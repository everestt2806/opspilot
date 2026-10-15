import { describe, expect, it, vi } from 'vitest'

import type { IngressPreflightResult } from './preflight'
import type { DnsReadinessResolver } from './dnsReadiness'
import { checkSharedIngressReadiness, DNS_QUERY_TIMEOUT_MS, MAX_CNAME_DEPTH } from './dnsReadiness'

const originIp = '93.184.216.34'

function makeIngress(overrides: Partial<IngressPreflightResult> = {}): IngressPreflightResult {
  return {
    ownership: 'ports_free',
    ports_status: 'free',
    install_assessment: 'safe',
    local_assessment: 'clear',
    reason_code: null,
    listeners: [],
    service: 'absent',
    caddy_version: null,
    ownership_marker: 'missing',
    config_exists: false,
    config_readable: null,
    ufw: {
      state: 'inactive',
      inbound_80: 'not_applicable',
      inbound_443: 'not_applicable',
      inbound_80_ipv4: 'not_applicable',
      inbound_80_ipv6: 'not_applicable',
      inbound_443_ipv4: 'not_applicable',
      inbound_443_ipv6: 'not_applicable'
    },
    route_activation: 'not_evaluated',
    ...overrides
  }
}

function makeResolver(records: Record<string, string[] | Error>): DnsReadinessResolver {
  const query = (type: 'A' | 'AAAA' | 'CNAME') => vi.fn(async (name: string) => {
    const value = records[`${type}:${name}`]
    if (value instanceof Error) throw value
    if (value) return value
    const error = new Error('no data') as NodeJS.ErrnoException
    error.code = 'ENODATA'
    throw error
  })
  return { resolve4: query('A'), resolve6: query('AAAA'), resolveCname: query('CNAME') } as unknown as DnsReadinessResolver
}

function makeResolvers(records: Record<string, string[] | Error>): readonly [DnsReadinessResolver, DnsReadinessResolver] {
  return [makeResolver(records), makeResolver(records)]
}

function dnsError(code: string): Error {
  const error = new Error(code) as NodeJS.ErrnoException
  error.code = code
  return error
}

describe('checkSharedIngressReadiness', () => {
  it('follows a bounded CNAME chain and requires every terminal IP to match the VPS', async () => {
    const resolvers = makeResolvers({
      'CNAME:app.example.com': ['edge.example.net'],
      'CNAME:edge.example.net': ['origin.example.net'],
      'A:origin.example.net': [originIp]
    })
    const result = await checkSharedIngressReadiness({
      hostname: 'App.Example.com.', vpsHost: 'origin.example.net', resolvers, ingress: makeIngress(),
      cloudflareProxyHint: 'disabled'
    })
    expect(result).toMatchObject({
      hostname: 'app.example.com', dns_status: 'propagated', dns_reason_code: null,
      expected_ipv4: [originIp], observed_a: [originIp],
      cname_chain: ['edge.example.net', 'origin.example.net'],
      acme_http_01: 'unknown', acme_tls_alpn: 'unknown',
      cloud_firewall_status: 'unknown', certificate_status: 'not_requested',
      route_status: 'not_configured', https_probe_status: 'not_run', overall_status: 'unknown'
    })
    expect(result.instructions.join(' ')).toContain('external HTTPS probe')
  })

  it('distinguishes NXDOMAIN from resolver failures', async () => {
    const nxdomain = await checkSharedIngressReadiness({
      hostname: 'missing.example.com', vpsHost: originIp,
      resolvers: makeResolvers({ 'CNAME:missing.example.com': dnsError('ENOTFOUND') }), ingress: makeIngress()
    })
    const resolverError = await checkSharedIngressReadiness({
      hostname: 'slow.example.com', vpsHost: originIp,
      resolvers: makeResolvers({ 'CNAME:slow.example.com': dnsError('EAI_AGAIN') }), ingress: makeIngress()
    })
    expect(nxdomain).toMatchObject({ dns_status: 'nxdomain', dns_reason_code: 'DNS_NXDOMAIN' })
    expect(resolverError).toMatchObject({ dns_status: 'resolver_error', dns_reason_code: 'DNS_RESOLVER_ERROR' })
  })

  it('does not confirm DNS when public resolvers disagree on terminal addresses', async () => {
    const result = await checkSharedIngressReadiness({
      hostname: 'app.example.com', vpsHost: originIp,
      resolvers: [
        makeResolver({ 'A:app.example.com': [originIp] }),
        makeResolver({ 'A:app.example.com': ['93.184.216.35'] })
      ],
      ingress: makeIngress(), cloudflareProxyHint: 'disabled'
    })
    expect(result).toMatchObject({
      dns_status: 'resolver_disagreement', dns_reason_code: 'DNS_RESOLVERS_DISAGREE',
      acme_http_01: 'unknown', certificate_status: 'not_requested', route_status: 'not_configured'
    })
  })

  it('times out and cancels each public resolver that does not answer', async () => {
    vi.useFakeTimers()
    const cancel1 = vi.fn()
    const cancel2 = vi.fn()
    const hanging = (cancel: () => void): DnsReadinessResolver => ({
      resolve4: vi.fn(() => new Promise<string[]>(() => {})),
      resolve6: vi.fn(() => new Promise<string[]>(() => {})),
      resolveCname: vi.fn(() => new Promise<string[]>(() => {})),
      cancel
    } as unknown as DnsReadinessResolver)
    try {
      const pending = checkSharedIngressReadiness({
        hostname: 'app.example.com', vpsHost: originIp,
        resolvers: [hanging(cancel1), hanging(cancel2)], ingress: makeIngress()
      })
      await vi.advanceTimersByTimeAsync(DNS_QUERY_TIMEOUT_MS)
      await expect(pending).resolves.toMatchObject({
        dns_status: 'resolver_timeout', dns_reason_code: 'DNS_RESOLVER_TIMEOUT',
        acme_http_01: 'unknown'
      })
      expect(cancel1).toHaveBeenCalledOnce()
      expect(cancel2).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('marks IPs mixed between the matching VPS and another target', async () => {
    const result = await checkSharedIngressReadiness({
      hostname: 'app.example.com', vpsHost: originIp,
      resolvers: makeResolvers({ 'A:app.example.com': [originIp, '1.1.1.1'] }), ingress: makeIngress()
    })
    expect(result).toMatchObject({ dns_status: 'mixed_target', dns_reason_code: 'DNS_MIXED_TARGETS' })
  })

  it('detects CNAME loops and depth overflow', async () => {
    const loop = await checkSharedIngressReadiness({
      hostname: 'a.example.com', vpsHost: originIp,
      resolvers: makeResolvers({ 'CNAME:a.example.com': ['b.example.com'], 'CNAME:b.example.com': ['a.example.com'] }),
      ingress: makeIngress()
    })
    const records: Record<string, string[]> = {}
    for (let i = 0; i <= MAX_CNAME_DEPTH; i += 1) {
      records[`CNAME:c${i}.example.com`] = [`c${i + 1}.example.com`]
    }
    const tooDeep = await checkSharedIngressReadiness({
      hostname: 'c0.example.com', vpsHost: originIp, resolvers: makeResolvers(records), ingress: makeIngress()
    })
    expect(loop).toMatchObject({ dns_status: 'cname_loop', dns_reason_code: 'DNS_CNAME_LOOP' })
    expect(tooDeep).toMatchObject({
      dns_status: 'cname_depth_exceeded', dns_reason_code: 'DNS_CNAME_DEPTH_EXCEEDED'
    })
  })

  it('rejects AAAA when the VPS target has no public IPv6 address', async () => {
    const result = await checkSharedIngressReadiness({
      hostname: 'app.example.com', vpsHost: originIp,
      resolvers: makeResolvers({ 'A:app.example.com': [originIp], 'AAAA:app.example.com': ['2001:4860:4860::8888'] }),
      ingress: makeIngress(), cloudflareProxyHint: 'disabled'
    })
    expect(result).toMatchObject({
      dns_status: 'ipv6_unreachable', dns_reason_code: 'DNS_IPV6_UNREACHABLE',
      ipv6_status: 'unreachable', acme_http_01: 'blocked', acme_tls_alpn: 'blocked'
    })
  })

  it('normalizes IPv6 before comparing equal full and compressed addresses', async () => {
    const result = await checkSharedIngressReadiness({
      hostname: 'app.example.com', vpsHost: '2001:db7::1',
      resolvers: makeResolvers({
        'AAAA:app.example.com': ['2001:0db7:0000:0000:0000:0000:0000:0001']
      }),
      ingress: makeIngress(), cloudflareProxyHint: 'disabled'
    })
    expect(result).toMatchObject({ dns_status: 'propagated', ipv6_status: 'target_matches' })
  })

  it.each([
    ['192.0.2.1', false], ['192.0.1.1', true], ['192.0.3.1', true],
    ['198.51.100.1', false], ['198.51.99.1', true], ['198.51.101.1', true],
    ['203.0.113.1', false], ['203.0.112.1', true], ['203.0.114.1', true]
  ])('classifies IPv4 TEST-NET boundaries for %s', async (address, isPublic) => {
    const result = await checkSharedIngressReadiness({
      hostname: 'app.example.com', vpsHost: address,
      resolvers: makeResolvers({ 'A:app.example.com': [address] }), ingress: makeIngress()
    })
    expect(result.dns_status).toBe(isPublic ? 'propagated' : 'expected_target_unresolved')
  })

  it('rejects exactly 2001:db8::/32 while accepting addresses immediately outside it', async () => {
    const docs = await checkSharedIngressReadiness({
      hostname: 'app.example.com', vpsHost: '2001:db8::1',
      resolvers: makeResolvers({ 'AAAA:app.example.com': ['2001:db8::1'] }), ingress: makeIngress()
    })
    const outside = await checkSharedIngressReadiness({
      hostname: 'app.example.com', vpsHost: '2001:db7::1',
      resolvers: makeResolvers({ 'AAAA:app.example.com': ['2001:db7::1'] }), ingress: makeIngress()
    })
    const above = await checkSharedIngressReadiness({
      hostname: 'app.example.com', vpsHost: '2001:db9::1',
      resolvers: makeResolvers({ 'AAAA:app.example.com': ['2001:db9::1'] }), ingress: makeIngress()
    })
    expect(docs.dns_status).toBe('expected_target_unresolved')
    expect(outside.dns_status).toBe('propagated')
    expect(above.dns_status).toBe('propagated')
  })

  it('marks matching AAAA unreachable when P1c finds host IPv6 firewall blocked', async () => {
    const result = await checkSharedIngressReadiness({
      hostname: 'app.example.com', vpsHost: '2001:4860:4860::8888',
      resolvers: makeResolvers({ 'AAAA:app.example.com': ['2001:4860:4860::8888'] }),
      ingress: makeIngress({
        install_assessment: 'blocked', local_assessment: 'blocked', reason_code: 'FIREWALL_80_BLOCKED',
        ufw: {
          state: 'active', inbound_80: 'blocked', inbound_443: 'blocked',
          inbound_80_ipv4: 'blocked', inbound_80_ipv6: 'blocked',
          inbound_443_ipv4: 'blocked', inbound_443_ipv6: 'blocked'
        }
      }), cloudflareProxyHint: 'disabled'
    })
    expect(result).toMatchObject({
      dns_status: 'ipv6_unreachable', dns_reason_code: 'DNS_IPV6_UNREACHABLE',
      ipv6_status: 'unreachable', acme_http_01: 'blocked', acme_tls_alpn: 'blocked'
    })
  })

  it('treats the renderer Cloudflare selection as an unverified hint, not provider evidence', async () => {
    const resolvers = makeResolvers({ 'A:app.example.com': ['104.16.0.1'] })
    const result = await checkSharedIngressReadiness({
      hostname: 'app.example.com', vpsHost: originIp, resolvers, ingress: makeIngress(),
      cloudflareProxyHint: 'enabled'
    })
    expect(resolvers[0].resolve4).toHaveBeenCalledWith('app.example.com')
    expect(result).toMatchObject({
      dns_status: 'proxy_hint_unverified', dns_reason_code: 'DNS_PROXY_HINT_UNVERIFIED',
      cloudflare_proxy_hint: 'enabled',
      observed_a: ['104.16.0.1'], acme_http_01: 'unknown', acme_tls_alpn: 'unknown'
    })
    expect(result.instructions.join(' ')).toContain('chưa phải trạng thái được xác minh')
    expect(result.instructions.join(' ')).toContain('không dùng gợi ý này')
  })

  it('preserves NXDOMAIN when Cloudflare proxy evidence exists but DNS has no name', async () => {
    const result = await checkSharedIngressReadiness({
      hostname: 'missing.example.com', vpsHost: originIp,
      resolvers: makeResolvers({ 'CNAME:missing.example.com': dnsError('ENOTFOUND') }),
      ingress: makeIngress(), cloudflareProxyHint: 'enabled'
    })
    expect(result).toMatchObject({ dns_status: 'nxdomain', dns_reason_code: 'DNS_NXDOMAIN' })
  })

  it('keeps ACME unknown when UFW is unknown, even with DNS matching', async () => {
    const result = await checkSharedIngressReadiness({
      hostname: 'app.example.com', vpsHost: originIp,
      resolvers: makeResolvers({ 'A:app.example.com': [originIp] }),
      ingress: makeIngress({
        install_assessment: 'unknown', local_assessment: 'unknown',
        ufw: {
          state: 'unknown', inbound_80: 'unknown', inbound_443: 'unknown',
          inbound_80_ipv4: 'unknown', inbound_80_ipv6: 'unknown',
          inbound_443_ipv4: 'unknown', inbound_443_ipv6: 'unknown'
        }
      }), cloudflareProxyHint: 'disabled'
    })
    expect(result).toMatchObject({
      dns_status: 'propagated', acme_http_01: 'unknown', acme_tls_alpn: 'unknown',
      cloud_firewall_status: 'unknown', https_probe_status: 'not_run', overall_status: 'unknown'
    })
  })
})
