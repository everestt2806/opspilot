import { describe, expect, it, vi } from 'vitest'

import type { SshManager } from '../../ssh/manager'
import {
  INGRESS_READ_COMMANDS,
  OPERATOR_INGRESS_MARKER,
  EXPECTED_OPSPILOT_UNIT,
  preflightSharedIngress
} from './preflight'

const verifiedService = [
  'LoadState=loaded',
  'ActiveState=active',
  'FragmentPath=/etc/systemd/system/opspilot-caddy.service',
  'DropInPaths=',
  'ExecStartPre={ path=/usr/bin/caddy ; argv[]=/usr/bin/caddy validate --config /etc/opspilot/caddy/Caddyfile --adapter caddyfile ; }',
  'ExecStart={ path=/usr/bin/caddy ; argv[]=/usr/bin/caddy run --config /etc/opspilot/caddy/Caddyfile --adapter caddyfile ; }',
  'ExecReload={ path=/usr/bin/caddy ; argv[]=/usr/bin/caddy reload --config /etc/opspilot/caddy/Caddyfile --adapter caddyfile --force ; }',
  'User=opspilot-caddy', 'Group=opspilot-caddy', 'Type=notify',
  'WorkingDirectory=/etc/opspilot/caddy', 'Environment=HOME=/var/lib/opspilot/caddy',
  'UMask=0077', 'Restart=on-failure', 'RestartUSec=2s', 'TimeoutStopUSec=5s',
  'LimitNOFILE=1048576', 'NoNewPrivileges=yes', 'PrivateTmp=yes', 'ProtectSystem=strict',
  'ProtectHome=yes', 'ProtectKernelTunables=yes', 'ProtectKernelModules=yes',
  'ProtectControlGroups=yes', 'RestrictSUIDSGID=yes', 'LockPersonality=yes',
  'CapabilityBoundingSet=cap_net_bind_service', 'AmbientCapabilities=cap_net_bind_service',
  'ReadWritePaths=/var/lib/opspilot/caddy',
  'MainPID=41'
].join('\n')
const missingBinary = { code: 0, stdout: 'KIND=missing\nPACKAGE=none\nTARGET_PACKAGE=none\n', stderr: '' }
const binaryHash = 'a'.repeat(64)
const packageHash = 'b'.repeat(64)
const versionedBinaryPath = '/usr/local/lib/opspilot-caddy/versions/2.9.1/caddy'

function managedPathFacts(): string {
  const directories = [
    '/usr', '/usr/bin', '/usr/local', '/usr/local/lib', '/usr/local/lib/opspilot-caddy',
    '/usr/local/lib/opspilot-caddy/versions', '/usr/local/lib/opspilot-caddy/versions/2.9.1',
    '/etc', '/etc/systemd', '/etc/systemd/system', '/etc/opspilot',
    '/var', '/var/lib', '/var/lib/opspilot'
  ].map((path) => `${path}|directory|root|root|755|1|`)
  const files = [
    `${versionedBinaryPath}|regular file|root|root|755|1|`,
    '/etc/systemd/system/opspilot-caddy.service|regular file|root|root|644|1|',
    '/etc/opspilot/caddy/OWNER|regular file|root|root|644|1|',
    '/etc/opspilot/caddy/INSTALLATION|regular file|root|root|644|1|',
    '/etc/opspilot/caddy/Caddyfile|regular file|root|opspilot-caddy|640|1|'
  ]
  return [
    ...directories,
    `/usr/bin/caddy|SYMLINK|root|root|777|1|${versionedBinaryPath}`,
    '/etc/opspilot/caddy|directory|root|opspilot-caddy|750|1|',
    '/var/lib/opspilot/caddy|directory|opspilot-caddy|opspilot-caddy|700|1|',
    '/var/lib/opspilot/caddy/production|directory|opspilot-caddy|opspilot-caddy|700|1|',
    ...files
  ].join('\n')
}

function cleanPathFacts(): string {
  const parents = [
    '/usr', '/usr/bin', '/usr/local', '/usr/local/lib', '/etc', '/etc/systemd',
    '/etc/systemd/system', '/var', '/var/lib'
  ].map((path) => `${path}|directory|root|root|755|1|`)
  const missing = [
    '/usr/bin/caddy', '/usr/local/lib/opspilot-caddy', '/etc/opspilot',
    '/etc/systemd/system/opspilot-caddy.service', '/var/lib/opspilot',
    '/etc/opspilot/caddy/OWNER', '/etc/opspilot/caddy/INSTALLATION',
    '/etc/opspilot/caddy/Caddyfile', '/var/lib/opspilot/caddy',
    '/var/lib/opspilot/caddy/production'
  ].map((path) => `${path}|MISSING|||||`)
  return [...parents, ...missing].join('\n')
}

const validInstallation = {
  code: 0,
  stdout: `KIND=regular\nformat=opspilot-caddy-installation-v1\nversion=2.9.1\narchitecture=amd64\nrepository_channel=stable\npackage_sha256=${packageHash}\nbinary_sha256=${binaryHash}\n`,
  stderr: ''
}

function fakeSsh(overrides: Partial<Record<keyof typeof INGRESS_READ_COMMANDS, {
  code: number
  stdout: string
  stderr: string
}>> = {}): { ssh: SshManager; exec: ReturnType<typeof vi.fn> } {
  const defaults = {
    listeners: {
      code: 0,
      stdout: [
        'LISTEN 0 4096 0.0.0.0:80 0.0.0.0:* users:(("caddy",pid=41,fd=7))',
        'LISTEN 0 4096 [::]:443 [::]:* users:(("caddy",pid=41,fd=8))'
      ].join('\n'),
      stderr: ''
    },
    platform: { code: 0, stdout: 'ID=debian\nVERSION_ID="12"\nx86_64\n', stderr: '' },
    binary: {
      code: 0,
      stdout: `KIND=symlink\nLINK=${versionedBinaryPath}\nRESOLVED=${versionedBinaryPath}\nPACKAGE=none\nTARGET_PACKAGE=none\nBINARY_SHA256=${binaryHash}\n`,
      stderr: ''
    },
    pathFacts: { code: 0, stdout: managedPathFacts(), stderr: '' },
    installation: validInstallation,
    service: { code: 0, stdout: verifiedService, stderr: '' },
    serviceUnit: { code: 0, stdout: EXPECTED_OPSPILOT_UNIT, stderr: '' },
    distroCaddyService: { code: 0, stdout: 'LoadState=not-found\nActiveState=inactive', stderr: '' },
    distroCaddyApiService: { code: 0, stdout: 'LoadState=not-found\nActiveState=inactive', stderr: '' },
    competingProxyServices: {
      code: 0,
      stdout: 'nginx.service=not-found\napache2.service=not-found\nhttpd.service=not-found\ntraefik.service=not-found\nhaproxy.service=not-found\n',
      stderr: ''
    },
    marker: { code: 0, stdout: `${OPERATOR_INGRESS_MARKER}\n`, stderr: '' },
    markerPath: { code: 0, stdout: 'REGULAR\n', stderr: '' },
    configPath: { code: 0, stdout: 'REGULAR\n', stderr: '' },
    config: { code: 0, stdout: 'READABLE\n', stderr: '' },
    ufw: {
      code: 0,
      stdout: 'Status: active\nDefault: deny (incoming), allow (outgoing), disabled (routed)\n80/tcp ALLOW IN Anywhere\n80/tcp ALLOW IN Anywhere (v6)\n443/tcp ALLOW IN Anywhere\n443/tcp ALLOW IN Anywhere (v6)',
      stderr: ''
    }
  }
  const responses = { ...defaults, ...overrides }
  const exec = vi.fn(async (_vpsId: number, command: string) => {
    const name = Object.entries(INGRESS_READ_COMMANDS).find(([, fixed]) => fixed === command)?.[0] as
      keyof typeof INGRESS_READ_COMMANDS
    return responses[name]
  })
  return { ssh: { exec } as unknown as SshManager, exec }
}

describe('preflightSharedIngress', () => {
  it('confirms OpsPilot ownership only when listener PID, unit, marker, config and version agree', async () => {
    const { ssh, exec } = fakeSsh()
    const result = await preflightSharedIngress(ssh, 7)
    expect(result).toMatchObject({
      ownership: 'opspilot_owned',
      ports_status: 'occupied',
      install_assessment: 'safe',
      local_assessment: 'clear',
      service: 'verified',
      caddy_version: '2.9.1',
      ownership_marker: 'valid',
      config_readable: true,
      reason_code: null,
      route_activation: 'not_evaluated',
      ufw: { state: 'active', inbound_80: 'allowed', inbound_443: 'allowed' }
    })
    expect(result.listeners.map(({ port, family }) => ({ port, family }))).toEqual([
      { port: 80, family: 'ipv4' },
      { port: 443, family: 'ipv6' }
    ])
    const commands = exec.mock.calls.map(([, command]) => command)
    expect(commands).toEqual(Object.values(INGRESS_READ_COMMANDS))
    expect(commands.join('\n')).not.toContain('/usr/bin/caddy version')
    expect(result.caddy_version).toBe('2.9.1')
  })

  it('keeps the empty supported host installable only when every fixed read proves clean state', async () => {
    const { ssh, exec } = fakeSsh({
      listeners: { code: 0, stdout: '', stderr: '' },
      pathFacts: { code: 0, stdout: cleanPathFacts(), stderr: '' },
      binary: missingBinary,
      installation: { code: 0, stdout: 'KIND=missing\n', stderr: '' },
      service: { code: 0, stdout: 'LoadState=not-found\nActiveState=inactive\nDropInPaths=\nMainPID=0', stderr: '' },
      markerPath: { code: 0, stdout: 'MISSING\n', stderr: '' },
      marker: { code: 1, stdout: '', stderr: 'No such file' },
      configPath: { code: 0, stdout: 'MISSING\n', stderr: '' },
      config: { code: 1, stdout: '', stderr: 'No such file' },
      ufw: { code: 0, stdout: 'Status: inactive\n', stderr: '' }
    })
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      ownership: 'ports_free', ports_status: 'free', install_assessment: 'safe',
      local_assessment: 'clear', service: 'absent'
    })
    expect(exec.mock.calls.map(([, command]) => command)).toEqual(Object.values(INGRESS_READ_COMMANDS))
    expect(Object.values(INGRESS_READ_COMMANDS).join('\n')).not.toMatch(/apt(-get)?\s+(install|update)|systemctl\s+(start|enable|reload)|\btee\b|\bmv\b|\brm\b/i)
  })

  it('does not treat a partially created OpsPilot path tree as a clean install target', async () => {
    const { ssh } = fakeSsh({
      listeners: { code: 0, stdout: '', stderr: '' },
      pathFacts: { code: 0, stdout: cleanPathFacts().replace('/etc/opspilot|MISSING|||||', '/etc/opspilot|directory|root|root|755|1|'), stderr: '' },
      binary: missingBinary,
      service: { code: 0, stdout: 'LoadState=not-found\nActiveState=inactive\nMainPID=0', stderr: '' },
      serviceUnit: { code: 1, stdout: '', stderr: 'missing' },
      markerPath: { code: 0, stdout: 'MISSING\n', stderr: '' },
      marker: { code: 1, stdout: '', stderr: 'missing' },
      configPath: { code: 0, stdout: 'MISSING\n', stderr: '' },
      config: { code: 1, stdout: '', stderr: 'missing' },
      ufw: { code: 0, stdout: 'Status: inactive\n', stderr: '' }
    })
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      service: 'absent', install_assessment: 'unknown', local_assessment: 'unknown'
    })
  })

  it.each([
    ['inactive nginx unit', 'nginx.service=loaded\napache2.service=not-found\nhttpd.service=not-found\ntraefik.service=not-found\nhaproxy.service=not-found\n'],
    ['unparseable proxy inventory', 'nginx.service=not-found\nunknown-format\n']
  ])('does not allow clean install with %s', async (_label, proxyInventory) => {
    const { ssh } = fakeSsh({
      listeners: { code: 0, stdout: '', stderr: '' },
      pathFacts: { code: 0, stdout: cleanPathFacts(), stderr: '' },
      binary: missingBinary,
      service: { code: 0, stdout: 'LoadState=not-found\nActiveState=inactive\nMainPID=0', stderr: '' },
      serviceUnit: { code: 1, stdout: '', stderr: 'missing' },
      markerPath: { code: 0, stdout: 'MISSING\n', stderr: '' },
      marker: { code: 1, stdout: '', stderr: 'missing' },
      configPath: { code: 0, stdout: 'MISSING\n', stderr: '' },
      config: { code: 1, stdout: '', stderr: 'missing' },
      competingProxyServices: { code: 0, stdout: proxyInventory, stderr: '' },
      ufw: { code: 0, stdout: 'Status: inactive\n', stderr: '' }
    })
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      service: 'absent', install_assessment: 'unknown', local_assessment: 'unknown'
    })
  })

  it.each([
    ['ExecStartPre', (value: string) => value.replace('ExecStartPre={ path=/usr/bin/caddy ; argv[]=/usr/bin/caddy validate', 'ExecStartPre={ path=/usr/bin/caddy ; argv[]=/usr/bin/caddy run')],
    ['ExecReload', (value: string) => value.replace('ExecReload={ path=/usr/bin/caddy ; argv[]=/usr/bin/caddy reload', 'ExecReload={ path=/usr/bin/caddy ; argv[]=/usr/bin/caddy restart')],
    ['service user', (value: string) => value.replace('User=opspilot-caddy', 'User=root')],
    ['service group', (value: string) => value.replace('Group=opspilot-caddy', 'Group=root')],
    ['capability limit', (value: string) => value.replace('CapabilityBoundingSet=cap_net_bind_service', 'CapabilityBoundingSet=CAP_NET_ADMIN')]
  ])('rejects a service with unexpected effective %s', async (_label, mutate) => {
    const { ssh } = fakeSsh({ service: { code: 0, stdout: mutate(verifiedService), stderr: '' } })
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      service: 'unknown', install_assessment: 'unknown', local_assessment: 'unknown'
    })
  })

  it('rejects any systemd drop-in even when the base unit is exact', async () => {
    const { ssh } = fakeSsh({
      service: { code: 0, stdout: verifiedService.replace('DropInPaths=', 'DropInPaths=/etc/systemd/system/opspilot-caddy.service.d/override.conf'), stderr: '' }
    })
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      service: 'unknown', install_assessment: 'unknown', local_assessment: 'unknown'
    })
  })

  it.each([
    ['ExecStartPre', EXPECTED_OPSPILOT_UNIT.replace('ExecStartPre=/usr/bin/caddy validate', 'ExecStartPre=/usr/bin/caddy run')],
    ['ExecReload', EXPECTED_OPSPILOT_UNIT.replace('ExecReload=/usr/bin/caddy reload', 'ExecReload=/usr/bin/caddy restart')],
    ['user', EXPECTED_OPSPILOT_UNIT.replace('User=opspilot-caddy', 'User=root')],
    ['extra directive', EXPECTED_OPSPILOT_UNIT.replace('Restart=on-failure', 'Restart=on-failure\nExecStartPost=/bin/true')]
  ])('rejects unexpected unit-file %s', async (_label, unit) => {
    const { ssh } = fakeSsh({ serviceUnit: { code: 0, stdout: unit, stderr: '' } })
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      service: 'unknown', install_assessment: 'unknown', local_assessment: 'unknown'
    })
  })

  it('accepts an installed service only when its complete fixed unit matches', async () => {
    const { ssh } = fakeSsh()
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      service: 'verified', install_assessment: 'safe', local_assessment: 'clear', ownership: 'opspilot_owned'
    })
  })

  it('verifies installed artifacts separately when the OpsPilot service is inactive', async () => {
    const { ssh } = fakeSsh({
      listeners: { code: 0, stdout: '', stderr: '' },
      service: { code: 0, stdout: verifiedService.replace('ActiveState=active', 'ActiveState=inactive').replace('MainPID=41', 'MainPID=0'), stderr: '' }
    })
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      service: 'verified', service_state: 'inactive', ownership: 'ports_free',
      install_assessment: 'safe', local_assessment: 'clear'
    })
  })

  it.each([
    ['unsupported distro', 'ID=alpine\nVERSION_ID="3.20"\nx86_64\n'],
    ['unsupported architecture', 'ID=debian\nVERSION_ID="12"\nriscv64\n'],
    ['unknown platform format', 'not-os-release\n']
  ])('fails closed for %s', async (_label, platform) => {
    const { ssh } = fakeSsh({
      listeners: { code: 0, stdout: '', stderr: '' },
      platform: { code: 0, stdout: platform, stderr: '' },
      service: { code: 0, stdout: 'LoadState=not-found\nActiveState=inactive\nMainPID=0', stderr: '' },
      binary: missingBinary,
      markerPath: { code: 0, stdout: 'MISSING\n', stderr: '' },
      marker: { code: 1, stdout: '', stderr: 'No such file' },
      configPath: { code: 0, stdout: 'MISSING\n', stderr: '' },
      config: { code: 1, stdout: '', stderr: 'No such file' },
      ufw: { code: 0, stdout: 'Status: inactive\n', stderr: '' }
    })
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      ownership: 'ports_free', install_assessment: 'unknown', local_assessment: 'unknown',
      reason_code: 'INGRESS_OWNER_UNKNOWN'
    })
  })

  it('blocks a binary owned by a distro package even when ports are free', async () => {
    const { ssh } = fakeSsh({
      listeners: { code: 0, stdout: '', stderr: '' },
      service: { code: 0, stdout: 'LoadState=not-found\nActiveState=inactive\nMainPID=0', stderr: '' },
      binary: { code: 0, stdout: 'KIND=regular\nPACKAGE=caddy: /usr/bin/caddy\nTARGET_PACKAGE=none\nVERSION=v2.9.1\n', stderr: '' },
      markerPath: { code: 0, stdout: 'MISSING\n', stderr: '' },
      marker: { code: 1, stdout: '', stderr: 'No such file' },
      configPath: { code: 0, stdout: 'MISSING\n', stderr: '' },
      config: { code: 1, stdout: '', stderr: 'No such file' },
      ufw: { code: 0, stdout: 'Status: inactive\n', stderr: '' }
    })
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      ports_status: 'free', install_assessment: 'unknown', local_assessment: 'unknown',
      reason_code: 'INGRESS_OWNER_UNKNOWN'
    })
  })

  it.each(['caddy.service', 'caddy-api.service'])(
    'blocks a foreign %s unit even when it is inactive and the listener is absent', async (unit) => {
      const { ssh } = fakeSsh({
        listeners: { code: 0, stdout: '', stderr: '' },
        service: { code: 0, stdout: 'LoadState=not-found\nActiveState=inactive\nMainPID=0', stderr: '' },
        binary: missingBinary,
        ...(unit === 'caddy.service'
          ? { distroCaddyService: { code: 0, stdout: 'LoadState=loaded\nActiveState=inactive\nFragmentPath=/lib/systemd/system/caddy.service', stderr: '' } }
          : { distroCaddyApiService: { code: 0, stdout: 'LoadState=loaded\nActiveState=inactive\nFragmentPath=/lib/systemd/system/caddy-api.service', stderr: '' } }),
        markerPath: { code: 0, stdout: 'MISSING\n', stderr: '' },
        marker: { code: 1, stdout: '', stderr: 'No such file' },
        configPath: { code: 0, stdout: 'MISSING\n', stderr: '' },
        config: { code: 1, stdout: '', stderr: 'No such file' },
        ufw: { code: 0, stdout: 'Status: inactive\n', stderr: '' }
      })
      expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
        ports_status: 'free', install_assessment: 'unknown', local_assessment: 'unknown',
        reason_code: 'INGRESS_OWNER_UNKNOWN'
      })
    }
  )

  it.each([
    ['dangling symlink', 'KIND=symlink\nLINK=/usr/local/lib/opspilot-caddy/versions/2.9.1/missing\nRESOLVE=failed\nPACKAGE=none\nTARGET_PACKAGE=unknown\n'],
    ['wrong symlink target', 'KIND=symlink\nLINK=/usr/bin/caddy-real\nRESOLVED=/usr/bin/caddy-real\nPACKAGE=none\nTARGET_PACKAGE=none\nVERSION=v2.9.1\n'],
    ['unreadable ownership data', 'KIND=symlink\nLINK=/usr/local/lib/opspilot-caddy/versions/2.9.1/caddy\nRESOLVED=/usr/local/lib/opspilot-caddy/versions/2.9.1/caddy\nPACKAGE=unknown\nTARGET_PACKAGE=unknown\nVERSION=v2.9.1\n']
  ])('does not trust %s', async (_label, binary) => {
    const { ssh } = fakeSsh({ binary: { code: 0, stdout: binary, stderr: '' } })
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      ownership: 'unknown', service: 'unknown', local_assessment: 'unknown',
      reason_code: 'INGRESS_OWNER_UNKNOWN'
    })
  })

  it.each([
    ['missing manifest', { code: 0, stdout: 'KIND=missing\n', stderr: '' }, ''],
    [
      'binary hash mismatch',
      { ...validInstallation, stdout: validInstallation.stdout.replace(`binary_sha256=${binaryHash}`, `binary_sha256=${'c'.repeat(64)}`) },
      managedPathFacts()
    ],
    [
      'malformed package hash',
      { ...validInstallation, stdout: validInstallation.stdout.replace(`package_sha256=${packageHash}`, 'package_sha256=bad') },
      managedPathFacts()
    ]
  ])('fails closed for %s', async (_label, installation, pathFacts) => {
    const paths = pathFacts || managedPathFacts().replace(
      '/etc/opspilot/caddy/INSTALLATION|regular file|root|root|644|1|',
      '/etc/opspilot/caddy/INSTALLATION|MISSING|||||'
    )
    const { ssh } = fakeSsh({
      installation,
      pathFacts: { code: 0, stdout: paths, stderr: '' }
    })
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      ownership: 'unknown', service: 'unknown', install_assessment: 'unknown',
      local_assessment: 'unknown', reason_code: 'INGRESS_OWNER_UNKNOWN'
    })
  })

  it.each([
    ['version differs from the immutable binary path', validInstallation.stdout.replace('version=2.9.1', 'version=2.9.2')],
    ['architecture differs from the supported host', validInstallation.stdout.replace('architecture=amd64', 'architecture=arm64')]
  ])('rejects an INSTALLATION manifest when %s', async (_label, manifest) => {
    const { ssh } = fakeSsh({
      installation: { ...validInstallation, stdout: manifest }
    })
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      service: 'unknown', install_assessment: 'unknown', local_assessment: 'unknown',
      reason_code: 'INGRESS_OWNER_UNKNOWN'
    })
  })

  it.each([
    ['/usr/local/lib', '/usr/local/lib|SYMLINK|root|root|777|1|/tmp/lib'],
    ['/etc/systemd/system', '/etc/systemd/system|SYMLINK|root|root|777|1|/tmp/systemd']
  ])('rejects a symlink in the %s path chain', async (path, symlinkFact) => {
    const facts = managedPathFacts().replace(new RegExp(`^${path}\\|[^\\n]+$`, 'm'), symlinkFact)
    const { ssh } = fakeSsh({ pathFacts: { code: 0, stdout: facts, stderr: '' } })
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      ownership: 'unknown', service: 'unknown', install_assessment: 'unknown',
      reason_code: 'INGRESS_OWNER_UNKNOWN'
    })
  })

  it.each([
    ['/etc/systemd/system/opspilot-caddy.service', '|regular file|root|root|664|1|'],
    ['/etc/opspilot/caddy/Caddyfile', '|regular file|root|root|640|1|']
  ])('rejects unsafe ownership or mode for %s', async (path, wrongMetadata) => {
    const facts = managedPathFacts().replace(new RegExp(`^${path}\\|[^\\n]+$`, 'm'), `${path}${wrongMetadata}`)
    const { ssh } = fakeSsh({ pathFacts: { code: 0, stdout: facts, stderr: '' } })
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      ownership: 'unknown', service: 'unknown', install_assessment: 'unknown'
    })
  })

  it.each([
    ['marker', { markerPath: { code: 0, stdout: 'SYMLINK\n', stderr: '' } }],
    ['Caddyfile', { configPath: { code: 0, stdout: 'SYMLINK\n', stderr: '' } }]
  ])('fails closed on a dangling or unexpected %s path', async (_label, override) => {
    const { ssh } = fakeSsh(override)
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      ownership: 'unknown', install_assessment: 'unknown', local_assessment: 'unknown',
      reason_code: 'INGRESS_OWNER_UNKNOWN'
    })
  })

  it('reports a known non-Caddy listener as a port conflict', async () => {
    const { ssh } = fakeSsh({
      listeners: {
        code: 0,
        stdout: 'LISTEN 0 128 0.0.0.0:80 0.0.0.0:* users:(("nginx",pid=92,fd=6))',
        stderr: ''
      }
    })
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      ownership: 'conflict',
      local_assessment: 'blocked',
      reason_code: 'INGRESS_PORT_CONFLICT'
    })
  })

  it('does not treat the caddy process name alone as ownership proof', async () => {
    const { ssh } = fakeSsh({
      listeners: {
        code: 0,
        stdout: 'LISTEN 0 128 [::]:443 [::]:* users:(("caddy",pid=99,fd=6))',
        stderr: ''
      },
      marker: { code: 0, stdout: 'different-owner\n', stderr: '' }
    })
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      ownership: 'unknown',
      local_assessment: 'unknown',
      reason_code: 'INGRESS_OWNER_UNKNOWN',
      ownership_marker: 'mismatch'
    })
  })

  it('fails closed when listener details cannot be read', async () => {
    const { ssh } = fakeSsh({
      listeners: { code: 1, stdout: '', stderr: 'sudo: a password is required' }
    })
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      ownership: 'unknown',
      local_assessment: 'unknown',
      reason_code: 'INGRESS_OWNER_UNKNOWN',
      listeners: []
    })
  })

  it('fails closed on any nonempty listener output that is not fully parseable', async () => {
    const { ssh } = fakeSsh({
      listeners: { code: 0, stdout: 'unexpected ss output for port 80', stderr: '' }
    })
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      ownership: 'unknown', reason_code: 'INGRESS_OWNER_UNKNOWN', local_assessment: 'unknown'
    })
  })

  it('reports free ports but keeps installation unknown without the ownership manifest', async () => {
    const { ssh } = fakeSsh({
      listeners: { code: 0, stdout: '', stderr: '' },
      binary: missingBinary,
      service: { code: 0, stdout: 'LoadState=not-found\nActiveState=inactive\nMainPID=0', stderr: '' },
      markerPath: { code: 0, stdout: 'MISSING\n', stderr: '' },
      marker: { code: 1, stdout: '', stderr: 'cat: /etc/opspilot/caddy/OWNER: No such file or directory' },
      configPath: { code: 0, stdout: 'MISSING\n', stderr: '' },
      config: { code: 1, stdout: '', stderr: '' },
      ufw: { code: 0, stdout: 'Status: inactive\n', stderr: '' }
    })
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      ownership: 'ports_free',
      ports_status: 'free',
      install_assessment: 'unknown',
      local_assessment: 'unknown',
      service: 'absent',
      ufw: { state: 'inactive', inbound_80: 'not_applicable', inbound_443: 'not_applicable' }
    })
  })

  it('does not call ports free when an active service has no listener', async () => {
    const { ssh } = fakeSsh({ listeners: { code: 0, stdout: '', stderr: '' } })
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      ownership: 'unknown', reason_code: 'INGRESS_OWNER_UNKNOWN'
    })
  })

  it('keeps an inactive but installed unit distinct from safe ingress installation', async () => {
    const { ssh } = fakeSsh({
      listeners: { code: 0, stdout: '', stderr: '' },
      service: {
        code: 0,
        stdout: 'LoadState=loaded\nActiveState=inactive\nFragmentPath=/etc/systemd/system/opspilot-caddy.service\nMainPID=0',
        stderr: ''
      },
      ufw: { code: 0, stdout: 'Status: inactive\n', stderr: '' }
    })
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      ports_status: 'free', install_assessment: 'unknown', local_assessment: 'unknown',
      ownership: 'ports_free', service: 'unknown'
    })
  })

  it('does not allow ingress writes when the owner marker is wrong despite free ports', async () => {
    const { ssh } = fakeSsh({
      listeners: { code: 0, stdout: '', stderr: '' },
      service: { code: 0, stdout: 'LoadState=not-found\nActiveState=inactive\nMainPID=0', stderr: '' },
      marker: { code: 0, stdout: 'another-owner\n', stderr: '' },
      configPath: { code: 0, stdout: 'MISSING\n', stderr: '' },
      config: { code: 1, stdout: '', stderr: '' },
      ufw: { code: 0, stdout: 'Status: inactive\n', stderr: '' }
    })
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      ports_status: 'free', install_assessment: 'unknown', local_assessment: 'unknown',
      ownership_marker: 'mismatch', reason_code: 'INGRESS_OWNER_UNKNOWN'
    })
  })

  it('does not allow ingress writes when the owner marker cannot be read', async () => {
    const { ssh } = fakeSsh({
      listeners: { code: 0, stdout: '', stderr: '' },
      service: { code: 0, stdout: 'LoadState=not-found\nActiveState=inactive\nMainPID=0', stderr: '' },
      marker: { code: 1, stdout: '', stderr: 'sudo: a password is required' },
      configPath: { code: 0, stdout: 'MISSING\n', stderr: '' },
      config: { code: 1, stdout: '', stderr: '' },
      ufw: { code: 0, stdout: 'Status: inactive\n', stderr: '' }
    })
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      ports_status: 'free', install_assessment: 'unknown', local_assessment: 'unknown',
      ownership_marker: 'unknown', reason_code: 'INGRESS_OWNER_UNKNOWN'
    })
  })

  it('does not allow writes over an existing config when no owner is verified', async () => {
    const { ssh } = fakeSsh({
      listeners: { code: 0, stdout: '', stderr: '' },
      service: { code: 0, stdout: 'LoadState=not-found\nActiveState=inactive\nMainPID=0', stderr: '' },
      markerPath: { code: 0, stdout: 'MISSING\n', stderr: '' },
      marker: { code: 1, stdout: '', stderr: 'cat: /etc/opspilot/caddy/OWNER: No such file or directory' },
      configPath: { code: 0, stdout: 'REGULAR\n', stderr: '' },
      config: { code: 0, stdout: 'READABLE\n', stderr: '' },
      ufw: { code: 0, stdout: 'Status: inactive\n', stderr: '' }
    })
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      ports_status: 'free', install_assessment: 'unknown', local_assessment: 'unknown',
      config_exists: true, ownership_marker: 'missing', reason_code: 'INGRESS_OWNER_UNKNOWN'
    })
  })

  it.each([
    '{ path=/opt/usr/bin/caddy ; argv[]=/opt/usr/bin/caddy run --config /etc/opspilot/caddy/Caddyfile ; }',
    '{ path=/usr/bin/caddy ; argv[]=/usr/bin/caddy run --config /etc/OtherCaddyfile ; }',
    '{ path=/usr/bin/caddy-wrapper ; argv[]=/usr/bin/caddy-wrapper run --config /etc/opspilot/caddy/Caddyfile ; }'
  ])('does not verify a similar but different ExecStart: %s', async (execStart) => {
    const { ssh } = fakeSsh({
      service: { code: 0, stdout: verifiedService.replace(verifiedService.split('\n')[3], `ExecStart=${execStart}`), stderr: '' }
    })
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      ownership: 'unknown', service: 'unknown', reason_code: 'INGRESS_OWNER_UNKNOWN'
    })
  })

  it('reports active UFW rules that omit a port without changing firewall state', async () => {
    const { ssh } = fakeSsh({
      ufw: {
        code: 0,
        stdout: 'Status: active\nDefault: deny (incoming), allow (outgoing), disabled (routed)\n80/tcp ALLOW IN Anywhere\n',
        stderr: ''
      }
    })
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      ufw: {
        state: 'active', inbound_80: 'blocked', inbound_80_ipv4: 'allowed', inbound_80_ipv6: 'blocked',
        inbound_443: 'blocked'
      },
      local_assessment: 'blocked',
      reason_code: 'FIREWALL_80_BLOCKED'
    })
  })

  it('does not report a broad UFW allow when a broad deny rule is also present', async () => {
    const { ssh } = fakeSsh({
      ufw: {
        code: 0,
        stdout: 'Status: active\nDefault: deny (incoming), allow (outgoing), disabled (routed)\n80/tcp ALLOW IN Anywhere\n80/tcp DENY IN Anywhere\n443/tcp ALLOW IN Anywhere\n',
        stderr: ''
      }
    })
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      ufw: { inbound_80: 'unknown', inbound_80_ipv4: 'unknown', inbound_80_ipv6: 'blocked', inbound_443: 'blocked' },
      local_assessment: 'blocked',
      reason_code: 'FIREWALL_443_BLOCKED'
    })
  })

  it('keeps an IPv6-only Anywhere rule separate from IPv4', async () => {
    const { ssh } = fakeSsh({
      ufw: { code: 0, stdout: 'Status: active\nDefault: deny (incoming), allow (outgoing), disabled (routed)\n80/tcp ALLOW IN Anywhere (v6)', stderr: '' }
    })
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      ufw: { inbound_80_ipv4: 'blocked', inbound_80_ipv6: 'allowed', inbound_80: 'blocked' }
    })
  })

  it('does not treat a source-limited allow as an Anywhere allow', async () => {
    const { ssh } = fakeSsh({
      ufw: { code: 0, stdout: 'Status: active\nDefault: deny (incoming), allow (outgoing), disabled (routed)\n80/tcp ALLOW IN 10.0.0.0/8', stderr: '' }
    })
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      ufw: { inbound_80_ipv4: 'blocked', inbound_80_ipv6: 'blocked' }
    })
  })

  it('marks unfamiliar UFW rule output unknown', async () => {
    const { ssh } = fakeSsh({
      ufw: { code: 0, stdout: 'Status: active\nDefault: deny (incoming), allow (outgoing), disabled (routed)\n80/tcp MAYBE IN Anywhere', stderr: '' }
    })
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      ufw: { inbound_80: 'unknown', inbound_80_ipv4: 'unknown', inbound_80_ipv6: 'unknown' },
      local_assessment: 'unknown'
    })
  })

  it.each(['DENY', 'REJECT'])('does not infer global access from default allow plus source-limited %s', async (action) => {
    const { ssh } = fakeSsh({
      ufw: {
        code: 0,
        stdout: `Status: active\nDefault: allow (incoming), allow (outgoing), disabled (routed)\n80/tcp ${action} IN 198.51.100.7`,
        stderr: ''
      }
    })
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      ufw: { inbound_80_ipv4: 'unknown', inbound_80: 'unknown' },
      local_assessment: 'unknown'
    })
  })

  it('returns SSH_UNAVAILABLE when exec channels cannot be opened', async () => {
    const ssh = {
      exec: vi.fn(async () => {
        throw new Error('transport unavailable')
      })
    } as unknown as SshManager
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      ownership: 'unknown',
      local_assessment: 'unknown',
      reason_code: 'SSH_UNAVAILABLE',
      ufw: { state: 'unknown' }
    })
  })

  it('keeps local assessment unknown when UFW cannot be read', async () => {
    const { ssh } = fakeSsh({ ufw: { code: 1, stdout: '', stderr: 'sudo: a password is required' } })
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      ownership: 'opspilot_owned',
      local_assessment: 'unknown',
      ufw: { state: 'unknown', inbound_80: 'unknown', inbound_443: 'unknown' },
      route_activation: 'not_evaluated'
    })
  })
})
