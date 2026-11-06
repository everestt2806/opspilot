import { createHash } from 'node:crypto'
import { PassThrough } from 'node:stream'
import type { ClientChannel, ConnectConfig } from 'ssh2'
import { PRODUCT_CONTROLLER_SSH_CHANNEL } from '../../../../docs/contracts/product-controller-api'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { clients } = vi.hoisted(() => ({
  clients: [] as Array<{
    emit: (event: string, ...args: unknown[]) => void
    config: ConnectConfig
    forwardOut: ReturnType<typeof vi.fn>
    exec: ReturnType<typeof vi.fn>
    end: ReturnType<typeof vi.fn>
    listenerCount: (event: string) => number
  }>
}))
vi.mock('ssh2', async () => {
  const { EventEmitter } = await import('node:events')
  class MockClient extends EventEmitter {
    config!: ConnectConfig
    forwardOut = vi.fn()
    exec = vi.fn()
    end = vi.fn()
    constructor() {
      super()
      clients.push(this)
    }
    connect(config: ConnectConfig): void {
      this.config = config
    }
  }
  return { Client: MockClient }
})
import { SshManager, type SshConnectionInfo, type SshVerifiedConnectionIdentity } from './manager'

const hostBlob = Buffer.from('unit-public-host-key-blob')
const expected: SshVerifiedConnectionIdentity = {
  vpsId: 7,
  host: 'controller.test',
  port: 22,
  hostFingerprint:
    'SHA256:' + createHash('sha256').update(hostBlob).digest('base64').replace(/=+$/, ''),
  username: 'operator',
  authType: 'key'
}
let manager: SshManager, info: SshConnectionInfo
beforeEach(() => {
  clients.length = 0
  info = { ...expected, secret: 'unit-placeholder' }
  manager = new SshManager(() => ({ ...info }))
})
afterEach(async () => {
  await manager.disconnectAll()
})
const stream = (): ClientChannel => new PassThrough() as unknown as ClientChannel
async function connect(): Promise<(typeof clients)[number]> {
  const task = manager.connect(7)
  await vi.waitFor(() => expect(clients).toHaveLength(1), { interval: 5 })
  const client = clients[0]
  const verifier = client.config.hostVerifier as (key: Buffer) => boolean
  expect(verifier(hostBlob)).toBe(true)
  client.emit('ready')
  await task
  return client
}
describe('Pinned controller API SSH channel', () => {
  it('only forwards the fixed loopback API and returns the actual pinned principal without exec', async () => {
    const client = await connect(),
      channel = stream()
    client.forwardOut.mockImplementation((_src, _port, _dest, _api, callback) =>
      callback(null, channel)
    )
    const opened = await manager.openControllerApiChannel(expected)
    expect(opened.identity).toEqual(expected)
    expect(opened.channel).toBe(channel)
    expect(client.forwardOut.mock.calls[0].slice(0, 4)).toEqual([
      '127.0.0.1',
      0,
      PRODUCT_CONTROLLER_SSH_CHANNEL.destination_host,
      PRODUCT_CONTROLLER_SSH_CHANNEL.destination_port
    ])
    expect(client.exec).not.toHaveBeenCalled()
    channel.destroy()
  })
  it('rejects expected endpoint/user/auth changes before creating an SSH client', async () => {
    for (const changed of [
      { host: 'foreign.test' },
      { port: 2222 },
      { username: 'other' },
      { authType: 'password' as const },
      { hostFingerprint: `SHA256:${'A'.repeat(43)}` }
    ])
      await expect(
        manager.openControllerApiChannel({ ...expected, ...changed })
      ).rejects.toMatchObject({ name: 'SshHostIdentityChangedError', commandDispatched: false })
    expect(clients).toHaveLength(0)
  })
  it('never uses an old pooled principal after the resolver changes user', async () => {
    const old = await connect()
    info.username = 'replacement'
    const task = manager.openControllerApiChannel({ ...expected, username: 'replacement' })
    await vi.waitFor(() => expect(clients).toHaveLength(2), { interval: 5 })
    const next = clients[1],
      channel = stream()
    expect((next.config.hostVerifier as (key: Buffer) => boolean)(hostBlob)).toBe(true)
    next.forwardOut.mockImplementation((_s, _p, _d, _a, callback) => callback(null, channel))
    next.emit('ready')
    expect((await task).identity.username).toBe('replacement')
    expect(old.forwardOut).not.toHaveBeenCalled()
    expect(old.end).toHaveBeenCalled()
    channel.destroy()
  })
  it('rejects absent handshake verification even if ready is emitted', async () => {
    const task = manager.openControllerApiChannel(expected)
    await vi.waitFor(() => expect(clients).toHaveLength(1), { interval: 5 })
    clients[0].emit('ready')
    await expect(task).rejects.toMatchObject({ name: 'SshHostIdentityChangedError' })
    expect(clients[0].forwardOut).not.toHaveBeenCalled()
  })
  it('does not replay forwardOut after a server rejection or disclose raw errors', async () => {
    const client = await connect()
    client.forwardOut.mockImplementation((_s, _p, _d, _a, callback) =>
      callback(new Error('unit-only-sensitive-error'))
    )
    const task = manager.openControllerApiChannel(expected)
    await expect(task).rejects.toMatchObject({ code: 'SSH_HOST_UNREACHABLE' })
    await expect(task).rejects.not.toThrow('unit-only-sensitive-error')
    expect(client.forwardOut).toHaveBeenCalledOnce()
    expect(clients).toHaveLength(1)
  })
  it('aborts an opening channel and destroys its late response without forwarding twice', async () => {
    const client = await connect(),
      stop = new AbortController(),
      channel = stream()
    const task = manager.openControllerApiChannel(expected, { signal: stop.signal })
    await vi.waitFor(() => expect(client.forwardOut).toHaveBeenCalledOnce(), { interval: 5 })
    stop.abort()
    await expect(task).rejects.toMatchObject({ name: 'SshAbortedError' })
    client.forwardOut.mock.calls[0][4](null, channel)
    expect(channel.destroyed).toBe(true)
    expect(client.listenerCount?.('close') ?? 0).toBeLessThanOrEqual(1)
  })
  it('bounds the entire open including a stalled resolver and never forwards on its late result', async () => {
    let release!: (value: SshConnectionInfo) => void
    manager = new SshManager(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    const task = manager.openControllerApiChannel(expected, { timeoutMs: 20 })
    await expect(task).rejects.toMatchObject({ code: 'SSH_TIMEOUT' })
    release(info)
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(clients).toHaveLength(0)
  })
  it('rejects SSH disconnect during open and closes a late channel without retry', async () => {
    const client = await connect(),
      channel = stream()
    const task = manager.openControllerApiChannel(expected)
    await vi.waitFor(() => expect(client.forwardOut).toHaveBeenCalledOnce(), { interval: 5 })
    client.emit('close')
    await expect(task).rejects.toMatchObject({ code: 'SSH_HOST_UNREACHABLE' })
    client.forwardOut.mock.calls[0][4](null, channel)
    expect(channel.destroyed).toBe(true)
    expect(client.forwardOut).toHaveBeenCalledOnce()
    expect(clients).toHaveLength(1)
  })
  it('destroys an opened stream when current resolver changes during channel open', async () => {
    const client = await connect(),
      channel = stream()
    const task = manager.openControllerApiChannel(expected)
    await vi.waitFor(() => expect(client.forwardOut).toHaveBeenCalledOnce(), { interval: 5 })
    info.host = 'changed.test'
    client.forwardOut.mock.calls[0][4](null, channel)
    await expect(task).rejects.toMatchObject({ name: 'SshHostIdentityChangedError' })
    expect(channel.destroyed).toBe(true)
  })
  it('destroys a stream if timeout happens during post-open resolver verification', async () => {
    const client = await connect(),
      channel = stream()
    let calls = 0,
      release!: (value: SshConnectionInfo) => void
    await manager.disconnectAll()
    manager = new SshManager(() =>
      ++calls === 1
        ? info
        : new Promise((resolve) => {
            release = resolve
          })
    )
    const task = manager.openControllerApiChannel(expected, { timeoutMs: 100 })
    await vi.waitFor(() => expect(clients).toHaveLength(2), { interval: 5 })
    const next = clients[1]
    expect((next.config.hostVerifier as (key: Buffer) => boolean)(hostBlob)).toBe(true)
    next.forwardOut.mockImplementation((_s, _p, _d, _a, callback) => callback(null, channel))
    next.emit('ready')
    await expect(task).rejects.toMatchObject({ code: 'SSH_TIMEOUT' })
    expect(channel.destroyed).toBe(true)
    release(info)
    expect(client.forwardOut).not.toHaveBeenCalled()
  })
  it('rejects pre-aborted and invalid deadlines before creating SSH connections', async () => {
    const stop = new AbortController()
    stop.abort()
    await expect(
      manager.openControllerApiChannel(expected, { signal: stop.signal })
    ).rejects.toMatchObject({ name: 'SshAbortedError' })
    for (const timeoutMs of [0, -1, 30001, Number.NaN])
      await expect(manager.openControllerApiChannel(expected, { timeoutMs })).rejects.toMatchObject(
        { code: 'VALIDATION' }
      )
    expect(clients).toHaveLength(0)
  })
  it('rejects a closed stream during post-open verification even when destroyed is false', async () => {
    let calls = 0,
      release!: (value: SshConnectionInfo) => void
    manager = new SshManager(() =>
      ++calls === 1
        ? info
        : new Promise((resolve) => {
            release = resolve
          })
    )
    const task = manager.openControllerApiChannel(expected)
    await vi.waitFor(() => expect(clients).toHaveLength(1), { interval: 5 })
    const client = clients[0],
      channel = stream()
    expect((client.config.hostVerifier as (key: Buffer) => boolean)(hostBlob)).toBe(true)
    client.forwardOut.mockImplementation((_s, _p, _d, _a, callback) => callback(null, channel))
    client.emit('ready')
    await vi.waitFor(() => expect(release).toBeTypeOf('function'), { interval: 5 })
    // ssh2 destroy() closes SSH protocol; it does not set Node's destroyed property.
    channel.emit('close')
    expect(channel.destroyed).toBe(false)
    release(info)
    await expect(task).rejects.toMatchObject({ name: 'SshHostIdentityChangedError' })
    expect(channel.destroyed).toBe(true)
  })
})
