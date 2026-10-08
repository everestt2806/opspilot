import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

const ssh2Harness = vi.hoisted(() => ({
  hostKey: [83, 83, 72, 32, 116, 101, 115, 116, 32, 104, 111, 115, 116, 32, 107, 101, 121],
  authenticationAttempts: 0,
  commandAttempts: 0
}))

vi.mock('ssh2', async () => {
  const { EventEmitter } = await import('node:events')

  class FakeClient extends EventEmitter {
    connect(options: { hostVerifier: (key: Buffer) => boolean }): void {
      if (!options.hostVerifier(Buffer.from(ssh2Harness.hostKey))) {
        this.emit('error', new Error('Host key rejected'))
        return
      }
      ssh2Harness.authenticationAttempts += 1
      this.emit('ready')
    }

    exec(_command: string, callback: (error: Error) => void): void {
      ssh2Harness.commandAttempts += 1
      callback(new Error('Unexpected command execution'))
    }

    end(): void {
      this.removeAllListeners()
    }
  }

  return { Client: FakeClient }
})

import { matchesSshHostFingerprint, SshManager } from './manager'

const receivedHostKey = Buffer.from(ssh2Harness.hostKey)
const otherReceivedHostKey = Buffer.from('different synthetic host public key bytes')

function fingerprintFor(key: Buffer): string {
  const digest = createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
  return `SHA256:${digest}`
}

const verifiedFingerprint = fingerprintFor(receivedHostKey)

describe('SSH host fingerprint verification', () => {
  it('accepts only the expected OpenSSH SHA256 fingerprint from the received key digest', () => {
    expect(matchesSshHostFingerprint(receivedHostKey, verifiedFingerprint)).toBe(true)
    expect(matchesSshHostFingerprint(otherReceivedHostKey, verifiedFingerprint)).toBe(false)
  })

  it('authenticates after ssh2 verifies the matching host key', async () => {
    ssh2Harness.authenticationAttempts = 0
    ssh2Harness.commandAttempts = 0
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
