import { Resolver } from 'node:dns/promises'
import { isIP } from 'node:net'

import type {
  DomainDnsReadinessStatus,
  DomainDnsReadinessReason,
  DomainAcmeAttemptStatus,
  SharedIngressReadinessResult
} from '@shared/ipc'

import type { IngressPreflightResult } from './preflight'

export const PUBLIC_DNS_SERVERS = ['1.1.1.1', '8.8.8.8'] as const
export const MAX_CNAME_DEPTH = 8

export type DnsReadinessResolver = Pick<Resolver, 'resolve4' | 'resolve6' | 'resolveCname'>

type AddressResolution =
  | { ok: true; ipv4: string[]; ipv6: string[]; cname_chain: string[] }
  | {
      ok: false
      status: Extract<DomainDnsReadinessStatus, 'nxdomain' | 'no_records' | 'resolver_error' | 'cname_loop' | 'cname_depth_exceeded'>
      cname_chain: string[]
    }

const statusReason: Partial<Record<DomainDnsReadinessStatus, DomainDnsReadinessReason>> = {
  nxdomain: 'DNS_NXDOMAIN',
  no_records: 'DNS_NO_RECORDS',
  resolver_error: 'DNS_RESOLVER_ERROR',
  mixed_target: 'DNS_MIXED_TARGETS',
  target_mismatch: 'DNS_TARGET_MISMATCH',
  cname_loop: 'DNS_CNAME_LOOP',
  cname_depth_exceeded: 'DNS_CNAME_DEPTH_EXCEEDED',
  ipv6_unreachable: 'DNS_IPV6_UNREACHABLE',
  cloudflare_proxied: 'DNS_CLOUDFLARE_PROXY_ENABLED',
  expected_target_unresolved: 'DNS_EXPECTED_TARGET_UNRESOLVED'
}

/** Read-only DNS + ingress readiness. It never writes domain state or marks TLS/route active. */
export async function checkSharedIngressReadiness(input: {
  hostname: string
  vpsHost: string
  cloudflareProxyStatus?: 'enabled' | 'disabled' | 'unknown'
  ingress: IngressPreflightResult
  resolver?: DnsReadinessResolver
}): Promise<SharedIngressReadinessResult> {
  const hostname = normalizeHostname(input.hostname)
  if (!isHostname(hostname)) throw new Error('Hostname không hợp lệ.')
  const resolver = input.resolver ?? createPublicResolver()
  const proxyStatus = input.cloudflareProxyStatus ?? 'unknown'

  const observed = await resolveAddressChain(hostname, resolver)
  if (proxyStatus === 'enabled') {
    const proxyInstructions = [
      'Cloudflare Proxy đang bật; A/AAAA có thể là IP Anycast của Cloudflare nên không dùng để đối chiếu với VPS.',
      'Xác minh origin bằng thông tin DNS provider hoặc chuyển tạm sang DNS only trước khi kiểm tra DNS-to-VPS.',
      'Preflight không cấp certificate, không bật route và chưa chạy external HTTPS probe.'
    ]
    if (observed.ok) {
      return buildResult(hostname, 'cloudflare_proxied', {
        ipv4: observed.ipv4, ipv6: observed.ipv6, cname_chain: observed.cname_chain
      }, input.ingress, proxyStatus, proxyInstructions)
    }
    return buildResult(hostname, observed.status, {
      ipv4: [], ipv6: [], cname_chain: observed.cname_chain
    }, input.ingress, proxyStatus, [...dnsInstructions(observed.status), ...proxyInstructions])
  }

  if (!observed.ok) {
    return buildResult(hostname, observed.status, {
      ipv4: [], ipv6: [], cname_chain: observed.cname_chain
    }, input.ingress, proxyStatus, dnsInstructions(observed.status))
  }

  const expected = await resolveExpectedAddresses(input.vpsHost, resolver)
  if (!expected.ok) {
    return buildResult(hostname, 'expected_target_unresolved', {
      ipv4: observed.ipv4, ipv6: observed.ipv6, cname_chain: observed.cname_chain
    }, input.ingress, proxyStatus, [
      'Không xác định được public IP từ host đã lưu của VPS; cần cập nhật endpoint VPS thành IP công khai hoặc hostname phân giải được.',
      'Không thể xác nhận DNS trỏ tới VPS.'
    ])
  }

  const hasWrongV4 = observed.ipv4.some((address) => !expected.ipv4.includes(address))
  const hasWrongV6 = observed.ipv6.some((address) => !expected.ipv6.includes(address))
  const hasIpv6WithoutVpsSupport = observed.ipv6.length > 0 && expected.ipv6.length === 0
  const hasCorrect = observed.ipv4.some((address) => expected.ipv4.includes(address)) ||
    observed.ipv6.some((address) => expected.ipv6.includes(address))
  const hasWrong = hasWrongV4 || hasWrongV6
  let dnsStatus: DomainDnsReadinessStatus
  if (hasIpv6WithoutVpsSupport || (hasWrongV6 && expected.ipv6.length === 0)) {
    dnsStatus = 'ipv6_unreachable'
  } else if (hasCorrect && hasWrong) {
    dnsStatus = 'mixed_target'
  } else if (hasWrong) {
    dnsStatus = 'target_mismatch'
  } else {
    dnsStatus = 'propagated'
  }

  const ipv6Status = observed.ipv6.length === 0
    ? 'not_advertised'
    : hasIpv6WithoutVpsSupport || hasWrongV6
      ? 'unreachable'
      : input.ingress.ufw.state === 'unknown' ||
          input.ingress.ufw.inbound_80_ipv6 === 'unknown' ||
          input.ingress.ufw.inbound_443_ipv6 === 'unknown'
        ? 'unknown'
        : input.ingress.ufw.inbound_80_ipv6 === 'blocked' ||
            input.ingress.ufw.inbound_443_ipv6 === 'blocked'
          ? 'unreachable'
          : 'target_matches'

  if (ipv6Status === 'unreachable') dnsStatus = 'ipv6_unreachable'

  const instructions = dnsStatus === 'propagated'
    ? [
        'A và AAAA cuối chuỗi CNAME đều khớp public IP đã phân giải từ host VPS.',
        ...(ipv6Status === 'unknown'
          ? ['IPv6 chưa được xác minh đầy đủ; kiểm tra firewall IPv6 và cloud firewall trước khi thử ACME.']
          : []),
        'Cloud firewall chưa được kiểm chứng; trạng thái thử ACME vẫn unknown.',
        'Certificate chỉ valid và route chỉ active sau external HTTPS probe thành công.'
      ]
    : dnsInstructions(dnsStatus)

  return buildResult(hostname, dnsStatus, {
    ipv4: observed.ipv4,
    ipv6: observed.ipv6,
    cname_chain: observed.cname_chain,
    target_ipv4: expected.ipv4,
    target_ipv6: expected.ipv6,
    ipv6_status: ipv6Status
  }, input.ingress, proxyStatus, instructions)
}

function buildResult(
  hostname: string,
  dnsStatus: DomainDnsReadinessStatus,
  addresses: {
    ipv4: string[]
    ipv6: string[]
    cname_chain: string[]
    target_ipv4?: string[]
    target_ipv6?: string[]
    ipv6_status?: 'not_advertised' | 'target_matches' | 'unreachable' | 'unknown'
  },
  ingress: IngressPreflightResult,
  proxyStatus: 'enabled' | 'disabled' | 'unknown',
  instructions: string[]
): SharedIngressReadinessResult {
  const dnsReason = statusReason[dnsStatus] ?? null
  const dnsBlocked = ['nxdomain', 'no_records', 'mixed_target', 'target_mismatch', 'ipv6_unreachable', 'expected_target_unresolved'].includes(dnsStatus)
  const acmeStatus = (port: 80 | 443): DomainAcmeAttemptStatus => {
    if (dnsBlocked || ingress.local_assessment === 'blocked') return 'blocked'
    if (dnsStatus !== 'propagated' || proxyStatus !== 'disabled') return 'unknown'
    if (ingress.install_assessment !== 'safe' || ingress.ufw.state === 'unknown') return 'unknown'
    const portStatus = ingress.ufw[`inbound_${port}`]
    if (portStatus === 'blocked') return 'blocked'
    if (portStatus === 'unknown') return 'unknown'
    if (addresses.ipv6_status === 'unreachable') return 'blocked'
    if (addresses.ipv6_status === 'unknown') return 'unknown'
    // P1d has no cloud-firewall adapter, so the network path is never proven ready here.
    return 'unknown'
  }
  return {
    hostname,
    dns_status: dnsStatus,
    dns_reason_code: dnsReason,
    resolver: 'public-resolvers',
    expected_ipv4: addresses.target_ipv4 ?? [],
    expected_ipv6: addresses.target_ipv6 ?? [],
    observed_a: addresses.ipv4,
    observed_aaaa: addresses.ipv6,
    cname_chain: addresses.cname_chain,
    ipv6_status: addresses.ipv6_status ?? 'unknown',
    cloudflare_proxy_status: proxyStatus,
    ingress: {
      ports_status: ingress.ports_status,
      install_assessment: ingress.install_assessment,
      local_assessment: ingress.local_assessment,
      reason_code: ingress.reason_code,
      ufw: ingress.ufw
    },
    cloud_firewall_status: 'unknown',
    acme_http_01: acmeStatus(80),
    acme_tls_alpn: acmeStatus(443),
    certificate_status: 'not_requested',
    route_status: 'not_configured',
    https_probe_status: 'not_run',
    overall_status: 'unknown',
    instructions
  }
}

function createPublicResolver(): DnsReadinessResolver {
  const resolver = new Resolver()
  resolver.setServers([...PUBLIC_DNS_SERVERS])
  return resolver
}

async function resolveExpectedAddresses(
  vpsHost: string,
  resolver: DnsReadinessResolver
): Promise<{ ok: true; ipv4: string[]; ipv6: string[] } | { ok: false }> {
  const host = stripIpv6Brackets(vpsHost.trim())
  const family = isIP(host)
  if (family === 4) return isPublicIpv4(host) ? { ok: true, ipv4: [host], ipv6: [] } : { ok: false }
  if (family === 6) return isPublicIpv6(host) ? { ok: true, ipv4: [], ipv6: [host.toLowerCase()] } : { ok: false }
  if (!isHostname(host)) return { ok: false }
  const resolved = await resolveAddressChain(host, resolver)
  if (!resolved.ok || (resolved.ipv4.length === 0 && resolved.ipv6.length === 0)) return { ok: false }
  if (!resolved.ipv4.every(isPublicIpv4) || !resolved.ipv6.every(isPublicIpv6)) return { ok: false }
  return { ok: true, ipv4: resolved.ipv4, ipv6: resolved.ipv6 }
}

async function resolveAddressChain(
  hostname: string,
  resolver: DnsReadinessResolver
): Promise<AddressResolution> {
  const cnameChain: string[] = []
  const visited = new Set<string>()
  let current = normalizeHostname(hostname)
  for (let depth = 0; depth <= MAX_CNAME_DEPTH; depth += 1) {
    if (visited.has(current)) return { ok: false, status: 'cname_loop', cname_chain: cnameChain }
    visited.add(current)
    let cnames: string[]
    try {
      cnames = await resolver.resolveCname(current)
    } catch (error) {
      const code = dnsErrorCode(error)
      if (code === 'ENOTFOUND') return { ok: false, status: 'nxdomain', cname_chain: cnameChain }
      if (!isNoData(code)) return { ok: false, status: 'resolver_error', cname_chain: cnameChain }
      cnames = []
    }
    if (cnames.length > 0) {
      if (cnames.length !== 1) return { ok: false, status: 'resolver_error', cname_chain: cnameChain }
      if (depth === MAX_CNAME_DEPTH) {
        return { ok: false, status: 'cname_depth_exceeded', cname_chain: cnameChain }
      }
      const target = normalizeHostname(cnames[0])
      if (!isHostname(target)) return { ok: false, status: 'resolver_error', cname_chain: cnameChain }
      cnameChain.push(target)
      current = target
      continue
    }

    const [a, aaaa] = await Promise.all([
      resolveAddressFamily(() => resolver.resolve4(current)),
      resolveAddressFamily(() => resolver.resolve6(current))
    ])
    if (a.error === 'ENOTFOUND' || aaaa.error === 'ENOTFOUND') {
      return { ok: false, status: 'nxdomain', cname_chain: cnameChain }
    }
    if ((a.error && !isNoData(a.error)) || (aaaa.error && !isNoData(aaaa.error))) {
      return { ok: false, status: 'resolver_error', cname_chain: cnameChain }
    }
    const ipv4 = a.values.filter((value) => isIP(value) === 4)
    const ipv6 = aaaa.values.filter((value) => isIP(value) === 6).map((value) => value.toLowerCase())
    if (ipv4.length !== a.values.length || ipv6.length !== aaaa.values.length) {
      return { ok: false, status: 'resolver_error', cname_chain: cnameChain }
    }
    if (ipv4.length === 0 && ipv6.length === 0) {
      return { ok: false, status: 'no_records', cname_chain: cnameChain }
    }
    return { ok: true, ipv4, ipv6, cname_chain: cnameChain }
  }
  return { ok: false, status: 'cname_depth_exceeded', cname_chain: cnameChain }
}

async function resolveAddressFamily(
  resolve: () => Promise<string[]>
): Promise<{ values: string[]; error: string | null }> {
  try {
    return { values: await resolve(), error: null }
  } catch (error) {
    return { values: [], error: dnsErrorCode(error) }
  }
}

function dnsErrorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'UNKNOWN'
}

function isNoData(code: string): boolean {
  return code === 'ENODATA' || code === 'NODATA'
}

function dnsInstructions(status: string): string[] {
  switch (status) {
    case 'nxdomain': return ['Hostname trả NXDOMAIN; kiểm tra tên và record tại DNS provider.']
    case 'no_records': return ['Hostname tồn tại nhưng không có A/AAAA cuối chuỗi CNAME.']
    case 'resolver_error': return ['Public resolver không trả kết quả xác định; thử lại sau và kiểm tra DNS delegation.']
    case 'cname_loop': return ['Chuỗi CNAME bị vòng lặp; sửa record để tạo chuỗi hữu hạn.']
    case 'cname_depth_exceeded': return [`Chuỗi CNAME vượt quá giới hạn ${MAX_CNAME_DEPTH}; rút ngắn chuỗi record.`]
    case 'mixed_target': return ['Một phần A/AAAA trỏ đúng nhưng còn IP khác; chỉ thử ACME khi mọi IP đều trỏ về VPS.']
    case 'target_mismatch': return ['A/AAAA cuối chuỗi CNAME không khớp public IP đã phân giải từ host VPS.']
    case 'ipv6_unreachable': return ['AAAA tồn tại nhưng VPS không có IPv6 công khai tương ứng hoặc firewall IPv6 đang chặn. Sửa/xóa AAAA trước khi thử ACME.']
    case 'expected_target_unresolved': return ['Không thể xác định public IP tương ứng với host VPS đã lưu.']
    default: return ['DNS chưa được xác minh; không cấp certificate hoặc bật route.']
  }
}

function normalizeHostname(value: string): string {
  return value.trim().replace(/\.$/, '').toLowerCase()
}

function stripIpv6Brackets(value: string): string {
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value
}

function isHostname(value: string): boolean {
  return value.length <= 253 &&
    /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value)
}

function isPublicIpv4(value: string): boolean {
  if (isIP(value) !== 4) return false
  const [a, b] = value.split('.').map(Number)
  if (a === undefined || b === undefined) return false
  return !(
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 2) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0)
  )
}

function isPublicIpv6(value: string): boolean {
  if (isIP(value) !== 6) return false
  const words = expandIpv6(value)
  if (!words) return false
  const globalUnicast = words[0] >= 0x2000 && words[0] <= 0x3fff
  const documentation = words[0] === 0x3fff && (words[1] & 0xf000) === 0
  const special2001 = words[0] === 0x2001 && words[1] <= 0x01ff
  return globalUnicast && !documentation && !special2001 && words[0] !== 0x2002
}

function expandIpv6(value: string): number[] | null {
  const parts = value.toLowerCase().split('::')
  if (parts.length > 2) return null
  const left = parts[0] ? parts[0].split(':') : []
  const right = parts.length === 2 && parts[1] ? parts[1].split(':') : []
  const missing = 8 - left.length - right.length
  if ((parts.length === 1 && missing !== 0) || (parts.length === 2 && missing < 1)) return null
  const words = [...left, ...Array(parts.length === 2 ? missing : 0).fill('0'), ...right]
    .map((part) => Number.parseInt(part, 16))
  return words.length === 8 && words.every((word) => Number.isInteger(word) && word >= 0 && word <= 0xffff)
    ? words
    : null
}
