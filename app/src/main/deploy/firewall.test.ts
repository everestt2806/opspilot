import { describe, expect, it, vi } from 'vitest'

import { DigitalOceanFirewallProvider } from './firewall'

function response(payload: unknown, ok = true): Response {
  return { ok, json: async () => payload } as Response
}

describe('DigitalOceanFirewallProvider', () => {
  it('reconcile idempotent, không PUT nếu port đã tồn tại', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      response({
        firewall: {
          id: 'f1',
          inbound_rules: [
            { protocol: 'tcp', ports: '30000', sources: { addresses: ['0.0.0.0/0'] } }
          ],
          outbound_rules: []
        }
      })
    )
    const result = await new DigitalOceanFirewallProvider({
      token: 'secret',
      firewallId: 'f1',
      fetchImpl
    }).ensureIngress(30000)
    expect(result).toMatchObject({ ok: true, changed: false })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('thêm rule khi port chưa mở và lần gọi thứ hai idempotent không đổi', async () => {
    let currentFirewall = {
      id: 'f1',
      inbound_rules: [{ protocol: 'tcp', ports: '22', sources: { addresses: ['0.0.0.0/0'] } }],
      outbound_rules: []
    }

    const fetchImpl = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(init.body as string)
        currentFirewall = body
        return response({ firewall: currentFirewall })
      }
      return response({ firewall: currentFirewall })
    })

    const provider = new DigitalOceanFirewallProvider({
      token: 'secret',
      firewallId: 'f1',
      fetchImpl
    })

    // Lần 1: port 30000 chưa có -> thêm và changed: true
    const first = await provider.ensureIngress(30000)
    expect(first).toMatchObject({ ok: true, changed: true })
    expect(fetchImpl).toHaveBeenCalledTimes(2) // 1 GET + 1 PUT

    // Lần 2: port 30000 đã có -> idempotent no-op (changed: false, không PUT)
    const second = await provider.ensureIngress(30000)
    expect(second).toMatchObject({ ok: true, changed: false })
    expect(fetchImpl).toHaveBeenCalledTimes(3) // thêm 1 GET, không PUT
  })

  it('không revoke firewall dùng chung', async () => {
    const result = await new DigitalOceanFirewallProvider({
      token: 'secret',
      firewallId: 'f1',
      fetchImpl: vi.fn(),
      dedicatedFirewall: false
    }).revokeIngress(30000)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('dùng chung')
  })

  it('revoke trên dedicated firewall và lần gọi thứ hai idempotent', async () => {
    let currentFirewall = {
      id: 'f1',
      inbound_rules: [
        { protocol: 'tcp', ports: '30000', sources: { addresses: ['0.0.0.0/0', '::/0'] } }
      ],
      outbound_rules: []
    }

    const fetchImpl = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(init.body as string)
        currentFirewall = body
        return response({ firewall: currentFirewall })
      }
      return response({ firewall: currentFirewall })
    })

    const provider = new DigitalOceanFirewallProvider({
      token: 'secret',
      firewallId: 'f1',
      dedicatedFirewall: true,
      fetchImpl
    })

    // Lần 1: có rule 30000 -> revoke, changed: true
    const first = await provider.revokeIngress(30000)
    expect(first).toMatchObject({ ok: true, changed: true })

    // Lần 2: không còn rule 30000 -> changed: false, không PUT
    const second = await provider.revokeIngress(30000)
    expect(second).toMatchObject({ ok: true, changed: false })
    expect(second.message).toContain('Không có rule')
  })

  it('bảo vệ port không hợp lệ', async () => {
    const provider = new DigitalOceanFirewallProvider({
      token: 'secret',
      firewallId: 'f1',
      fetchImpl: vi.fn()
    })

    await expect(provider.ensureIngress(0)).rejects.toThrow(/port không hợp lệ/i)
    await expect(provider.ensureIngress(70000)).rejects.toThrow(/port không hợp lệ/i)
    await expect(provider.revokeIngress(-1)).rejects.toThrow(/port không hợp lệ/i)
  })

  it('xử lý API error gracefully', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    const provider = new DigitalOceanFirewallProvider({
      token: 'secret',
      firewallId: 'f1',
      fetchImpl
    })

    const res = await provider.ensureIngress(30000)
    expect(res).toMatchObject({ ok: false, changed: false })
  })
})
