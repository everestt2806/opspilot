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
export const DNS_QUERY_TIMEOUT_MS = 2500

export type DnsReadinessResolver = Pick<Resolver, 'resolve4' | 'resolve6' | 'resolveCname'> & {
  cancel?: () => void
}

type AddressResolution =
  | { ok: true; ipv4: string[]; ipv6: string[]; cname_chain: string[] }
  | {
      ok: false
      status: Extract<DomainDnsReadinessStatus, 'nxdomain' | 'no_records' | 'resolver_error' | 'cname_loop' | 'cname_depth_exceeded' | 'resolver_disagreement' | 'resolver_timeout'>
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
  resolver_disagreement: 'DNS_RESOLVERS_DISAGREE',
  resolver_timeout: 'DNS_RESOLVER_TIMEOUT',
  proxy_hint_unverified: 'DNS_PROXY_HINT_UNVERIFIED',
  expected_target_unresolved: 'DNS_EXPECTED_TARGET_UNRESOLVED'
}

/** Read-only DNS + ingress readiness. It never writes domain state or marks TLS/route active. */
export async function checkSharedIngressReadiness(input: {
  hostname: string
  vpsHost: string
  cloudflareProxyHint?: 'enabled' | 'disabled' | 'unknown'
  ingress: IngressPreflightResult
  resolvers?: readonly [DnsReadinessResolver, DnsReadinessResolver]
}): Promise<SharedIngressReadinessResult> {
  const hostname = normalizeHostname(input.hostname)
  if (!isHostname(hostname)) throw new Error('Hostname không hợp lệ.')
  const resolvers = input.resolvers ?? createPublicResolvers()
  const proxyHint = input.cloudflareProxyHint ?? 'unknown'

  const observed = await resolveConsistentAddressChain(hostname, resolvers)
  if (!observed.ok && (observed.status === 'resolver_timeout' || observed.status === 'resolver_disagreement' || observed.status === 'resolver_error')) {
    return buildResult(hostname, observed.status, {
      ipv4: [], ipv6: [], cname_chain: observed.cname_chain
    }, input.ingress, proxyHint, dnsInstructions(observed.status))
  }
  if (!observed.ok) {
    return buildResult(hostname, observed.status, {
      ipv4: [], ipv6: [], cname_chain: observed.cname_chain
    }, input.ingress, proxyHint, dnsInstructions(observed.status))
  }
  if (proxyHint === 'enabled') {
    const proxyInstructions = [
      'Bạn đã chọn gợi ý Cloudflare Proxy đang bật; đây chưa phải trạng thái được xác minh từ Cloudflare.',
      'A/AAAA có thể là IP Anycast; không dùng gợi ý này làm bằng chứng origin hoặc để kích hoạt HTTPS. Xác minh cấu hình tại DNS provider.',
      'Preflight không cấp certificate, không bật route và chưa chạy external HTTPS probe.'
    ]
    return buildResult(hostname, 'proxy_hint_unverified', {
      ipv4: observed.ipv4, ipv6: observed.ipv6, cname_chain: observed.cname_chain
    }, input.ingress, proxyHint, proxyInstructions)
  }

  const expected = await resolveExpectedAddresses(input.vpsHost, resolvers)
  if (!expected.ok) {
    const status = expected.status ?? 'expected_target_unresolved'
    return buildResult(hostname, status, {
      ipv4: observed.ipv4, ipv6: observed.ipv6, cname_chain: observed.cname_chain
    }, input.ingress, proxyHint, status === 'expected_target_unresolved' ? [
      'Không xác định được public IP từ host đã lưu của VPS; cần cập nhật endpoint VPS thành IP công khai hoặc hostname phân giải được.',
      'Không thể xác nhận DNS trỏ tới VPS.'
    ] : dnsInstructions(status))
  }

  const hasWrongV4 = observed.ipv4.some((address) => !expected.ipv4.includes(address))
  const expectedIpv6 = new Set(expected.ipv6.map(canonicalIpv6))
  const hasWrongV6 = observed.ipv6.some((address) => !expectedIpv6.has(canonicalIpv6(address)))
  const hasIpv6WithoutVpsSupport = observed.ipv6.length > 0 && expected.ipv6.length === 0
  const hasCorrect = observed.ipv4.some((address) => expected.ipv4.includes(address)) ||
    observed.ipv6.some((address) => expectedIpv6.has(canonicalIpv6(address)))
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
  }, input.ingress, proxyHint, instructions)
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
  proxyHint: 'enabled' | 'disabled' | 'unknown',
  instructions: string[]
): SharedIngressReadinessResult {
  const dnsReason = statusReason[dnsStatus] ?? null
  const dnsBlocked = ['nxdomain', 'no_records', 'mixed_target', 'target_mismatch', 'ipv6_unreachable', 'expected_target_unresolved'].includes(dnsStatus)
  const acmeStatus = (port: 80 | 443): DomainAcmeAttemptStatus => {
    if (dnsBlocked || ingress.local_assessment === 'blocked') return 'blocked'
    if (dnsStatus !== 'propagated' || proxyHint !== 'disabled') return 'unknown'
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
    resolvers: [...PUBLIC_DNS_SERVERS],
    expected_ipv4: addresses.target_ipv4 ?? [],
    expected_ipv6: addresses.target_ipv6 ?? [],
    observed_a: addresses.ipv4,
    observed_aaaa: addresses.ipv6,
    cname_chain: addresses.cname_chain,
    ipv6_status: addresses.ipv6_status ?? 'unknown',
    cloudflare_proxy_hint: proxyHint,
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
    instructions: [
      ...instructions,
      'cloudflare_proxy_hint chỉ là gợi ý do người dùng cung cấp, chưa xác minh từ Cloudflare; P1e không được dùng gợi ý này để kích hoạt HTTPS.'
    ]
  }
}

function createPublicResolvers(): readonly [DnsReadinessResolver, DnsReadinessResolver] {
  const makeResolver = (server: string): DnsReadinessResolver => {
    const resolver = new Resolver({ timeout: DNS_QUERY_TIMEOUT_MS, tries: 1 })
    resolver.setServers([server])
    return resolver
  }
  return [makeResolver(PUBLIC_DNS_SERVERS[0]), makeResolver(PUBLIC_DNS_SERVERS[1])]
}

async function resolveExpectedAddresses(
  vpsHost: string,
  resolvers: readonly [DnsReadinessResolver, DnsReadinessResolver]
): Promise<{
  ok: true; ipv4: string[]; ipv6: string[]
} | {
  ok: false; status?: DomainDnsReadinessStatus
}> {
  const host = stripIpv6Brackets(vpsHost.trim())
  const family = isIP(host)
  if (family === 4) return isPublicIpv4(host) ? { ok: true, ipv4: [host], ipv6: [] } : { ok: false }
  if (family === 6) return isPublicIpv6(host) ? { ok: true, ipv4: [], ipv6: [host.toLowerCase()] } : { ok: false }
  if (!isHostname(host)) return { ok: false }
  const resolved = await resolveConsistentAddressChain(host, resolvers)
  if (!resolved.ok) return { ok: false, status: resolved.status }
  if (resolved.ipv4.length === 0 && resolved.ipv6.length === 0) return { ok: false }
  if (!resolved.ipv4.every(isPublicIpv4) || !resolved.ipv6.every(isPublicIpv6)) return { ok: false }
  return { ok: true, ipv4: resolved.ipv4, ipv6: resolved.ipv6 }
}

async function resolveConsistentAddressChain(
  hostname: string,
  resolvers: readonly [DnsReadinessResolver, DnsReadinessResolver]
): Promise<AddressResolution> {
  const results = await Promise.all(resolvers.map((resolver) =>
    withDnsTimeout(resolveAddressChain(hostname, resolver), resolver)
  ))
  if (results.some((result) => !result.ok && result.status === 'resolver_timeout')) {
    return { ok: false, status: 'resolver_timeout', cname_chain: [] }
  }
  if (sameAddressResolution(results[0], results[1])) return results[0]
  if (results.some((result) => !result.ok && result.status === 'resolver_error')) {
    return { ok: false, status: 'resolver_error', cname_chain: [] }
  }
  return { ok: false, status: 'resolver_disagreement', cname_chain: [] }
}

function sameAddressResolution(left: AddressResolution, right: AddressResolution): boolean {
  if (left.ok !== right.ok) return false
  if (!left.ok && !right.ok) {
    return left.status === right.status && sameSequence(left.cname_chain, right.cname_chain)
  }
  if (left.ok && right.ok) {
    return sameSequence(left.cname_chain, right.cname_chain) &&
      sameStrings(left.ipv4, right.ipv4) &&
      sameStrings(left.ipv6.map(canonicalIpv6), right.ipv6.map(canonicalIpv6))
  }
  return false
}

function sameStrings(left: string[], right: string[]): boolean {
  const sortedLeft = [...new Set(left)].sort()
  const sortedRight = [...new Set(right)].sort()
  return sortedLeft.length === sortedRight.length && sortedLeft.every((value, index) => value === sortedRight[index])
}

function sameSequence(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

async function withDnsTimeout<T>(promise: Promise<T>, resolver: DnsReadinessResolver): Promise<T | AddressResolution> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<AddressResolution>((resolve) => {
        timer = setTimeout(() => {
          resolver.cancel?.()
          resolve({ ok: false, status: 'resolver_timeout', cname_chain: [] })
        }, DNS_QUERY_TIMEOUT_MS)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
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
    case 'resolver_disagreement': return ['Hai public resolver trả chuỗi CNAME hoặc tập IP khác nhau; DNS chưa được xác minh, hãy chờ đồng bộ rồi kiểm tra lại.']
    case 'resolver_timeout': return [`Public resolver không phản hồi trong ${DNS_QUERY_TIMEOUT_MS} ms; truy vấn đã bị hủy và DNS chưa được xác minh.`]
    case 'cname_loop': return ['Chuỗi CNAME bị vòng lặp; sửa record để tạo chuỗi hữu hạn.']
    case 'cname_depth_exceeded': return [`Chuỗi CNAME vượt quá giới hạn ${MAX_CNAME_DEPTH}; rút ngắn chuỗi record.`]
    case 'mixed_target': return ['Một phần A/AAAA trỏ đúng nhưng còn IP khác; chỉ thử ACME khi mọi IP đều trỏ về VPS.']
    case 'target_mismatch': return ['A/AAAA cuối chuỗi CNAME không khớp public IP đã phân giải từ host VPS.']
    case 'ipv6_unreachable': return ['AAAA tồn tại nhưng VPS không có IPv6 công khai tương ứng hoặc firewall IPv6 đang chặn. Sửa/xóa AAAA trước khi thử ACME.']
    case 'expected_target_unresolved': return ['Không thể xác định public IP tương ứng với host VPS đã lưu.']
    case 'proxy_hint_unverified': return ['Gợi ý Cloudflare Proxy do người dùng cung cấp chưa được xác minh; không thể kết luận DNS trỏ trực tiếp tới VPS.']
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
  const [c, d] = value.split('.').slice(2).map(Number)
  if (c === undefined || d === undefined) return false
  const in192 = (second: number, third: number) => a === 192 && b === second && c === third
  return !(
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0 && d !== 9 && d !== 10) ||
    in192(0, 2) || in192(88, 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  )
}

function isPublicIpv6(value: string): boolean {
  if (isIP(value) !== 6) return false
  const words = expandIpv6(value)
  if (!words) return false
  const globalUnicast = words[0] >= 0x2000 && words[0] <= 0x3fff
  const documentation = (words[0] === 0x2001 && words[1] === 0x0db8) ||
    (words[0] === 0x3fff && (words[1] & 0xfff0) === 0)
  const benchmark = words[0] === 0x2001 && words[1] === 0x0002
  const orchid = words[0] === 0x2001 && words[1] === 0x0010
  return globalUnicast && !documentation && !benchmark && !orchid && words[0] !== 0x2002
}

function canonicalIpv6(value: string): string {
  const words = expandIpv6(value)
  return words ? words.map((word) => word.toString(16).padStart(4, '0')).join(':') : value.toLowerCase()
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
