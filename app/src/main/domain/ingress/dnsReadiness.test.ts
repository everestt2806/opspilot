import { describe, expect, it, vi } from 'vitest'

import type { IngressPreflightResult } from './preflight'
import type { DnsReadinessResolver } from './dnsReadiness'
import { checkSharedIngressReadiness, MAX_CNAME_DEPTH } from './dnsReadiness'

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

function dnsError(code: string): Error {
  const error = new Error(code) as NodeJS.ErrnoException
  error.code = code
  return error
}

describe('checkSharedIngressReadiness', () => {
  it('follows a bounded CNAME chain and requires every terminal IP to match the VPS', async () => {
    const resolver = makeResolver({
      'CNAME:app.example.com': ['edge.example.net'],
      'CNAME:edge.example.net': ['origin.example.net'],
      'A:origin.example.net': [originIp]
    })
    const result = await checkSharedIngressReadiness({
      hostname: 'App.Example.com.', vpsHost: 'origin.example.net', resolver, ingress: makeIngress(),
      cloudflareProxyStatus: 'disabled'
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
      resolver: makeResolver({ 'CNAME:missing.example.com': dnsError('ENOTFOUND') }), ingress: makeIngress()
    })
    const resolverError = await checkSharedIngressReadiness({
      hostname: 'slow.example.com', vpsHost: originIp,
      resolver: makeResolver({ 'CNAME:slow.example.com': dnsError('EAI_AGAIN') }), ingress: makeIngress()
    })
    expect(nxdomain).toMatchObject({ dns_status: 'nxdomain', dns_reason_code: 'DNS_NXDOMAIN' })
    expect(resolverError).toMatchObject({ dns_status: 'resolver_error', dns_reason_code: 'DNS_RESOLVER_ERROR' })
  })

  it('marks IPs mixed between the matching VPS and another target', async () => {
    const result = await checkSharedIngressReadiness({
      hostname: 'app.example.com', vpsHost: originIp,
      resolver: makeResolver({ 'A:app.example.com': [originIp, '1.1.1.1'] }), ingress: makeIngress()
    })
    expect(result).toMatchObject({ dns_status: 'mixed_target', dns_reason_code: 'DNS_MIXED_TARGETS' })
  })

  it('detects CNAME loops and depth overflow', async () => {
    const loop = await checkSharedIngressReadiness({
      hostname: 'a.example.com', vpsHost: originIp,
      resolver: makeResolver({ 'CNAME:a.example.com': ['b.example.com'], 'CNAME:b.example.com': ['a.example.com'] }),
      ingress: makeIngress()
    })
    const records: Record<string, string[]> = {}
    for (let i = 0; i <= MAX_CNAME_DEPTH; i += 1) {
      records[`CNAME:c${i}.example.com`] = [`c${i + 1}.example.com`]
    }
    const tooDeep = await checkSharedIngressReadiness({
      hostname: 'c0.example.com', vpsHost: originIp, resolver: makeResolver(records), ingress: makeIngress()
    })
    expect(loop).toMatchObject({ dns_status: 'cname_loop', dns_reason_code: 'DNS_CNAME_LOOP' })
    expect(tooDeep).toMatchObject({
      dns_status: 'cname_depth_exceeded', dns_reason_code: 'DNS_CNAME_DEPTH_EXCEEDED'
    })
  })

  it('rejects AAAA when the VPS target has no public IPv6 address', async () => {
    const result = await checkSharedIngressReadiness({
      hostname: 'app.example.com', vpsHost: originIp,
      resolver: makeResolver({ 'A:app.example.com': [originIp], 'AAAA:app.example.com': ['2001:4860:4860::8888'] }),
      ingress: makeIngress(), cloudflareProxyStatus: 'disabled'
    })
    expect(result).toMatchObject({
      dns_status: 'ipv6_unreachable', dns_reason_code: 'DNS_IPV6_UNREACHABLE',
      ipv6_status: 'unreachable', acme_http_01: 'blocked', acme_tls_alpn: 'blocked'
    })
  })

  it('marks matching AAAA unreachable when P1c finds host IPv6 firewall blocked', async () => {
    const result = await checkSharedIngressReadiness({
      hostname: 'app.example.com', vpsHost: '2001:4860:4860::8888',
      resolver: makeResolver({ 'AAAA:app.example.com': ['2001:4860:4860::8888'] }),
      ingress: makeIngress({
        install_assessment: 'blocked', local_assessment: 'blocked', reason_code: 'FIREWALL_80_BLOCKED',
        ufw: {
          state: 'active', inbound_80: 'blocked', inbound_443: 'blocked',
          inbound_80_ipv4: 'blocked', inbound_80_ipv6: 'blocked',
          inbound_443_ipv4: 'blocked', inbound_443_ipv6: 'blocked'
        }
      }), cloudflareProxyStatus: 'disabled'
    })
    expect(result).toMatchObject({
      dns_status: 'ipv6_unreachable', dns_reason_code: 'DNS_IPV6_UNREACHABLE',
      ipv6_status: 'unreachable', acme_http_01: 'blocked', acme_tls_alpn: 'blocked'
    })
  })

  it('treats Cloudflare proxy evidence as proxied instead of comparing Anycast addresses', async () => {
    const resolver = makeResolver({ 'A:app.example.com': ['104.16.0.1'] })
    const result = await checkSharedIngressReadiness({
      hostname: 'app.example.com', vpsHost: originIp, resolver, ingress: makeIngress(),
      cloudflareProxyStatus: 'enabled'
    })
    expect(resolver.resolve4).toHaveBeenCalledWith('app.example.com')
    expect(result).toMatchObject({
      dns_status: 'cloudflare_proxied', dns_reason_code: 'DNS_CLOUDFLARE_PROXY_ENABLED',
      observed_a: ['104.16.0.1'], acme_http_01: 'unknown', acme_tls_alpn: 'unknown'
    })
    expect(result.instructions.join(' ')).toContain('Anycast')
  })

  it('preserves NXDOMAIN when Cloudflare proxy evidence exists but DNS has no name', async () => {
    const result = await checkSharedIngressReadiness({
      hostname: 'missing.example.com', vpsHost: originIp,
      resolver: makeResolver({ 'CNAME:missing.example.com': dnsError('ENOTFOUND') }),
      ingress: makeIngress(), cloudflareProxyStatus: 'enabled'
    })
    expect(result).toMatchObject({ dns_status: 'nxdomain', dns_reason_code: 'DNS_NXDOMAIN' })
  })

  it('keeps ACME unknown when UFW is unknown, even with DNS matching', async () => {
    const result = await checkSharedIngressReadiness({
      hostname: 'app.example.com', vpsHost: originIp,
      resolver: makeResolver({ 'A:app.example.com': [originIp] }),
      ingress: makeIngress({
        install_assessment: 'unknown', local_assessment: 'unknown',
        ufw: {
          state: 'unknown', inbound_80: 'unknown', inbound_443: 'unknown',
          inbound_80_ipv4: 'unknown', inbound_80_ipv6: 'unknown',
          inbound_443_ipv4: 'unknown', inbound_443_ipv6: 'unknown'
        }
      }), cloudflareProxyStatus: 'disabled'
    })
    expect(result).toMatchObject({
      dns_status: 'propagated', acme_http_01: 'unknown', acme_tls_alpn: 'unknown',
      cloud_firewall_status: 'unknown', https_probe_status: 'not_run', overall_status: 'unknown'
    })
  })
})
