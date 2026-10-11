import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { EncryptedCredential } from '../crypto/credentialCipher'
import { closeDatabase, initializeDatabase } from './index'
import { VpsRepository, type CreateVpsRecord } from './vpsRepository'
import { AppRepository } from './appRepository'
import { MonitorRepository } from '../monitor/repository'

const FINGERPRINT_A = `SHA256:${Buffer.alloc(32, 1).toString('base64').replace(/=+$/, '')}`
const FINGERPRINT_B = `SHA256:${Buffer.alloc(32, 2).toString('base64').replace(/=+$/, '')}`

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
      host_fingerprint: FINGERPRINT_A,
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

  it('does not create two active records for the same pinned SSH server', () => {
    const { database, repository } = createRepository()
    const first = repository.create(vpsInput('First', FINGERPRINT_A))
    expect(() => repository.create(vpsInput('Second', FINGERPRINT_A))).toThrow('VALIDATION')
    expect(repository.list().map((vps) => vps.id)).toEqual([first.id])
    expect(database.prepare('SELECT COUNT(*) AS count FROM vps').get()).toEqual({ count: 1 })
  })

  it('bao loi khi update/delete VPS khong ton tai', () => {
    const { repository } = createRepository()

    expect(() => repository.update(999, { name: 'Không tồn tại' })).toThrow('VALIDATION')
    expect(() => repository.delete(999)).toThrow('VALIDATION')
  })

  it('archives and restores one VPS without losing apps, deployments or monitor history', () => {
    const { database, repository } = createRepository()
    const original = repository.create(vpsInput('Server A', FINGERPRINT_A))
    const apps = new AppRepository(database)
    const app = apps.create({
      vps_id: original.id,
      name: 'demo-api',
      framework: 'express',
      source_path: 'C:/demo',
      host_port: 30001,
      container_port: 3000,
      healthcheck_path: '/health',
      needs_db: 0
    })
    database
      .prepare(
        "INSERT INTO deployment (app_id, version, image_tag, status) VALUES (?, 1, 'demo-api:v1', 'running')"
      )
      .run(app.id)
    const deployment = database
      .prepare('SELECT id FROM deployment WHERE app_id = ?')
      .get(app.id) as { id: number }
    apps.setCurrentDeployment(app.id, deployment.id)
    database.prepare('INSERT INTO monitor_setting (app_id) VALUES (?)').run(app.id)
    database
      .prepare(
        "INSERT INTO metric_sample (deployment_id, seq, ts_vps, ts_local) VALUES (?, 1, '2026-10-11T00:00:00Z', '2026-10-11T00:00:01Z')"
      )
      .run(deployment.id)

    expect(new MonitorRepository(database).listTargets()).toHaveLength(1)
    repository.delete(original.id)
    expect(repository.list()).toEqual([])
    expect(() => repository.getById(original.id)).toThrow('VALIDATION')
    expect(apps.listAll()).toEqual([])
    expect(new MonitorRepository(database).listTargets()).toEqual([])
    expect(database.prepare('SELECT COUNT(*) AS count FROM deployment').get()).toEqual({ count: 1 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM metric_sample').get()).toEqual({
      count: 1
    })
    expect(database.prepare('SELECT COUNT(*) AS count FROM monitor_setting').get()).toEqual({
      count: 1
    })
    expect(
      (
        database
          .prepare('SELECT length(encrypted_secret) AS size FROM vps WHERE id=?')
          .get(original.id) as {
          size: number
        }
      ).size
    ).toBe(0)

    const restored = repository.create({
      ...vpsInput('Server Reconnected', FINGERPRINT_A),
      credential: fakeCredential('replacement-cipher')
    })
    expect(restored.id).toBe(original.id)
    expect(restored.name).toBe('Server Reconnected')
    expect(restored.last_status).toBe('unknown')
    expect(apps.listAll().map((item) => item.id)).toEqual([app.id])
    expect(new MonitorRepository(database).listTargets()).toHaveLength(1)
    expect(database.prepare('SELECT COUNT(*) AS count FROM vps').get()).toEqual({ count: 1 })
    expect(
      (
        database.prepare('SELECT encrypted_secret FROM vps WHERE id=?').get(original.id) as {
          encrypted_secret: Buffer
        }
      ).encrypted_secret.toString()
    ).toBe('replacement-cipher')
  })

  it('never links records to a changed SSH host key or endpoint', () => {
    const { database, repository } = createRepository()
    const original = repository.create(vpsInput('Server A', FINGERPRINT_A))
    repository.delete(original.id)
    const changedKey = repository.create(vpsInput('Server A', FINGERPRINT_B))
    const changedPort = repository.create({
      ...vpsInput('Different port', FINGERPRINT_A),
      port: 2222
    })
    expect(changedKey.id).not.toBe(original.id)
    expect(changedPort.id).not.toBe(original.id)
    expect(
      database
        .prepare('SELECT archived_at IS NOT NULL AS archived FROM vps WHERE id=?')
        .get(original.id)
    ).toEqual({ archived: 1 })
    expect(repository.list()).toHaveLength(2)
  })

  it('refuses to archive a legacy VPS without a pinned SSH fingerprint', () => {
    const { repository } = createRepository()
    const legacy = repository.create({
      ...vpsInput('Legacy', FINGERPRINT_A),
      host_fingerprint: undefined
    })
    expect(() => repository.delete(legacy.id)).toThrow('VALIDATION')
    expect(repository.list()).toHaveLength(1)
  })

  it('does not archive a VPS with active deploy, migrate or experiment', () => {
    const { database, repository } = createRepository()
    const vps = repository.create(vpsInput('Busy', FINGERPRINT_A))
    const app = new AppRepository(database).create({
      vps_id: vps.id,
      name: 'busy-app',
      framework: 'express',
      source_path: 'C:/demo',
      host_port: 30002,
      container_port: 3000,
      healthcheck_path: '/',
      needs_db: 0
    })
    database
      .prepare(
        "INSERT INTO deployment (app_id, version, image_tag, status) VALUES (?, 1, 'busy-app:v1', 'building')"
      )
      .run(app.id)
    expect(() => repository.delete(vps.id)).toThrow('VALIDATION')
    database.prepare("UPDATE deployment SET status='running' WHERE app_id=?").run(app.id)
    database
      .prepare(
        "INSERT INTO migration_job (app_id, source_vps_id, target_vps_id, status) VALUES (?, ?, ?, 'awaiting_confirm')"
      )
      .run(app.id, vps.id, vps.id)
    expect(() => repository.delete(vps.id)).toThrow('VALIDATION')
    database.prepare("UPDATE migration_job SET status='completed'").run()
    database
      .prepare(
        "INSERT INTO experiment_run (scenario, repeat_index, deployment_id, status) VALUES ('cpu_spike', 1, (SELECT id FROM deployment WHERE app_id=?), 'running')"
      )
      .run(app.id)
    expect(() => repository.delete(vps.id)).toThrow('VALIDATION')
    expect(repository.getById(vps.id).id).toBe(vps.id)
  })
})

function vpsInput(name: string, fingerprint: string): CreateVpsRecord {
  return {
    name,
    host: '203.0.113.10',
    port: 22,
    host_fingerprint: fingerprint,
    username: 'deploy',
    auth_type: 'key' as const,
    credential: fakeCredential('cipher')
  }
}

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
