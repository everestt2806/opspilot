import Database from 'better-sqlite3'
import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import {
  encryptControllerCredential,
  loadControllerCredentialCipher,
  type ControllerCredentialBinding
} from './controllerSecrets'
import { createControllerSshResolver } from './controllerSshResolver'

vi.mock('./controllerSecrets', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./controllerSecrets')>()),
  loadControllerCredentialCipher: vi.fn()
}))

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
const material = 'SYNTHETIC_UNIT_MATERIAL'
let database: Database.Database
let cipher: AesGcmCredentialCipher

function saveCredential(value = binding, plaintext = material): void {
  const encrypted = encryptControllerCredential(cipher, value, plaintext)
  database
    .prepare(`UPDATE vps SET crypto_scheme=?, encrypted_secret=?, iv=?, auth_tag=? WHERE id=1`)
    .run(encrypted.crypto_scheme, encrypted.encrypted_secret, encrypted.iv, encrypted.auth_tag)
}

beforeEach(() => {
  vi.clearAllMocks()
  cipher = new AesGcmCredentialCipher(randomBytes(32))
  vi.mocked(loadControllerCredentialCipher).mockReturnValue(cipher)
  database = new Database(':memory:')
  database.exec(`CREATE TABLE vps (
    id INTEGER PRIMARY KEY, host TEXT, port INTEGER, username TEXT, auth_type TEXT,
    host_fingerprint TEXT, ssh_security_revision INTEGER, archived_at TEXT,
    crypto_scheme TEXT, encrypted_secret BLOB, iv BLOB, auth_tag BLOB
  )`)
  database
    .prepare(`INSERT INTO vps VALUES (1,?,22,'deploy','key',?,1,NULL,NULL,NULL,NULL,NULL)`)
    .run(binding.target.host, binding.target.host_fingerprint)
  saveCredential()
})

afterEach(() => {
  if (database.open) database.close()
})

describe('Controller SQLite to pinned SSH resolver', () => {
  it.each(['key', 'password'] as const)(
    'reads bound %s material without writes or config cache',
    (auth) => {
      database.prepare('UPDATE vps SET auth_type=?').run(auth)
      saveCredential({ ...binding, target: { ...binding.target, auth_type: auth } })
      const resolve = createControllerSshResolver(database, binding.controller_id, '/unit-private')
      const before = database.prepare('SELECT total_changes() AS n').get()
      expect(resolve(1)).toEqual({
        host: binding.target.host,
        port: 22,
        hostFingerprint: binding.target.host_fingerprint,
        username: 'deploy',
        authType: auth,
        secret: material
      })
      expect(database.prepare('SELECT total_changes() AS n').get()).toEqual(before)
      saveCredential(
        { ...binding, target: { ...binding.target, auth_type: auth } },
        'UPDATED_UNIT_MATERIAL'
      )
      expect(resolve(1)).toMatchObject({ secret: 'UPDATED_UNIT_MATERIAL' })
      expect(loadControllerCredentialCipher).toHaveBeenCalledTimes(2)
    }
  )

  it.each([
    ['host', 'other.example.test'],
    ['port', 2222],
    ['username', 'other'],
    ['auth_type', 'password'],
    ['host_fingerprint', `SHA256:${'B'.repeat(43)}`],
    ['ssh_security_revision', 2]
  ])('rejects changed identity %s with old ciphertext', (field, value) => {
    const resolve = createControllerSshResolver(database, binding.controller_id, '/unit-private')
    expect(resolve(1)).toMatchObject({ secret: material })
    database.prepare(`UPDATE vps SET ${field}=?`).run(value)
    expect(() => resolve(1)).toThrow(/^CONTROLLER_SSH_CREDENTIAL_UNAVAILABLE$/)
  })

  it('rejects encrypted material for another controller or VPS row', () => {
    const resolve = createControllerSshResolver(database, binding.controller_id, '/unit-private')
    for (const changed of [
      { ...binding, controller_id: 'other-controller' },
      { ...binding, target: { ...binding.target, vps_id: 2 } }
    ]) {
      saveCredential(changed)
      expect(() => resolve(1)).toThrow(/^CONTROLLER_SSH_CREDENTIAL_UNAVAILABLE$/)
    }
  })

  it.each([
    ['host_fingerprint', null],
    ['host_fingerprint', 'SHA256:incomplete'],
    ['host_fingerprint', `${binding.target.host_fingerprint}\n`],
    ['host', ''],
    ['host', 'host\nother'],
    ['username', ''],
    ['port', 0],
    ['port', 65536],
    ['port', 22.5],
    ['auth_type', 'other'],
    ['ssh_security_revision', 0],
    ['ssh_security_revision', 1.5]
  ])('rejects invalid profile %s=%s before key loading', (field, value) => {
    database.prepare(`UPDATE vps SET ${field}=?`).run(value)
    const resolve = createControllerSshResolver(database, binding.controller_id, '/unit-private')
    expect(() => resolve(1)).toThrow(/^CONTROLLER_SSH_IDENTITY_INVALID$/)
    expect(loadControllerCredentialCipher).not.toHaveBeenCalled()
  })

  it('rejects missing, archived, deleted and unreadable profiles before key loading', () => {
    const resolve = createControllerSshResolver(database, binding.controller_id, '/unit-private')
    expect(() => resolve(2)).toThrow(/^CONTROLLER_SSH_PROFILE_UNAVAILABLE$/)
    database.prepare("UPDATE vps SET archived_at='2026-11-06T00:00:00Z'").run()
    expect(() => resolve(1)).toThrow(/^CONTROLLER_SSH_PROFILE_UNAVAILABLE$/)
    database.prepare('DELETE FROM vps').run()
    expect(() => resolve(1)).toThrow(/^CONTROLLER_SSH_PROFILE_UNAVAILABLE$/)
    database.close()
    expect(() => resolve(1)).toThrow(/^CONTROLLER_SSH_PROFILE_UNAVAILABLE$/)
    expect(loadControllerCredentialCipher).not.toHaveBeenCalled()
  })

  it('refuses legacy credential schemes and malformed envelopes without reading a key', () => {
    const resolve = createControllerSshResolver(database, binding.controller_id, '/unit-private')
    for (const [field, value] of [
      ['crypto_scheme', 'safe_storage'],
      ['encrypted_secret', material],
      ['iv', null],
      ['auth_tag', null]
    ] as const) {
      saveCredential()
      database.prepare(`UPDATE vps SET ${field}=?`).run(value)
      expect(() => resolve(1)).toThrow(/^CONTROLLER_SSH_CREDENTIAL_UNAVAILABLE$/)
    }
    expect(loadControllerCredentialCipher).not.toHaveBeenCalled()
  })

  it('rejects tampering, unbound ciphertext and unavailable keys without leaking details', () => {
    const resolve = createControllerSshResolver(database, binding.controller_id, '/unit-private')
    const encrypted = cipher.encrypt(material)
    database
      .prepare('UPDATE vps SET encrypted_secret=?, iv=?, auth_tag=?')
      .run(encrypted.encrypted_secret, encrypted.iv, encrypted.auth_tag)
    expect(() => resolve(1)).toThrow(/^CONTROLLER_SSH_CREDENTIAL_UNAVAILABLE$/)
    saveCredential()
    database.prepare('UPDATE vps SET auth_tag=zeroblob(16)').run()
    expect(() => resolve(1)).toThrow(/^CONTROLLER_SSH_CREDENTIAL_UNAVAILABLE$/)
    saveCredential()
    vi.mocked(loadControllerCredentialCipher).mockImplementation(() => {
      throw new Error(`PRIVATE_PATH_AND_${material}`)
    })
    expect(() => resolve(1)).toThrow(/^CONTROLLER_SSH_CREDENTIAL_UNAVAILABLE$/)
  })

  it('rejects unsafe controller and VPS IDs before loading a key', () => {
    for (const id of ['', '../escape', '-start', 'controller\n', 'x'.repeat(129)])
      expect(() => createControllerSshResolver(database, id, '/unit-private')).toThrow(
        /^CONTROLLER_SSH_IDENTITY_INVALID$/
      )
    const resolve = createControllerSshResolver(database, binding.controller_id, '/unit-private')
    for (const id of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(() => resolve(id)).toThrow(/^CONTROLLER_SSH_IDENTITY_INVALID$/)
    expect(loadControllerCredentialCipher).not.toHaveBeenCalled()
  })
})
