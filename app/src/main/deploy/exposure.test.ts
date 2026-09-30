import { describe, expect, it, vi } from 'vitest'

import type { App, Vps } from '@shared/ipc'

import { SshExposureManager, UncheckedExposureManager } from './exposure'
import type { CloudFirewallProvider } from './firewall'

const vps: Vps = {
  id: 1,
  name: 'lab',
  host: '203.0.113.10',
  port: 22,
  username: 'root',
  auth_type: 'password',
  provider: 'lab',
  region: 'test',
  docker_version: null,
  last_status: 'online',
  last_seen_at: null,
  created_at: '2026-09-28T00:00:00Z'
}

const app: App = {
  id: 1,
  vps_id: 1,
  name: 'demo',
  framework: 'express',
  host_port: 30000,
  container_port: 3000,
  healthcheck_path: '/',
  needs_db: 0,
  current_deployment_id: 1,
  url: 'http://203.0.113.10:30000'
}

describe('SshExposureManager', () => {
  it('mở đúng port UFW active rồi xác nhận external reachable', async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce({ code: 0, stdout: 'Status: active\n', stderr: '' })
      .mockResolvedValueOnce({ code: 0, stdout: 'Rule added\n', stderr: '' })
    const result = await new SshExposureManager({ exec } as never, {
      probe: vi.fn().mockResolvedValue(true)
    }).reconcile({ vps, app })

    expect(result.status).toBe('reachable')
    expect(result.ufw_reconciled).toBe(true)
    expect(exec).toHaveBeenNthCalledWith(2, 1, 'sudo -n ufw allow 30000/tcp', expect.anything())
  })

  it('không báo URL public khi external probe fail', async () => {
    const exec = vi.fn().mockResolvedValue({ code: 0, stdout: 'Status: inactive\n', stderr: '' })
    const result = await new SshExposureManager({ exec } as never, {
      probe: vi.fn().mockResolvedValue(false),
      probeAttempts: 2
    }).reconcile({ vps, app })

    expect(result.status).toBe('degraded')
    expect(result.external_probe).toBe('unreachable')
    expect(result.diagnosis?.code).toBe('PORT_BLOCKED_EXTERNAL')
  })

  it('skipExternalProbe trả not_checked và external_probe not_run', async () => {
    const exec = vi.fn().mockResolvedValue({ code: 0, stdout: 'Status: inactive\n', stderr: '' })
    const result = await new SshExposureManager({ exec } as never, {
      skipExternalProbe: true
    }).reconcile({ vps, app })

    expect(result.status).toBe('not_checked')
    expect(result.external_probe).toBe('not_run')
    expect(result.diagnosis).toBeNull()
  })

  it('reconcile cloud firewall adapter nếu được cấu hình', async () => {
    const exec = vi.fn().mockResolvedValue({ code: 0, stdout: 'Status: inactive\n', stderr: '' })
    const cloudFirewall: CloudFirewallProvider = {
      ensureIngress: vi.fn().mockResolvedValue({ ok: true, changed: true, message: 'ok' }),
      revokeIngress: vi.fn().mockResolvedValue({ ok: true, changed: false, message: 'ok' })
    }

    const result = await new SshExposureManager({ exec } as never, {
      cloudFirewall,
      probe: vi.fn().mockResolvedValue(true)
    }).reconcile({ vps, app })

    expect(result.status).toBe('reachable')
    expect(result.cloud_firewall).toBe('reconciled')
    expect(cloudFirewall.ensureIngress).toHaveBeenCalledWith(30000)
  })

  it('ghi nhận cloud_firewall failed khi adapter báo lỗi nhưng external probe vẫn quyết định exposure', async () => {
    const exec = vi.fn().mockResolvedValue({ code: 0, stdout: 'Status: inactive\n', stderr: '' })
    const cloudFirewall: CloudFirewallProvider = {
      ensureIngress: vi.fn().mockRejectedValue(new Error('Cloud API timeout')),
      revokeIngress: vi.fn()
    }

    const result = await new SshExposureManager({ exec } as never, {
      cloudFirewall,
      probe: vi.fn().mockResolvedValue(false)
    }).reconcile({ vps, app })

    expect(result.status).toBe('degraded')
    expect(result.cloud_firewall).toBe('failed')
    expect(result.diagnosis?.code).toBe('PORT_BLOCKED_EXTERNAL')
  })

  it('reconcile idempotent: chạy nhiều lần trên UFW active không lỗi', async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce({ code: 0, stdout: 'Status: active\n', stderr: '' })
      .mockResolvedValueOnce({ code: 0, stdout: 'Skipping adding existing rule\n', stderr: '' })

    const manager = new SshExposureManager({ exec } as never, {
      probe: vi.fn().mockResolvedValue(true)
    })
    const result = await manager.reconcile({ vps, app })

    expect(result.status).toBe('reachable')
    expect(result.ufw_reconciled).toBe(true)
  })
})

describe('UncheckedExposureManager', () => {
  it('luôn trả not_checked và not_run an toàn cho môi trường test/offline', async () => {
    const manager = new UncheckedExposureManager()
    const result = await manager.reconcile({ vps, app })

    expect(result.status).toBe('not_checked')
    expect(result.external_probe).toBe('not_run')
    expect(result.ufw_state).toBe('not_checked')
    expect(result.diagnosis).toBeNull()
  })
})
