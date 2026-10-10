export interface FirewallRule {
  protocol: 'tcp'
  ports: string
  sources: { addresses: string[] }
}

export interface FirewallReconcileResult {
  ok: boolean
  changed: boolean
  message: string
  technical?: string
}

export interface CloudFirewallProvider {
  ensureIngress(port: number): Promise<FirewallReconcileResult>
  revokeIngress(port: number): Promise<FirewallReconcileResult>
}

export interface DigitalOceanFirewallOptions {
  token: string
  firewallId: string
  dedicatedFirewall?: boolean
  fetchImpl?: typeof fetch
}

type DigitalOceanFirewall = {
  id: string
  inbound_rules: FirewallRule[]
  outbound_rules: unknown[]
  name?: string
  tags?: string[]
}

type DigitalOceanResponse = { firewall?: DigitalOceanFirewall; message?: string }

/**
 * Adapter firewall cloud đầu tiên. Chỉ revoke tự động khi firewall được đánh dấu dedicated;
 * nếu firewall dùng chung, tool chỉ ensure và không xóa rule có thể thuộc ứng dụng khác.
 */
export class DigitalOceanFirewallProvider implements CloudFirewallProvider {
  private readonly fetchImpl: typeof fetch

  constructor(private readonly options: DigitalOceanFirewallOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
  }

  async ensureIngress(port: number): Promise<FirewallReconcileResult> {
    validatePort(port)
    const current = await this.getFirewall()
    if (!current) return { ok: false, changed: false, message: 'Không đọc được cloud firewall.' }
    const exists = current.inbound_rules.some(
      (rule) => rule.protocol === 'tcp' && rule.ports === String(port) && allInternet(rule.sources)
    )
    if (exists) return { ok: true, changed: false, message: `Cloud firewall đã mở TCP ${port}.` }

    const response = await this.updateFirewall({
      ...current,
      inbound_rules: [
        ...current.inbound_rules,
        { protocol: 'tcp', ports: String(port), sources: { addresses: ['0.0.0.0/0', '::/0'] } }
      ]
    })
    return response
      ? { ok: true, changed: true, message: `Đã mở TCP ${port} trên cloud firewall.` }
      : { ok: false, changed: false, message: 'Không thể cập nhật cloud firewall.' }
  }

  async revokeIngress(port: number): Promise<FirewallReconcileResult> {
    validatePort(port)
    if (!this.options.dedicatedFirewall) {
      return {
        ok: false,
        changed: false,
        message: 'Không revoke firewall dùng chung để tránh xóa rule của ứng dụng khác.'
      }
    }
    const current = await this.getFirewall()
    if (!current) return { ok: false, changed: false, message: 'Không đọc được cloud firewall.' }
    const remaining = current.inbound_rules.filter(
      (rule) =>
        !(rule.protocol === 'tcp' && rule.ports === String(port) && allInternet(rule.sources))
    )
    if (remaining.length === current.inbound_rules.length) {
      return { ok: true, changed: false, message: `Không có rule TCP ${port} để revoke.` }
    }
    const response = await this.updateFirewall({ ...current, inbound_rules: remaining })
    return response
      ? { ok: true, changed: true, message: `Đã revoke TCP ${port} trên dedicated firewall.` }
      : { ok: false, changed: false, message: 'Không thể revoke cloud firewall.' }
  }

  private async getFirewall(): Promise<DigitalOceanFirewall | null> {
    const response = await this.fetchImpl(
      `https://api.digitalocean.com/v2/firewalls/${encodeURIComponent(this.options.firewallId)}`,
      { headers: { Authorization: `Bearer ${this.options.token}` } }
    )
    if (!response.ok) return null
    const payload = (await response.json()) as DigitalOceanResponse
    return payload.firewall ?? null
  }

  private async updateFirewall(firewall: DigitalOceanFirewall): Promise<boolean> {
    const response = await this.fetchImpl(
      `https://api.digitalocean.com/v2/firewalls/${encodeURIComponent(this.options.firewallId)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${this.options.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          inbound_rules: firewall.inbound_rules,
          outbound_rules: firewall.outbound_rules
        })
      }
    )
    return response.ok
  }
}

function allInternet(sources: FirewallRule['sources']): boolean {
  const addresses = new Set(sources.addresses)
  return addresses.has('0.0.0.0/0') || addresses.has('::/0')
}

function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`port không hợp lệ: ${port}`)
  }
}
