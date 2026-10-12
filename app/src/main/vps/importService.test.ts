import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { VpsAppImportSnapshot } from '@shared/ipc'

import type { EncryptedCredential } from '../crypto/credentialCipher'
import { AppRepository } from '../db/appRepository'
import { initializeDatabase } from '../db'
import { DeploymentRepository } from '../db/deploymentRepository'
import { VpsRepository } from '../db/vpsRepository'
import type { SshManager } from '../ssh/manager'
import { discoverVpsApps } from './discovery'
import { VpsAppImportService } from './importService'

const testDirectories: string[] = []
const testDatabases: Array<ReturnType<typeof initializeDatabase>> = []

afterEach(() => {
  for (const database of testDatabases.splice(0)) if (database.open) database.close()
  for (const directory of testDirectories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('VPS app import', () => {
  it('imports a verified live snapshot atomically and the next deployment uses N+1', async () => {
    const harness = createHarness()
    const service = new VpsAppImportService(harness.db, harness.ssh)
    const snapshot = await currentSnapshot(harness.ssh, harness.vpsId)

    const result = await service.importApp(harness.vpsId, 'blog', snapshot)
    const app = new AppRepository(harness.db).getById(result.app_id)
    const baseline = new DeploymentRepository(harness.db).getById(result.deployment_id)

    expect(app).toMatchObject({
      name: 'blog',
      source_type: 'git',
      source_path: null,
      git_repo_url: 'https://github.com/example/blog.git',
      git_ref: 'main',
      git_root: '.',
      imported_from_vps: 1,
      current_deployment_id: result.deployment_id
    })
    expect(baseline).toMatchObject({
      version: 3,
      image_tag: 'blog:v3',
      status: 'running',
      origin: 'vps_import',
      started_at: null,
      finished_at: null,
      build_duration_ms: null,
      total_duration_ms: null,
      git_repo_url: 'https://github.com/example/blog.git',
      git_commit_sha: null
    })
    expect(
      harness.db
        .prepare('SELECT env_json, detector_json FROM deployment WHERE id=?')
        .get(result.deployment_id)
    ).toEqual({ env_json: null, detector_json: null })

    const next = new DeploymentRepository(harness.db).createNextVersion(
      app.id,
      app.name,
      null,
      null
    )
    expect(next).toMatchObject({ version: 4, image_tag: 'blog:v4', origin: 'opspilot' })
    expect(JSON.stringify(harness.db.prepare('SELECT * FROM app').all())).not.toContain('SECRET_CANARY')
    expect(JSON.stringify(harness.db.prepare('SELECT * FROM deployment').all())).not.toContain(
      'SECRET_CANARY'
    )
    expect(harness.exec).toHaveBeenCalledTimes(4)
  })

  it.each([
    ['image changed', (h: Harness) => h.setImage('blog:v4')],
    ['published port changed', (h: Harness) => h.setPort(32002)],
    ['manifest changed', (h: Harness) => h.setManifest(makeManifest('release-2'))]
  ])('rejects import when the %s after the UI snapshot', async (_label, change) => {
    const harness = createHarness()
    const snapshot = await currentSnapshot(harness.ssh, harness.vpsId)
    change(harness)
    const service = new VpsAppImportService(harness.db, harness.ssh)

    await expect(service.importApp(harness.vpsId, 'blog', snapshot)).rejects.toMatchObject({
      code: 'VALIDATION'
    })
    expect(harness.db.prepare('SELECT COUNT(*) AS count FROM app').get()).toEqual({ count: 0 })
  })

  it('imports local-source metadata without inventing a desktop source path', async () => {
    const harness = createHarness()
    harness.setManifest(
      JSON.stringify({
        schema_version: 1,
        app: { name: 'blog' },
        framework: 'express',
        source: { type: 'local', locator_available: false },
        ports: { host: 32001, container: 3000 },
        healthcheck: '/health',
        needs_db: false
      })
    )
    const snapshot = await currentSnapshot(harness.ssh, harness.vpsId)
    const imported = await new VpsAppImportService(harness.db, harness.ssh).importApp(
      harness.vpsId,
      'blog',
      snapshot
    )
    expect(new AppRepository(harness.db).getById(imported.app_id)).toMatchObject({
      source_type: 'local',
      source_path: null,
      git_repo_url: null,
      git_ref: null,
      git_root: null
    })
  })

  it('rejects non-verified evidence, untrusted VPS records, existing apps, and used ports', async () => {
    const harness = createHarness()
    const snapshot = await currentSnapshot(harness.ssh, harness.vpsId)
    const service = new VpsAppImportService(harness.db, harness.ssh)
    await expect(
      service.importApp(harness.vpsId, 'blog', { ...snapshot, recovery_status: 'legacy' })
    ).rejects.toMatchObject({ code: 'VALIDATION' })

    new AppRepository(harness.db).create({
      vps_id: harness.vpsId,
      name: 'other-app',
      framework: 'express',
      source_path: 'local',
      host_port: 32001,
      container_port: 3000,
      healthcheck_path: '/health',
      needs_db: 0
    })
    await expect(service.importApp(harness.vpsId, 'blog', snapshot)).rejects.toMatchObject({
      code: 'PORT_EXHAUSTED'
    })

    const duplicateHarness = createHarness()
    const duplicateSnapshot = await currentSnapshot(duplicateHarness.ssh, duplicateHarness.vpsId)
    new AppRepository(duplicateHarness.db).create({
      vps_id: duplicateHarness.vpsId,
      name: 'blog',
      framework: 'express',
      source_path: 'D:/existing',
      host_port: 32002,
      container_port: 3000,
      healthcheck_path: '/health',
      needs_db: 0
    })
    await expect(
      new VpsAppImportService(duplicateHarness.db, duplicateHarness.ssh).importApp(
        duplicateHarness.vpsId,
        'blog',
        duplicateSnapshot
      )
    ).rejects.toMatchObject({ code: 'VALIDATION' })

    const { db, ssh, vpsId } = createHarness()
    const untrusted = new VpsAppImportService(db, ssh)
    db.prepare('UPDATE vps SET host_fingerprint=NULL WHERE id=?').run(vpsId)
    await expect(untrusted.importApp(vpsId, 'blog', snapshot)).rejects.toMatchObject({
      code: 'VALIDATION'
    })
  })

  it('rejects a duplicate app and a repeated import, and rolls back an injected mid-transaction failure', async () => {
    const harness = createHarness()
    const snapshot = await currentSnapshot(harness.ssh, harness.vpsId)
    const service = new VpsAppImportService(harness.db, harness.ssh)
    await service.importApp(harness.vpsId, 'blog', snapshot)
    await expect(service.importApp(harness.vpsId, 'blog', snapshot)).rejects.toMatchObject({
      code: 'VALIDATION'
    })

    const rollbackHarness = createHarness()
    const rollbackSnapshot = await currentSnapshot(rollbackHarness.ssh, rollbackHarness.vpsId)
    rollbackHarness.db.exec(`
      CREATE TRIGGER fail_import_baseline BEFORE INSERT ON deployment
      WHEN NEW.origin = 'vps_import'
      BEGIN SELECT RAISE(ABORT, 'injected baseline failure'); END;
    `)
    await expect(
      new VpsAppImportService(rollbackHarness.db, rollbackHarness.ssh).importApp(
        rollbackHarness.vpsId,
        'blog',
        rollbackSnapshot
      )
    ).rejects.toMatchObject({ code: 'DB_ERROR' })
    expect(rollbackHarness.db.prepare('SELECT COUNT(*) AS count FROM app').get()).toEqual({
      count: 0
    })
    expect(
      rollbackHarness.db.prepare('SELECT COUNT(*) AS count FROM deployment').get()
    ).toEqual({ count: 0 })
  })
})

interface Harness {
  db: ReturnType<typeof initializeDatabase>
  ssh: Pick<SshManager, 'exec'>
  exec: ReturnType<typeof vi.fn>
  vpsId: number
  setImage(image: string): void
  setPort(port: number): void
  setManifest(value: string): void
}

function createHarness(): Harness {
  const directory = mkdtempSync(join(tmpdir(), 'opspilot-vps-import-'))
  testDirectories.push(directory)
  const db = initializeDatabase(directory)
  testDatabases.push(db)
  const vps = new VpsRepository(db).create({
    name: 'Import VPS',
    host: '203.0.113.77',
    port: 22,
    host_fingerprint: 'SHA256:verified-test-fingerprint',
    username: 'deploy',
    auth_type: 'password',
    credential: fakeCredential()
  })
  let image = 'blog:v3'
  let port = 32001
  let manifest = makeManifest()
  const exec = vi.fn<Pick<SshManager, 'exec'>['exec']>(async (_id, command) => ({
    code: 0,
    stdout: command.includes('docker ps')
      ? JSON.stringify({
          Names: 'blog-app',
          Image: image,
          State: 'running',
          Ports: `0.0.0.0:${port}->3000/tcp`,
          Directory: '/opt/opspilot/blog',
          Service: 'app',
          Config: '/opt/opspilot/blog/docker-compose.yml'
        })
      : manifest,
    stderr: 'SECRET_CANARY'
  }))
  const ssh = { exec }
  return {
    db,
    ssh,
    exec,
    vpsId: vps.id,
    setImage(value) {
      image = value
    },
    setPort(value) {
      port = value
      manifest = makeManifest('main', value)
    },
    setManifest(value) {
      manifest = value
    }
  }
}

async function currentSnapshot(
  ssh: Harness['ssh'],
  vpsId: number
): Promise<VpsAppImportSnapshot> {
  const [candidate] = await discoverVpsApps(ssh as never, vpsId)
  return candidate as VpsAppImportSnapshot
}

function makeManifest(ref = 'main', hostPort = 32001): string {
  return JSON.stringify({
    schema_version: 1,
    app: { name: 'blog' },
    framework: 'express',
    source: {
      type: 'git',
      locator_available: true,
      remote: 'https://github.com/example/blog.git',
      ref,
      root: '.'
    },
    ports: { host: hostPort, container: 3000 },
    healthcheck: '/health',
    needs_db: false
  })
}

function fakeCredential(): EncryptedCredential {
  return {
    crypto_scheme: 'aes_256_gcm',
    encrypted_secret: Buffer.from('cipher'),
    iv: Buffer.alloc(12, 1),
    auth_tag: Buffer.alloc(16, 2)
  }
}
