import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import type { ClientChannel } from 'ssh2'
import { describe, expect, it, vi, type Mock } from 'vitest'
import type { SshManager, SshVerifiedConnectionIdentity } from '../ssh/manager'
import { evaluateControllerHost, probeControllerHost } from './controllerHostPreflight'

const facts = {
  format: 1,
  system: 'Linux',
  architecture: 'x86_64',
  libc: 'glibc',
  libc_version: '2.39',
  uid: 0,
  available_memory_bytes: 1024 ** 3,
  free_disk_bytes: 10 * 1024 ** 3,
  systemd_system: true,
  systemd_user_bus: false,
  user_linger: false,
  installation_conflict: false
}
const release = { platform: 'linux-x64-glibc', minimum_glibc: '2.39' } as const
const identity: SshVerifiedConnectionIdentity = {
  vpsId: 7,
  host: '127.0.0.1',
  port: 22,
  hostFingerprint: 'SHA256:SYNTHETIC',
  username: 'fixture',
  authType: 'key'
}

describe('Readonly controller host preflight', () => {
  it('accepts compatible root systemd snapshot, without implying install/runtime success', () => {
    expect(evaluateControllerHost(facts, release)).toMatchObject({
      state: 'compatible_snapshot',
      service_mode: 'system',
      reasons: []
    })
  })
  it('requires both user bus and linger for a non-root service', () => {
    expect(evaluateControllerHost({ ...facts, uid: 1000 }, release).reasons).toEqual(['SYSTEMD'])
    expect(
      evaluateControllerHost({ ...facts, uid: 1000, systemd_user_bus: true }, release).reasons
    ).toEqual(['SYSTEMD'])
    expect(
      evaluateControllerHost(
        { ...facts, uid: 1000, systemd_user_bus: true, user_linger: true },
        release
      )
    ).toMatchObject({ state: 'compatible_snapshot', service_mode: 'user' })
  })
  it.each([
    [{ architecture: 'aarch64' }, 'PLATFORM'],
    [{ system: 'Windows' }, 'PLATFORM'],
    [{ libc: 'musl' }, 'LIBC'],
    [{ libc_version: '2.38' }, 'LIBC'],
    [{ libc_version: 'broken' }, 'LIBC'],
    [{ available_memory_bytes: 512 * 1024 ** 2 }, 'MEMORY'],
    [{ free_disk_bytes: 2 * 1024 ** 3 }, 'DISK'],
    [{ systemd_system: false }, 'SYSTEMD'],
    [{ installation_conflict: true }, 'EXISTING_INSTALLATION']
  ])('blocks incompatible snapshot %j', (change, reason) => {
    expect(evaluateControllerHost({ ...facts, ...change }, release)).toMatchObject({
      state: 'blocked',
      reasons: [reason]
    })
  })
  it.each([
    { ...facts, uid: -1 },
    { ...facts, free_disk_bytes: Infinity },
    { ...facts, secret: 'SYNTHETIC' }
  ])('rejects malformed or unexpected fields', (value) =>
    expect(() => evaluateControllerHost(value, release)).toThrow()
  )

  function fixture(kind: 'good' | 'stderr' | 'large' | 'malformed' | 'exit' | 'abort'): {
    ssh: { openProductBootstrapChannel: Mock<SshManager['openProductBootstrapChannel']> }
    channel: EventEmitter & { destroy: Mock<() => void>; stderr: EventEmitter }
  } {
    const channel = Object.assign(new EventEmitter(), {
      stderr: new EventEmitter(),
      destroy: vi.fn<() => void>(),
      end: vi.fn(() => {
        queueMicrotask(() => {
          if (kind === 'abort') return
          channel.stderr.emit('data', Buffer.from('SYNTHETIC_RAW_STDERR_NOT_FOR_OUTPUT'))
          channel.emit(
            'data',
            Buffer.from(
              kind === 'large'
                ? 'x'.repeat(4097)
                : kind === 'malformed'
                  ? '{'
                  : JSON.stringify(facts)
            )
          )
          channel.emit('close', kind === 'exit' || kind === 'stderr' ? 1 : 0)
        })
      })
    })
    const open = vi.fn<SshManager['openProductBootstrapChannel']>(async () => ({
      channel: channel as unknown as ClientChannel,
      identity
    }))
    return { ssh: { openProductBootstrapChannel: open }, channel }
  }
  it('passes exact expected pinned identity and hashes fixed script; sends no input/credential', async () => {
    const { ssh, channel } = fixture('good')
    await expect(
      probeControllerHost({ ssh, vpsId: 7, expectedIdentity: identity, release })
    ).resolves.toMatchObject({ state: 'compatible_snapshot' })
    const call = ssh.openProductBootstrapChannel.mock.calls[0] as unknown as [
      number,
      { text: string; sha256: string },
      { expectedIdentity: unknown }
    ]
    expect(call[0]).toBe(7)
    expect(call[1].sha256).toBe(createHash('sha256').update(call[1].text).digest('hex'))
    expect(call[2].expectedIdentity).toEqual(identity)
    expect(channel.destroy).toHaveBeenCalledTimes(1)
  })
  it.each(['stderr', 'large', 'malformed', 'exit'] as const)(
    'returns stable failure without remote data: %s',
    async (kind) => {
      const { ssh } = fixture(kind)
      await expect(
        probeControllerHost({ ssh, vpsId: 7, expectedIdentity: identity, release })
      ).rejects.toThrow(/^CONTROLLER_HOST_PROBE_FAILED$/)
    }
  )
  it('aborts an open channel and refuses a pre-aborted request without SSH', async () => {
    const { ssh, channel } = fixture('abort')
    const abort = new AbortController()
    const result = probeControllerHost({
      ssh,
      vpsId: 7,
      expectedIdentity: identity,
      release,
      signal: abort.signal
    })
    await Promise.resolve()
    abort.abort()
    await expect(result).rejects.toThrow('CONTROLLER_HOST_PROBE_FAILED')
    expect(channel.destroy).toHaveBeenCalledTimes(1)
    ssh.openProductBootstrapChannel.mockClear()
    await expect(
      probeControllerHost({
        ssh,
        vpsId: 7,
        expectedIdentity: identity,
        release,
        signal: abort.signal
      })
    ).rejects.toThrow()
    expect(ssh.openProductBootstrapChannel).not.toHaveBeenCalled()
  })
  it('discards bounded stderr, sanitizes channel-open failure and rejects mismatched identity before SSH', async () => {
    const { ssh, channel } = fixture('abort')
    const result = probeControllerHost({ ssh, vpsId: 7, expectedIdentity: identity, release })
    await vi.waitFor(() => expect(channel.listenerCount('data')).toBe(1))
    channel.emit('data', Buffer.alloc(0))
    channel.stderr.emit('data', Buffer.alloc(4097))
    await expect(result).rejects.toThrow(/^CONTROLLER_HOST_PROBE_FAILED$/)
    ssh.openProductBootstrapChannel.mockRejectedValueOnce(Error('SYNTHETIC_REMOTE_DATA'))
    await expect(
      probeControllerHost({ ssh, vpsId: 7, expectedIdentity: identity, release })
    ).rejects.toThrow(/^CONTROLLER_HOST_PROBE_FAILED$/)
    ssh.openProductBootstrapChannel.mockClear()
    await expect(
      probeControllerHost({ ssh, vpsId: 8, expectedIdentity: identity, release })
    ).rejects.toThrow(/^CONTROLLER_HOST_PROBE_FAILED$/)
    expect(ssh.openProductBootstrapChannel).not.toHaveBeenCalled()
  })
  it('destroys a silent channel at the fixed deadline', async () => {
    vi.useFakeTimers()
    try {
      const { ssh, channel } = fixture('abort')
      const result = probeControllerHost({ ssh, vpsId: 7, expectedIdentity: identity, release })
      const rejected = expect(result).rejects.toThrow(/^CONTROLLER_HOST_PROBE_FAILED$/)
      await vi.advanceTimersByTimeAsync(15000)
      await rejected
      expect(channel.destroy).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
