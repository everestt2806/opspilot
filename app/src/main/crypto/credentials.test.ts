import { mkdtempSync, rmSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { AesGcmCredentialCipher } from './credentialCipher'
import { loadSecret } from './credentials'
import { closeDatabase, initializeDatabase } from '../db'
import { VpsRepository } from '../db/vpsRepository'
import { VpsService } from '../vps/service'

const SAMPLE_KEY = [
  '-----BEGIN OPENSSH PRIVATE KEY-----',
  'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZWQy',
  'NTUxOQAAACB2FcQhYbQewyV3lYPd6o2Xf9QwvQcN4wRCuO2v3m3mHwAAAKjRwCk9Mx1N',
  'v0EZ1WfGs8QpE2g0T0B5WHXm1mZvLq4vHWwiuAqSGykAAAAFWJuYW1lQGJueW5hbWUBNg',
  '-----END OPENSSH PRIVATE KEY-----'
].join('\n')

let testDirectory: string | null = null

afterEach(() => {
  closeDatabase()
  if (testDirectory) {
    rmSync(testDirectory, { recursive: true, force: true })
    testDirectory = null
  }
})

describe('credential trong DB', () => {
  it('luu bi an: cot encrypted_secret khong chua ban ro, doc lai duoc bang loadSecret', () => {
    const { database, service, cipher } = createStack()

    const created = service.create({
      name: 'Sandbox',
      host: '127.0.0.1',
      port: 2222,
      username: 'deploy',
      auth_type: 'key',
      secret: SAMPLE_KEY
    })

    const row = database
      .prepare('SELECT encrypted_secret, iv, auth_tag FROM vps WHERE id = ?')
      .get(created.id) as { encrypted_secret: Buffer; iv: Buffer; auth_tag: Buffer }

    const stored = row.encrypted_secret.toString('utf8')
    expect(stored).not.toContain('OPENSSH PRIVATE KEY')
    expect(stored).not.toContain('b3BlbnNzaC1rZXktdjE')
    expect(row.iv).toHaveLength(12)
    expect(row.auth_tag).toHaveLength(16)

    expect(loadSecret(database, cipher, created.id)).toBe(SAMPLE_KEY)
  })

  it('loadSecret bao loi khi VPS khong ton tai', () => {
    const { database, cipher } = createStack()
    expect(() => loadSecret(database, cipher, 9999)).toThrow('VALIDATION')
  })

  it('loadSecret bao loi khi dữ lieu bi sua (tamper) thay vi tra chuoi rac', () => {
    const { database, service, cipher } = createStack()
    const created = service.create({
      name: 'Sandbox',
      host: '127.0.0.1',
      port: 2222,
      username: 'deploy',
      auth_type: 'password',
      secret: 'mat-khau'
    })

    database
      .prepare('UPDATE vps SET encrypted_secret = ? WHERE id = ?')
      .run(Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x01]), created.id)

    expect(() => loadSecret(database, cipher, created.id)).toThrow('SSH_AUTH_FAILED')
  })
})

function createStack(): {
  database: ReturnType<typeof initializeDatabase>
  service: VpsService
  cipher: AesGcmCredentialCipher
} {
  testDirectory = mkdtempSync(join(tmpdir(), 'opspilot-cred-'))
  const database = initializeDatabase(testDirectory)
  const cipher = new AesGcmCredentialCipher(randomBytes(32))
  return { database, cipher, service: new VpsService(new VpsRepository(database), cipher) }
}
