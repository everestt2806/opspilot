import { resolve4, resolve6, resolveCname } from 'node:dns/promises'
import { isIP } from 'node:net'

import { redactText } from '../doctor/engine'
import { maskSecrets } from '../logger'

export type DnsRecordType = 'A' | 'AAAA' | 'CNAME'

export interface DnsRecord {
  id?: string
  type: DnsRecordType
  name: string
  content: string
  ttl?: number
  proxied?: boolean
  ownershipKey: string
}

export interface ProviderCapability {
  provider: string
  authoritative: boolean
  supportsUpsert: boolean
  supportsDelete: boolean
  supportsPropagationCheck: boolean
  reason?: string
}

export interface ChangeResult {
  ok: boolean
  id?: string
  record?: DnsRecord
  conflict?: boolean
  message: string
  technical?: string
}

export interface PropagationResult {
  status: 'pending' | 'propagated' | 'wrong_target' | 'nxdomain' | 'error'
  observed: string[]
  resolver: string
  message: string
}

export interface DnsProvider {
  discover(domain: string): Promise<ProviderCapability>
  upsertRecord(record: DnsRecord): Promise<ChangeResult>
  deleteOwnedRecord(record: DnsRecord): Promise<ChangeResult>
  checkPropagation(record: DnsRecord): Promise<PropagationResult>
}

export interface CloudflareDnsOptions {
  apiToken: string
  zoneId: string
  fetchImpl?: typeof fetch
  resolver?: (name: string, type: DnsRecordType) => Promise<string[]>
}

type CloudflareRecord = {
  id: string
  type: DnsRecordType
  name: string
  content: string
  ttl: number
  proxied: boolean
  comment?: string | null
}

type CloudflareResponse<T> = {
  success: boolean
  errors?: Array<{ message?: string }>
  result?: T
}

/**
 * Cloudflare adapter nhỏ, không ghi token vào log và không overwrite record khác ownershipKey.
 * Adapter dùng fetch injection để contract-test offline.
 */
export class CloudflareDnsProvider implements DnsProvider {
  private readonly fetchImpl: typeof fetch
  private readonly resolver: (name: string, type: DnsRecordType) => Promise<string[]>

  constructor(private readonly options: CloudflareDnsOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.resolver = options.resolver ?? defaultResolver
  }

  async discover(domain: string): Promise<ProviderCapability> {
    if (!isHostname(domain)) {
      return {
        provider: 'cloudflare',
        authoritative: false,
        supportsUpsert: false,
        supportsDelete: false,
        supportsPropagationCheck: false,
        reason: 'Hostname không hợp lệ.'
      }
    }
    return {
      provider: 'cloudflare',
      authoritative: true,
      supportsUpsert: true,
      supportsDelete: true,
      supportsPropagationCheck: true
    }
  }

  async upsertRecord(record: DnsRecord): Promise<ChangeResult> {
    if (!isHostname(record.name) || !isRecordContent(record)) {
      return { ok: false, message: 'DNS record không hợp lệ.' }
    }
    const lookup = await this.listRecordsForName(record)
    if (lookup.error || !lookup.records) {
      return {
        ok: false,
        message: 'Không thể kiểm tra DNS record trên Cloudflare.',
        technical: lookup.error ?? 'Lỗi khi tra cứu danh sách DNS record từ Cloudflare API.'
      }
    }
    const existingList = lookup.records

    const owned = existingList.find(
      (candidate) =>
        candidate.type === record.type &&
        candidate.name === record.name &&
        candidate.comment === record.ownershipKey
    )

    // Kiểm tra xung đột quyền sở hữu: nếu đã tồn tại record cùng type/name nhưng không có comment
    // hoặc comment khác ownershipKey, TUYỆT ĐỐI không ghi đè record của bên khác,
    // kể cả khi đồng thời có record mình sở hữu.
    const foreignRecord = existingList.find(
      (candidate) =>
        candidate.type === record.type &&
        candidate.name === record.name &&
        candidate.comment !== record.ownershipKey
    )
    if (foreignRecord) {
      return {
        ok: false,
        conflict: true,
        message:
          'Xung đột quyền sở hữu: DNS record đã tồn tại trên Cloudflare nhưng thuộc bên khác hoặc không có ownership fingerprint phù hợp.',
        technical: `Record ID ${foreignRecord.id} hiện có comment '${foreignRecord.comment ?? 'none'}' thay vì '${record.ownershipKey}'.`
      }
    }

    const payload = {
      type: record.type,
      name: record.name,
      content: record.content,
      ttl: record.ttl ?? 300,
      proxied: record.proxied ?? false,
      comment: record.ownershipKey
    }
    const path = owned
      ? `/zones/${this.options.zoneId}/dns_records/${owned.id}`
      : `/zones/${this.options.zoneId}/dns_records`
    const response = await this.request(owned ? 'PUT' : 'POST', path, payload)
    if (!response.success || !response.result) {
      return {
        ok: false,
        message: 'Không thể cập nhật DNS record.',
        technical: firstError(response)
      }
    }
    const saved = response.result as CloudflareRecord
    return {
      ok: true,
      id: saved.id,
      record: { ...record, id: saved.id },
      message: owned ? 'Đã cập nhật DNS record.' : 'Đã tạo DNS record.'
    }
  }

  async deleteOwnedRecord(record: DnsRecord): Promise<ChangeResult> {
    const lookup = await this.listRecordsForName(record)
    if (lookup.error || !lookup.records) {
      return {
        ok: false,
        message: 'Không thể kiểm tra DNS record trên Cloudflare.',
        technical: lookup.error ?? 'Lỗi khi tra cứu danh sách DNS record từ Cloudflare API.'
      }
    }
    const existingList = lookup.records
    const owned = existingList.find(
      (candidate) =>
        candidate.type === record.type &&
        candidate.name === record.name &&
        candidate.comment === record.ownershipKey
    )
    if (!owned) return { ok: true, message: 'Không có DNS record do OpsPilot sở hữu để xóa.' }
    const response = await this.request(
      'DELETE',
      `/zones/${this.options.zoneId}/dns_records/${owned.id}`
    )
    if (!response.success) {
      return { ok: false, message: 'Không thể xóa DNS record.', technical: firstError(response) }
    }
    return { ok: true, id: owned.id, message: 'Đã xóa DNS record do OpsPilot sở hữu.' }
  }

  async checkPropagation(record: DnsRecord): Promise<PropagationResult> {
    try {
      const observed = await this.resolver(record.name, record.type)
      if (!observed || observed.length === 0) {
        return {
          status: 'nxdomain',
          observed: [],
          resolver: 'system-resolver',
          message:
            'Resolver chưa trả record; có thể đang chờ propagation hoặc hostname chưa tồn tại.'
        }
      }
      const expected = normalizeDnsValue(record.content)
      const allMatch =
        observed.length > 0 && observed.every((value) => normalizeDnsValue(value) === expected)
      return {
        status: allMatch ? 'propagated' : 'wrong_target',
        observed,
        resolver: 'system-resolver',
        message: allMatch
          ? 'DNS record đã trỏ đúng target.'
          : observed.some((v) => normalizeDnsValue(v) === expected)
            ? `DNS đang trỏ lẫn nhiều target (${observed.join(', ')}), chưa trỏ hoàn toàn về ${record.content}.`
            : `DNS đang trỏ tới ${observed.join(', ')}, không phải ${record.content}.`
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code
      if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'NODATA') {
        return {
          status: 'nxdomain',
          observed: [],
          resolver: 'system-resolver',
          message: 'Hostname chưa có record nào trên resolver (NXDOMAIN/NODATA).'
        }
      }
      return {
        status: 'error',
        observed: [],
        resolver: 'system-resolver',
        message: `Không kiểm tra được propagation: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }

  private async listRecordsForName(
    record: DnsRecord
  ): Promise<{ records: CloudflareRecord[] | null; error?: string }> {
    const response = await this.request(
      'GET',
      `/zones/${this.options.zoneId}/dns_records?type=${encodeURIComponent(record.type)}&name=${encodeURIComponent(record.name)}`
    )
    if (!response.success || !Array.isArray(response.result)) {
      return { records: null, error: firstError(response) }
    }
    return { records: response.result as CloudflareRecord[] }
  }

  private async request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<CloudflareResponse<unknown>> {
    try {
      const response = await this.fetchImpl(`https://api.cloudflare.com/client/v4${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.options.apiToken}`,
          'Content-Type': 'application/json'
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      })
      const payload = (await response.json()) as CloudflareResponse<unknown>
      if (!response.ok && payload.success) payload.success = false
      return payload
    } catch (error) {
      const rawMsg = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        errors: [{ message: redactText(maskSecrets(rawMsg)) }]
      }
    }
  }
}

export function buildDomainConnectUrl(
  providerBaseUrl: string,
  domain: string,
  serviceId: string
): string {
  if (!isHostname(domain)) throw new Error('domain không hợp lệ')
  const base = new URL(providerBaseUrl)
  const query = new URLSearchParams({ domain, service: serviceId })
  return `${base.origin}/.well-known/domain-connect/authorize?${query}`
}

function isHostname(value: string): boolean {
  return (
    value.length <= 253 &&
    /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value)
  )
}

function isRecordContent(record: DnsRecord): boolean {
  if (record.type === 'A') return isIP(record.content) === 4
  if (record.type === 'AAAA') return isIP(record.content) === 6
  return isHostname(record.content)
}

function normalizeDnsValue(value: string): string {
  return value.trim().replace(/\.$/, '').toLowerCase()
}

function firstError(response: CloudflareResponse<unknown>): string | undefined {
  const msg = response.errors?.find((error) => error.message)?.message
  return msg ? redactText(maskSecrets(msg)) : undefined
}

async function defaultResolver(name: string, type: DnsRecordType): Promise<string[]> {
  if (type === 'A') return resolve4(name)
  if (type === 'CNAME') return resolveCname(name)
  return resolve6(name)
}
