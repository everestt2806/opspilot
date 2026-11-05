import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import {
  encryptControllerCredential,
  decryptControllerCredential,
  type ControllerCredentialBinding
} from './controllerSecrets'

const binding: ControllerCredentialBinding = {
  controller_id: 'unit-controller',
  target: {
    vps_id: 1,
    host: 'target.example.test',
    port: 22,
    username: 'deploy',
    auth_type: 'key',
    host_fingerprint: `SHA256:${'A'.repeat(43)}`,
    ssh_security_revision: 1
  }
}

describe('Controller credential identity binding', () => {
  it('roundtrips only with its authenticated controller and SSH profile', () => {
    const cipher = new AesGcmCredentialCipher(randomBytes(32))
    const encrypted = encryptControllerCredential(cipher, binding, 'SYNTHETIC_UNIT_MATERIAL')
    expect(decryptControllerCredential(cipher, binding, encrypted)).toBe('SYNTHETIC_UNIT_MATERIAL')
    expect(encrypted.encrypted_secret.toString('utf8')).not.toContain('SYNTHETIC_UNIT_MATERIAL')
    for (const [key, value] of Object.entries({
      vps_id: 2,
      host: 'other.example.test',
      port: 2222,
      username: 'other',
      auth_type: 'password',
      host_fingerprint: `SHA256:${'B'.repeat(43)}`,
      ssh_security_revision: 2
    })) {
      expect(() =>
        decryptControllerCredential(
          cipher,
          { ...binding, target: { ...binding.target, [key]: value } },
          encrypted
        )
      ).toThrow('CONTROLLER_CREDENTIAL_UNAVAILABLE')
    }
    expect(() =>
      decryptControllerCredential(cipher, { ...binding, controller_id: 'other' }, encrypted)
    ).toThrow('CONTROLLER_CREDENTIAL_UNAVAILABLE')
  })

  it('rejects tampering and a different master key with a stable secret-free error', () => {
    const cipher = new AesGcmCredentialCipher(randomBytes(32))
    const encrypted = encryptControllerCredential(cipher, binding, 'SYNTHETIC_UNIT_MATERIAL')
    for (const field of ['encrypted_secret', 'iv', 'auth_tag'] as const) {
      const changed = { ...encrypted, [field]: Buffer.from(encrypted[field]) }
      changed[field][0] ^= 1
      expect(() => decryptControllerCredential(cipher, binding, changed)).toThrow(
        /^CONTROLLER_CREDENTIAL_UNAVAILABLE$/
      )
    }
    expect(() =>
      decryptControllerCredential(new AesGcmCredentialCipher(randomBytes(32)), binding, encrypted)
    ).toThrow(/^CONTROLLER_CREDENTIAL_UNAVAILABLE$/)
  })

  it('refuses legacy plaintext payloads and oversized material', () => {
    const cipher = new AesGcmCredentialCipher(randomBytes(32))
    expect(() =>
      decryptControllerCredential(cipher, binding, cipher.encrypt('SYNTHETIC_UNIT_MATERIAL'))
    ).toThrow(/^CONTROLLER_CREDENTIAL_UNAVAILABLE$/)
    expect(() => encryptControllerCredential(cipher, binding, 'x'.repeat(256 * 1024 + 1))).toThrow(
      /^CONTROLLER_CREDENTIAL_INVALID$/
    )
  })
})
