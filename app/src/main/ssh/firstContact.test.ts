import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  options: null as Record<string, unknown> | null,
  behavior: 'key',
  accepted: null as boolean | null,
  ended: 0
}))
vi.mock('ssh2', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    Client: class extends EventEmitter {
      connect(options: Record<string, unknown>): void {
        harness.options = options
        if (harness.behavior === 'throw') throw Error('raw transport failure')
        if (harness.behavior === 'hang') return
        if (harness.behavior === 'key') {
          harness.accepted = (options.hostVerifier as (key: Buffer) => boolean)(
            Buffer.from('synthetic public host key')
          )
        }
        this.emit('error', Error('handshake rejected'))
      }
      end(): void {
        harness.ended += 1
        this.emit('close')
      }
    }
  }
})
import { readFirstContactFingerprint } from './firstContact'

afterEach(() => {
  vi.useRealTimers()
  harness.options = null
  harness.behavior = 'key'
  harness.ended = 0
  harness.accepted = null
})

describe('first-contact public key observation', () => {
  it('rejects the key exchange before auth and sends no credential or agent', async () => {
    const pin =
      'SHA256:' +
      createHash('sha256').update('synthetic public host key').digest('base64').replace(/=+$/, '')
    await expect(readFirstContactFingerprint('test.invalid', 22)).resolves.toBe(pin)
    expect(harness.accepted).toBe(false)
    expect(harness.options).not.toHaveProperty('password')
    expect(harness.options).not.toHaveProperty('privateKey')
    expect(harness.options).not.toHaveProperty('agent')
    expect((harness.options!.authHandler as () => false)()).toBe(false)
    expect(harness.ended).toBe(1)
  })
  it.each(['error', 'throw'])(
    'does not invent a pin when transport fails: %s',
    async (behavior) => {
      harness.behavior = behavior
      await expect(readFirstContactFingerprint('test.invalid', 22)).rejects.toMatchObject({
        code: 'SSH_HOST_UNREACHABLE'
      })
      expect(harness.ended).toBe(1)
    }
  )
  it('bounds a stalled observation and closes the client', async () => {
    harness.behavior = 'hang'
    vi.useFakeTimers()
    const pending = expect(readFirstContactFingerprint('test.invalid', 22)).rejects.toMatchObject({
      code: 'SSH_HOST_UNREACHABLE'
    })
    await vi.advanceTimersByTimeAsync(15_000)
    await pending
    expect(harness.ended).toBe(1)
  })
})
