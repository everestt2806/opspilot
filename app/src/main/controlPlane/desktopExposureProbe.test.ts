import { EventEmitter } from 'node:events'
import { beforeEach, expect, it, vi } from 'vitest'
const wire = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('node:http', () => ({ request: wire.request }))
import { isPublicExposureAddress, probeDesktopExposure } from './desktopExposureProbe'

let respond: (callback: (response: unknown) => void, outgoing: EventEmitter) => void
beforeEach(() => {
  wire.request.mockReset()
  respond = (callback) => callback({ statusCode: 200, destroy: vi.fn() })
  wire.request.mockImplementation((_options, callback) => {
    const outgoing = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() })
    outgoing.end.mockImplementation(() => queueMicrotask(() => respond(callback, outgoing)))
    return outgoing
  })
})
it.each([
  '127.0.0.1',
  '0.0.0.0',
  '10.1.2.3',
  '100.100.100.200',
  '169.254.169.254',
  '172.16.0.1',
  '192.168.1.1',
  '192.0.2.1',
  '198.18.0.1',
  '198.51.100.3',
  '203.0.113.1',
  '224.0.0.1',
  '255.255.255.255',
  '::1',
  '::ffff:127.0.0.1',
  'fe80::1',
  'fc00::1',
  '2001:db8::1',
  '2001::1',
  '2002::1',
  '3fff::1',
  '2001:4860::1%eth0'
])('rejects non-public or special address %s', (address) =>
  expect(isPublicExposureAddress(address)).toBe(false)
)
it('connects only to the validated numeric address, keeps Host and consumes no body', async () => {
  const resolve = vi.fn(async () => [{ address: '167.71.202.116', family: 4 }])
  expect(isPublicExposureAddress('2606:4700:4700::1111')).toBe(true)
  expect(isPublicExposureAddress('167.71.202.116')).toBe(true)
  expect(await probeDesktopExposure('http://deployed.example:30000', { resolve })).toMatchObject({
    outcome: 'reachable',
    http_status: 200,
    reason: 'none'
  })
  expect(resolve).toHaveBeenCalledOnce()
  expect(wire.request).toHaveBeenCalledWith(
    expect.objectContaining({
      hostname: '167.71.202.116',
      path: '/',
      agent: false,
      headers: expect.objectContaining({ host: 'deployed.example:30000' })
    }),
    expect.any(Function)
  )
  expect(wire.request.mock.calls[0][0]).not.toHaveProperty('auth')
})
it('rejects a mixed public/private DNS result without opening a socket', async () => {
  const resolve = async (): Promise<Array<{ address: string; family: number }>> => [
    { address: '167.71.202.116', family: 4 },
    { address: '127.0.0.1', family: 4 }
  ]
  expect(await probeDesktopExposure('http://deployed.example:30000', { resolve })).toMatchObject({
    outcome: 'not_run',
    reason: 'unsafe_target'
  })
  expect(wire.request).not.toHaveBeenCalled()
})
it.each([
  'http://127.0.0.1:30000',
  'http://2130706433:30000',
  'http://0x7f000001:30000',
  'http://[::ffff:127.0.0.1]:30000',
  'https://167.71.202.116:30000',
  'http://user:secret@167.71.202.116:30000',
  'http://167.71.202.116:22',
  'http://167.71.202.116:30000/path',
  'http://167.71.202.116:30000/?secret=value'
])('rejects unsafe context %s before network IO', async (url) => {
  expect(await probeDesktopExposure(url)).toMatchObject({
    outcome: 'not_run',
    reason: 'unsafe_target'
  })
  expect(wire.request).not.toHaveBeenCalled()
})
it.each([
  [302, 'redirect'],
  [503, 'http_error']
] as const)('classifies HTTP %s without redirect/body diagnostics', async (statusCode, reason) => {
  respond = (callback) =>
    callback({ statusCode, headers: { location: 'http://127.0.0.1/secret' }, destroy: vi.fn() })
  const result = await probeDesktopExposure('http://167.71.202.116:30000')
  expect(result).toMatchObject({ outcome: 'unreachable', http_status: statusCode, reason })
  expect(JSON.stringify(result)).not.toContain('secret')
  expect(wire.request).toHaveBeenCalledOnce()
})
it('bounds DNS and does not connect after abort even when resolution completes later', async () => {
  let resolved!: (value: Array<{ address: string; family: number }>) => void
  const signal = new AbortController()
  const checking = probeDesktopExposure('http://deployed.example:30000', {
    signal: signal.signal,
    resolve: () =>
      new Promise((done) => {
        resolved = done
      })
  })
  signal.abort()
  expect(await checking).toMatchObject({ outcome: 'not_run', reason: 'aborted' })
  resolved([{ address: '167.71.202.116', family: 4 }])
  await Promise.resolve()
  expect(wire.request).not.toHaveBeenCalled()
})
it('bounds response wait and cleans the socket after timeout', async () => {
  respond = () => {}
  expect(
    await probeDesktopExposure('http://167.71.202.116:30000', { timeoutMs: 20 })
  ).toMatchObject({ outcome: 'unreachable', reason: 'timeout' })
  expect(wire.request.mock.results[0].value.destroy).toHaveBeenCalled()
})
it('redacts DNS/socket exception text', async () => {
  const result = await probeDesktopExposure('http://deployed.example:30000', {
    resolve: async () => {
      throw Error('fake-secret')
    }
  })
  expect(result).toMatchObject({ outcome: 'unreachable', reason: 'connection_error' })
  expect(JSON.stringify(result)).not.toContain('fake-secret')
})
