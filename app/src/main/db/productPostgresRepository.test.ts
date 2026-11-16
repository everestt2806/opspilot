import { reviewPostgresInspection } from '../controlPlane/productPostgresInspection'
import { ProductPostgresPreflight } from '../controlPlane/productPostgresPreflight'
import type { ProductPostgresInspectionInput } from '../../../../docs/contracts/product-postgres-inspection'
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import { initializeDatabase, closeDatabase } from './index'
import { readProjectConfigurationContext } from '../controlPlane/projectConfigurationContext'
import { ProductPostgresRepository } from './productPostgresRepository'
import type { ProductEnvironmentScope } from '../../../../docs/contracts/product-environment'
import { PRODUCT_POSTGRES_IMAGE } from '../controlPlane/productPostgres'
import { canonicalH2Json } from '../controlPlane/productH2Proof'
import {
  ProductPostgresCommands,
  assertProductPostgresTargetManifest
} from '../controlPlane/productPostgresCommands'
import {
  CONTROLLER_POSTGRES_IO_ASSET_TRANSITION,
  CONTROLLER_POSTGRES_ASSET_TRANSITION,
  CONTROLLER_ENVIRONMENT_ASSET_TRANSITION
} from '../controlPlane/controllerUpgradeAssets'
import type { VerifiedControllerBundle } from '../controlPlane/controllerBundle'
import { ProductPostgresSelection } from '../controlPlane/productPostgresSelection'
import { ProductEnvironmentRepository } from './productEnvironmentRepository'
import { ProductEnvironmentSelection } from '../controlPlane/productEnvironmentSelection'
import { ProductDeployRepository } from './productDeployRepository'
import { ProductRuntimeRepository } from './productRuntimeRepository'
import {
  ProductPostgresRuntime,
  renderProductPostgresTransfer
} from '../controlPlane/productPostgresRuntime'
import { h2ContextSchema } from '../controlPlane/productH2Proof'
import { stageProductSourceAndRenderWithSession } from '../controlPlane/productPipelineSourceRender'
import type { GuardedSshExecutionSession } from '../controlPlane/guardedSshSession'
import { readBoundProductEnvironmentSource } from '../controlPlane/productSourceBindings'
import type {
  ProductPostgresPrepareInput,
  ProductPostgresPrepareResult,
  ProductPostgresSelectionResult
} from '../../../../docs/contracts/product-postgres'

let directory: string,
  db: Database.Database,
  cipher: AesGcmCredentialCipher,
  store: ProductPostgresRepository
const connections: Database.Database[] = []
const source = canonicalH2Json({
    framework: 'express',
    host_port: 30000,
    container_port: 3000,
    healthcheck_path: '/health',
    needs_db: false
  }),
  hash = createHash('sha256').update(source).digest('hex')
const scope: ProductEnvironmentScope = {
  controller_id: 'postgres-test',
  app_id: 1,
  ownership_generation: 1,
  target: {
    vps_id: 1,
    host: 'example.test',
    port: 22,
    username: 'operator',
    auth_type: 'key',
    host_fingerprint: 'SHA256:' + 'A'.repeat(43),
    ssh_security_revision: 1
  }
}
const input = (): ProductPostgresPrepareInput => ({
  format: 1,
  request_key: randomUUID(),
  scope: structuredClone(scope),
  expected_source_generation: 1,
  expected_source_config_sha256: hash
})
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'opspilot-postgres-vault-'))
  db = initializeDatabase(directory, 'controller')
  db.prepare(
    "INSERT INTO vps(id,name,host,port,username,auth_type,host_fingerprint,encrypted_secret) VALUES(1,'fixture','example.test',22,'operator','key',?,X'00')"
  ).run(scope.target.host_fingerprint)
  db.exec(
    "INSERT INTO app(id,vps_id,name,framework,host_port,container_port,healthcheck_path,source_type,git_repo_url,git_ref,git_root) VALUES(1,1,'postgres-app','express',30000,3000,'/health','git','https://example.test/app.git','main','.');INSERT INTO product_controller VALUES('postgres-test','2026-11-16T00:00:00.000Z','active')"
  )
  db.prepare(
    "INSERT INTO product_source_config VALUES(1,1,'https://example.test/app.git','main','.',?,?,'2026-11-16T00:00:00.000Z')"
  ).run(source, hash)
  db.prepare(
    "INSERT INTO product_app_control(app_id,mode,controller_id,ownership_generation,source_generation,source_config_sha256,auto_deploy_paused,pause_reason,pause_policy_provenance,changed_at) VALUES(1,'product','postgres-test',1,1,?,1,'operator','explicit','2026-11-16T00:00:00.000Z')"
  ).run(hash)
  cipher = new AesGcmCredentialCipher(randomBytes(32))
  store = new ProductPostgresRepository(db, cipher)
})

function claimedDatabase(): {
  subject: ProductPostgresRuntime
  repository: ProductDeployRepository
  claim: import('../../../../docs/contracts/product-auto-deploy').ProductClaimToken
  metadata: import('../../../../docs/contracts/product-auto-deploy').ProductGitSnapshotMetadata
  key: Buffer
  resource: ProductPostgresPrepareResult
} {
  const resource = prepare(),
    selected = new ProductPostgresSelection(db, cipher).select(
      { ...input(), database_id: resource.metadata.database_id },
      scope.controller_id,
      'unix:1000'
    ),
    repository = new ProductDeployRepository(db),
    now = new Date().toISOString(),
    key = randomBytes(32)
  db.prepare(
    `INSERT INTO product_deploy_job(job_id,controller_id,app_id,ownership_generation,source_generation,source_config_sha256,trigger,idempotency_key,ref,target_sha,state,available_at,created_at,updated_at)
    VALUES('pg-job',?,1,1,2,?,'manual_redeploy','pg-request','main',?,'queued',?,?,?)`
  ).run(scope.controller_id, selected.source_config_sha256, 'a'.repeat(40), now, now, now)
  const result = repository.claimNextJob(scope.controller_id)
  if (result.state !== 'claimed') throw Error('PG_CLAIM_FIXTURE_FAILED')
  const claim = result.claim,
    metadata = {
      repositoryUrl: 'https://example.test/app.git',
      repositoryRoot: '.',
      commitSha: 'a'.repeat(40),
      sourceConfigSha256: selected.source_config_sha256
    }
  expect(repository.markGitSnapshotVerified(claim, metadata).state).toBe('snapshot_verified')
  return {
    subject: new ProductPostgresRuntime(db, repository, cipher, claim, () => Buffer.from(key)),
    repository,
    claim,
    metadata,
    key,
    resource
  }
}

describe('Product PostgreSQL claim runtime', () => {
  it('binds generated resource to exact claim/target/source and H2 context without secrets', () => {
    const f = claimedDatabase(),
      resolved = f.subject.resolve()!
    expect(resolved.reference.database_id).toBe(f.resource.metadata.database_id)
    expect(resolved.credentials).toEqual(
      store.readCredentials(scope, f.resource.metadata.database_id)
    )
    const started = f.repository.beginGitDispatch(f.claim, f.metadata)
    if (started.state !== 'dispatch_authorized') throw Error('PG_DISPATCH_FIXTURE_FAILED')
    expect(f.subject.resolve(started.deployment_id)?.credentials).toEqual(resolved.credentials)
    expect(() => f.subject.resolve()).toThrow('PRODUCT_POSTGRES_UNAVAILABLE')
    const context = new ProductRuntimeRepository(db, { secret: f.key }).createContext(
      f.claim,
      started.deployment_id,
      {
        state: 'build_failed_definite',
        image_tag: started.image_tag,
        target_sha: f.metadata.commitSha,
        exit_code: 1
      }
    )
    expect(context.database).toEqual(resolved.reference)
    for (const value of Object.values(resolved.credentials))
      expect(JSON.stringify(context)).not.toContain(value)
    expect(
      h2ContextSchema.safeParse({
        ...context,
        database: { ...context.database, ownership_generation: 2 }
      }).success
    ).toBe(false)
  })
  it('signs a nonce-blinded private comment, clears key copy and rejects expired signing capability', () => {
    const f = claimedDatabase(),
      resolved = f.subject.resolve()!,
      first = renderProductPostgresTransfer(resolved),
      second = renderProductPostgresTransfer(resolved),
      { payload, signature } = JSON.parse(first.slice('# opspilot-managed-postgres-v1 '.length)),
      key = createHmac('sha256', f.key).update('opspilot-postgres-transfer-key-v1').digest()
    expect(first).not.toBe(second)
    expect(signature).toBe(
      createHmac('sha256', key)
        .update('opspilot-postgres-transfer-v1\n')
        .update(canonicalH2Json(payload))
        .digest('hex')
    )
    db.exec("UPDATE product_app_lease SET expires_at='2026-01-01T00:00:00Z'")
    expect(() => renderProductPostgresTransfer(resolved)).toThrow()
  })
  it.each([
    'UPDATE vps SET ssh_security_revision=2',
    "UPDATE product_controller SET status='maintenance'",
    'UPDATE product_app_control SET ownership_generation=2',
    'UPDATE product_app_control SET source_generation=1,source_config_sha256=(SELECT config_sha256 FROM product_source_config WHERE source_generation=1)',
    "UPDATE product_app_lease SET expires_at='2026-01-01T00:00:00Z'"
  ])('rejects changed authority before decrypt: %s', (sql) => {
    const f = claimedDatabase(),
      decrypt = vi.spyOn(cipher, 'decrypt')
    db.exec(sql)
    expect(() => f.subject.resolve()).toThrow('PRODUCT_POSTGRES_UNAVAILABLE')
    expect(decrypt).not.toHaveBeenCalled()
  })
  it('rechecks authority after decrypt and never exposes raw cipher errors', () => {
    const f = claimedDatabase(),
      decrypt = cipher.decrypt.bind(cipher)
    vi.spyOn(cipher, 'decrypt').mockImplementation((value) => {
      const result = decrypt(value)
      db.exec('UPDATE vps SET ssh_security_revision=2')
      return result
    })
    expect(() => f.subject.resolve()).toThrow('PRODUCT_POSTGRES_UNAVAILABLE')
  })
  it('stages exactly three render files, keeps credential outside Dockerfile/source and omits secret manifest digest', async () => {
    const f = claimedDatabase(),
      sourceRoot = join(directory, 'source')
    mkdirSync(sourceRoot)
    writeFileSync(
      join(sourceRoot, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        scripts: { start: 'node server.js' },
        dependencies: { express: '^4.21.2', pg: '^8.13.0' }
      })
    )
    writeFileSync(
      join(sourceRoot, 'server.js'),
      "const express=require('express');const {Pool}=require('pg');const db=new Pool({connectionString:process.env.DATABASE_URL});const app=express();app.get('/health',(req,res)=>res.send('ok'));app.listen(3000)"
    )
    const started = f.repository.beginGitDispatch(f.claim, f.metadata)
    if (started.state !== 'dispatch_authorized') throw Error('PG_DISPATCH_FIXTURE_FAILED')
    const received: Record<string, Buffer[]> = {}
    let current = ''
    const session = {
      deploymentId: started.deployment_id,
      beginTransferScope: vi.fn(),
      completeTransferScope: vi.fn(),
      finishTransferFile: vi.fn(),
      beginTransferFile: vi.fn(
        async (transferScope: string, path: string, _size: number, mode: number) => {
          current = transferScope + '/' + path
          received[current] = []
          if (path === '.env') expect(mode).toBe(0o600)
        }
      ),
      writeTransferChunk: vi.fn(async (_index: number, bytes: Buffer) => {
        received[current].push(Buffer.from(bytes))
      })
    } as unknown as GuardedSshExecutionSession
    const result = await stageProductSourceAndRenderWithSession(
        session,
        db,
        {
          claim: f.claim,
          metadata: f.metadata,
          rootDirectory: sourceRoot,
          snapshotDirectory: sourceRoot,
          cleanup: vi.fn()
        },
        { postgres: f.subject }
      ),
      text = (path: string): string => Buffer.concat(received[path]).toString('utf8'),
      credentials = store.readCredentials(scope, f.resource.metadata.database_id)
    expect(result.render_file_count).toBe(3)
    expect(result.render_manifest_sha256).toBeNull()
    for (const secret of Object.values(credentials)) {
      expect(text('render/.env')).toContain(secret)
      for (const path of Object.keys(received).filter((p) => p !== 'render/.env'))
        expect(text(path)).not.toContain(secret)
      expect(JSON.stringify(result)).not.toContain(secret)
    }
  })
})

describe('Product PostgreSQL source selection primitive', () => {
  it('selects once with source CAS, keeps pause and credentials, and never starts a job', () => {
    const resource = prepare(),
      selection = new ProductPostgresSelection(db, cipher)
    const request = { ...input(), database_id: resource.metadata.database_id },
      before = store.readCredentials(scope, resource.metadata.database_id)
    const result = selection.select(request, scope.controller_id, 'unix:1000')
    expect(result).toMatchObject({
      state: 'selected',
      source_generation: 2,
      auto_deploy_paused: true,
      deployment_started: false
    })
    expect(db.prepare('SELECT needs_db,current_deployment_id FROM app').get()).toEqual({
      needs_db: 1,
      current_deployment_id: null
    })
    expect(store.readCredentials(scope, resource.metadata.database_id)).toEqual(before)
    expect(selection.select(request, scope.controller_id, 'unix:1000')).toEqual({
      ...result,
      state: 'already_selected'
    })
    expect(selection.lookup(request, scope.controller_id, 'unix:1000')).toEqual({
      result,
      is_current: true,
      definitively_unapplied: false
    })
    expect(db.prepare('SELECT count(*) n FROM product_deploy_job').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT count(*) n FROM product_source_postgres').get()).toEqual({ n: 1 })
  })
  it('database selection inherits env revision without copying the env request UUID', () => {
    const resource = prepare(),
      vault = new ProductEnvironmentRepository(db, cipher),
      envs = new ProductEnvironmentSelection(db, cipher)
    vault.append({
      scope,
      expected_latest_revision: null,
      expected_source_generation: 1,
      expected_source_config_sha256: hash,
      values: { runtime_env: { APP_MODE: 'fixture' }, public_build_args: {} }
    })
    const env = envs.select(
      { ...input(), expected_latest_revision: 1, environment_revision: 1 },
      scope.controller_id,
      'unix:1000'
    )
    const selection = new ProductPostgresSelection(db, cipher),
      databaseRequest = {
        ...input(),
        expected_source_generation: env.source_generation,
        expected_source_config_sha256: env.source_config_sha256,
        database_id: resource.metadata.database_id
      },
      result = selection.select(databaseRequest, scope.controller_id, 'unix:1000')
    expect(result.source_generation).toBe(3)
    expect(db.prepare('SELECT count(*) n FROM product_source_environment').get()).toEqual({ n: 1 })
    const binding = readBoundProductEnvironmentSource(
      db,
      scope,
      3,
      result.source_config_sha256,
      env.environment,
      result.database
    )
    expect(binding.basis_source_generation).toBe(2)
    expect(binding.environment_revision).toBe(1)
    expect(vault.readValues(scope, 1).runtime_env).toEqual({ APP_MODE: 'fixture' })
    const credentials = store.readCredentials(scope, resource.metadata.database_id)
    vault.append({
      scope,
      expected_latest_revision: 1,
      expected_source_generation: 3,
      expected_source_config_sha256: result.source_config_sha256,
      values: { runtime_env: { APP_MODE: 'updated' }, public_build_args: {} }
    })
    const next = envs.select(
      {
        ...input(),
        expected_source_generation: 3,
        expected_source_config_sha256: result.source_config_sha256,
        expected_latest_revision: 2,
        environment_revision: 2
      },
      scope.controller_id,
      'unix:1000'
    )
    expect(next.source_generation).toBe(4)
    const current = JSON.parse(
      (
        db
          .prepare(
            'SELECT deploy_config_json FROM product_source_config WHERE app_id=1 AND source_generation=4'
          )
          .get() as { deploy_config_json: string }
      ).deploy_config_json
    )
    expect(current.database).toEqual(result.database)
    expect(current.environment).toEqual(next.environment)
    expect(
      readBoundProductEnvironmentSource(
        db,
        scope,
        4,
        next.source_config_sha256,
        next.environment,
        result.database
      ).basis_source_generation
    ).toBe(4)
    expect(store.readCredentials(scope, resource.metadata.database_id)).toEqual(credentials)
    expect(selection.lookup(databaseRequest, scope.controller_id, 'unix:1000')).toMatchObject({
      is_current: false,
      definitively_unapplied: false
    })
    expect(() => selection.select(databaseRequest, scope.controller_id, 'unix:1000')).toThrow(
      'PRODUCT_POSTGRES_AUTHORITY_CHANGED'
    )
  })
  it('new request for the selected database records receipt without advancing source or recreating identity', () => {
    const resource = prepare(),
      selection = new ProductPostgresSelection(db, cipher)
    const first = selection.select(
      { ...input(), database_id: resource.metadata.database_id },
      scope.controller_id,
      'unix:1000'
    )
    const result = selection.select(
      {
        ...input(),
        expected_source_generation: first.source_generation,
        expected_source_config_sha256: first.source_config_sha256,
        database_id: resource.metadata.database_id
      },
      scope.controller_id,
      'unix:1000'
    )
    expect(result.state).toBe('already_selected')
    expect(result.source_generation).toBe(first.source_generation)
    expect(db.prepare('SELECT count(*) n FROM product_source_config').get()).toEqual({ n: 2 })
    expect(db.prepare('SELECT count(*) n FROM product_managed_postgres').get()).toEqual({ n: 1 })
    expect(db.prepare('SELECT count(*) n FROM product_postgres_selection_request').get()).toEqual({
      n: 2
    })
  })
  it('pending helper barrier blocks database selection without source mutation', () => {
    const resource = prepare(),
      selection = new ProductPostgresSelection(db, cipher)
    db.prepare(
      `INSERT INTO product_target_enrollment(controller_id,app_id,ownership_generation,target_binding_json,manifest_sha256,target_root,state,last_error_code,created_at,updated_at)
      VALUES(?,1,1,?,?,'/private-fixture','unknown',?,'2026-11-16T00:00:00.000Z','2026-11-16T00:00:00.000Z')`
    ).run(
      scope.controller_id,
      canonicalH2Json(scope.target),
      'a'.repeat(64),
      'TARGET_HELPER_UPGRADE_PENDING:' + randomUUID()
    )
    expect(() =>
      selection.select(
        { ...input(), database_id: resource.metadata.database_id },
        scope.controller_id,
        'unix:1000'
      )
    ).toThrow('PRODUCT_POSTGRES_REQUIRES_QUIESCENCE')
    expect(db.prepare('SELECT needs_db FROM app').get()).toEqual({ needs_db: 0 })
    expect(db.prepare('SELECT count(*) n FROM product_source_postgres').get()).toEqual({ n: 0 })
  })
  it('stale CAS or invalid resource cannot advance source or enable DB', () => {
    const resource = prepare(),
      selection = new ProductPostgresSelection(db, cipher)
    expect(() =>
      selection.select(
        { ...input(), expected_source_generation: 2, database_id: resource.metadata.database_id },
        scope.controller_id,
        'unix:1000'
      )
    ).toThrow('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
    expect(() =>
      selection.select({ ...input(), database_id: randomUUID() }, scope.controller_id, 'unix:1000')
    ).toThrow('PRODUCT_POSTGRES_UNAVAILABLE')
    expect(db.prepare('SELECT needs_db FROM app').get()).toEqual({ needs_db: 0 })
    expect(db.prepare('SELECT count(*) n FROM product_source_config').get()).toEqual({ n: 1 })
  })
})
afterEach(() => {
  for (const c of connections.splice(0)) if (c.open) c.close()
  closeDatabase()
  rmSync(directory, { recursive: true, force: true })
  vi.restoreAllMocks()
})
const prepare = (request = input()): ProductPostgresPrepareResult =>
  store.prepare(request, scope.controller_id, 'unix:1000')
describe('Managed PostgreSQL immutable encrypted preparation', () => {
  it('generates separate credentials, metadata only, and never activates source/jobs/deployments', () => {
    const before = db.prepare('SELECT * FROM product_app_control').get(),
      result = prepare()
    expect(result.metadata).toMatchObject({
      engine: 'postgresql',
      major: 16,
      image: PRODUCT_POSTGRES_IMAGE,
      provisioning: 'prepared',
      application_user: 'opspilot',
      administrator_user: 'postgres'
    })
    const secret = store.readCredentials(scope, result.metadata.database_id)
    expect(secret.administrator_password).not.toBe(secret.application_password)
    for (const value of Object.values(secret)) {
      expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(JSON.stringify(result)).not.toContain(value)
    }
    expect(JSON.stringify(result)).not.toMatch(/encrypted_secret|auth_tag|password/)
    expect(db.prepare('SELECT * FROM product_app_control').get()).toEqual(before)
    for (const t of [
      'product_deploy_job',
      'deployment',
      'product_history_event',
      'product_source_environment'
    ])
      expect(db.prepare('SELECT count(*) n FROM ' + t).get()).toEqual({ n: 0 })
    expect(existsSync(join(directory, '.controller-runtime-key'))).toBe(false)
    db.pragma('wal_checkpoint(FULL)')
    const bytes = Buffer.concat(
      ['opspilot.db', 'opspilot.db-wal']
        .filter((n) => existsSync(join(directory, n)))
        .map((n) => readFileSync(join(directory, n)))
    )
    for (const value of Object.values(secret))
      expect(bytes.includes(Buffer.from(value))).toBe(false)
  })
  it('same request and distinct second request keep the same resource and credentials across two connections', () => {
    const request = input(),
      first = prepare(request),
      secret = store.readCredentials(scope, first.metadata.database_id)
    const other = new Database(join(directory, 'opspilot.db'))
    connections.push(other)
    other.pragma('foreign_keys=ON')
    const second = new ProductPostgresRepository(other, cipher)
    expect(second.prepare(request, scope.controller_id, 'unix:1000')).toEqual({
      ...first,
      state: 'already_prepared'
    })
    expect(
      second.prepare({ ...request, request_key: randomUUID() }, scope.controller_id, 'unix:1000')
        .metadata
    ).toEqual(first.metadata)
    expect(second.readCredentials(scope, first.metadata.database_id)).toEqual(secret)
    expect(db.prepare('SELECT count(*) n FROM product_managed_postgres').get()).toEqual({ n: 1 })
    expect(db.prepare('SELECT count(*) n FROM product_managed_postgres_request').get()).toEqual({
      n: 2
    })
  })
  it('source generation advance preserves DB identity and passwords; stale prepare is rejected', () => {
    const request = input(),
      first = prepare(request),
      secret = store.readCredentials(scope, first.metadata.database_id)
    const next = '{"framework":"express","healthcheck_path":"/health"}',
      digest = createHash('sha256').update(next).digest('hex')
    db.transaction(() => {
      db.prepare(
        "INSERT INTO product_source_config VALUES(1,2,'https://example.test/app.git','main','.',?,?,'2026-11-16T01:00:00.000Z')"
      ).run(next, digest)
      db.prepare(
        'UPDATE product_app_control SET source_generation=2,source_config_sha256=? WHERE app_id=1'
      ).run(digest)
    })()
    expect(() => prepare()).toThrow('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
    expect(() =>
      prepare({ ...request, expected_source_generation: 2, expected_source_config_sha256: digest })
    ).toThrow('PRODUCT_POSTGRES_REQUEST_CONFLICT')
    expect(
      prepare({ ...input(), expected_source_generation: 2, expected_source_config_sha256: digest })
        .metadata
    ).toEqual(first.metadata)
    expect(store.readCredentials(scope, first.metadata.database_id)).toEqual(secret)
  })
  it('framework drift refuses the retained resource without creating a new receipt', () => {
    const request = input()
    prepare(request)
    db.prepare("UPDATE app SET framework='nextjs' WHERE id=1").run()
    expect(() => prepare(request)).toThrow('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
    expect(db.prepare('SELECT count(*) n FROM product_managed_postgres_request').get()).toEqual({
      n: 1
    })
  })
  it.each(['unpaused', 'archived', 'owner', 'target', 'framework', 'controller'] as const)(
    'rejects changed %s before decrypt',
    (change) => {
      const first = prepare(),
        spy = vi.spyOn(cipher, 'decrypt')
      if (change === 'unpaused')
        db.exec('UPDATE product_app_control SET auto_deploy_paused=0,pause_reason=NULL')
      if (change === 'archived') db.exec("UPDATE vps SET archived_at='2026-11-16T00:01:00Z'")
      if (change === 'owner') db.exec('UPDATE product_app_control SET ownership_generation=2')
      if (change === 'target') db.exec('UPDATE vps SET port=2222')
      if (change === 'framework') db.exec("UPDATE app SET framework='static-spa'")
      if (change === 'controller') db.exec("UPDATE product_controller SET status='revoked'")
      expect(() => prepare()).toThrow(/PRODUCT_POSTGRES_/)
      expect(spy).not.toHaveBeenCalled()
      if (change !== 'unpaused')
        expect(() => store.readCredentials(scope, first.metadata.database_id)).toThrow(
          /PRODUCT_POSTGRES_/
        )
    }
  )
  it('missing/wrong key cannot prepare/decrypt and no key file is initialized', () => {
    expect(() =>
      new ProductPostgresRepository(db, undefined as unknown as AesGcmCredentialCipher).prepare(
        input(),
        scope.controller_id,
        'unix:1000'
      )
    ).toThrow('PRODUCT_POSTGRES_UNAVAILABLE')
    expect(db.prepare('SELECT count(*) n FROM product_managed_postgres').get()).toEqual({ n: 0 })
    const first = prepare(),
      wrong = new ProductPostgresRepository(db, new AesGcmCredentialCipher(randomBytes(32)))
    expect(() => wrong.readCredentials(scope, first.metadata.database_id)).toThrow(
      'PRODUCT_POSTGRES_UNAVAILABLE'
    )
    expect(() => wrong.prepare(input(), scope.controller_id, 'unix:1000')).toThrow(
      'PRODUCT_POSTGRES_UNAVAILABLE'
    )
    expect(existsSync(join(directory, '.controller-runtime-key'))).toBe(false)
  })
  it('cipher failure and authority change during encryption leave no resource or receipt', () => {
    const encrypt = cipher.encrypt.bind(cipher)
    vi.spyOn(cipher, 'encrypt').mockImplementation((value) => {
      db.exec('UPDATE product_app_control SET ownership_generation=2')
      return encrypt(value)
    })
    expect(() => prepare()).toThrow(/PRODUCT_POSTGRES_/)
    expect(db.prepare('SELECT ownership_generation g FROM product_app_control').get()).toEqual({
      g: 1
    })
    for (const t of ['product_managed_postgres', 'product_managed_postgres_request'])
      expect(db.prepare('SELECT count(*) n FROM ' + t).get()).toEqual({ n: 0 })
  })
  it('caller transaction remains owned and unchanged after refusal', () => {
    db.exec('BEGIN')
    db.exec("UPDATE app SET name='caller-change'")
    expect(() => prepare()).toThrow('PRODUCT_POSTGRES_INPUT_INVALID')
    expect(db.inTransaction).toBe(true)
    expect(db.prepare('SELECT name FROM app').get()).toEqual({ name: 'caller-change' })
    db.exec('ROLLBACK')
  })
  it('SQL cannot mutate or delete resource/receipt, and rejects app deletion', () => {
    prepare()
    expect(() => db.exec("UPDATE product_managed_postgres SET image='wrong'")).toThrow(/immutable/)
    expect(() => db.exec('DELETE FROM product_managed_postgres')).toThrow(/retained/)
    expect(() => db.exec('DELETE FROM product_managed_postgres_request')).toThrow(/retained/)
    expect(() => db.exec('DELETE FROM app WHERE id=1')).toThrow()
  })
  it.each(['purpose', 'target', 'image', 'equal_passwords'] as const)(
    'rejects valid encrypted envelope with wrong %s binding',
    (change) => {
      const first = prepare()
      const row = db.prepare('SELECT * FROM product_managed_postgres').get() as Parameters<
        AesGcmCredentialCipher['decrypt']
      >[0]
      const payload = JSON.parse(cipher.decrypt(row))
      if (change === 'purpose') payload.purpose = 'different-component'
      if (change === 'target') payload.target.host = 'other.test'
      if (change === 'image') payload.metadata.image = 'postgres:16-alpine@sha256:' + '0'.repeat(64)
      if (change === 'equal_passwords')
        payload.credentials.application_password = payload.credentials.administrator_password
      const changed = cipher.encrypt(JSON.stringify(payload))
      // Test a misplaced but cryptographically valid same-controller-key envelope.
      db.exec('DROP TRIGGER product_managed_postgres_immutable')
      db.prepare('UPDATE product_managed_postgres SET encrypted_secret=?,iv=?,auth_tag=?').run(
        changed.encrypted_secret,
        changed.iv,
        changed.auth_tag
      )
      expect(() => store.readCredentials(scope, first.metadata.database_id)).toThrow(
        'PRODUCT_POSTGRES_UNAVAILABLE'
      )
    }
  )
  it('reopens retained identity with the original key and refuses caller transaction credential reads', () => {
    const first = prepare(),
      secret = store.readCredentials(scope, first.metadata.database_id)
    closeDatabase()
    db = new Database(join(directory, 'opspilot.db'))
    connections.push(db)
    db.pragma('foreign_keys=ON')
    store = new ProductPostgresRepository(db, cipher)
    expect(store.state({ format: 1, scope })).toEqual(first.metadata)
    expect(store.readCredentials(scope, first.metadata.database_id)).toEqual(secret)
    db.exec('BEGIN')
    expect(() => store.readCredentials(scope, first.metadata.database_id)).toThrow(
      'PRODUCT_POSTGRES_INPUT_INVALID'
    )
    expect(db.inTransaction).toBe(true)
    db.exec('ROLLBACK')
  })
})

describe('Managed PostgreSQL public selection boundary', () => {
  const policy = CONTROLLER_POSTGRES_IO_ASSET_TRANSITION[0]
  const manifest = (asset: { size: number; sha256: string } = policy.after): Buffer =>
    Buffer.from(
      JSON.stringify({
        format: 1,
        node_major: 22,
        files: [{ path: policy.path.replace(/^payload\//, ''), ...asset }]
      })
    )
  const setup = (): {
    commands: ProductPostgresCommands
    inspect: ReturnType<
      typeof vi.fn<(_scope: ProductEnvironmentScope, _signal: AbortSignal) => Promise<Buffer>>
    >
    request: import('../../../../docs/contracts/product-postgres').ProductPostgresSelectionInput
  } => {
    const resource = prepare(),
      request = { ...input(), database_id: resource.metadata.database_id },
      inspect = vi
        .fn<(_scope: ProductEnvironmentScope, _signal: AbortSignal) => Promise<Buffer>>()
        .mockResolvedValue(manifest())
    // No production artifact/probe seam is exposed through the CLI. This is SQL/TOCTOU composition only.
    const bundle = {} as VerifiedControllerBundle
    return {
      commands: new ProductPostgresCommands(
        db,
        cipher,
        directory,
        scope.controller_id,
        'unix:1000',
        bundle,
        { inspectTarget: inspect }
      ),
      inspect,
      request
    }
  }
  it('requires the exact IO-hardened PostgreSQL capability and rejects missing/duplicate/tampered/older manifests', () => {
    expect(() => assertProductPostgresTargetManifest(manifest())).not.toThrow()
    for (const asset of [
      CONTROLLER_POSTGRES_ASSET_TRANSITION[0].after,
      CONTROLLER_ENVIRONMENT_ASSET_TRANSITION[0].after,
      { ...policy.after, size: 1 },
      { ...policy.after, sha256: 'f'.repeat(64) }
    ])
      expect(() => assertProductPostgresTargetManifest(manifest(asset))).toThrow(
        'HELPER_UPGRADE_REQUIRED'
      )
    for (const value of [
      {},
      { format: 1, node_major: 22, files: [] },
      {
        ...JSON.parse(manifest().toString()),
        files: [
          ...JSON.parse(manifest().toString()).files,
          ...JSON.parse(manifest().toString()).files
        ]
      }
    ])
      expect(() => assertProductPostgresTargetManifest(Buffer.from(JSON.stringify(value)))).toThrow(
        'HELPER_UPGRADE_REQUIRED'
      )
  })
  it('reviews without selecting or claiming a running database and replays an exact receipt offline', async () => {
    const { commands, inspect, request } = setup()
    const before = db.prepare('SELECT * FROM product_app_control').get()
    db.pragma('query_only=ON')
    const review = await commands.review(request)
    expect(review).toMatchObject({
      metadata: { provisioning: 'prepared' },
      auto_deploy_paused: true,
      deployment_started: false
    })
    expect(db.prepare('SELECT * FROM product_app_control').get()).toEqual(before)
    db.pragma('query_only=OFF')
    const selected = await commands.select(request)
    inspect.mockRejectedValue(Error('SYNTHETIC_OFFLINE_SECRET'))
    expect(await commands.select(request)).toEqual({ ...selected, state: 'already_selected' })
    expect(commands.lookup(request)).toMatchObject({ result: selected, is_current: true })
    expect(inspect).toHaveBeenCalledTimes(2)
    expect(db.prepare('SELECT count(*) n FROM product_deploy_job').get()).toEqual({ n: 0 })
  })
  it('rejects old helpers before source or needs_db changes', async () => {
    const { commands, inspect, request } = setup()
    inspect.mockResolvedValue(manifest(CONTROLLER_ENVIRONMENT_ASSET_TRANSITION[0].after))
    await expect(commands.select(request)).rejects.toThrow('HELPER_UPGRADE_REQUIRED')
    expect(db.prepare('SELECT count(*) n FROM product_source_postgres').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT needs_db FROM app').get()).toEqual({ needs_db: 0 })
  })
  it('rechecks source CAS when a second selection wins during the target probe', async () => {
    const { commands, inspect, request } = setup()
    inspect.mockImplementation(async () => {
      new ProductPostgresSelection(db, cipher).select(
        { ...request, request_key: randomUUID() },
        scope.controller_id,
        'unix:1000'
      )
      return manifest()
    })
    await expect(commands.select(request)).rejects.toThrow('AUTHORITY_CHANGED')
    expect(db.prepare('SELECT count(*) n FROM product_postgres_selection_request').get()).toEqual({
      n: 1
    })
  })
  it('rechecks pause and ownership after the probe before source selection', async () => {
    const { commands, inspect, request } = setup()
    inspect.mockImplementation(async () => {
      db.exec(
        "UPDATE product_app_control SET auto_deploy_paused=0,pause_reason=NULL,pause_policy_provenance='explicit'"
      )
      return manifest()
    })
    await expect(commands.select(request)).rejects.toThrow('PRODUCT_POSTGRES_')
    expect(db.prepare('SELECT count(*) n FROM product_source_postgres').get()).toEqual({ n: 0 })
  })
  it('redacts transport faults and aborts without source changes', async () => {
    const { commands, inspect, request } = setup()
    inspect.mockRejectedValue(Error('SYNTHETIC_RAW_TRANSPORT_SECRET'))
    await expect(commands.select(request)).rejects.toThrow('PRODUCT_POSTGRES_UNAVAILABLE')
    const abort = new AbortController()
    abort.abort()
    await expect(commands.select(request, abort.signal)).rejects.toThrow(
      'PRODUCT_POSTGRES_UNAVAILABLE'
    )
    expect(inspect).toHaveBeenCalledOnce()
    expect(db.prepare('SELECT count(*) n FROM product_source_postgres').get()).toEqual({ n: 0 })
  })
})

describe('Project configuration metadata anchored to registration', () => {
  const context = (overrides: object = {}): ReturnType<typeof readProjectConfigurationContext> =>
    readProjectConfigurationContext(db, cipher, scope.controller_id, 'unix:1000', {
      format: 1,
      controller_id: scope.controller_id,
      app_id: 1,
      expected_ownership_generation: 1,
      expected_source_generation: 1,
      expected_source_config_sha256: hash,
      expected_target_security_revision: 1,
      ...overrides
    })
  const selectDatabase = (): ProductPostgresSelectionResult => {
    const row = db
      .prepare('SELECT source_generation,source_config_sha256 FROM product_app_control')
      .get() as { source_generation: number; source_config_sha256: string }
    const resource = store.prepare(
      {
        ...input(),
        expected_source_generation: row.source_generation,
        expected_source_config_sha256: row.source_config_sha256
      },
      scope.controller_id,
      'unix:1000'
    )
    return new ProductPostgresSelection(db, cipher).select(
      {
        ...input(),
        expected_source_generation: row.source_generation,
        expected_source_config_sha256: row.source_config_sha256,
        database_id: resource.metadata.database_id
      },
      scope.controller_id,
      'unix:1000'
    )
  }
  const selectEnv = (): void => {
    const row = db
      .prepare('SELECT source_generation,source_config_sha256 FROM product_app_control')
      .get() as { source_generation: number; source_config_sha256: string }
    new ProductEnvironmentRepository(db, cipher).append({
      scope,
      expected_latest_revision: null,
      expected_source_generation: row.source_generation,
      expected_source_config_sha256: row.source_config_sha256,
      values: { runtime_env: { APP_MODE: 'CONTEXT_SYNTHETIC_VALUE' }, public_build_args: {} }
    })
    new ProductEnvironmentSelection(db, cipher).select(
      {
        ...input(),
        expected_source_generation: row.source_generation,
        expected_source_config_sha256: row.source_config_sha256,
        expected_latest_revision: 1,
        environment_revision: 1
      },
      scope.controller_id,
      'unix:1000'
    )
  }
  it('keeps an empty registration readonly and distinguishes prepared database from selected database', () => {
    expect(context()).toMatchObject({
      source_generation: 1,
      basis_source_generation: 1,
      database: { prepared: null, selected: null },
      environment: { latest: null, selected: null },
      deployment_started: false
    })
    const prepared = prepare()
    expect(context().database).toEqual({ prepared: prepared.metadata, selected: null })
    expect(db.prepare('SELECT count(*) n FROM product_deploy_job').get()).toEqual({ n: 0 })
  })
  it.each(['database-only', 'env-before-database', 'database-before-env'])(
    'reviews %s using the immutable original basis without credentials or source mutation',
    (order) => {
      if (order === 'env-before-database') selectEnv()
      const selected = selectDatabase()
      if (order === 'database-before-env') selectEnv()
      const before = db.serialize()
      const result = context()
      expect(result.source_generation).toBe(order === 'database-only' ? 2 : 3)
      expect(result.database.selected?.database_id).toBe(selected.database.database_id)
      expect(result.database.prepared).toEqual(result.database.selected)
      expect(result.environment.selected?.revision ?? null).toBe(
        order === 'database-only' ? null : 1
      )
      expect(result.scope.target.auth_type).toBe('key')
      expect(result.auto_deploy_paused).toBe(true)
      expect(result.deployment_started).toBe(false)
      const credentials = store.readCredentials(scope, selected.database.database_id)
      for (const secret of Object.values(credentials))
        expect(JSON.stringify(result)).not.toContain(secret)
      expect(JSON.stringify(result)).not.toContain('CONTEXT_SYNTHETIC_VALUE')
      expect(db.serialize()).toEqual(before)
    }
  )
  it.each([
    { expected_source_config_sha256: '0'.repeat(64) },
    { expected_target_security_revision: 2 },
    { expected_ownership_generation: 2 },
    { controller_id: 'foreign-controller' },
    { expected_source_generation: 2 }
  ])('rejects changed registration/target/ownership authority %#', (patch) => {
    expect(() => context(patch)).toThrow('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
  })
  it('rejects repository drift and new deployment-plan source even when its hash is valid', () => {
    const changed = canonicalH2Json({
      framework: 'express',
      host_port: 30000,
      container_port: 4000,
      healthcheck_path: '/health',
      needs_db: false
    })
    const changedHash = createHash('sha256').update(changed).digest('hex')
    db.prepare(
      "INSERT INTO product_source_config VALUES(1,2,'https://example.test/app.git','main','.',?,?,'2026-11-16T00:01:00.000Z')"
    ).run(changed, changedHash)
    db.prepare('UPDATE product_app_control SET source_generation=2,source_config_sha256=?').run(
      changedHash
    )
    db.prepare('UPDATE app SET container_port=4000').run()
    expect(() => context()).toThrow('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
    db.prepare("UPDATE app SET git_repo_url='https://example.test/other.git'").run()
    expect(() => context()).toThrow('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
  })
  it('rejects a missing/wrong credential key and refuses to borrow a caller transaction', () => {
    selectDatabase()
    const values = {
      format: 1,
      controller_id: scope.controller_id,
      app_id: 1,
      expected_ownership_generation: 1,
      expected_source_generation: 1,
      expected_source_config_sha256: hash,
      expected_target_security_revision: 1
    }
    expect(() =>
      readProjectConfigurationContext(
        db,
        new AesGcmCredentialCipher(randomBytes(32)),
        scope.controller_id,
        'unix:1000',
        values
      )
    ).toThrow('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
    db.exec('BEGIN')
    expect(() => context()).toThrow('PRODUCT_POSTGRES_INPUT_INVALID')
    expect(db.inTransaction).toBe(true)
    db.exec('ROLLBACK')
  })
})

describe('Exact PostgreSQL prepare receipt recovery', () => {
  it('does not equate receipt absence with non-application, even when the resource exists from another UUID', () => {
    const pending = input()
    expect(store.lookupPrepare(pending, scope.controller_id, 'unix:1000')).toEqual({
      result: null,
      definitively_unapplied: false
    })
    const created = prepare()
    expect(store.lookupPrepare(pending, scope.controller_id, 'unix:1000')).toEqual({
      result: null,
      definitively_unapplied: false
    })
    new ProductPostgresSelection(db, cipher).select(
      { ...input(), database_id: created.metadata.database_id },
      scope.controller_id,
      'unix:1000'
    )
    expect(store.lookupPrepare(pending, scope.controller_id, 'unix:1000')).toEqual({
      result: null,
      definitively_unapplied: true
    })
  })
  it('reads the exact positive receipt after selection and during a queued job without writing or replaying prepare', () => {
    const pending = input(),
      created = store.prepare(pending, scope.controller_id, 'unix:1000')
    const selected = new ProductPostgresSelection(db, cipher).select(
      { ...input(), database_id: created.metadata.database_id },
      scope.controller_id,
      'unix:1000'
    )
    db.prepare(
      `INSERT INTO product_deploy_job(job_id,controller_id,app_id,ownership_generation,source_generation,source_config_sha256,trigger,idempotency_key,ref,target_sha,state,available_at,created_at,updated_at)
      VALUES('lookup-job',?,1,1,?,?,'manual_redeploy','lookup-key','main',?,'queued','2026-11-16T00:00:00Z','2026-11-16T00:00:00Z','2026-11-16T00:00:00Z')`
    ).run(
      scope.controller_id,
      selected.source_generation,
      selected.source_config_sha256,
      'a'.repeat(40)
    )
    const bytes = db.serialize()
    expect(store.lookupPrepare(pending, scope.controller_id, 'unix:1000')).toEqual({
      result: { ...created, state: 'already_prepared' },
      definitively_unapplied: false
    })
    expect(db.serialize()).toEqual(bytes)
    expect(() => store.prepare(pending, scope.controller_id, 'unix:1000')).toThrow()
  })
  it('rejects conflicting bodies and wrong target without returning another administrator receipt', () => {
    const pending = input()
    store.prepare(pending, scope.controller_id, 'unix:1000')
    expect(() =>
      store.lookupPrepare(
        { ...pending, expected_source_config_sha256: '0'.repeat(64) },
        scope.controller_id,
        'unix:1000'
      )
    ).toThrow('PRODUCT_POSTGRES_REQUEST_CONFLICT')
    expect(() =>
      store.lookupPrepare(
        { ...pending, scope: { ...scope, target: { ...scope.target, host: 'foreign.test' } } },
        scope.controller_id,
        'unix:1000'
      )
    ).toThrow('PRODUCT_POSTGRES_AUTHORITY_CHANGED')
    expect(store.lookupPrepare(pending, scope.controller_id, 'unix:2000')).toEqual({
      result: null,
      definitively_unapplied: false
    })
  })
  it('checks ciphertext/key availability and preserves a caller transaction', () => {
    const pending = input()
    store.prepare(pending, scope.controller_id, 'unix:1000')
    const wrong = new ProductPostgresRepository(db, new AesGcmCredentialCipher(randomBytes(32)))
    expect(() => wrong.lookupPrepare(pending, scope.controller_id, 'unix:1000')).toThrow(
      'PRODUCT_POSTGRES_UNAVAILABLE'
    )
    db.exec('BEGIN')
    expect(() => store.lookupPrepare(pending, scope.controller_id, 'unix:1000')).toThrow(
      'PRODUCT_POSTGRES_INPUT_INVALID'
    )
    expect(db.inTransaction).toBe(true)
    db.exec('ROLLBACK')
  })
  it('returns no negative proof to a concurrent reader before the atomic prepare transaction commits', () => {
    const observerDb = new Database(join(directory, 'opspilot.db'), { readonly: true })
    connections.push(observerDb)
    const observer = new ProductPostgresRepository(observerDb, cipher),
      pending = input(),
      encrypt = cipher.encrypt.bind(cipher)
    const spy = vi.spyOn(cipher, 'encrypt').mockImplementationOnce((value) => {
      const encoded = encrypt(value)
      expect(observer.lookupPrepare(pending, scope.controller_id, 'unix:1000')).toEqual({
        result: null,
        definitively_unapplied: false
      })
      return encoded
    })
    const result = store.prepare(pending, scope.controller_id, 'unix:1000')
    spy.mockRestore()
    expect(
      observer.lookupPrepare(pending, scope.controller_id, 'unix:1000').result?.metadata
    ).toEqual(result.metadata)
  })
})

describe('Explicit PostgreSQL inspection configuration', () => {
  const selectedInspection = (): ProductPostgresInspectionInput => {
    const resource = prepare()
    const selected = new ProductPostgresSelection(db, cipher).select(
      { ...input(), database_id: resource.metadata.database_id },
      scope.controller_id,
      'unix:1000'
    )
    return {
      format: 1,
      controller_id: scope.controller_id,
      app_id: 1,
      expected_ownership_generation: 1,
      expected_source_generation: selected.source_generation,
      expected_source_config_sha256: selected.source_config_sha256,
      expected_target_security_revision: 1,
      database_id: resource.metadata.database_id
    }
  }
  it('requires exact instance even for two databases with the same name on one VPS, returns no runtime health or secrets, and never writes', () => {
    const first = selectedInspection()
    const secondSource = canonicalH2Json({ ...JSON.parse(source), host_port: 30001 }),
      secondHash = createHash('sha256').update(secondSource).digest('hex')
    db.exec(
      "INSERT INTO app(id,vps_id,name,framework,host_port,container_port,healthcheck_path,source_type,git_repo_url,git_ref,git_root) VALUES(2,1,'second','express',30001,3000,'/health','git','https://example.test/app.git','main','.')"
    )
    db.prepare(
      "INSERT INTO product_source_config VALUES(2,1,'https://example.test/app.git','main','.',?,?,'2026-11-16T00:00:00.000Z')"
    ).run(secondSource, secondHash)
    db.prepare(
      "INSERT INTO product_app_control(app_id,mode,controller_id,ownership_generation,source_generation,source_config_sha256,auto_deploy_paused,pause_reason,pause_policy_provenance,changed_at) VALUES(2,'product','postgres-test',1,1,?,1,'operator','explicit','2026-11-16T00:00:00.000Z')"
    ).run(secondHash)
    const secondRequest = {
      ...input(),
      scope: { ...scope, app_id: 2 },
      expected_source_config_sha256: secondHash
    }
    const resource = store.prepare(secondRequest, scope.controller_id, 'unix:1000')
    const selected = new ProductPostgresSelection(db, cipher).select(
      { ...secondRequest, database_id: resource.metadata.database_id },
      scope.controller_id,
      'unix:1000'
    )
    const second = {
      ...first,
      app_id: 2,
      expected_source_config_sha256: selected.source_config_sha256,
      database_id: resource.metadata.database_id
    }
    const before = db.prepare('SELECT total_changes() n').get()
    const a = reviewPostgresInspection(db, cipher, scope.controller_id, first),
      b = reviewPostgresInspection(db, cipher, scope.controller_id, second)
    expect(a.database.database_name).toBe(b.database.database_name)
    expect(a.database.database_id).not.toBe(b.database.database_id)
    const readonly = new Database(join(directory, 'opspilot.db'), {
      readonly: true,
      fileMustExist: true
    })
    connections.push(readonly)
    expect(reviewPostgresInspection(readonly, cipher, scope.controller_id, first)).toEqual(a)
    expect(a.runtime_status).toBe('not_checked')
    expect(a.state).toBe('configuration_verified')
    expect(() =>
      reviewPostgresInspection(db, cipher, scope.controller_id, {
        ...first,
        database_id: second.database_id
      })
    ).toThrow('PRODUCT_POSTGRES_UNAVAILABLE')
    const credentials = store.readCredentials(scope, first.database_id)
    expect(JSON.stringify([a, b])).not.toContain(credentials.application_password)
    expect(JSON.stringify([a, b])).not.toContain(credentials.administrator_password)
    expect(db.prepare('SELECT total_changes() n').get()).toEqual(before)
    expect(db.prepare('SELECT count(*) n FROM product_deploy_job').get()).toEqual({ n: 0 })
  })
  it('allows inspection metadata while auto-deploy is enabled without weakening deployment preflight', () => {
    const request = selectedInspection()
    db.prepare(
      'UPDATE product_app_control SET auto_deploy_paused=0,pause_reason=NULL WHERE app_id=1'
    ).run()
    expect(
      reviewPostgresInspection(db, cipher, scope.controller_id, request).database.database_id
    ).toBe(request.database_id)
    expect(() => ProductPostgresPreflight.review(db, request, cipher)).toThrow(
      'PRODUCT_POSTGRES_UNAVAILABLE'
    )
    expect(db.prepare('SELECT auto_deploy_paused FROM product_app_control').get()).toEqual({
      auto_deploy_paused: 0
    })
  })
  it('refuses missing instance, extra SQL/path, wrong controller/owner/source/target and prepared-only resource', () => {
    const resource = prepare()
    const request = {
      format: 1,
      controller_id: scope.controller_id,
      app_id: 1,
      expected_ownership_generation: 1,
      expected_source_generation: 1,
      expected_source_config_sha256: hash,
      expected_target_security_revision: 1,
      database_id: resource.metadata.database_id
    }
    expect(() => reviewPostgresInspection(db, cipher, scope.controller_id, request)).toThrow(
      'PRODUCT_POSTGRES_UNAVAILABLE'
    )
    const selected = new ProductPostgresSelection(db, cipher).select(
      { ...input(), database_id: resource.metadata.database_id },
      scope.controller_id,
      'unix:1000'
    )
    const current = {
      ...request,
      expected_source_generation: selected.source_generation,
      expected_source_config_sha256: selected.source_config_sha256
    }
    for (const changed of [
      { database_id: undefined },
      { sql: 'SELECT 1' },
      { path: '/tmp/x' },
      { expected_ownership_generation: 2 },
      { expected_source_generation: 1 },
      { expected_target_security_revision: 2 },
      { expected_source_config_sha256: 'b'.repeat(64) },
      { controller_id: 'foreign' }
    ])
      expect(() =>
        reviewPostgresInspection(db, cipher, scope.controller_id, { ...current, ...changed })
      ).toThrow()
    expect(() =>
      reviewPostgresInspection(
        db,
        new AesGcmCredentialCipher(randomBytes(32)),
        scope.controller_id,
        current
      )
    ).toThrow('PRODUCT_POSTGRES_UNAVAILABLE')
    db.exec('BEGIN')
    expect(() => reviewPostgresInspection(db, cipher, scope.controller_id, current)).toThrow(
      'PRODUCT_POSTGRES_INPUT_INVALID'
    )
    expect(db.inTransaction).toBe(true)
    db.exec('ROLLBACK')
  })
})
