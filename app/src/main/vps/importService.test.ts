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
import { RecoveryManifestService } from './recoveryManifestService'
import { runRecoveryManifestCli } from './recoveryManifestCli'
import { MonitorService } from '../monitor/service'
import { MonitorPoller } from '../monitor/poller'
import type { MetricSource } from '../monitor/metricSource'

const testDirectories: string[] = []
const testDatabases: Array<ReturnType<typeof initializeDatabase>> = []

afterEach(() => {
  for (const database of testDatabases.splice(0)) if (database.open) database.close()
  for (const directory of testDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

describe('VPS app import', () => {
  it('excludes a migration-009 imported app from polling and manual training while polling local apps', async () => {
    const harness = createHarness()
    const snapshot = await currentSnapshot(harness.ssh, harness.vpsId)
    const imported = await new VpsAppImportService(harness.db, harness.ssh).importApp(
      harness.vpsId,
      'blog',
      snapshot
    )
    const local = new AppRepository(harness.db).create({
      vps_id: harness.vpsId,
      name: 'local-app',
      framework: 'express',
      source_path: 'D:/local-app',
      host_port: 32003,
      container_port: 3000,
      healthcheck_path: '/health',
      needs_db: 0
    })
    const deployment = new DeploymentRepository(harness.db).createNextVersion(
      local.id,
      local.name,
      null,
      null
    )
    harness.db.prepare("UPDATE deployment SET status='running' WHERE id=?").run(deployment.id)
    harness.db
      .prepare('UPDATE app SET current_deployment_id=? WHERE id=?')
      .run(deployment.id, local.id)

    const importedBaseline = imported.deployment_id
    const before = {
      metrics: harness.db.prepare('SELECT COUNT(*) n FROM metric_sample').get(),
      scores: harness.db.prepare('SELECT COUNT(*) n FROM score_sample').get(),
      alerts: harness.db.prepare('SELECT COUNT(*) n FROM alert').get(),
      activations: harness.db
        .prepare('SELECT COUNT(*) n FROM deployment_activation WHERE app_id=?')
        .get(imported.app_id),
      offset: harness.db.prepare('SELECT metrics_offset FROM app WHERE id=?').get(imported.app_id)
    }
    const sshCalls = {
      exec: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
      metricSnapshot: vi.fn(),
      fileIdentity: vi.fn(async () => ({ generation: 'g1', device: 1, inode: 1 })),
      fileSize: vi.fn(async () => 0),
      readFileTail: vi.fn(async () => ({ content: '', nextOffset: 1 }))
    }
    const ssh = sshCalls as never
    await new MonitorService(harness.db).pollAll(ssh)

    expect(sshCalls.fileSize).toHaveBeenCalledTimes(1)
    expect(sshCalls.readFileTail).toHaveBeenCalledTimes(1)
    expect(harness.db.prepare('SELECT COUNT(*) n FROM metric_sample').get()).toEqual(before.metrics)
    expect(harness.db.prepare('SELECT COUNT(*) n FROM score_sample').get()).toEqual(before.scores)
    expect(harness.db.prepare('SELECT COUNT(*) n FROM alert').get()).toEqual(before.alerts)
    expect(
      harness.db
        .prepare('SELECT COUNT(*) n FROM deployment_activation WHERE app_id=?')
        .get(imported.app_id)
    ).toEqual(before.activations)
    expect(
      harness.db.prepare('SELECT metrics_offset FROM app WHERE id=?').get(imported.app_id)
    ).toEqual(before.offset)

    const source = {
      size: vi.fn(async () => 1),
      tail: vi.fn(async () => ''),
      identity: vi.fn(async () => ({ generation: 'g1' }))
    } satisfies MetricSource
    const directResult = await new MonitorPoller(harness.db).poll(
      imported.app_id,
      importedBaseline,
      source
    )
    expect(directResult.inserted).toBe(0)
    expect(source.size).not.toHaveBeenCalled()
    const client = { train: vi.fn() }
    await expect(
      new MonitorService(harness.db).trainNow(importedBaseline, client as never)
    ).rejects.toMatchObject({
      code: 'VALIDATION'
    })
    expect(client.train).not.toHaveBeenCalled()
  })

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
    expect(JSON.stringify(harness.db.prepare('SELECT * FROM app').all())).not.toContain(
      'SECRET_CANARY'
    )
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
    expect(rollbackHarness.db.prepare('SELECT COUNT(*) AS count FROM deployment').get()).toEqual({
      count: 0
    })
  })
})

describe('R3d recovery manifest creation', () => {
  it('rejects source and target VPS ID mismatch before discovery or any SSH write', async () => {
    const source = createRecoveryHarness()
    const targetDirectory = mkdtempSync(join(tmpdir(), 'opspilot-r3d-cli-target-'))
    testDirectories.push(targetDirectory)
    const targetDb = initializeDatabase(targetDirectory)
    testDatabases.push(targetDb)
    new VpsRepository(targetDb).create({
      name: 'Unrelated VPS',
      host: '203.0.113.79',
      port: 22,
      host_fingerprint: 'SHA256:other-test-fingerprint',
      username: 'deploy',
      auth_type: 'password',
      credential: fakeCredential()
    })
    new VpsRepository(targetDb).create({
      name: 'Matching VPS',
      host: '203.0.113.78',
      port: 22,
      host_fingerprint: 'SHA256:verified-test-fingerprint',
      username: 'deploy',
      auth_type: 'password',
      credential: fakeCredential()
    })

    await expect(
      runRecoveryManifestCli(source.db, source.ssh, {
        vpsId: source.vpsId,
        name: 'blog',
        targetProfile: targetDirectory
      })
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    expect(source.exec).not.toHaveBeenCalled()
    expect(source.writeFile).not.toHaveBeenCalled()
    expect(targetDb.prepare('SELECT COUNT(*) AS count FROM app').get()).toEqual({ count: 0 })
    expect(targetDb.prepare('SELECT COUNT(*) AS count FROM deployment').get()).toEqual({
      count: 0
    })
  })

  it('writes a private manifest only after DB and pinned SSH runtime match', async () => {
    const h = createRecoveryHarness()
    const result = await new RecoveryManifestService(h.db, h.ssh).write(h.vpsId, 'blog')
    expect(result).toEqual({ created: true })
    expect(h.writeFile).toHaveBeenCalledOnce()
    const [, path, content, options] = h.writeFile.mock.calls[0] as unknown as [
      number,
      string,
      string,
      { mode: number; silent: boolean }
    ]
    expect(path).toMatch(/\.opspilot-app\.json\.[0-9a-f-]+\.tmp$/)
    expect(options).toEqual({ mode: 0o600, silent: true })
    expect(content).not.toContain('id')
    expect(content).not.toContain('source_path')
    expect(content).not.toContain('SECRET_CANARY')
    expect(h.commands.some((command) => command.includes('ln --') && !command.includes('mv'))).toBe(
      true
    )
  })

  it('refuses runtime mismatch and missing source records', async () => {
    const mismatch = createRecoveryHarness({ image: 'blog:v4' })
    await expect(
      new RecoveryManifestService(mismatch.db, mismatch.ssh).write(mismatch.vpsId, 'blog')
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    expect(mismatch.writeFile).not.toHaveBeenCalled()
    const missing = createRecoveryHarness({ omitApp: true })
    await expect(
      new RecoveryManifestService(missing.db, missing.ssh).write(missing.vpsId, 'blog')
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    expect(missing.exec).not.toHaveBeenCalled()
  })

  it('refuses conflicting existing manifests and reports write failures without replacing files', async () => {
    const exists = createRecoveryHarness({ existing: '{"different":true}' })
    await expect(
      new RecoveryManifestService(exists.db, exists.ssh).write(exists.vpsId, 'blog')
    ).rejects.toMatchObject({ code: 'VALIDATION' })
    expect(exists.writeFile).not.toHaveBeenCalled()
    const failure = createRecoveryHarness({ writeFailure: true })
    await expect(
      new RecoveryManifestService(failure.db, failure.ssh).write(failure.vpsId, 'blog')
    ).rejects.toThrow('injected write failure')
    expect(failure.commands.some((command) => command.includes('ln --'))).toBe(false)
  })

  it('returns created false for an exact existing manifest and never overwrites it', async () => {
    const expected = JSON.stringify({
      schema_version: 1,
      app: { name: 'blog' },
      framework: 'express',
      source: {
        type: 'git',
        locator_available: true,
        remote: 'https://github.com/example/blog.git',
        ref: 'main',
        root: '.'
      },
      ports: { host: 32001, container: 3000 },
      healthcheck: '/health',
      needs_db: false
    })
    const h = createRecoveryHarness({ existing: expected })
    const result = await new RecoveryManifestService(h.db, h.ssh).write(h.vpsId, 'blog')
    expect(result).toEqual({ created: false })
    expect(h.writeFile).not.toHaveBeenCalled()
    expect(h.commands.some((command) => command.includes('ln --'))).toBe(false)
    expect(h.disconnect).not.toHaveBeenCalled()
  })

  it('distinguishes hard-link failure from cleanup failure after successful creation', async () => {
    const linkFailure = createRecoveryHarness({ lnFailure: true })
    await expect(
      new RecoveryManifestService(linkFailure.db, linkFailure.ssh).write(linkFailure.vpsId, 'blog')
    ).rejects.toMatchObject({ code: 'UNKNOWN' })
    expect(linkFailure.commands.some((command) => command.startsWith('rm --'))).toBe(false)

    const cleanupFailure = createRecoveryHarness({ cleanupFailure: true })
    await expect(
      new RecoveryManifestService(cleanupFailure.db, cleanupFailure.ssh).write(
        cleanupFailure.vpsId,
        'blog'
      )
    ).resolves.toEqual({ created: true })
    expect(cleanupFailure.commands.some((command) => command.includes('ln --'))).toBe(true)
    expect(cleanupFailure.commands.some((command) => command.startsWith('rm --'))).toBe(true)
    expect(cleanupFailure.commands.some((command) => command.startsWith('rm -f --'))).toBe(true)
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

async function currentSnapshot(ssh: Harness['ssh'], vpsId: number): Promise<VpsAppImportSnapshot> {
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

interface RecoveryHarness {
  db: ReturnType<typeof initializeDatabase>
  vpsId: number
  exec: ReturnType<typeof vi.fn<SshManager['exec']>>
  writeFile: ReturnType<typeof vi.fn<SshManager['writeFile']>>
  disconnect: ReturnType<typeof vi.fn<SshManager['disconnect']>>
  commands: string[]
  ssh: Pick<SshManager, 'exec' | 'writeFile' | 'disconnect'>
}

function createRecoveryHarness(
  options: {
    image?: string
    omitApp?: boolean
    existing?: string
    writeFailure?: boolean
    lnFailure?: boolean
    cleanupFailure?: boolean
  } = {}
): RecoveryHarness {
  const directory = mkdtempSync(join(tmpdir(), 'opspilot-r3d-'))
  testDirectories.push(directory)
  const db = initializeDatabase(directory)
  testDatabases.push(db)
  const vps = new VpsRepository(db).create({
    name: 'Recovery VPS',
    host: '203.0.113.78',
    port: 22,
    host_fingerprint: 'SHA256:verified-test-fingerprint',
    username: 'deploy',
    auth_type: 'password',
    credential: fakeCredential()
  })
  if (!options.omitApp) {
    const app = new AppRepository(db).create({
      vps_id: vps.id,
      name: 'blog',
      framework: 'express',
      source_type: 'git',
      source_path: null,
      git_repo_url: 'https://github.com/example/blog.git',
      git_ref: 'main',
      git_root: '.',
      host_port: 32001,
      container_port: 3000,
      healthcheck_path: '/health',
      needs_db: 0
    })
    const deployment = new DeploymentRepository(db).createNextVersion(
      app.id,
      app.name,
      null,
      null,
      { repositoryUrl: 'https://github.com/example/blog.git', commitSha: 'abc123' }
    )
    db.prepare("UPDATE deployment SET status='running' WHERE id=?").run(deployment.id)
    new AppRepository(db).setCurrentDeployment(app.id, deployment.id)
  }
  const commands: string[] = []
  const exec = vi.fn<SshManager['exec']>(async (_id, command) => {
    commands.push(command)
    if (command.includes('docker ps'))
      return {
        code: 0,
        stdout: JSON.stringify({
          Names: 'blog-app',
          Image: options.image ?? 'blog:v1',
          State: 'running',
          Ports: '0.0.0.0:32001->3000/tcp',
          Directory: '/opt/opspilot/blog',
          Service: 'app',
          Config: '/opt/opspilot/blog/docker-compose.yml'
        }),
        stderr: ''
      }
    if (command.includes('head -c'))
      return options.existing !== undefined
        ? { code: 0, stdout: options.existing, stderr: '' }
        : { code: 5, stdout: '', stderr: '' }
    if (command.includes('ln --'))
      return { code: options.lnFailure ? 1 : 0, stdout: '', stderr: 'private detail' }
    if (command.startsWith('rm --'))
      return { code: options.cleanupFailure ? 1 : 0, stdout: '', stderr: 'private detail' }
    return { code: 0, stdout: '', stderr: '' }
  })
  const writeFile = vi.fn(async () => {
    if (options.writeFailure) throw new Error('injected write failure')
  })
  const disconnect = vi.fn<SshManager['disconnect']>(async () => undefined)
  return {
    db,
    vpsId: vps.id,
    exec,
    writeFile,
    disconnect,
    commands,
    ssh: { exec, writeFile, disconnect } as unknown as SshManager
  }
}

function fakeCredential(): EncryptedCredential {
  return {
    crypto_scheme: 'aes_256_gcm',
    encrypted_secret: Buffer.from('cipher'),
    iv: Buffer.alloc(12, 1),
    auth_tag: Buffer.alloc(16, 2)
  }
}
