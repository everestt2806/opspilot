import { describe, expect, it, vi } from 'vitest'

import type { SshManager } from '../../ssh/manager'
import {
  INGRESS_READ_COMMANDS,
  OPERATOR_INGRESS_MARKER,
  preflightSharedIngress
} from './preflight'

const verifiedService = [
  'LoadState=loaded',
  'ActiveState=active',
  'FragmentPath=/etc/systemd/system/opspilot-caddy.service',
  'ExecStart={ path=/usr/bin/caddy ; argv[]=/usr/bin/caddy run --config /etc/opspilot/caddy/Caddyfile ; }',
  'MainPID=41'
].join('\n')
const missingBinary = { code: 0, stdout: 'KIND=missing\nPACKAGE=none\nTARGET_PACKAGE=none\n', stderr: '' }

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
      stdout: 'KIND=symlink\nLINK=/usr/local/lib/opspilot-caddy/versions/2.9.1/caddy\nRESOLVED=/usr/local/lib/opspilot-caddy/versions/2.9.1/caddy\nPACKAGE=none\nTARGET_PACKAGE=none\nVERSION=v2.9.1 h1:example\n',
      stderr: ''
    },
    service: { code: 0, stdout: verifiedService, stderr: '' },
    distroCaddyService: { code: 0, stdout: 'LoadState=not-found\nActiveState=inactive', stderr: '' },
    distroCaddyApiService: { code: 0, stdout: 'LoadState=not-found\nActiveState=inactive', stderr: '' },
    marker: { code: 0, stdout: `${OPERATOR_INGRESS_MARKER}\n`, stderr: '' },
    markerPath: { code: 0, stdout: 'REGULAR\n', stderr: '' },
    configPath: { code: 0, stdout: 'REGULAR\n', stderr: '' },
    config: { code: 0, stdout: 'READABLE\n', stderr: '' },
    version: { code: 0, stdout: 'v2.9.1 h1:example\n', stderr: '' },
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
    expect(exec.mock.calls.map(([, command]) => command)).toEqual(Object.values(INGRESS_READ_COMMANDS))
  })

  it('keeps the empty supported host installable only when every fixed read proves clean state', async () => {
    const { ssh, exec } = fakeSsh({
      listeners: { code: 0, stdout: '', stderr: '' },
      binary: missingBinary,
      service: { code: 0, stdout: 'LoadState=not-found\nActiveState=inactive\nMainPID=0', stderr: '' },
      markerPath: { code: 0, stdout: 'MISSING\n', stderr: '' },
      marker: { code: 1, stdout: '', stderr: 'No such file' },
      configPath: { code: 0, stdout: 'MISSING\n', stderr: '' },
      config: { code: 1, stdout: '', stderr: 'No such file' },
      ufw: { code: 0, stdout: 'Status: inactive\n', stderr: '' }
    })
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      ownership: 'ports_free', install_assessment: 'safe', local_assessment: 'clear'
    })
    expect(exec.mock.calls.map(([, command]) => command)).toEqual(Object.values(INGRESS_READ_COMMANDS))
    expect(Object.values(INGRESS_READ_COMMANDS).join('\n')).not.toMatch(/apt(-get)?\s+(install|update)|systemctl\s+(start|enable|reload)|\btee\b|\bmv\b|\brm\b/i)
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

  it('reports free ports independently from a missing unit and parses inactive UFW', async () => {
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
      install_assessment: 'safe',
      local_assessment: 'clear',
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
