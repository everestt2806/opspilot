import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

const ssh2Harness = vi.hoisted(() => ({
  hostKey: [83, 83, 72, 32, 116, 101, 115, 116, 32, 104, 111, 115, 116, 32, 107, 101, 121],
  authenticationAttempts: 0,
  commandAttempts: 0,
  endCalls: 0,
  connectBehavior: 'ready' as 'ready' | 'close' | 'hang',
  execBehavior: 'error' as 'error' | 'no-callback' | 'channel',
  clients: [] as Array<{ listenerCount: (event: string) => number }>,
  channels: [] as Array<{ destroyed: boolean; listenerCount: (event: string) => number }>,
  lateExecCallback: null as ((error: Error | null, channel?: unknown) => void) | null
}))

vi.mock('ssh2', async () => {
  const { EventEmitter } = await import('node:events')

  class FakeChannel extends EventEmitter {
    stderr = new EventEmitter()
    destroyed = false
    destroy(): this {
      this.destroyed = true
      return this
    }
  }

  class FakeClient extends EventEmitter {
    constructor() {
      super()
      ssh2Harness.clients.push(this)
    }

    connect(options: { hostVerifier: (key: Buffer) => boolean }): void {
      if (!options.hostVerifier(Buffer.from(ssh2Harness.hostKey))) {
        this.emit('error', new Error('Host key rejected'))
        return
      }
      ssh2Harness.authenticationAttempts += 1
      if (ssh2Harness.connectBehavior === 'ready') this.emit('ready')
      if (ssh2Harness.connectBehavior === 'close') this.emit('close')
    }

    exec(_command: string, callback: (error: Error | null, channel?: FakeChannel) => void): void {
      ssh2Harness.commandAttempts += 1
      if (ssh2Harness.execBehavior === 'no-callback') {
        ssh2Harness.lateExecCallback = callback as (error: Error | null, channel?: unknown) => void
        return
      }
      if (ssh2Harness.execBehavior === 'channel') {
        const channel = new FakeChannel()
        ssh2Harness.channels.push(channel)
        callback(null, channel)
        return
      }
      callback(new Error('Unexpected command execution'))
    }

    end(): void {
      ssh2Harness.endCalls += 1
      this.emit('close')
    }
  }

  return { Client: FakeClient, FakeChannel }
})

import { matchesSshHostFingerprint, SshManager } from './manager'

const receivedHostKey = Buffer.from(ssh2Harness.hostKey)
const otherReceivedHostKey = Buffer.from('different synthetic host public key bytes')

function fingerprintFor(key: Buffer): string {
  const digest = createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
  return `SHA256:${digest}`
}

const verifiedFingerprint = fingerprintFor(receivedHostKey)
type RunCommand = (
  entry: object,
  command: string,
  options?: { logCommand?: boolean }
) => Promise<{ code: number; stdout: string; stderr: string }>

describe('SSH host fingerprint verification', () => {
  const resetHarness = (): void => {
    ssh2Harness.authenticationAttempts = 0
    ssh2Harness.commandAttempts = 0
    ssh2Harness.endCalls = 0
    ssh2Harness.connectBehavior = 'ready'
    ssh2Harness.execBehavior = 'error'
    ssh2Harness.clients = []
    ssh2Harness.channels = []
    ssh2Harness.lateExecCallback = null
  }

  it('accepts only the expected OpenSSH SHA256 fingerprint from the received key digest', () => {
    expect(matchesSshHostFingerprint(receivedHostKey, verifiedFingerprint)).toBe(true)
    expect(matchesSshHostFingerprint(otherReceivedHostKey, verifiedFingerprint)).toBe(false)
  })

  it('authenticates after ssh2 verifies the matching host key', async () => {
    resetHarness()
    const manager = new SshManager(async () => ({
      host: 'vps.example.invalid',
      port: 22,
      hostFingerprint: verifiedFingerprint,
      username: 'test-user',
      authType: 'key',
      secret: 'test-only-key-placeholder'
    }))

    await expect(manager.connect(1)).resolves.toBeUndefined()
    expect(ssh2Harness.authenticationAttempts).toBe(1)
    expect(ssh2Harness.commandAttempts).toBe(0)
    await manager.disconnect(1)
  })

  it('settles and closes the client if the connection closes before ready', async () => {
    resetHarness()
    ssh2Harness.connectBehavior = 'close'
    vi.useFakeTimers()
    const manager = new SshManager(async () => ({
      host: 'vps.example.invalid',
      port: 22,
      hostFingerprint: verifiedFingerprint,
      username: 'test-user',
      authType: 'key',
      secret: 'test-only-key-placeholder'
    }))

    const pending = manager.connect(1)
    const rejection = expect(pending).rejects.toMatchObject({ code: 'SSH_HOST_UNREACHABLE' })
    await vi.runAllTimersAsync()
    await rejection
    expect(ssh2Harness.clients).toHaveLength(4)
    expect(ssh2Harness.endCalls).toBe(4)
    vi.useRealTimers()
  })

  it('closes stalled handshake clients after the connection deadline', async () => {
    resetHarness()
    ssh2Harness.connectBehavior = 'hang'
    vi.useFakeTimers()
    const manager = new SshManager(async () => ({
      host: 'vps.example.invalid',
      port: 22,
      hostFingerprint: verifiedFingerprint,
      username: 'test-user',
      authType: 'key',
      secret: 'test-only-key-placeholder'
    }))

    const pending = manager.connect(1)
    const rejection = expect(pending).rejects.toMatchObject({ code: 'SSH_TIMEOUT' })
    await vi.runAllTimersAsync()
    await rejection
    expect(ssh2Harness.clients).toHaveLength(4)
    expect(ssh2Harness.endCalls).toBe(4)
    vi.useRealTimers()
  })

  it('times out when exec never calls back and destroys a late channel', async () => {
    resetHarness()
    ssh2Harness.execBehavior = 'no-callback'
    vi.useFakeTimers()
    const manager = new SshManager(async () => ({
      host: 'vps.example.invalid',
      port: 22,
      hostFingerprint: verifiedFingerprint,
      username: 'test-user',
      authType: 'key',
      secret: 'test-only-key-placeholder'
    }))
    await manager.connect(1)

    const pending = manager.exec(1, 'printf read-only', { timeoutMs: 100 })
    const rejection = expect(pending).rejects.toMatchObject({ code: 'SSH_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(100)
    await rejection
    const lateChannel = { destroyed: false, destroy() { this.destroyed = true } }
    ssh2Harness.lateExecCallback?.(null, lateChannel as never)
    expect(lateChannel.destroyed).toBe(true)
    expect(ssh2Harness.clients[0]?.listenerCount('close')).toBe(1)
    await manager.disconnectAll()
    vi.useRealTimers()
  })

  it('settles on command timeout even when destroying the channel emits no close', async () => {
    resetHarness()
    ssh2Harness.execBehavior = 'channel'
    vi.useFakeTimers()
    const manager = new SshManager(async () => ({
      host: 'vps.example.invalid',
      port: 22,
      hostFingerprint: verifiedFingerprint,
      username: 'test-user',
      authType: 'key',
      secret: 'test-only-key-placeholder'
    }))
    await manager.connect(1)

    const pending = manager.exec(1, 'printf read-only', { timeoutMs: 100 })
    const rejection = expect(pending).rejects.toMatchObject({ code: 'SSH_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(100)
    await rejection
    expect(ssh2Harness.channels[0]?.destroyed).toBe(true)
    expect(ssh2Harness.channels[0]?.listenerCount('close')).toBe(0)
    await manager.disconnectAll()
    vi.useRealTimers()
  })

  it('rejects a remote file write with a nonzero exit before attempting chmod', async () => {
    const manager = new SshManager(async () => ({
      host: 'vps.example.invalid',
      port: 22,
      hostFingerprint: verifiedFingerprint,
      username: 'test-user',
      authType: 'key',
      secret: 'test-only-key-placeholder'
    }))
    await manager.connect(1)
    const runCommand = vi
      .spyOn(manager as unknown as { runCommand: RunCommand }, 'runCommand')
      .mockResolvedValue({
        code: 1,
        stdout: '',
        stderr: 'sensitive remote detail'
      })

    await expect(
      manager.writeFile(1, '/tmp/manifest.tmp', '{"ok":true}', { mode: 0o600 })
    ).rejects.toMatchObject({ userMessage: 'Không thể ghi file từ xa qua SSH.' })
    expect(runCommand).toHaveBeenCalledOnce()
    expect(runCommand.mock.calls[0]?.[2]).toMatchObject({ logCommand: true })
    await manager.disconnect(1)
  })

  it('rejects a nonzero chmod result without exposing remote stderr', async () => {
    const manager = new SshManager(async () => ({
      host: 'vps.example.invalid',
      port: 22,
      hostFingerprint: verifiedFingerprint,
      username: 'test-user',
      authType: 'key',
      secret: 'test-only-key-placeholder'
    }))
    await manager.connect(1)
    const runCommand = vi
      .spyOn(manager as unknown as { runCommand: RunCommand }, 'runCommand')
      .mockResolvedValueOnce({ code: 0, stdout: '', stderr: '' })
      .mockResolvedValueOnce({
        code: 1,
        stdout: '',
        stderr: 'sensitive remote detail'
      })

    await expect(
      manager.writeFile(1, '/tmp/manifest.tmp', '{"ok":true}', { mode: 0o600 })
    ).rejects.toMatchObject({ userMessage: 'Không thể áp dụng quyền riêng tư cho file từ xa.' })
    expect(runCommand).toHaveBeenCalledTimes(2)
    await manager.disconnect(1)
  })

  it('rejects a wrong host key before authentication or command execution', async () => {
    ssh2Harness.authenticationAttempts = 0
    ssh2Harness.commandAttempts = 0
    const manager = new SshManager(async () => ({
      host: 'vps.example.invalid',
      port: 22,
      hostFingerprint: fingerprintFor(otherReceivedHostKey),
      username: 'test-user',
      authType: 'key',
      secret: 'test-only-key-placeholder'
    }))

    await expect(manager.exec(1, 'printf test')).rejects.toMatchObject({
      userMessage: expect.stringContaining('Fingerprint SSH không khớp')
    })
    expect(ssh2Harness.authenticationAttempts).toBe(0)
    expect(ssh2Harness.commandAttempts).toBe(0)
  })

  it('blocks a legacy VPS with no fingerprint before opening SSH', async () => {
    const resolver = vi.fn(async () => ({
      host: 'vps.example.invalid',
      port: 22,
      hostFingerprint: null,
      username: 'test-user',
      authType: 'password' as const,
      secret: ''
    }))
    const manager = new SshManager(resolver)

    await expect(manager.connect(1)).rejects.toMatchObject({
      userMessage: expect.stringContaining('Thiếu fingerprint SSH')
    })
    expect(resolver).toHaveBeenCalledOnce()
  })

  it('rejects a missing or malformed expected fingerprint', async () => {
    const manager = new SshManager(async () => ({
      host: 'vps.example.invalid',
      port: 22,
      hostFingerprint: 'invalid',
      username: 'test-user',
      authType: 'password',
      secret: ''
    }))

    await expect(manager.connect(1)).rejects.toMatchObject({
      userMessage: expect.stringContaining('Thiếu fingerprint SSH')
    })
  })
})
