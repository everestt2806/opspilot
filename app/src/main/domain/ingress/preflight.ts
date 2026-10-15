import type { DomainReasonCode } from '@shared/ipc'

import type { SshManager } from '../../ssh/manager'

export const INGRESS_READ_COMMANDS = {
  listeners: "sudo -n ss -H -ltnpn 'sport = :80 or sport = :443'",
  service:
    'systemctl show opspilot-caddy.service --property=LoadState,ActiveState,FragmentPath,ExecStart,MainPID --no-pager',
  marker: 'sudo -n cat /etc/opspilot/caddy/OWNER',
  configExists: 'sudo -n test -e /etc/opspilot/caddy/Caddyfile && printf "EXISTS\\n"',
  config: 'sudo -n test -r /etc/opspilot/caddy/Caddyfile && printf "READABLE\\n"',
  version: 'sudo -n /usr/bin/caddy version',
  ufw: 'sudo -n ufw status verbose'
} as const

export const OPERATOR_INGRESS_MARKER = 'opspilot-shared-ingress-v1'

export type IngressOwnership = 'ports_free' | 'opspilot_owned' | 'conflict' | 'unknown'
export type IngressFirewallState = 'active' | 'inactive' | 'unknown'
export type IngressPortFirewallState = 'allowed' | 'blocked' | 'not_applicable' | 'unknown'

export interface IngressListener {
  port: 80 | 443
  family: 'ipv4' | 'ipv6' | 'unknown'
  process: 'caddy' | 'other' | 'unknown'
  pid: number | null
}

export interface IngressPreflightResult {
  ownership: IngressOwnership
  ports_status: 'free' | 'occupied' | 'unknown'
  install_assessment: 'safe' | 'blocked' | 'unknown'
  local_assessment: 'clear' | 'blocked' | 'unknown'
  reason_code: DomainReasonCode | null
  listeners: IngressListener[]
  service: 'verified' | 'absent' | 'unknown'
  caddy_version: string | null
  ownership_marker: 'valid' | 'missing' | 'mismatch' | 'unknown'
  config_exists: boolean | null
  config_readable: boolean | null
  ufw: {
    state: IngressFirewallState
    inbound_80: IngressPortFirewallState
    inbound_443: IngressPortFirewallState
    inbound_80_ipv4: IngressPortFirewallState
    inbound_80_ipv6: IngressPortFirewallState
    inbound_443_ipv4: IngressPortFirewallState
    inbound_443_ipv6: IngressPortFirewallState
  }
  route_activation: 'not_evaluated'
}

interface CommandOutput {
  code: number
  stdout: string
  stderr: string
}

/** Read-only inventory. The command list is fixed and never contains user input. */
export async function preflightSharedIngress(
  ssh: SshManager,
  vpsId: number
): Promise<IngressPreflightResult> {
  const outputs = new Map<keyof typeof INGRESS_READ_COMMANDS, CommandOutput | null>()
  for (const [name, command] of Object.entries(INGRESS_READ_COMMANDS) as Array<
    [keyof typeof INGRESS_READ_COMMANDS, string]
  >) {
    try {
      const result = await ssh.exec(vpsId, command, { timeoutMs: 10_000 })
      outputs.set(name, { code: result.code, stdout: result.stdout, stderr: result.stderr })
    } catch {
      outputs.set(name, null)
    }
  }

  const listenerOutput = successfulOutput(outputs.get('listeners'))
  const listeners = listenerOutput === null ? null : parseIngressListeners(listenerOutput)
  const serviceOutput = successfulOutput(outputs.get('service'))
  const markerOutput = successfulOutput(outputs.get('marker'))
  const configExistsOutput = successfulOutput(outputs.get('configExists'))
  const configOutput = successfulOutput(outputs.get('config'))
  const versionOutput = successfulOutput(outputs.get('version'))
  const serviceFacts = serviceOutput === null ? null : parseServiceFacts(serviceOutput)
  const markerResult = outputs.get('marker')
  const markerStatus = markerOutput === null
    ? markerResult?.code === 1 && /no such file|cannot access/i.test(markerResult.stderr)
      ? 'missing'
      : 'unknown'
    : markerOutput.trim() === OPERATOR_INGRESS_MARKER ? 'valid' : 'mismatch'
  const configResult = outputs.get('config')
  const configReadable = configOutput === null
    ? configResult?.code === 1 && /no such file|cannot access/i.test(configResult.stderr)
      ? false
      : null
    : configOutput.trim() === 'READABLE'
  const configExistsResult = outputs.get('configExists')
  const configExists = configExistsOutput === null
    ? configExistsResult?.code === 1 && configExistsResult.stderr.trim() === ''
      ? false
      : null
    : configExistsOutput.trim() === 'EXISTS' ? true : null
  const version = versionOutput === null ? null : versionOutput.match(/\bv?(\d+\.\d+\.\d+)\b/)?.[1] ?? null
  const serviceVerified = Boolean(
    serviceFacts?.loaded &&
      serviceFacts.active &&
      serviceFacts.fragmentPath === '/etc/systemd/system/opspilot-caddy.service' &&
      serviceFacts.execPath === '/usr/bin/caddy' &&
      serviceFacts.argv[0] === '/usr/bin/caddy' &&
      serviceFacts.argv.filter((argument) => argument === '--config').length === 1 &&
      serviceFacts.argv.includes('--config') &&
      serviceFacts.argv[serviceFacts.argv.indexOf('--config') + 1] === '/etc/opspilot/caddy/Caddyfile' &&
      serviceFacts.mainPid !== null &&
      markerStatus === 'valid' &&
      configReadable === true &&
      version !== null
  )
  const ownerStatus = classifyIngressOwnership(
    listeners,
    serviceFacts?.mainPid ?? null,
    serviceFacts?.active ?? false,
    serviceVerified
  )
  const firewall = parseUfw(successfulOutput(outputs.get('ufw')))
  const portsStatus = listeners === null
    ? 'unknown'
    : listeners.length === 0 ? 'free' : 'occupied'
  const firewallBlocked = firewall.inbound_80 === 'blocked' || firewall.inbound_443 === 'blocked'
  const firewallKnown = firewall.state === 'inactive' ||
    (firewall.inbound_80 === 'allowed' && firewall.inbound_443 === 'allowed')
  const cleanInstall = serviceFacts?.loadState === 'not-found' &&
    markerStatus === 'missing' && configExists === false
  const ingressWriteSafe = serviceVerified || cleanInstall
  const localAssessment = ownerStatus === 'conflict' || firewallBlocked
    ? 'blocked'
    : ingressWriteSafe && (ownerStatus === 'ports_free' || ownerStatus === 'opspilot_owned') && firewallKnown
      ? 'clear'
      : 'unknown'
  const installAssessment = localAssessment === 'clear'
    ? 'safe'
    : localAssessment === 'blocked' ? 'blocked' : 'unknown'
  let reasonCode: DomainReasonCode | null = null
  if ([...outputs.values()].some((output) => output === null)) reasonCode = 'SSH_UNAVAILABLE'
  else if (ownerStatus === 'conflict') reasonCode = 'INGRESS_PORT_CONFLICT'
  else if (ownerStatus === 'unknown') reasonCode = 'INGRESS_OWNER_UNKNOWN'
  else if (!ingressWriteSafe) reasonCode = 'INGRESS_OWNER_UNKNOWN'
  else if (firewall.inbound_80 === 'blocked') reasonCode = 'FIREWALL_80_BLOCKED'
  else if (firewall.inbound_443 === 'blocked') reasonCode = 'FIREWALL_443_BLOCKED'

  return {
    ownership: ownerStatus,
    ports_status: portsStatus,
    install_assessment: installAssessment,
    local_assessment: localAssessment,
    reason_code: reasonCode,
    listeners: listeners ?? [],
    service: serviceVerified
      ? 'verified'
      : serviceOutput !== null && serviceFacts?.loadState === 'not-found' ? 'absent' : 'unknown',
    caddy_version: version,
    ownership_marker: markerStatus,
    config_exists: configExists,
    config_readable: configReadable,
    ufw: firewall,
    route_activation: 'not_evaluated'
  }
}

export function parseIngressListeners(output: string): IngressListener[] | null {
  if (output === '') return []
  const listeners: IngressListener[] = []
  const lines = output.split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop()
  for (const line of lines) {
    const match = line.match(/^LISTEN\s+\d+\s+\d+\s+(\S+)\s+(\S+)(?:\s+users:\(\("([^"(),]+)",pid=(\d+),fd=\d+\)\))?$/)
    if (!match) return null
    const localAddress = match[1]
    const portMatch = localAddress.match(/:(\d+)$/)
    if (!portMatch) return null
    const port = Number(portMatch[1])
    if (port !== 80 && port !== 443) return null
    const processName = match[3]
    listeners.push({
      port: port as 80 | 443,
      family: localAddress.startsWith('[') || localAddress.startsWith('::')
        ? 'ipv6'
        : localAddress.includes('.') || localAddress.startsWith('*:') ? 'ipv4' : 'unknown',
      process: processName ? processName === 'caddy' ? 'caddy' : 'other' : 'unknown',
      pid: match[4] ? Number(match[4]) : null
    })
  }
  if (listeners.some((listener) => listener.family === 'unknown')) return null
  return listeners
}

function successfulOutput(output: CommandOutput | null | undefined): string | null {
  return output?.code === 0 ? output.stdout : null
}

function parseServiceFacts(output: string): {
  loadState: string | null
  loaded: boolean
  active: boolean
  fragmentPath: string | null
  execPath: string | null
  argv: string[]
  mainPid: number | null
} {
  const properties = new Map<string, string>()
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf('=')
    if (separator > 0) properties.set(line.slice(0, separator), line.slice(separator + 1))
  }
  const mainPidValue = properties.get('MainPID')
  const mainPid = mainPidValue && /^\d+$/.test(mainPidValue) && Number(mainPidValue) > 0
    ? Number(mainPidValue)
    : null
  return {
    loadState: properties.get('LoadState') ?? null,
    loaded: properties.get('LoadState') === 'loaded',
    active: properties.get('ActiveState') === 'active',
    fragmentPath: properties.get('FragmentPath') ?? null,
    execPath: properties.get('ExecStart')?.match(/(?:^|\{\s*)path=([^\s;]+)(?:\s*;|\s*\})/)?.[1] ?? null,
    argv: parseExecArgv(properties.get('ExecStart') ?? ''),
    mainPid
  }
}

function parseExecArgv(execStart: string): string[] {
  const value = execStart.match(/(?:^|;\s*)argv\[\]=(.+?)(?:\s*;\s*(?:ignore_errors|start_time|stop_time|pid)|\s*\}\s*$)/)?.[1]
  if (!value || /["'\\]/.test(value)) return []
  return value.trim().split(/\s+/)
}

function classifyIngressOwnership(
  listeners: IngressListener[] | null,
  serviceMainPid: number | null,
  serviceActive: boolean,
  serviceVerified: boolean
): IngressOwnership {
  if (listeners === null) return 'unknown'
  if (listeners.length === 0) return serviceActive ? 'unknown' : 'ports_free'
  if (listeners.some((listener) => listener.process === 'other')) return 'conflict'
  if (
    serviceVerified &&
    listeners.every(
      (listener) => listener.process === 'caddy' && listener.pid === serviceMainPid
    )
  ) {
    return 'opspilot_owned'
  }
  return 'unknown'
}

function parseUfw(output: string | null): IngressPreflightResult['ufw'] {
  const unknown = {
    state: 'unknown' as const,
    inbound_80: 'unknown' as const,
    inbound_443: 'unknown' as const,
    inbound_80_ipv4: 'unknown' as const,
    inbound_80_ipv6: 'unknown' as const,
    inbound_443_ipv4: 'unknown' as const,
    inbound_443_ipv6: 'unknown' as const
  }
  if (output === null) {
    return unknown
  }
  let status: 'active' | 'inactive' | null = null
  let defaultInbound: 'allow' | 'deny' | 'reject' | null = null
  const rules: Array<{ port: string; action: string; family: 'ipv4' | 'ipv6'; broad: boolean }> = []
  let afterDefault = false
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const statusMatch = line.match(/^Status:\s*(active|inactive)$/i)
    if (statusMatch) {
      if (status !== null) return unknown
      status = statusMatch[1].toLowerCase() as 'active' | 'inactive'
      continue
    }
    if (/^Logging:\s+(?:on(?:\s+\([^)]+\))?|off)$/i.test(line)) continue
    const defaultMatch = line.match(/^Default:\s*(allow|deny|reject)\s+\(incoming\),\s*(allow|deny|reject)\s+\(outgoing\),\s*(allow|deny|reject|disabled)\s+\(routed\)$/i)
    if (defaultMatch) {
      if (defaultInbound !== null) return unknown
      defaultInbound = defaultMatch[1].toLowerCase() as 'allow' | 'deny' | 'reject'
      afterDefault = true
      continue
    }
    if (/^New profiles:\s*.*$/i.test(line) || /^To\s+Action\s+From$/i.test(line)) continue
    if (!/^[^\s]+\s+(ALLOW|DENY|REJECT)\s+IN\s+[^\s]+(?:\s+\(v6\))?$/i.test(line)) return unknown
    if (!afterDefault) return unknown
    const [, port, action, from] = line.match(/^([^\s]+)\s+(ALLOW|DENY|REJECT)\s+IN\s+([^\s]+)(?:\s+\(v6\))?$/i) ?? []
    const family: 'ipv4' | 'ipv6' = /\(v6\)$/i.test(line) ? 'ipv6' : 'ipv4'
    rules.push({ port, action: action.toUpperCase(), family, broad: from === 'Anywhere' })
  }
  if (status === 'inactive') {
    return {
      state: 'inactive', inbound_80: 'not_applicable', inbound_443: 'not_applicable',
      inbound_80_ipv4: 'not_applicable', inbound_80_ipv6: 'not_applicable',
      inbound_443_ipv4: 'not_applicable', inbound_443_ipv6: 'not_applicable'
    }
  }
  if (status !== 'active' || !defaultInbound) return unknown
  const familyState = (port: 80 | 443, family: 'ipv4' | 'ipv6'): IngressPortFirewallState => {
    const matchingRules = rules.filter((rule) =>
      rule.family === family && (rule.port === `${port}/tcp` || rule.port === `${port}`)
    )
    const actions = new Set(matchingRules.map((entry) => entry.action))
    if (actions.size > 1) return 'unknown'
    const broadActions = new Set(matchingRules.filter((rule) => rule.broad).map((rule) => rule.action))
    if (broadActions.size > 1) return 'unknown'
    if (actions.has('REJECT')) return broadActions.has('REJECT') ? 'blocked' : 'unknown'
    if (broadActions.has('ALLOW')) return 'allowed'
    if (broadActions.has('DENY')) return 'blocked'
    if (defaultInbound === 'allow') return actions.has('DENY') ? 'unknown' : 'allowed'
    if (defaultInbound === 'deny' || defaultInbound === 'reject') return 'blocked'
    return 'unknown'
  }
  const combine = (a: IngressPortFirewallState, b: IngressPortFirewallState): IngressPortFirewallState =>
    a === 'unknown' || b === 'unknown'
      ? 'unknown'
      : a === b ? a : a === 'blocked' || b === 'blocked' ? 'blocked' : 'unknown'
  const p80v4 = familyState(80, 'ipv4')
  const p80v6 = familyState(80, 'ipv6')
  const p443v4 = familyState(443, 'ipv4')
  const p443v6 = familyState(443, 'ipv6')
  return {
    state: 'active',
    inbound_80: combine(p80v4, p80v6), inbound_443: combine(p443v4, p443v6),
    inbound_80_ipv4: p80v4, inbound_80_ipv6: p80v6,
    inbound_443_ipv4: p443v4, inbound_443_ipv6: p443v6
  }
}
