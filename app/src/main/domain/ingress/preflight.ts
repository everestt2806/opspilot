import type { DomainReasonCode } from '@shared/ipc'

import type { SshManager } from '../../ssh/manager'

export const INGRESS_READ_COMMANDS = {
  listeners: "sudo -n ss -H -ltnpn 'sport = :80 or sport = :443'",
  platform: "grep -E '^(ID|VERSION_ID)=' /etc/os-release && uname -m",
  binary: `sudo -n sh -c '\
if [ -L /usr/bin/caddy ]; then printf "KIND=symlink\\n"; readlink -- /usr/bin/caddy | sed "s/^/LINK=/"; readlink -e -- /usr/bin/caddy | sed "s/^/RESOLVED=/" || printf "RESOLVE=failed\\n"; \
elif [ -e /usr/bin/caddy ]; then printf "KIND=other\\n"; \
else printf "KIND=missing\\n"; fi; \
if command -v dpkg-query >/dev/null 2>&1; then \
  if dpkg-query -S -- /usr/bin/caddy >/dev/null 2>&1; then dpkg-query -S -- /usr/bin/caddy | sed "s/^/PACKAGE=/"; \
  else result=$?; if [ "$result" -eq 1 ]; then printf "PACKAGE=none\\n"; else printf "PACKAGE=unknown\\n"; fi; fi; \
  resolved=$(readlink -e -- /usr/bin/caddy 2>/dev/null || true); \
  if [ -n "$resolved" ]; then \
    if dpkg-query -S -- "$resolved" >/dev/null 2>&1; then dpkg-query -S -- "$resolved" | sed "s/^/TARGET_PACKAGE=/"; \
    else result=$?; if [ "$result" -eq 1 ]; then printf "TARGET_PACKAGE=none\\n"; else printf "TARGET_PACKAGE=unknown\\n"; fi; fi; \
  elif [ ! -e /usr/bin/caddy ] && [ ! -L /usr/bin/caddy ]; then printf "TARGET_PACKAGE=none\\n"; \
  else printf "TARGET_PACKAGE=unknown\\n"; fi; \
else printf "PACKAGE=unknown\\nTARGET_PACKAGE=unknown\\n"; fi; \
if [ -L /usr/bin/caddy ]; then \
  target=$(readlink -- /usr/bin/caddy 2>/dev/null || true); \
  if printf "%s\\n" "$target" | grep -Eq '^/usr/local/lib/opspilot-caddy/versions/[0-9]+\\.[0-9]+\\.[0-9]+/caddy$' && \
     [ "$(readlink -e -- /usr/bin/caddy 2>/dev/null || true)" = "$target" ] && [ -f "$target" ] && [ ! -L "$target" ]; then \
    size=$(stat -c %s -- "$target" 2>/dev/null || printf 0); links=$(stat -c %h -- "$target" 2>/dev/null || printf 0); \
    if [ "$size" -le 104857600 ] && [ "$links" -eq 1 ]; then sha256sum -- "$target" | awk '{print "BINARY_SHA256=" $1}'; \
    else printf "BINARY_SHA256=unknown\\n"; fi; \
  else printf "BINARY_SHA256=unknown\\n"; fi; \
else printf "BINARY_SHA256=unknown\\n"; fi'`,
  pathFacts: `sudo -n sh -c '\
inspect() { path="$1"; if [ -L "$path" ]; then metadata=$(stat -c "%U|%G|%a|%h" -- "$path" 2>/dev/null) || metadata="unknown|unknown|unknown|unknown"; printf "%s|SYMLINK|%s|%s\\n" "$path" "$metadata" "$(readlink -- "$path" 2>/dev/null || printf unknown)"; \
elif [ -e "$path" ]; then stat -c "%n|%F|%U|%G|%a|%h|" -- "$path"; \
else printf "%s|MISSING|||||\\n" "$path"; fi; }; \
for path in /usr /usr/bin /usr/bin/caddy /usr/local /usr/local/lib /usr/local/lib/opspilot-caddy /usr/local/lib/opspilot-caddy/versions \
/etc /etc/systemd /etc/systemd/system /etc/systemd/system/opspilot-caddy.service /etc/opspilot /etc/opspilot/caddy \
/etc/opspilot/caddy/OWNER /etc/opspilot/caddy/INSTALLATION /etc/opspilot/caddy/Caddyfile \
/var /var/lib /var/lib/opspilot /var/lib/opspilot/caddy /var/lib/opspilot/caddy/production; do inspect "$path"; done; \
target=$(readlink -- /usr/bin/caddy 2>/dev/null || true); \
if printf "%s\\n" "$target" | grep -Eq '^/usr/local/lib/opspilot-caddy/versions/[0-9]+\\.[0-9]+\\.[0-9]+/caddy$'; then \
  version_dir=\${target%/caddy}; inspect "$version_dir"; inspect "$target"; \
else printf "DYNAMIC_BINARY_PATH=INVALID\\n"; fi'`,
  installation: `sudo -n sh -c 'if [ -L /etc/opspilot/caddy/INSTALLATION ]; then printf "KIND=symlink\\n"; elif [ -f /etc/opspilot/caddy/INSTALLATION ]; then printf "KIND=regular\\n"; cat /etc/opspilot/caddy/INSTALLATION; elif [ -e /etc/opspilot/caddy/INSTALLATION ]; then printf "KIND=other\\n"; else printf "KIND=missing\\n"; fi'`,
  service:
    'systemctl show opspilot-caddy.service --property=LoadState,ActiveState,FragmentPath,ExecStart,MainPID --no-pager',
  distroCaddyService:
    'systemctl show caddy.service --property=LoadState,ActiveState,FragmentPath --no-pager',
  distroCaddyApiService:
    'systemctl show caddy-api.service --property=LoadState,ActiveState,FragmentPath --no-pager',
  marker: 'sudo -n cat /etc/opspilot/caddy/OWNER',
  markerPath: `sudo -n sh -c 'if [ -L /etc/opspilot/caddy/OWNER ]; then printf "SYMLINK\\n"; elif [ -f /etc/opspilot/caddy/OWNER ]; then printf "REGULAR\\n"; elif [ -e /etc/opspilot/caddy/OWNER ]; then printf "OTHER\\n"; else printf "MISSING\\n"; fi'`,
  configPath: `sudo -n sh -c 'if [ -L /etc/opspilot/caddy/Caddyfile ]; then printf "SYMLINK\\n"; elif [ -f /etc/opspilot/caddy/Caddyfile ]; then printf "REGULAR\\n"; elif [ -e /etc/opspilot/caddy/Caddyfile ]; then printf "OTHER\\n"; else printf "MISSING\\n"; fi'`,
  config: 'sudo -n test -r /etc/opspilot/caddy/Caddyfile && printf "READABLE\\n"',
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
  const platformOutput = successfulOutput(outputs.get('platform'))
  const hostFacts = platformOutput === null ? null : parseSupportedHost(platformOutput)
  const hostSupport = hostFacts?.supported ?? null
  const binaryOutput = successfulOutput(outputs.get('binary'))
  const binaryFacts = binaryOutput === null ? null : parseBinaryFacts(binaryOutput)
  const pathFactsOutput = successfulOutput(outputs.get('pathFacts'))
  const pathFacts = pathFactsOutput === null ? null : parsePathFacts(pathFactsOutput)
  const pathAncestorsSafe = pathFacts !== null && pathFacts.every(
    (fact) => fact.kind !== 'SYMLINK' || fact.path === '/usr/bin/caddy'
  )
  const managedPathsValid = pathFacts !== null && validateManagedPaths(pathFacts, binaryFacts)
  const installationOutput = successfulOutput(outputs.get('installation'))
  const installation = installationOutput === null ? null : parseInstallationManifest(installationOutput)
  const serviceOutput = successfulOutput(outputs.get('service'))
  const distroServiceOutput = successfulOutput(outputs.get('distroCaddyService'))
  const distroApiServiceOutput = successfulOutput(outputs.get('distroCaddyApiService'))
  const markerOutput = successfulOutput(outputs.get('marker'))
  const markerPathOutput = successfulOutput(outputs.get('markerPath'))
  const configPathOutput = successfulOutput(outputs.get('configPath'))
  const configOutput = successfulOutput(outputs.get('config'))
  const serviceFacts = serviceOutput === null ? null : parseServiceFacts(serviceOutput)
  const markerPath = markerPathOutput?.trim()
  const markerStatus = markerPath === 'MISSING'
    ? 'missing'
    : markerPath === 'REGULAR' && markerOutput !== null
      ? markerOutput.trim() === OPERATOR_INGRESS_MARKER ? 'valid' : 'mismatch'
      : markerPath === 'SYMLINK' || markerPath === 'OTHER' ? 'mismatch' : 'unknown'
  const configReadable = configOutput === null
    ? configPathOutput?.trim() === 'MISSING' ? false : null
    : configPathOutput?.trim() === 'REGULAR' && configOutput.trim() === 'READABLE'
  const configExists = configPathOutput === null
    ? null
    : configPathOutput.trim() === 'MISSING' ? false : true
  const version = installation?.version ?? null
  const installationVerified = Boolean(
    installation &&
    installation.architecture === hostFacts?.architecture &&
    installation.repositoryChannel === 'stable' &&
    installation.packageSha256 !== null &&
    installation.binarySha256 !== null &&
    binaryFacts?.binarySha256 === installation.binarySha256 &&
    binaryFacts?.versionFromTarget === installation.version
  )
  const distroUnits = [distroServiceOutput, distroApiServiceOutput]
  const distroUnitState = distroUnits.some((output) => output === null)
    ? 'unknown'
    : distroUnits.every((output) => parseServiceLoadState(output) === 'not-found')
      ? 'absent'
      : distroUnits.some((output) => parseServiceLoadState(output) !== 'not-found')
        ? 'present'
        : 'unknown'
  const serviceVerified = Boolean(
      hostSupport === true &&
      binaryFacts?.safeManagedBinary &&
      pathAncestorsSafe &&
      managedPathsValid &&
      installationVerified &&
      distroUnitState === 'absent' &&
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
  const ingressWriteSafe = serviceVerified
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
  else if (
    hostSupport !== true || binaryFacts?.packageOwner !== 'none' || distroUnitState !== 'absent' ||
    !pathAncestorsSafe || !managedPathsValid || !installationVerified
  ) reasonCode = 'INGRESS_OWNER_UNKNOWN'
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

function parseSupportedHost(output: string): { supported: boolean; architecture: string } | null {
  const lines = output.trim().split(/\r?\n/)
  const properties = new Map<string, string>()
  for (const line of lines) {
    const match = line.match(/^(ID|VERSION_ID)=(.+)$/)
    if (match) properties.set(match[1], match[2].replace(/^['"]|['"]$/g, ''))
  }
  const arch = lines.at(-1)?.trim()
  if (!properties.has('ID') || !properties.has('VERSION_ID') || !arch) return null
  const supportedDistro =
    (properties.get('ID') === 'debian' && properties.get('VERSION_ID') === '12') ||
    (properties.get('ID') === 'ubuntu' && ['22.04', '24.04'].includes(properties.get('VERSION_ID') ?? ''))
  const architecture = arch === 'x86_64' ? 'amd64' : arch === 'aarch64' ? 'arm64' : arch
  return { supported: supportedDistro && ['amd64', 'arm64'].includes(architecture), architecture }
}

function parseBinaryFacts(output: string): {
  kind: 'missing' | 'symlink' | 'other' | 'unknown',
  packageOwner: 'none' | 'owned' | 'unknown',
  binarySha256: string | null
  versionFromTarget: string | null
  safeManagedBinary: boolean
} {
  const values = new Map<string, string[]>()
  for (const line of output.split(/\r?\n/)) {
    const separator = line.indexOf('=')
    if (separator < 1) continue
    const key = line.slice(0, separator)
    values.set(key, [...(values.get(key) ?? []), line.slice(separator + 1)])
  }
  const kindValue = values.get('KIND')
  const kind = kindValue?.length === 1 && ['missing', 'symlink', 'other'].includes(kindValue[0])
    ? kindValue[0] as 'missing' | 'symlink' | 'other'
    : 'unknown'
  const packageValues = values.get('PACKAGE')
  const targetPackageValues = values.get('TARGET_PACKAGE')
  const packageOwner = packageValues?.length === 1 && targetPackageValues?.length === 1
    ? packageValues[0] === 'none' && targetPackageValues[0] === 'none'
      ? 'none'
      : packageValues[0] === 'unknown' || targetPackageValues[0] === 'unknown' ? 'unknown' : 'owned'
    : 'unknown'
  const link = values.get('LINK')?.[0]
  const resolved = values.get('RESOLVED')?.[0]
  const versionFromTarget = link?.match(/^\/usr\/local\/lib\/opspilot-caddy\/versions\/(\d+\.\d+\.\d+)\/caddy$/)?.[1] ?? null
  const binarySha256Value = values.get('BINARY_SHA256')
  const binarySha256 = binarySha256Value?.length === 1 && /^[a-f0-9]{64}$/.test(binarySha256Value[0])
    ? binarySha256Value[0]
    : null
  const pathMatchesVersion = versionFromTarget !== null && link === resolved
  return {
    kind,
    packageOwner,
    binarySha256,
    versionFromTarget,
    safeManagedBinary: kind === 'symlink' && packageOwner === 'none' && binarySha256 !== null && pathMatchesVersion
  }
}

interface PathFact {
  path: string
  kind: string
  owner: string | null
  group: string | null
  mode: string | null
  links: number | null
  target: string | null
}

function parsePathFacts(output: string): PathFact[] | null {
  const facts: PathFact[] = []
  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    const [path, kind, owner, group, mode, links, target] = line.split('|')
    if (!path?.startsWith('/') || !kind || line.split('|').length !== 7) return null
    if (kind === 'MISSING') {
      facts.push({ path, kind, owner: null, group: null, mode: null, links: null, target: null })
      continue
    }
    if (kind === 'SYMLINK') {
      facts.push({ path, kind, owner, group, mode, links: Number(links), target })
      continue
    }
    if (!owner || !group || !/^\d{3,4}$/.test(mode ?? '') || !/^\d+$/.test(links ?? '')) return null
    facts.push({ path, kind, owner, group, mode, links: Number(links), target: null })
  }
  return facts.length > 0 ? facts : null
}

function validateManagedPaths(facts: PathFact[], binary: ReturnType<typeof parseBinaryFacts> | null): boolean {
  const byPath = new Map(facts.map((fact) => [fact.path, fact]))
  const expectedDirectories: Record<string, [string, string, string]> = {
    '/usr': ['root', 'root', '755'],
    '/usr/bin': ['root', 'root', '755'],
    '/usr/local': ['root', 'root', '755'],
    '/usr/local/lib': ['root', 'root', '755'],
    '/usr/local/lib/opspilot-caddy': ['root', 'root', '755'],
    '/usr/local/lib/opspilot-caddy/versions': ['root', 'root', '755'],
    '/etc': ['root', 'root', '755'],
    '/etc/systemd': ['root', 'root', '755'],
    '/etc/systemd/system': ['root', 'root', '755'],
    '/etc/opspilot': ['root', 'root', '755'],
    '/etc/opspilot/caddy': ['root', 'opspilot-caddy', '750'],
    '/var': ['root', 'root', '755'],
    '/var/lib': ['root', 'root', '755'],
    '/var/lib/opspilot': ['root', 'root', '755'],
    '/var/lib/opspilot/caddy': ['opspilot-caddy', 'opspilot-caddy', '700'],
    '/var/lib/opspilot/caddy/production': ['opspilot-caddy', 'opspilot-caddy', '700']
  }
  for (const [path, [owner, group, mode]] of Object.entries(expectedDirectories)) {
    if (!hasPathMetadata(byPath.get(path), 'directory', owner, group, mode)) return false
  }
  if (!binary?.versionFromTarget) return false
  const binaryTarget = `/usr/local/lib/opspilot-caddy/versions/${binary.versionFromTarget}/caddy`
  if (!hasPathMetadata(byPath.get(`/usr/local/lib/opspilot-caddy/versions/${binary.versionFromTarget}`), 'directory', 'root', 'root', '755')) return false
  return hasPathMetadata(byPath.get('/usr/bin/caddy'), 'SYMLINK', 'root', 'root', '777') &&
    byPath.get('/usr/bin/caddy')?.target === binaryTarget &&
    hasPathMetadata(byPath.get(binaryTarget), 'regular file', 'root', 'root', '755', 1) &&
    hasPathMetadata(byPath.get('/etc/systemd/system/opspilot-caddy.service'), 'regular file', 'root', 'root', '644', 1) &&
    hasPathMetadata(byPath.get('/etc/opspilot/caddy/OWNER'), 'regular file', 'root', 'root', '644', 1) &&
    hasPathMetadata(byPath.get('/etc/opspilot/caddy/INSTALLATION'), 'regular file', 'root', 'root', '644', 1) &&
    hasPathMetadata(byPath.get('/etc/opspilot/caddy/Caddyfile'), 'regular file', 'root', 'opspilot-caddy', '640', 1)
}

function hasPathMetadata(
  fact: PathFact | undefined,
  kind: string,
  owner: string,
  group: string,
  mode: string,
  links?: number
): boolean {
  return Boolean(
    fact && fact.kind === kind && fact.owner === owner && fact.group === group && fact.mode === mode &&
    (links === undefined || fact.links === links)
  )
}

function parseInstallationManifest(output: string): {
  version: string
  architecture: string
  repositoryChannel: string
  packageSha256: string | null
  binarySha256: string | null
} | null {
  const [kindLine, ...manifestLines] = output.trimEnd().split(/\r?\n/)
  if (kindLine !== 'KIND=regular') return null
  const values = new Map<string, string>()
  for (const line of manifestLines) {
    const match = line.match(/^([a-z0-9_]+)=([^\r\n]+)$/)
    if (!match || values.has(match[1])) return null
    values.set(match[1], match[2])
  }
  if (values.size !== 6 || values.get('format') !== 'opspilot-caddy-installation-v1') return null
  const version = values.get('version')
  const architecture = values.get('architecture')
  const repositoryChannel = values.get('repository_channel')
  const packageSha256 = values.get('package_sha256')
  const binarySha256 = values.get('binary_sha256')
  if (!version || !/^\d+\.\d+\.\d+$/.test(version) || !architecture || !repositoryChannel) return null
  return {
    version,
    architecture,
    repositoryChannel,
    packageSha256: packageSha256 && /^[a-f0-9]{64}$/.test(packageSha256) ? packageSha256 : null,
    binarySha256: binarySha256 && /^[a-f0-9]{64}$/.test(binarySha256) ? binarySha256 : null
  }
}

function parseServiceLoadState(output: string | null): string | null {
  if (output === null) return null
  const match = output.match(/^LoadState=([^\r\n]+)$/m)
  return match?.[1] ?? null
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
