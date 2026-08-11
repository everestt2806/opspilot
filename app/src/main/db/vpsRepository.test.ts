import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { EncryptedCredential } from '../crypto/credentialCipher'
import { closeDatabase, initializeDatabase } from './index'
import { VpsRepository } from './vpsRepository'

let testDirectory: string | null = null

afterEach(() => {
  closeDatabase()
  if (testDirectory) {
    rmSync(testDirectory, { recursive: true, force: true })
    testDirectory = null
  }
})

describe('VpsRepository', () => {
  it('create/list/update/delete VPS ma khong tra credential ra DTO', () => {
    const { database, repository } = createRepository()
    const created = repository.create({
      name: 'VPS Demo',
      host: '203.0.113.10',
      port: 22,
      username: 'deploy',
      auth_type: 'key',
      provider: 'Example Cloud',
      region: 'bangkok-1',
      credential: fakeCredential('cipher-one')
    })

    expect(created).toMatchObject({
      name: 'VPS Demo',
      host: '203.0.113.10',
      auth_type: 'key',
      last_status: 'unknown'
    })
    expect(created).not.toHaveProperty('encrypted_secret')
    expect(repository.list()).toEqual([created])

    const updated = repository.update(created.id, {
      name: 'VPS Demo 2',
      port: 2222,
      provider: '',
      credential: fakeCredential('cipher-two')
    })
    const stored = database
      .prepare('SELECT encrypted_secret, provider FROM vps WHERE id = ?')
      .get(created.id) as { encrypted_secret: Buffer; provider: string | null }

    expect(updated.name).toBe('VPS Demo 2')
    expect(updated.port).toBe(2222)
    expect(updated.provider).toBeNull()
    expect(stored.encrypted_secret.toString()).toBe('cipher-two')

    repository.delete(created.id)
    expect(repository.list()).toEqual([])
  })

  it('tu choi ten VPS trung', () => {
    const { repository } = createRepository()
    const input = {
      name: 'Trùng tên',
      host: '203.0.113.11',
      port: 22,
      username: 'deploy',
      auth_type: 'password' as const,
      credential: fakeCredential('cipher')
    }

    repository.create(input)
    expect(() => repository.create(input)).toThrow('VALIDATION')
  })

  it('bao loi khi update/delete VPS khong ton tai', () => {
    const { repository } = createRepository()

    expect(() => repository.update(999, { name: 'Không tồn tại' })).toThrow('VALIDATION')
    expect(() => repository.delete(999)).toThrow('VALIDATION')
  })
})

function createRepository(): {
  database: ReturnType<typeof initializeDatabase>
  repository: VpsRepository
} {
  testDirectory = mkdtempSync(join(tmpdir(), 'opspilot-vps-repository-'))
  const database = initializeDatabase(testDirectory)
  return { database, repository: new VpsRepository(database) }
}

function fakeCredential(value: string): EncryptedCredential {
  return {
    crypto_scheme: 'aes_256_gcm',
    encrypted_secret: Buffer.from(value),
    iv: Buffer.alloc(12, 1),
    auth_tag: Buffer.alloc(16, 2)
  }
}
