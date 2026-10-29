import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { EncryptedCredential } from '../crypto/credentialCipher'
import { closeDatabase, initializeDatabase } from './index'
import { AppRepository, type CreateAppRecord } from './appRepository'
import { DeploymentRepository } from './deploymentRepository'
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

  it('persists Git app provenance without storing the temporary checkout path', () => {
    const { repository, vpsId } = createHarness()
    const app = repository.create({
      ...appRecord(vpsId, 'git-api', 30_000),
      source_path: null,
      source_type: 'git',
      git_repo_url: 'https://github.com/example/repo.git',
      git_ref: 'main',
      git_root: 'services/api'
    })

    expect(app).toMatchObject({
      source_type: 'git',
      source_path: null,
      git_repo_url: 'https://github.com/example/repo.git',
      git_ref: 'main',
      git_root: 'services/api'
    })
  })

  it('defaults app health probes to status-only and persists an explicitly declared JSON policy', () => {
    const { repository, vpsId } = createHarness()
    const defaultApp = repository.create(appRecord(vpsId, 'default-health', 30_000))
    const jsonApp = repository.create({
      ...appRecord(vpsId, 'json-health', 30_001),
      healthcheck_response_type: 'json'
    })
    expect(defaultApp.healthcheck_response_type).toBe('status_2xx')
    expect(jsonApp.healthcheck_response_type).toBe('json')
  })

  it('records full Git SHA on the deployment attempt', () => {
    const { repository, vpsId, database } = createHarness()
    const app = repository.create(appRecord(vpsId, 'git-api', 30_000))
    const deployment = new DeploymentRepository(database).createNextVersion(
      app.id,
      app.name,
      null,
      null,
      { repositoryUrl: 'https://github.com/example/repo.git', commitSha: 'a'.repeat(40) }
    )

    expect(deployment.git_repo_url).toBe('https://github.com/example/repo.git')
    expect(deployment.git_commit_sha).toBe('a'.repeat(40))
  })
})

function createHarness(): {
  repository: AppRepository
  vpsId: number
  database: ReturnType<typeof initializeDatabase>
} {
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
  return { repository: new AppRepository(database), vpsId: vps.id, database }
}

function appRecord(vpsId: number, name: string, hostPort: number): CreateAppRecord {
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
