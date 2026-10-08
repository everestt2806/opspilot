import { createHash } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import { matchesSshHostFingerprint, SshManager } from './manager'

const receivedHostKey = Buffer.from('synthetic SSH host public key bytes')
const otherReceivedHostKey = Buffer.from('different synthetic host public key bytes')
const digest = createHash('sha256').update(receivedHostKey).digest('base64').replace(/=+$/, '')
const verifiedFingerprint = `SHA256:${digest}`

describe('SSH host fingerprint verification', () => {
  it('accepts only the expected OpenSSH SHA256 fingerprint from the received key digest', () => {
    expect(matchesSshHostFingerprint(receivedHostKey, verifiedFingerprint)).toBe(true)
    expect(matchesSshHostFingerprint(otherReceivedHostKey, verifiedFingerprint)).toBe(false)
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
