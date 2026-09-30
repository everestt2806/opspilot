import { describe, expect, it, vi } from 'vitest'

import { CloudflareDnsProvider, buildDomainConnectUrl, type DnsRecord } from './dns'

const record: DnsRecord = {
  type: 'A',
  name: 'app.example.com',
  content: '203.0.113.10',
  ownershipKey: 'app:1'
}

function response(payload: unknown, ok = true): Response {
  return {
    ok,
    json: async () => payload
  } as Response
}

describe('CloudflareDnsProvider', () => {
  it('tạo record mới qua POST khi chưa có record sở hữu trên Cloudflare', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response({ success: true, result: [] }))
      .mockResolvedValueOnce(response({ success: true, result: { id: 'r1', ...record } }))
    const result = await new CloudflareDnsProvider({
      apiToken: 'secret-token',
      zoneId: 'zone-1',
      fetchImpl,
      resolver: async () => ['203.0.113.10']
    }).upsertRecord(record)

    expect(result.ok).toBe(true)
    expect(result.id).toBe('r1')
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://api.cloudflare.com/client/v4/zones/zone-1/dns_records',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('idempotent: cập nhật record hiện có qua PUT khi đã có record sở hữu cùng ownershipKey', async () => {
    const existingRecord = {
      id: 'r-owned-1',
      type: 'A',
      name: 'app.example.com',
      content: '203.0.113.9',
      ttl: 300,
      proxied: false,
      comment: 'app:1' // khớp ownershipKey
    }
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response({ success: true, result: [existingRecord] }))
      .mockResolvedValueOnce(
        response({ success: true, result: { ...existingRecord, content: record.content } })
      )
    const provider = new CloudflareDnsProvider({
      apiToken: 'secret-token',
      zoneId: 'zone-1',
      fetchImpl
    })
    const result = await provider.upsertRecord(record)

    expect(result.ok).toBe(true)
    expect(result.id).toBe('r-owned-1')
    expect(result.message).toContain('Đã cập nhật DNS record')
    // Phải gọi PUT tới ID cũ, không tạo record mới
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://api.cloudflare.com/client/v4/zones/zone-1/dns_records/r-owned-1',
      expect.objectContaining({ method: 'PUT' })
    )
  })

  it('xung đột ownership: không ghi đè record của bên khác khi comment không khớp ownershipKey', async () => {
    const foreignRecord = {
      id: 'r-foreign-99',
      type: 'A',
      name: 'app.example.com',
      content: '1.2.3.4',
      ttl: 300,
      proxied: false,
      comment: 'other-owner:app-99' // bên khác sở hữu
    }
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response({ success: true, result: [foreignRecord] }))

    const provider = new CloudflareDnsProvider({
      apiToken: 'secret-token',
      zoneId: 'zone-1',
      fetchImpl
    })
    const result = await provider.upsertRecord(record)

    expect(result.ok).toBe(false)
    expect(result.conflict).toBe(true)
    expect(result.message).toContain('Xung đột quyền sở hữu')
    // Tuyệt đối không gọi PUT hay POST
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('xung đột ownership: không ghi đè record của bên khác khi record cũ không có comment fingerprint', async () => {
    const unownedRecord = {
      id: 'r-unowned-88',
      type: 'A',
      name: 'app.example.com',
      content: '1.2.3.4',
      ttl: 300,
      proxied: false,
      comment: null // record thủ công không có fingerprint
    }
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response({ success: true, result: [unownedRecord] }))

    const provider = new CloudflareDnsProvider({
      apiToken: 'secret-token',
      zoneId: 'zone-1',
      fetchImpl
    })
    const result = await provider.upsertRecord(record)

    expect(result.ok).toBe(false)
    expect(result.conflict).toBe(true)
    expect(result.message).toContain('Xung đột quyền sở hữu')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('xung đột ownership: báo conflict khi có foreign record kể cả khi đồng thời có record mình sở hữu', async () => {
    const ownedRecord = {
      id: 'r-owned-1',
      type: 'A',
      name: 'app.example.com',
      content: '203.0.113.10',
      ttl: 300,
      proxied: false,
      comment: 'app:1' // khớp ownershipKey
    }
    const foreignRecord = {
      id: 'r-foreign-2',
      type: 'A',
      name: 'app.example.com',
      content: '1.2.3.4',
      ttl: 300,
      proxied: false,
      comment: 'other-team' // không khớp ownershipKey
    }
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response({ success: true, result: [ownedRecord, foreignRecord] }))

    const provider = new CloudflareDnsProvider({
      apiToken: 'secret-token',
      zoneId: 'zone-1',
      fetchImpl
    })
    const result = await provider.upsertRecord(record)

    expect(result.ok).toBe(false)
    expect(result.conflict).toBe(true)
    expect(result.message).toContain('Xung đột quyền sở hữu')
    expect(fetchImpl).toHaveBeenCalledTimes(1) // không gọi PUT hay POST
  })

  it('lỗi provider: che cả Bearer token và mật khẩu URL trong lỗi provider', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      response(
        {
          success: false,
          errors: [
            {
              message:
                'Failed calling http://admin:superSecretPassword@cloudflare.api/dns with Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token123'
            }
          ]
        },
        false
      )
    )
    const provider = new CloudflareDnsProvider({
      apiToken: 'secret-token',
      zoneId: 'zone-1',
      fetchImpl
    })
    const result = await provider.upsertRecord(record)

    expect(result.ok).toBe(false)
    expect(result.technical).toBeDefined()
    expect(result.technical).not.toContain('superSecretPassword')
    expect(result.technical).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token123')
    expect(result.technical).toContain('http://admin:***@cloudflare.api/dns')
    expect(result.technical).toContain('Bearer ***')
  })

  it('lỗi provider: xử lý khi Cloudflare API trả về lỗi (403/invalid token/zone not found)', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(
      response(
        {
          success: false,
          errors: [{ code: 10000, message: 'Authentication error: Invalid API token' }]
        },
        false
      )
    )
    const provider = new CloudflareDnsProvider({
      apiToken: 'bad-token',
      zoneId: 'zone-1',
      fetchImpl
    })
    const result = await provider.upsertRecord(record)

    expect(result.ok).toBe(false)
    expect(result.message).toContain('Không thể kiểm tra DNS record')
  })

  it('lỗi provider: xử lý khi fetch ném network error/timeout', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('fetch failed: network down'))
    const provider = new CloudflareDnsProvider({
      apiToken: 'secret-token',
      zoneId: 'zone-1',
      fetchImpl
    })
    const result = await provider.upsertRecord(record)

    expect(result.ok).toBe(false)
    expect(result.message).toContain('Không thể kiểm tra DNS record')
  })

  it('deleteOwnedRecord: xóa đúng record có ownershipKey và không xóa record của bên khác', async () => {
    const foreignRecord = {
      id: 'r-foreign-1',
      type: 'A',
      name: 'app.example.com',
      content: '1.2.3.4',
      ttl: 300,
      proxied: false,
      comment: 'someone-else'
    }
    const fetchForeign = vi
      .fn()
      .mockResolvedValueOnce(response({ success: true, result: [foreignRecord] }))
    const providerForeign = new CloudflareDnsProvider({
      apiToken: 'secret-token',
      zoneId: 'zone-1',
      fetchImpl: fetchForeign
    })
    const deleteForeignResult = await providerForeign.deleteOwnedRecord(record)
    expect(deleteForeignResult.ok).toBe(true)
    expect(deleteForeignResult.message).toContain('Không có DNS record do OpsPilot sở hữu')
    expect(fetchForeign).toHaveBeenCalledTimes(1) // không gọi DELETE

    const ownedRecord = { ...foreignRecord, id: 'r-owned-2', comment: 'app:1' }
    const fetchOwned = vi
      .fn()
      .mockResolvedValueOnce(response({ success: true, result: [ownedRecord] }))
      .mockResolvedValueOnce(response({ success: true, result: { id: 'r-owned-2' } }))
    const providerOwned = new CloudflareDnsProvider({
      apiToken: 'secret-token',
      zoneId: 'zone-1',
      fetchImpl: fetchOwned
    })
    const deleteOwnedResult = await providerOwned.deleteOwnedRecord(record)
    expect(deleteOwnedResult.ok).toBe(true)
    expect(deleteOwnedResult.id).toBe('r-owned-2')
    expect(fetchOwned).toHaveBeenNthCalledWith(
      2,
      'https://api.cloudflare.com/client/v4/zones/zone-1/dns_records/r-owned-2',
      expect.objectContaining({ method: 'DELETE' })
    )
  })

  it('phân biệt propagated và wrong_target (sai target)', async () => {
    const providerWrong = new CloudflareDnsProvider({
      apiToken: 'secret-token',
      zoneId: 'zone-1',
      resolver: async () => ['198.51.100.9']
    })
    const resultWrong = await providerWrong.checkPropagation(record)
    expect(resultWrong.status).toBe('wrong_target')
    expect(resultWrong.message).toContain('198.51.100.9')

    const providerCorrect = new CloudflareDnsProvider({
      apiToken: 'secret-token',
      zoneId: 'zone-1',
      resolver: async () => ['203.0.113.10']
    })
    const resultCorrect = await providerCorrect.checkPropagation(record)
    expect(resultCorrect.status).toBe('propagated')

    const providerNx = new CloudflareDnsProvider({
      apiToken: 'secret-token',
      zoneId: 'zone-1',
      resolver: async () => []
    })
    const resultNx = await providerNx.checkPropagation(record)
    expect(resultNx.status).toBe('nxdomain')

    const providerMixed = new CloudflareDnsProvider({
      apiToken: 'secret-token',
      zoneId: 'zone-1',
      resolver: async () => ['203.0.113.10', '198.51.100.9']
    })
    const resultMixed = await providerMixed.checkPropagation(record)
    expect(resultMixed.status).toBe('wrong_target')
    expect(resultMixed.message).toContain('chưa trỏ hoàn toàn')
  })
})

describe('buildDomainConnectUrl', () => {
  it('giữ domain/service trong URL provider đã discovery', () => {
    const url = buildDomainConnectUrl(
      'https://registrar.example/connect',
      'app.example.com',
      'opspilot'
    )
    expect(url).toContain('domain=app.example.com')
    expect(url).toContain('service=opspilot')
    expect(url.startsWith('https://registrar.example/')).toBe(true)
  })
})
