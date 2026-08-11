import { randomBytes } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { AesGcmCredentialCipher } from './credentialCipher'

describe('AesGcmCredentialCipher', () => {
  it('ma hoa va giai ma credential UTF-8', () => {
    const cipher = new AesGcmCredentialCipher(randomBytes(32))
    const encrypted = cipher.encrypt('mật-khẩu-an-toàn')

    expect(encrypted.crypto_scheme).toBe('aes_256_gcm')
    expect(encrypted.iv).toHaveLength(12)
    expect(encrypted.auth_tag).toHaveLength(16)
    expect(cipher.decrypt(encrypted)).toBe('mật-khẩu-an-toàn')
  })

  it('tao ciphertext khac nhau khi ma hoa cung ban ro', () => {
    const cipher = new AesGcmCredentialCipher(randomBytes(32))

    const first = cipher.encrypt('same-secret')
    const second = cipher.encrypt('same-secret')

    expect(first.iv.equals(second.iv)).toBe(false)
    expect(first.encrypted_secret.equals(second.encrypted_secret)).toBe(false)
  })

  it('throw khi ciphertext bi sua', () => {
    const cipher = new AesGcmCredentialCipher(randomBytes(32))
    const encrypted = cipher.encrypt('secret')
    const tampered = {
      ...encrypted,
      encrypted_secret: Buffer.from(encrypted.encrypted_secret)
    }
    tampered.encrypted_secret[0] ^= 1

    expect(() => cipher.decrypt(tampered)).toThrow()
  })
})
