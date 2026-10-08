import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CredentialCipher } from '../crypto/credentialCipher'
import { closeDatabase, initializeDatabase } from '../db'
import { VpsRepository } from '../db/vpsRepository'
import { VpsService } from './service'

const TEST_HOST_FINGERPRINT = `SHA256:${Buffer.alloc(32, 2).toString('base64').replace(/=+$/, '')}`

let testDirectory: string | null = null

afterEach(() => {
  closeDatabase()
  if (testDirectory) {
    rmSync(testDirectory, { recursive: true, force: true })
    testDirectory = null
  }
})

describe('VpsService', () => {
  it('validate input va ma hoa secret truoc khi luu', () => {
    const { service, encrypt } = createService()
    const created = service.create({
      name: '  VPS A  ',
      host: '  203.0.113.20 ',
      port: 22,
      host_fingerprint: TEST_HOST_FINGERPRINT,
      username: ' deploy ',
      auth_type: 'password',
      secret: 'plain-secret',
      provider: ' Cloud '
    })

    expect(encrypt).toHaveBeenCalledWith('plain-secret')
    expect(created).toMatchObject({
      name: 'VPS A',
      host: '203.0.113.20',
      username: 'deploy',
      provider: 'Cloud'
    })
  })

  it('giu credential khi update khong gui secret', () => {
    const { service, encrypt } = createService()
    const created = service.create({
      name: 'VPS A',
      host: '203.0.113.20',
      port: 22,
      host_fingerprint: TEST_HOST_FINGERPRINT,
      username: 'deploy',
      auth_type: 'password',
      secret: 'first-secret'
    })

    service.update(created.id, { name: 'VPS B' })
    expect(encrypt).toHaveBeenCalledTimes(1)
    expect(service.list()[0]?.name).toBe('VPS B')
  })

  it('yeu cau secret khi doi cach xac thuc', () => {
    const { service } = createService()
    const created = service.create({
      name: 'VPS A',
      host: '203.0.113.20',
      port: 22,
      host_fingerprint: TEST_HOST_FINGERPRINT,
      username: 'deploy',
      auth_type: 'password',
      secret: 'first-secret'
    })

    expect(() => service.update(created.id, { auth_type: 'key' })).toThrow('VALIDATION')
  })

  it('tu choi input sai truoc khi cham database', () => {
    const { service } = createService()

    expect(() =>
      service.create({
        name: '',
        host: '',
        port: 0,
        host_fingerprint: TEST_HOST_FINGERPRINT,
        username: '',
        auth_type: 'password',
        secret: ''
      })
    ).toThrow('VALIDATION')
    expect(service.list()).toEqual([])
  })

  it('yêu cầu fingerprint mới khi đổi host hoặc port', () => {
    const { service } = createService()
    const created = service.create({
      name: 'VPS A',
      host: 'vps.example.invalid',
      port: 22,
      host_fingerprint: TEST_HOST_FINGERPRINT,
      username: 'deploy',
      auth_type: 'key',
      secret: 'non-secret test fixture'
    })

    expect(() => service.update(created.id, { host: 'other.example.invalid' })).toThrowError(
      expect.objectContaining({ userMessage: expect.stringContaining('Đổi host hoặc port') })
    )
    expect(() => service.update(created.id, { port: 2222 })).toThrowError(
      expect.objectContaining({ userMessage: expect.stringContaining('Đổi host hoặc port') })
    )
  })
})

function createService(): {
  service: VpsService
  encrypt: ReturnType<typeof vi.fn<CredentialCipher['encrypt']>>
} {
  testDirectory = mkdtempSync(join(tmpdir(), 'opspilot-vps-service-'))
  const database = initializeDatabase(testDirectory)
  const encrypt = vi.fn<CredentialCipher['encrypt']>(() => ({
    crypto_scheme: 'aes_256_gcm',
    encrypted_secret: Buffer.from('encrypted'),
    iv: Buffer.alloc(12, 1),
    auth_tag: Buffer.alloc(16, 2)
  }))
  return {
    service: new VpsService(new VpsRepository(database), { encrypt }),
    encrypt
  }
}
