import type { DomainReasonCode } from '@shared/ipc'

import type { SshManager } from '../../ssh/manager'

export const INGRESS_READ_COMMANDS = {
  listeners: "sudo -n ss -H -ltnp 'sport = :80 or sport = :443'",
  service:
    'systemctl show opspilot-caddy.service --property=LoadState,ActiveState,FragmentPath,ExecStart,MainPID --no-pager',
  marker: 'sudo -n cat /etc/opspilot/caddy/OWNER',
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
  local_assessment: 'clear' | 'blocked' | 'unknown'
  reason_code: DomainReasonCode | null
  listeners: IngressListener[]
  service: 'verified' | 'absent' | 'unknown'
  caddy_version: string | null
  ownership_marker: 'valid' | 'missing' | 'mismatch' | 'unknown'
  config_readable: boolean | null
  ufw: {
    state: IngressFirewallState
    inbound_80: IngressPortFirewallState
    inbound_443: IngressPortFirewallState
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
  const version = versionOutput === null ? null : versionOutput.match(/\bv?(\d+\.\d+\.\d+)\b/)?.[1] ?? null
  const serviceVerified = Boolean(
    serviceFacts?.loaded &&
      serviceFacts.active &&
      serviceFacts.fragmentPath === '/etc/systemd/system/opspilot-caddy.service' &&
      serviceFacts.execStart.includes('/usr/bin/caddy') &&
      serviceFacts.execStart.includes('/etc/opspilot/caddy/Caddyfile') &&
      serviceFacts.mainPid !== null &&
      markerStatus === 'valid' &&
      configReadable === true &&
      version !== null
  )
  const ownerStatus = classifyIngressOwnership(listeners, serviceFacts?.mainPid ?? null, serviceVerified)
  const firewall = parseUfw(successfulOutput(outputs.get('ufw')))
  const firewallBlocked = firewall.inbound_80 === 'blocked' || firewall.inbound_443 === 'blocked'
  const firewallKnown = firewall.state === 'inactive' ||
    (firewall.inbound_80 === 'allowed' && firewall.inbound_443 === 'allowed')
  const localAssessment = ownerStatus === 'conflict' || firewallBlocked
    ? 'blocked'
    : (ownerStatus === 'ports_free' || ownerStatus === 'opspilot_owned') && firewallKnown
      ? 'clear'
      : 'unknown'
  let reasonCode: DomainReasonCode | null = null
  if ([...outputs.values()].some((output) => output === null)) reasonCode = 'SSH_UNAVAILABLE'
  else if (ownerStatus === 'conflict') reasonCode = 'INGRESS_PORT_CONFLICT'
  else if (ownerStatus === 'unknown') reasonCode = 'INGRESS_OWNER_UNKNOWN'
  else if (firewall.inbound_80 === 'blocked') reasonCode = 'FIREWALL_80_BLOCKED'
  else if (firewall.inbound_443 === 'blocked') reasonCode = 'FIREWALL_443_BLOCKED'

  return {
    ownership: ownerStatus,
    local_assessment: localAssessment,
    reason_code: reasonCode,
    listeners: listeners ?? [],
    service: serviceVerified
      ? 'verified'
      : serviceOutput !== null && serviceFacts?.loadState === 'not-found' ? 'absent' : 'unknown',
    caddy_version: version,
    ownership_marker: markerStatus,
    config_readable: configReadable,
    ufw: firewall,
    route_activation: 'not_evaluated'
  }
}

export function parseIngressListeners(output: string): IngressListener[] {
  const listeners: IngressListener[] = []
  for (const line of output.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/)
    if (fields[0] !== 'LISTEN') continue
    const localAddress = fields[3]
    const portMatch = localAddress?.match(/:(80|443)$/)
    const port = Number(portMatch?.[1])
    if (port !== 80 && port !== 443) continue
    const processMatch = line.match(/users:\(\("([^"(),]+)"(?:,pid=(\d+))?/)
    listeners.push({
      port,
      family: localAddress?.startsWith('[') || localAddress?.startsWith('::')
        ? 'ipv6'
        : localAddress?.includes('.') ? 'ipv4' : 'unknown',
      process: processMatch ? processMatch[1] === 'caddy' ? 'caddy' : 'other' : 'unknown',
      pid: processMatch?.[2] ? Number(processMatch[2]) : null
    })
  }
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
  execStart: string
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
    execStart: properties.get('ExecStart') ?? '',
    mainPid
  }
}

function classifyIngressOwnership(
  listeners: IngressListener[] | null,
  serviceMainPid: number | null,
  serviceVerified: boolean
): IngressOwnership {
  if (listeners === null) return 'unknown'
  if (listeners.length === 0) return 'ports_free'
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
  if (output === null) {
    return { state: 'unknown', inbound_80: 'unknown', inbound_443: 'unknown' }
  }
  const status = output.match(/^Status:\s*(active|inactive)\s*$/im)?.[1]?.toLowerCase()
  if (status === 'inactive') {
    return { state: 'inactive', inbound_80: 'not_applicable', inbound_443: 'not_applicable' }
  }
  if (status !== 'active') {
    return { state: 'unknown', inbound_80: 'unknown', inbound_443: 'unknown' }
  }
  const defaultInbound = output.match(/^Default:\s*(allow|deny|reject)\s+\(incoming\)/im)?.[1]?.toLowerCase()
  const ruleState = (port: 80 | 443): IngressPortFirewallState => {
    const lines = output.split(/\r?\n/)
    const broadRule = (action: 'ALLOW' | 'DENY'): boolean => lines.some((line) => {
      const rule = line.trim()
      return new RegExp(`^${port}(?:/tcp)?\\s+${action}\\s+IN\\s+Anywhere(?:\\s|$)`, 'i').test(rule)
    })
    if (broadRule('DENY')) return 'blocked'
    if (broadRule('ALLOW') || defaultInbound === 'allow') return 'allowed'
    if (defaultInbound === 'deny' || defaultInbound === 'reject') return 'blocked'
    return 'unknown'
  }
  return {
    state: 'active',
    inbound_80: ruleState(80),
    inbound_443: ruleState(443)
  }
}
