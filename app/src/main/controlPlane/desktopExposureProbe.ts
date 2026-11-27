import { lookup } from 'node:dns/promises'
import { request, type ClientRequest } from 'node:http'
import { isIP } from 'node:net'
import type { ProductExposureObservationInput } from '../../../../docs/contracts/product-exposure'

export type ExposureProbeResult = Pick<
  ProductExposureObservationInput,
  'started_at' | 'checked_at' | 'outcome' | 'http_status' | 'reason'
>
type Address = { address: string; family: number }
export type ExposureProbeOptions = {
  signal?: AbortSignal
  timeoutMs?: number
  /** Main/lab dependency only; never passed through IPC. Socket still uses public IP. */
  resolve?: (host: string) => Promise<Address[]>
}

/** Conservative public-unicast policy. Never sends credentials or follows a redirect. */
export function isPublicExposureAddress(value: string): boolean {
  const family = isIP(value)
  if (family === 4) {
    const [a, b, c] = value.split('.').map(Number)
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    )
  }
  if (family !== 6 || value.includes('%')) return false
  const normalized = new URL(`http://[${value}]/`).hostname.slice(1, -1)
  const words = normalized
    .split('::')[0]
    .split(':')
    .map((part) => parseInt(part, 16))
  const first = words[0],
    second = words[1] ?? 0
  return (
    first >= 0x2000 &&
    first <= 0x3fff &&
    !(first === 0x2001 && (second <= 0x01ff || second === 0x0db8)) &&
    first !== 0x2002 &&
    !(first === 0x3fff && second < 0x1000)
  )
}

/** Explicit independent probe from Desktop. Target is authenticated controller context only. */
export async function probeDesktopExposure(
  url: string,
  options: ExposureProbeOptions = {}
): Promise<ExposureProbeResult> {
  const started_at = new Date().toISOString()
  const result = (
    outcome: ExposureProbeResult['outcome'],
    reason: ExposureProbeResult['reason'],
    http_status: number | null = null
  ): ExposureProbeResult => ({
    started_at,
    checked_at: new Date().toISOString(),
    outcome,
    reason,
    http_status
  })
  if (options.signal?.aborted) return result('not_run', 'aborted')
  const timeout = options.timeoutMs ?? 8000
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 10_000)
    return result('not_run', 'unsafe_target')
  let target: URL
  try {
    target = new URL(url)
    if (
      target.protocol !== 'http:' ||
      target.username ||
      target.password ||
      target.hash ||
      target.search ||
      target.pathname !== '/' ||
      Number(target.port) < 30000 ||
      Number(target.port) > 30999
    )
      return result('not_run', 'unsafe_target')
  } catch {
    return result('not_run', 'unsafe_target')
  }
  const hostname = target.hostname.replace(/^\[|\]$/g, '')
  let outgoing: ClientRequest | undefined,
    stopped = false,
    settle!: (value: ExposureProbeResult) => void
  const done = new Promise<ExposureProbeResult>((resolve) => {
    settle = resolve
  })
  const finish = (value: ExposureProbeResult): void => {
    if (stopped) return
    stopped = true
    outgoing?.destroy()
    settle(value)
  }
  const abort = (): void => finish(result('not_run', 'aborted'))
  const timer = setTimeout(() => finish(result('unreachable', 'timeout')), timeout)
  options.signal?.addEventListener('abort', abort, { once: true })
  if (options.signal?.aborted) abort()
  try {
    const addresses = await Promise.race([
      isIP(hostname)
        ? Promise.resolve([{ address: hostname, family: isIP(hostname) }])
        : (options.resolve ?? ((host) => lookup(host, { all: true, verbatim: true })))(hostname),
      done
    ])
    if (!stopped && Array.isArray(addresses)) {
      if (
        !addresses.length ||
        addresses.length > 16 ||
        addresses.some(
          (entry) => !isPublicExposureAddress(entry.address) || isIP(entry.address) !== entry.family
        )
      ) {
        finish(result('not_run', 'unsafe_target'))
      } else {
        // Connect to the validated numeric address. No second DNS lookup/rebinding.
        outgoing = request(
          {
            hostname: addresses[0].address,
            family: addresses[0].family,
            port: Number(target.port),
            method: 'GET',
            path: '/',
            agent: false,
            maxHeaderSize: 8192,
            headers: {
              host: target.host,
              accept: 'text/html',
              connection: 'close',
              'user-agent': 'OpsPilot-Exposure/1'
            }
          },
          (response) => {
            const status = response.statusCode ?? 0
            if (status >= 200 && status < 300) finish(result('reachable', 'none', status))
            else if (status >= 300 && status < 400)
              finish(result('unreachable', 'redirect', status))
            else if (status >= 400 && status <= 599)
              finish(result('unreachable', 'http_error', status))
            else finish(result('unreachable', 'connection_error'))
            response.destroy() // Do not collect HTML/error body, cookie, Location or server diagnostics.
          }
        )
        outgoing.once('error', () => finish(result('unreachable', 'connection_error')))
        outgoing.once('upgrade', (_response, socket) => {
          socket.destroy()
          finish(result('unreachable', 'connection_error'))
        })
        outgoing.end()
      }
    }
  } catch {
    finish(result('unreachable', 'connection_error'))
  }
  try {
    return await done
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', abort)
    outgoing?.destroy()
  }
}
