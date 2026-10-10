import { resolve4, resolve6, resolveCname } from 'node:dns/promises'
import { isIP } from 'node:net'

import type { DnsRecordType } from './dns'

export type DomainMode = 'direct_port' | 'shared_ingress' | 'named_tunnel'

export interface DomainPlan {
  hostname: string
  mode: DomainMode
  record_type: DnsRecordType
  record_name: string
  target: string
  direct_url: string
  public_url: string
  instructions: string[]
}

export function planDomain(input: {
  hostname: string
  target: string
  appPort: number
  mode: DomainMode
}): DomainPlan {
  const hostname = normalizeHostname(input.hostname)
  if (!isHostname(hostname)) throw new Error('Hostname không hợp lệ.')
  if (!Number.isInteger(input.appPort) || input.appPort < 1 || input.appPort > 65535) {
    throw new Error('Port ứng dụng không hợp lệ.')
  }

  const isV4 = isIpv4(input.target)
  const isV6 = isIpv6(input.target)

  if (input.mode === 'named_tunnel') {
    if (isV4 || isV6) {
      throw new Error(
        'Mode named_tunnel yêu cầu CNAME target của tunnel (ví dụ: <id>.cfargotunnel.com), không dùng IP của VPS.'
      )
    }
    if (!isHostname(input.target)) {
      throw new Error('Mode named_tunnel yêu cầu CNAME target là hostname hợp lệ.')
    }
  }

  const recordType: DnsRecordType =
    input.mode === 'named_tunnel' ? 'CNAME' : isV4 ? 'A' : isV6 ? 'AAAA' : 'CNAME'
  if (recordType === 'CNAME' && !isHostname(input.target)) {
    throw new Error('Target phải là IPv4 hoặc hostname hợp lệ.')
  }
  if (recordType === 'AAAA' && !isV6) throw new Error('IPv6 target không hợp lệ.')
  const directTarget = isV6 ? `[${input.target}]` : input.target
  const publicUrl =
    input.mode === 'direct_port' ? `http://${hostname}:${input.appPort}` : `https://${hostname}`
  return {
    hostname,
    mode: input.mode,
    record_type: recordType,
    record_name: hostname,
    target: input.target,
    direct_url: `http://${directTarget}:${input.appPort}`,
    public_url: publicUrl,
    instructions:
      input.mode === 'direct_port'
        ? [
            `Tạo record ${recordType} ${hostname} → ${input.target}.`,
            `Mở TCP ${input.appPort} trên firewall.`
          ]
        : input.mode === 'named_tunnel'
          ? [
              `Tạo record ${recordType} ${hostname} → ${input.target}.`,
              'Cần Cloudflare Tunnel hoặc named tunnel kết nối tới app port nội bộ.',
              'Chỉ active domain sau khi HTTPS probe thành công.'
            ]
          : [
              `Tạo record ${recordType} ${hostname} → ${input.target}.`,
              'Cần ingress/tunnel lắng nghe 80/443 và route hostname vào app.',
              'Chỉ active domain sau khi HTTPS probe thành công.'
            ]
  }
}

export type DomainTargetResolver = (
  hostname: string,
  recordType: DnsRecordType
) => Promise<string[]>

export async function checkDomainTarget(
  hostname: string,
  expectedTarget: string,
  recordType: DnsRecordType = isIpv4(expectedTarget)
    ? 'A'
    : isIpv6(expectedTarget)
      ? 'AAAA'
      : 'CNAME',
  resolver?: DomainTargetResolver
): Promise<{ status: 'propagated' | 'wrong_target' | 'nxdomain' | 'error'; observed: string[] }> {
  try {
    const resolve =
      resolver ??
      (async (name: string, type: DnsRecordType) => {
        if (type === 'A') return resolve4(name)
        if (type === 'AAAA') return resolve6(name)
        return resolveCname(name)
      })
    const observed = await resolve(hostname, recordType)
    if (!observed || observed.length === 0) {
      return { status: 'nxdomain', observed: [] }
    }
    const expected = normalizeHostname(expectedTarget)
    const allMatch =
      observed.length > 0 && observed.every((value) => normalizeHostname(value) === expected)
    return {
      status: allMatch ? 'propagated' : 'wrong_target',
      observed
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code
    if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'NODATA') {
      return { status: 'nxdomain', observed: [] }
    }
    return { status: 'error', observed: [] }
  }
}

function normalizeHostname(value: string): string {
  return value.trim().replace(/\.$/, '').toLowerCase()
}

function isHostname(value: string): boolean {
  return /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value)
}

function isIpv4(value: string): boolean {
  return isIP(value) === 4
}

function isIpv6(value: string): boolean {
  return isIP(value) === 6
}
