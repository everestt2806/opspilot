import https, { type RequestOptions } from 'node:https'
import { isIP } from 'node:net'
import type { TLSSocket } from 'node:tls'

export const HTTPS_PROBE_TIMEOUT_MS = 6_000
export const HTTPS_PROBE_MAX_ADDRESSES = 8
export const HTTPS_PROBE_MAX_RESPONSE_BYTES = 16 * 1024

export type ExternalHttpsProbeFailure =
  | 'invalid_input'
  | 'dns_not_propagated'
  | 'certificate_hostname_invalid'
  | 'certificate_expired'
  | 'certificate_untrusted'
  | 'peer_ip_mismatch'
  | 'timeout'
  | 'redirect_rejected'
  | 'health_response_invalid'
  | 'response_too_large'
  | 'peer_set_too_large'
  | 'connection_failed'

export type ExternalHttpsProbeResult =
  | {
      status: 'passed'
      hostname: string
      peer_ip: string
      peer_ips: readonly string[]
      http_status: number
      trust: 'system' | 'lab'
    }
  | { status: 'failed'; reason: ExternalHttpsProbeFailure }

export interface ExternalHttpsProbeInput {
  hostname: string
  healthcheckPath: string
  healthcheckResponseType?: 'status_2xx' | 'json'
  dnsStatus: 'propagated' | 'pending' | 'conflict' | 'failed' | 'disabled'
  expectedPeerIps: readonly string[]
}

interface ProbeOptions {
  ca?: string | Buffer
  port?: number
}

/** Uses hostname/SNI while pinning the socket to a DNS-verified VPS address. TLS verification stays enabled. */
export function probeExternalHttps(
  input: ExternalHttpsProbeInput
): Promise<ExternalHttpsProbeResult> {
  return runProbe(input, {})
}

/** Test helper for local TLS servers; it still uses system-default trust. */
export function probeExternalHttpsWithSystemTrustForTest(
  input: ExternalHttpsProbeInput,
  port: number
): Promise<ExternalHttpsProbeResult> {
  return runProbe(input, { port })
}

/** Test-only trust injection; the result is tagged lab and cannot be used for production activation. */
export function probeExternalHttpsWithLabTrust(
  input: ExternalHttpsProbeInput,
  ca: string | Buffer,
  port = 443
): Promise<ExternalHttpsProbeResult> {
  return runProbe(input, { ca, port })
}

function runProbe(
  input: ExternalHttpsProbeInput,
  options: ProbeOptions
): Promise<ExternalHttpsProbeResult> {
  const hostname = input.hostname.toLowerCase().replace(/\.$/, '')
  if (
    input.dnsStatus !== 'propagated' ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname) ||
    !/^\/[A-Za-z0-9/._~?=&%-]{0,255}$/.test(input.healthcheckPath) ||
    input.healthcheckPath.includes('//') ||
    input.expectedPeerIps.length === 0 ||
    input.expectedPeerIps.some((address) => isIP(address) === 0)
  )
    return Promise.resolve({
      status: 'failed',
      reason: input.dnsStatus === 'propagated' ? 'invalid_input' : 'dns_not_propagated'
    })

  const peers = [...new Set(input.expectedPeerIps.map(normalizeIp))]
  if (peers.length > HTTPS_PROBE_MAX_ADDRESSES) {
    return Promise.resolve({ status: 'failed', reason: 'peer_set_too_large' })
  }
  return Promise.all(
    peers.map((peerIp) => requestOnce(hostname, input.healthcheckPath, peerIp, input.healthcheckResponseType ?? 'status_2xx', options))
  ).then((results) => {
    const failure = results.find((result) => result.status === 'failed')
    if (failure?.status === 'failed') return failure
    const verified = results as PeerProbeSuccess[]
    return {
      status: 'passed',
      hostname,
      peer_ip: verified[0].peer_ip,
      peer_ips: verified.map((result) => result.peer_ip),
      http_status: verified[0].http_status,
      trust: options.ca ? 'lab' : 'system'
    }
  })
}

interface PeerProbeSuccess {
  status: 'passed'
  peer_ip: string
  http_status: number
}

function requestOnce(
  hostname: string,
  path: string,
  expectedPeerIp: string,
  healthcheckResponseType: 'status_2xx' | 'json',
  options: ProbeOptions
): Promise<PeerProbeSuccess | { status: 'failed'; reason: ExternalHttpsProbeFailure }> {
  return new Promise((resolve) => {
    let settled = false
    let responseBytes = 0
    let body = ''
    let response: import('node:http').IncomingMessage | null = null
    let request: import('node:http').ClientRequest | null = null
    const finish = (result: PeerProbeSuccess | { status: 'failed'; reason: ExternalHttpsProbeFailure }): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const failAndDestroy = (reason: ExternalHttpsProbeFailure): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolve({ status: 'failed', reason })
      response?.destroy()
      request?.destroy()
    }
    const timer = setTimeout(() => {
      request?.destroy(new Error('HTTPS_PROBE_TIMEOUT'))
      finish({ status: 'failed', reason: 'timeout' })
    }, HTTPS_PROBE_TIMEOUT_MS)
    const family = isIP(expectedPeerIp) as 4 | 6
    const requestOptions: RequestOptions = {
      protocol: 'https:',
      hostname,
      port: options.port ?? 443,
      path,
      method: 'GET',
      servername: hostname,
      rejectUnauthorized: true,
      ...(options.ca ? { ca: options.ca } : {}),
      headers: { accept: 'application/json, text/plain;q=0.9', connection: 'close' },
      lookup: (_lookupHostname, optionsOrCallback, possibleCallback) => {
        const lookupOptions = typeof optionsOrCallback === 'object' ? optionsOrCallback : undefined
        const callback = (
          typeof optionsOrCallback === 'function' ? optionsOrCallback : possibleCallback
        ) as NonNullable<typeof possibleCallback>
        if (!callback) throw new Error('HTTPS_PROBE_LOOKUP_CALLBACK_MISSING')
        if (lookupOptions?.all) callback(null, [{ address: expectedPeerIp, family }])
        else callback(null, expectedPeerIp, family)
      }
    }
    request = https.request(requestOptions, (incomingResponse) => {
      response = incomingResponse
      const status = incomingResponse.statusCode ?? 0
      const socket = incomingResponse.socket as TLSSocket
      const peerIp = normalizeIp(socket.remoteAddress ?? '')
      if (!peerIp || !peersMatch(peerIp, expectedPeerIp)) {
        failAndDestroy('peer_ip_mismatch')
        return
      }
      if (status >= 300 && status < 400) {
        failAndDestroy('redirect_rejected')
        return
      }
      if (status < 200 || status >= 300) {
        failAndDestroy('health_response_invalid')
        return
      }
      incomingResponse.on('data', (chunk: Buffer | string) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        responseBytes += bytes.length
        if (responseBytes > HTTPS_PROBE_MAX_RESPONSE_BYTES) {
          failAndDestroy('response_too_large')
          return
        }
        body += bytes.toString('utf8')
      })
      incomingResponse.on('aborted', () => failAndDestroy('connection_failed'))
      incomingResponse.on('error', () => failAndDestroy('connection_failed'))
      incomingResponse.on('end', () => {
        if (!isHealthyBody(body, incomingResponse.headers['content-type'], healthcheckResponseType)) {
          finish({ status: 'failed', reason: 'health_response_invalid' })
          return
        }
        finish({
          status: 'passed',
          peer_ip: peerIp,
          http_status: status
        })
      })
    })
    request.on('error', (error: NodeJS.ErrnoException) =>
      finish({ status: 'failed', reason: classifyTlsError(error) })
    )
    request.setTimeout(HTTPS_PROBE_TIMEOUT_MS, () => {
      request.destroy(new Error('HTTPS_PROBE_TIMEOUT'))
      finish({ status: 'failed', reason: 'timeout' })
    })
    request.end()
  })
}

function isHealthyBody(
  body: string,
  contentType: string | string[] | undefined,
  healthcheckResponseType: 'status_2xx' | 'json'
): boolean {
  if (Buffer.byteLength(body) > HTTPS_PROBE_MAX_RESPONSE_BYTES) return false
  if (healthcheckResponseType === 'status_2xx') return true
  if (body.trim() === '') return false
  const type = Array.isArray(contentType) ? contentType.join(';') : (contentType ?? '')
  if (!type.toLowerCase().includes('application/json')) return false
  try {
    const parsed: unknown = JSON.parse(body)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
    const record = parsed as Record<string, unknown>
    return record.ok !== false && record.status !== 'error' && record.status !== 'unhealthy'
  } catch {
    return false
  }
}

function classifyTlsError(error: NodeJS.ErrnoException): ExternalHttpsProbeFailure {
  const code = `${error.code ?? ''} ${error.message}`
  if (/TIMEOUT/.test(code)) return 'timeout'
  if (/ERR_TLS_CERT_ALTNAME_INVALID/.test(code)) return 'certificate_hostname_invalid'
  if (/CERT_HAS_EXPIRED|ERR_CERT_DATE_INVALID/.test(code)) return 'certificate_expired'
  if (/SELF_SIGNED|UNABLE_TO_VERIFY|CERT_SIGNATURE|CERT_UNTRUSTED|DEPTH_ZERO/.test(code))
    return 'certificate_untrusted'
  return 'connection_failed'
}

function normalizeIp(address: string): string {
  const value = address.toLowerCase().split('%')[0]
  if (isIP(value) === 4)
    return value
      .split('.')
      .map((part) => String(Number(part)))
      .join('.')
  if (isIP(value) !== 6) return value
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return normalizeIp(mapped[1])
  const halves = value.split('::')
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves[1] ? halves[1].split(':') : []
  const expanded =
    halves.length === 2
      ? [...left, ...Array(8 - left.length - right.length).fill('0'), ...right]
      : left
  const words = expanded.map((part) => Number.parseInt(part || '0', 16))
  if (words.slice(0, 5).every((part) => part === 0) && words[5] === 0xffff) {
    return `${words[6] >> 8}.${words[6] & 255}.${words[7] >> 8}.${words[7] & 255}`
  }
  return words.map((part) => part.toString(16).padStart(4, '0')).join(':')
}

export function sameIpAddress(left: string, right: string): boolean {
  return normalizeIp(left) === normalizeIp(right)
}

const peersMatch = sameIpAddress
