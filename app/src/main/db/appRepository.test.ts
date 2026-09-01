import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { EncryptedCredential } from '../crypto/credentialCipher'
import { closeDatabase, initializeDatabase } from './index'
import { AppRepository } from './appRepository'
import { VpsRepository } from './vpsRepository'

let testDirectory: string | null = null

afterEach(() => {
  closeDatabase()
  if (testDirectory) {
    rmSync(testDirectory, { recursive: true, force: true })
    testDirectory = null
  }
})

describe('AppRepository constraint mapping', () => {
  it('map xung dot host_port thanh PORT_EXHAUSTED thay vi DB_ERROR', () => {
    const { repository, vpsId } = createHarness()
    repository.create(appRecord(vpsId, 'first-api', 30_000))

    expect(() => repository.create(appRecord(vpsId, 'second-api', 30_000))).toThrow(
      'PORT_EXHAUSTED'
    )
  })

  it('map trung ten app tren cung VPS thanh VALIDATION', () => {
    const { repository, vpsId } = createHarness()
    repository.create(appRecord(vpsId, 'demo-api', 30_000))

    expect(() => repository.create(appRecord(vpsId, 'demo-api', 30_001))).toThrow('VALIDATION')
  })
})

function createHarness(): { repository: AppRepository; vpsId: number } {
  testDirectory = mkdtempSync(join(tmpdir(), 'opspilot-app-repository-'))
  const database = initializeDatabase(testDirectory)
  const vps = new VpsRepository(database).create({
    name: 'VM Test',
    host: '203.0.113.55',
    port: 22,
    username: 'deploy',
    auth_type: 'password',
    credential: fakeCredential('cipher')
  })
  return { repository: new AppRepository(database), vpsId: vps.id }
}

function appRecord(vpsId: number, name: string, hostPort: number) {
  return {
    vps_id: vpsId,
    name,
    framework: 'express' as const,
    source_path: 'C:\\demo',
    host_port: hostPort,
    container_port: 3_000,
    healthcheck_path: '/health',
    needs_db: 0 as const
  }
}

function fakeCredential(value: string): EncryptedCredential {
  return {
    crypto_scheme: 'aes_256_gcm',
    encrypted_secret: Buffer.from(value),
    iv: Buffer.alloc(12, 1),
    auth_tag: Buffer.alloc(16, 2)
  }
}
