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

function fakeSsh(overrides: Partial<Record<keyof typeof INGRESS_READ_COMMANDS, {
  code: number
  stdout: string
  stderr: string
}>> = {}) {
  const defaults = {
    listeners: {
      code: 0,
      stdout: [
        'LISTEN 0 4096 0.0.0.0:80 0.0.0.0:* users:(("caddy",pid=41,fd=7))',
        'LISTEN 0 4096 [::]:443 [::]:* users:(("caddy",pid=41,fd=8))'
      ].join('\n'),
      stderr: ''
    },
    service: { code: 0, stdout: verifiedService, stderr: '' },
    marker: { code: 0, stdout: `${OPERATOR_INGRESS_MARKER}\n`, stderr: '' },
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

  it('reports free ports independently from a missing unit and parses inactive UFW', async () => {
    const { ssh } = fakeSsh({
      listeners: { code: 0, stdout: '', stderr: '' },
      service: { code: 0, stdout: 'LoadState=not-found\nActiveState=inactive\nMainPID=0', stderr: '' },
      ufw: { code: 0, stdout: 'Status: inactive\n', stderr: '' }
    })
    expect(await preflightSharedIngress(ssh, 7)).toMatchObject({
      ownership: 'ports_free',
      local_assessment: 'clear',
      service: 'absent',
      ufw: { state: 'inactive', inbound_80: 'not_applicable', inbound_443: 'not_applicable' }
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
      ufw: { state: 'active', inbound_80: 'allowed', inbound_443: 'blocked' },
      local_assessment: 'blocked',
      reason_code: 'FIREWALL_443_BLOCKED'
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
      ufw: { inbound_80: 'blocked', inbound_443: 'allowed' },
      local_assessment: 'blocked',
      reason_code: 'FIREWALL_80_BLOCKED'
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
