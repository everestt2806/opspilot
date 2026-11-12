import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type Database from 'better-sqlite3'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase, closeDatabase } from '../db'
import { AppRepository } from '../db/appRepository'
import { ProductDeployRepository } from '../db/productDeployRepository'
import { createGitSnapshot } from '../git/snapshot'
import { verifyControllerBundle } from './controllerBundle'
import { canonicalH2Json } from './productH2Proof'
import { verifyProductProjectSource } from './projectSourceVerification'
import type { ProductProjectSourceVerificationInput } from '../../../../docs/contracts/product-project-source-verification'

vi.mock('../git/snapshot', async (original) => ({
  ...(await original<typeof import('../git/snapshot')>()),
  createGitSnapshot: vi.fn()
}))
vi.mock('./controllerBundle', () => ({ verifyControllerBundle: vi.fn() }))

let directory: string,
  source: string,
  db: Database.Database,
  request: ProductProjectSourceVerificationInput
const cleanup = vi.fn(),
  sha = 'b'.repeat(40)
const check = (): ReturnType<typeof verifyProductProjectSource> =>
  verifyProductProjectSource(db, 'controller-test', request)
const counts = (): unknown =>
  Object.fromEntries(
    [
      'product_branch_observation',
      'product_desired_branch',
      'product_history_event',
      'product_deploy_job',
      'deployment',
      'product_target_enrollment'
    ].map((table) => [table, db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()])
  )
const queueJob = (): void => {
  db.prepare(
    `INSERT INTO product_deploy_job(job_id,controller_id,app_id,ownership_generation,
    source_generation,source_config_sha256,trigger,idempotency_key,ref,target_sha,state,
    available_at,created_at,updated_at) VALUES('pjob_busy','controller-test',1,1,1,?,
    'manual_redeploy','test-busy','main',?,'queued',?,?,?)`
  ).run(request.expected_source_config_sha256, sha, ...Array(3).fill(new Date().toISOString()))
}

beforeEach(() => {
  vi.resetAllMocks()
  directory = mkdtempSync(join(tmpdir(), 'opspilot-source-verify-'))
  source = join(directory, 'snapshot')
  mkdirSync(source)
  writeFileSync(
    join(source, 'package.json'),
    JSON.stringify({
      name: 'fixture-api',
      scripts: { start: 'node server.js' },
      dependencies: { express: '4.21.2' }
    })
  )
  writeFileSync(
    join(source, 'server.js'),
    "const app = require('express')(); app.get('/health',(req,res)=>res.send('ok')); app.listen(3000);\n"
  )
  db = initializeDatabase(join(directory, 'db'))
  db.prepare("INSERT INTO product_controller VALUES('controller-test',?,'active')").run(
    new Date().toISOString()
  )
  db.prepare(
    "INSERT INTO vps(id,name,host,port,username,auth_type,host_fingerprint,ssh_security_revision,encrypted_secret) VALUES(1,'fixture','target.test',22,'operator','key',?,1,X'0102')"
  ).run('SHA256:' + 'A'.repeat(43))
  new AppRepository(db).create({
    vps_id: 1,
    name: 'fixture-api',
    framework: 'express',
    source_type: 'git',
    source_path: null,
    git_repo_url: 'https://github.com/example/api.git',
    git_ref: 'main',
    git_root: '.',
    host_port: 30000,
    container_port: 3000,
    healthcheck_path: '/health',
    needs_db: 0
  })
  const config = canonicalH2Json({
    framework: 'express',
    host_port: 30000,
    container_port: 3000,
    healthcheck_path: '/health',
    needs_db: false
  })
  const hash = createHash('sha256').update(config).digest('hex')
  db.prepare(
    "INSERT INTO product_source_config VALUES(1,1,'https://github.com/example/api.git','main','.',?,?,?)"
  ).run(config, hash, new Date().toISOString())
  db.prepare(
    "INSERT INTO product_app_control(app_id,mode,controller_id,ownership_generation,source_generation,source_config_sha256,changed_at,auto_deploy_paused,pause_reason,pause_policy_provenance) VALUES(1,'product','controller-test',1,1,?,?,1,'operator','explicit')"
  ).run(hash, new Date().toISOString())
  request = {
    format: 1,
    controller_id: 'controller-test',
    app_id: 1,
    expected_ownership_generation: 1,
    expected_source_generation: 1,
    expected_source_config_sha256: hash,
    expected_target_security_revision: 1,
    artifact: '/trusted/control-plane.cjs',
    manifest_sha256: 'c'.repeat(64)
  }
  vi.mocked(verifyControllerBundle).mockReturnValue({
    state: 'bundle_verified',
    manifest_sha256: request.manifest_sha256,
    root_directory: '/trusted',
    entrypoint: request.artifact,
    templates_directory: resolve('../templates'),
    collector_directory: resolve('../collector'),
    target_helper_path: '/trusted/helper',
    files: 12
  })
  vi.mocked(createGitSnapshot).mockResolvedValue({
    repositoryUrl: 'https://github.com/example/api.git',
    commitSha: sha,
    rootDirectory: source,
    snapshotDirectory: source,
    cleanup
  })
})
afterEach(() => {
  if (db.inTransaction) db.exec('ROLLBACK')
  closeDatabase()
  rmSync(directory, { recursive: true, force: true })
})

describe('Xác minh source Product trước deployment', () => {
  const spa = (): void => {
    db.prepare("UPDATE app SET framework='static-spa',container_port=80,healthcheck_path='/'").run()
    const config = canonicalH2Json({
      framework: 'static-spa',
      host_port: 30000,
      container_port: 80,
      healthcheck_path: '/',
      needs_db: false
    })
    const hash = createHash('sha256').update(config).digest('hex')
    db.transaction(() => {
      db.pragma('defer_foreign_keys = ON')
      db.prepare('UPDATE product_source_config SET deploy_config_json=?,config_sha256=?').run(
        config,
        hash
      )
      db.prepare('UPDATE product_app_control SET source_config_sha256=?').run(hash)
    })()
    request.expected_source_config_sha256 = hash
    writeFileSync(
      join(source, 'package.json'),
      JSON.stringify({
        name: 'spa-fixture',
        scripts: { build: 'vite build' },
        devDependencies: { vite: '5.4.11' }
      })
    )
    writeFileSync(join(source, 'index.html'), '<html><body>SPA</body></html>')
  }
  it('xác minh SPA khớp framework, giữ paused và không tạo deployment/job', async () => {
    spa()
    const before = counts()
    expect(await check()).toMatchObject({
      framework: 'static-spa',
      configured_container_port: 80,
      detected_container_port: 80,
      deployment_started: false,
      auto_deploy_paused: true
    })
    expect(db.prepare('SELECT COUNT(*) AS n FROM deployment').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT COUNT(*) AS n FROM product_deploy_job').get()).toEqual({ n: 0 })
    expect(counts()).not.toEqual(before)
    expect(cleanup).toHaveBeenCalledOnce()
  })
  it('không xác minh source Express dưới đăng ký SPA hoặc cổng nginx sai', async () => {
    spa()
    db.prepare('UPDATE app SET container_port=3000').run()
    await expect(check()).rejects.toThrow('PROJECT_SOURCE_AUTHORITY_REJECTED')
    spa()
    writeFileSync(
      join(source, 'package.json'),
      JSON.stringify({ scripts: { start: 'node server.js' }, dependencies: { express: '4.21.2' } })
    )
    await expect(check()).rejects.toThrow('PROJECT_SOURCE_UNSUPPORTED')
    expect(db.prepare('SELECT COUNT(*) AS n FROM product_branch_observation').get()).toEqual({
      n: 0
    })
  })
  it('fetches the exact branch namespace and shares source/render preflight, keeping app paused without jobs', async () => {
    const result = await check()
    expect(result).toMatchObject({
      state: 'source_verified',
      commit_sha: sha,
      observation_sequence: 1,
      framework: 'express',
      configured_container_port: 3000,
      detected_container_port: 3000,
      auto_deploy_paused: true,
      deployment_started: false,
      runtime_preflight: 'required'
    })
    expect(createGitSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryUrl: 'https://github.com/example/api.git',
        ref: 'refs/heads/main',
        root: '.',
        signal: expect.any(AbortSignal),
        maxBytes: 512 * 1024 * 1024
      })
    )
    expect(result.source_file_count).toBeGreaterThan(2)
    expect(result.source_bytes).toBeGreaterThan(0)
    expect(cleanup).toHaveBeenCalledOnce()
    expect(db.prepare('SELECT state FROM product_deploy_job').all()).toEqual([])
    expect(db.prepare('SELECT * FROM deployment').all()).toEqual([])
    expect(db.prepare('SELECT * FROM product_target_enrollment').all()).toEqual([])
    expect(db.prepare('SELECT auto_deploy_paused FROM product_app_control').get()).toEqual({
      auto_deploy_paused: 1
    })
    expect(db.prepare('SELECT reconciliation_state FROM product_desired_branch').get()).toEqual({
      reconciliation_state: 'paused'
    })
    expect(db.prepare('SELECT kind FROM product_history_event').all()).toEqual([
      { kind: 'project_source_verified' }
    ])
  })
  it('re-verifies same SHA with one observation and exposes only safe metadata', async () => {
    writeFileSync(join(source, 'README.md'), 'do-not-export-file-content')
    const first = await check(),
      second = await check()
    expect(second.observation_sequence).toBe(first.observation_sequence)
    expect(db.prepare('SELECT COUNT(*) AS n FROM product_branch_observation').get()).toEqual({
      n: 1
    })
    for (const forbidden of [
      'do-not-export-file-content',
      'node server.js',
      'npm ci',
      'buildCommand',
      'startCommand',
      'rootDirectory'
    ])
      expect(JSON.stringify(second)).not.toContain(forbidden)
    expect(cleanup).toHaveBeenCalledTimes(2)
  })
  it('rejects caller transaction, wrong current generations, controller, target revision and extra authority fields before network', async () => {
    for (const change of [
      { format: 2 },
      { controller_id: 'foreign' },
      { app_id: 999 },
      { expected_ownership_generation: 2 },
      { expected_source_generation: 2 },
      { expected_source_config_sha256: 'f'.repeat(64) },
      { expected_target_security_revision: 2 },
      { repository_url: 'https://github.com/other/api.git' },
      { target_sha: sha },
      { env: { SECRET: 'never-export' } },
      { expected_ownership_generation: 1.5 }
    ]) {
      await expect(
        verifyProductProjectSource(db, 'controller-test', { ...request, ...change })
      ).rejects.toThrow('PROJECT_SOURCE_')
    }
    db.exec('BEGIN')
    await expect(check()).rejects.toThrow('PROJECT_SOURCE_REQUEST_INVALID')
    expect(db.inTransaction).toBe(true)
    expect(createGitSnapshot).not.toHaveBeenCalled()
  })
  it.each([
    "UPDATE product_controller SET status='maintenance'",
    "UPDATE product_app_control SET mode='desktop',controller_id=NULL",
    'UPDATE product_app_control SET auto_deploy_paused=0,pause_reason=NULL',
    "UPDATE vps SET archived_at='2026-11-07T00:00:00Z'",
    'UPDATE vps SET host_fingerprint=NULL',
    'UPDATE app SET container_port=4000',
    "UPDATE app SET git_root='different'"
  ])('rejects invalid authority before fetch: %s', async (sql) => {
    db.exec(sql)
    const before = counts()
    await expect(check()).rejects.toThrow('PROJECT_SOURCE_')
    expect(createGitSnapshot).not.toHaveBeenCalled()
    expect(counts()).toEqual(before)
  })
  it.each([
    'UPDATE product_app_control SET ownership_generation=2',
    'UPDATE product_app_control SET auto_deploy_paused=0,pause_reason=NULL',
    "UPDATE product_app_control SET pause_reason='manual_action'",
    "UPDATE vps SET host='changed.test'",
    'UPDATE vps SET ssh_security_revision=2',
    "UPDATE app SET healthcheck_path='/other'",
    "UPDATE app SET git_ref='other'"
  ])('rechecks authority after async fetch: %s', async (sql) => {
    vi.mocked(createGitSnapshot).mockImplementationOnce(async () => {
      db.exec(sql)
      return {
        repositoryUrl: 'https://github.com/example/api.git',
        commitSha: sha,
        rootDirectory: source,
        snapshotDirectory: source,
        cleanup
      }
    })
    await expect(check()).rejects.toThrow('PROJECT_SOURCE_')
    expect(db.prepare('SELECT * FROM product_branch_observation').all()).toEqual([])
    expect(db.prepare('SELECT * FROM product_history_event').all()).toEqual([])
    expect(cleanup).toHaveBeenCalledOnce()
  })
  it('does not overwrite an observation committed by poller during fetch', async () => {
    vi.mocked(createGitSnapshot).mockImplementationOnce(async () => {
      new ProductDeployRepository(db).observeTip({
        controllerId: 'controller-test',
        appId: 1,
        ownershipGeneration: 1,
        sourceGeneration: 1,
        configSha256: request.expected_source_config_sha256,
        ref: 'main',
        tipSha: 'd'.repeat(40),
        expectedObservationSequence: null
      })
      return {
        repositoryUrl: 'https://github.com/example/api.git',
        commitSha: sha,
        rootDirectory: source,
        snapshotDirectory: source,
        cleanup
      }
    })
    await expect(check()).rejects.toThrow('PROJECT_SOURCE_OBSERVATION_STALE')
    expect(db.prepare('SELECT observed_sha FROM product_branch_observation').all()).toEqual([
      { observed_sha: 'd'.repeat(40) }
    ])
    expect(cleanup).toHaveBeenCalledOnce()
  })
  it('rejects queued work before fetch and work arriving while fetch is in progress', async () => {
    queueJob()
    await expect(check()).rejects.toThrow('PROJECT_SOURCE_REQUIRES_QUIESCENCE')
    expect(createGitSnapshot).not.toHaveBeenCalled()
    db.prepare("DELETE FROM product_deploy_job WHERE job_id='pjob_busy'").run()
    vi.mocked(createGitSnapshot).mockImplementationOnce(async () => {
      queueJob()
      return {
        repositoryUrl: 'https://github.com/example/api.git',
        commitSha: sha,
        rootDirectory: source,
        snapshotDirectory: source,
        cleanup
      }
    })
    await expect(check()).rejects.toThrow('PROJECT_SOURCE_REQUIRES_QUIESCENCE')
    expect(db.prepare('SELECT * FROM product_branch_observation').all()).toEqual([])
    expect(cleanup).toHaveBeenCalledOnce()
  })
  it('retains caller transaction ownership if one starts while waiting on Git', async () => {
    vi.mocked(createGitSnapshot).mockImplementationOnce(async () => {
      db.exec('BEGIN')
      return {
        repositoryUrl: 'https://github.com/example/api.git',
        commitSha: sha,
        rootDirectory: source,
        snapshotDirectory: source,
        cleanup
      }
    })
    await expect(check()).rejects.toThrow('PROJECT_SOURCE_REQUEST_INVALID')
    expect(db.inTransaction).toBe(true)
    expect(cleanup).toHaveBeenCalledOnce()
  })
  it('bounds the whole Git operation by a deadline and maps abort without exposing process errors', async () => {
    const deadline = new AbortController()
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(deadline.signal)
    try {
      vi.mocked(createGitSnapshot).mockImplementationOnce(
        ({ signal }) =>
          new Promise((_resolve, reject) => {
            signal!.addEventListener('abort', () => reject(new Error('raw-child-secret')), {
              once: true
            })
          })
      )
      const result = expect(check()).rejects.toThrow('PROJECT_SOURCE_DEADLINE')
      expect(timeout).toHaveBeenCalledWith(90_000)
      deadline.abort()
      await result
      expect(db.prepare('SELECT * FROM product_branch_observation').all()).toEqual([])
    } finally {
      timeout.mockRestore()
    }
  })
  it.each(['next', 'pg', 'env', 'unknown'])(
    'rejects unsupported source %s without persisting observation',
    async (kind) => {
      if (kind === 'env') writeFileSync(join(source, '.env.example'), 'API_SECRET=\n')
      else
        writeFileSync(
          join(source, 'package.json'),
          JSON.stringify({
            scripts: { start: 'node server.js' },
            dependencies: kind === 'unknown' ? {} : { express: '4.21.2', [kind]: '1.0.0' }
          })
        )
      await expect(check()).rejects.toThrow('PROJECT_SOURCE_UNSUPPORTED')
      expect(db.prepare('SELECT * FROM product_branch_observation').all()).toEqual([])
      expect(cleanup).toHaveBeenCalledOnce()
    }
  )
  it('enforces the shared per-file transfer quota before recording an observation', async () => {
    writeFileSync(join(source, 'large.bin'), Buffer.alloc(8 * 1024 * 1024 + 1))
    await expect(check()).rejects.toThrow('PROJECT_SOURCE_LIMIT_EXCEEDED')
    expect(db.prepare('SELECT * FROM product_branch_observation').all()).toEqual([])
    expect(cleanup).toHaveBeenCalledOnce()
  })
  it('rolls back observation and desired state if audit persistence fails', async () => {
    db.exec(
      "CREATE TRIGGER reject_source_audit BEFORE INSERT ON product_history_event BEGIN SELECT RAISE(ABORT,'synthetic-secret-do-not-export'); END"
    )
    await expect(check()).rejects.toThrow('PROJECT_SOURCE_STORAGE_UNAVAILABLE')
    expect(db.prepare('SELECT * FROM product_branch_observation').all()).toEqual([])
    expect(db.prepare('SELECT * FROM product_desired_branch').all()).toEqual([])
    expect(cleanup).toHaveBeenCalledOnce()
  })
  it('maps cleanup failures without exposing paths and retains a primary verification failure', async () => {
    cleanup.mockImplementationOnce(() => {
      throw new Error('private-path-secret')
    })
    await expect(check()).rejects.toThrow('PROJECT_SOURCE_STORAGE_UNAVAILABLE')
    expect(db.prepare('SELECT COUNT(*) AS n FROM product_branch_observation').get()).toEqual({
      n: 1
    })
    writeFileSync(join(source, '.env.example'), 'API_SECRET=\n')
    cleanup.mockImplementationOnce(() => {
      throw new Error('private-path-secret')
    })
    await expect(check()).rejects.toThrow('PROJECT_SOURCE_UNSUPPORTED')
    expect(cleanup).toHaveBeenCalledTimes(2)
  })
  it('does not export raw Git failure, cleans received mismatched snapshot and respects cancellation', async () => {
    vi.mocked(createGitSnapshot).mockRejectedValueOnce(new Error('stderr-secret-do-not-export'))
    await expect(check()).rejects.toThrow('PROJECT_SOURCE_FETCH_FAILED')
    const controller = new AbortController()
    controller.abort()
    await expect(
      verifyProductProjectSource(db, 'controller-test', request, { signal: controller.signal })
    ).rejects.toThrow('PROJECT_SOURCE_ABORTED')
    vi.mocked(createGitSnapshot).mockResolvedValueOnce({
      repositoryUrl: 'https://github.com/other/api.git',
      commitSha: sha,
      rootDirectory: source,
      snapshotDirectory: source,
      cleanup
    })
    await expect(check()).rejects.toThrow('PROJECT_SOURCE_FETCH_FAILED')
    expect(cleanup).toHaveBeenCalledOnce()
  })
})
