import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase, closeDatabase } from '../db'
import { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import { encryptControllerCredential } from './controllerSecrets'
import { ProductProjectRegistration } from './projectRegistration'
import { ProductEnvironmentRepository } from '../db/productEnvironmentRepository'
import { ProductPostgresRepository } from '../db/productPostgresRepository'
import { ProductEnvironmentSelection } from './productEnvironmentSelection'
import { ProductPostgresSelection } from './productPostgresSelection'
import { ProductEnvironmentPreflight } from './productEnvironmentPreflight'
import { ProductPostgresPreflight } from './productPostgresPreflight'
import { canonicalH2Json } from './productH2Proof'
import {
  readProjectReconnectionContext,
  projectReconnectionContextSchema
} from './projectReconnection'

let directory: string, db: Database.Database, cipher: AesGcmCredentialCipher, fixtureSecret: string
const controllerId = 'reconnection-test'
const input = { format: 1 as const, controller_id: controllerId, app_id: 1 }
const read = (value: unknown = input): ReturnType<typeof readProjectReconnectionContext> =>
  readProjectReconnectionContext(db, cipher, controllerId, 'unix:1000', value)

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'opspilot-reconnection-'))
  db = initializeDatabase(directory, 'controller')
  db.prepare("INSERT INTO product_controller VALUES(?,?,'active')").run(
    controllerId,
    new Date().toISOString()
  )
  cipher = new AesGcmCredentialCipher(randomBytes(32))
  fixtureSecret = randomBytes(32).toString('base64url') // Inert fixture, never used for SSH.
  const target = {
    vps_id: 1,
    host: 'fixture.test',
    port: 22,
    username: 'operator',
    auth_type: 'password' as const,
    host_fingerprint: 'SHA256:' + 'A'.repeat(43),
    ssh_security_revision: 1
  }
  const envelope = encryptControllerCredential(
    cipher,
    { controller_id: controllerId, target },
    fixtureSecret
  )
  db.prepare(
    `INSERT INTO vps(id,name,host,port,username,auth_type,host_fingerprint,ssh_security_revision,
    crypto_scheme,encrypted_secret,iv,auth_tag) VALUES(1,'fixture',?,?,?,?,?,1,'aes_256_gcm',?,?,?)`
  ).run(
    target.host,
    target.port,
    target.username,
    target.auth_type,
    target.host_fingerprint,
    envelope.encrypted_secret,
    envelope.iv,
    envelope.auth_tag
  )
  new ProductProjectRegistration(db, controllerId, 'unix:1000', cipher).register({
    format: 1,
    controller_id: controllerId,
    request_key: randomUUID(),
    target_vps_id: 1,
    expected_target_security_revision: 1,
    app_name: 'reconnection-demo',
    framework: 'express',
    repository_url: 'https://github.com/example/demo',
    production_ref: 'main',
    repository_root: '.',
    host_port: 30000,
    container_port: 3000,
    healthcheck_path: '/health'
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  closeDatabase()
  rmSync(directory, { recursive: true })
})

function selectEnvironment(): void {
  const c = read()
  new ProductEnvironmentRepository(db, cipher).append({
    scope: c.scope,
    expected_latest_revision: null,
    expected_source_generation: c.source.generation,
    expected_source_config_sha256: c.source.config_sha256,
    values: { runtime_env: { APP_MODE: 'fixture-env-canary-never-output' }, public_build_args: {} }
  })
  new ProductEnvironmentSelection(db, cipher).select(
    {
      format: 1,
      request_key: randomUUID(),
      scope: c.scope,
      expected_source_generation: c.source.generation,
      expected_source_config_sha256: c.source.config_sha256,
      expected_latest_revision: 1,
      environment_revision: 1
    },
    controllerId,
    'unix:1000'
  )
}
function selectDatabase(): void {
  const c = read()
  const request = {
    format: 1 as const,
    request_key: randomUUID(),
    scope: c.scope,
    expected_source_generation: c.source.generation,
    expected_source_config_sha256: c.source.config_sha256
  }
  const pg = new ProductPostgresRepository(db, cipher).prepare(request, controllerId, 'unix:1000')
  new ProductPostgresSelection(db, cipher).select(
    { ...request, database_id: pg.metadata.database_id },
    controllerId,
    'unix:1000'
  )
}
function material(): string {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as { name: string }[]
  return JSON.stringify(
    tables.map(({ name }) => [
      name,
      db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()
    ])
  )
}

describe('Product reconnection review (no Desktop receipt fabrication)', () => {
  it('reads a genuine registered Git source with no local history or runtime-ready claim', () => {
    const before = material()
    const c = read()
    expect(c).toMatchObject({
      state: 'review_required',
      app_id: 1,
      app_name: 'reconnection-demo',
      source: { generation: 1, repository_url: 'https://github.com/example/demo.git' },
      selected_environment: null,
      selected_database: null,
      consent_required: true,
      desktop_authority: 'not_granted',
      runtime_status: 'not_checked'
    })
    expect(read({ ...input, expected_snapshot_sha256: c.snapshot_sha256 })).toEqual(c)
    expect(material()).toBe(before)
    expect(JSON.stringify(c)).not.toContain(fixtureSecret)
  })
  it.each([true, false])(
    'authenticates selected ENV and PG in either order (PG first=%s)',
    (pgFirst) => {
      if (pgFirst) {
        selectDatabase()
        selectEnvironment()
      } else {
        selectEnvironment()
        selectDatabase()
      }
      const before = material()
      db.pragma('query_only=ON')
      const c = read()
      expect(c.source.generation).toBe(3)
      expect(c.selected_environment).toMatchObject({ revision: 1, runtime_keys: ['APP_MODE'] })
      expect(c.selected_database?.database_id).toBe(c.source.configuration.database?.database_id)
      expect(c.selected_database?.provisioning).toBe('prepared')
      expect(c.runtime_status).toBe('not_checked')
      expect(JSON.stringify(c)).not.toContain('fixture-env-canary-never-output')
      expect(material()).toBe(before)
    }
  )
  it('permits readonly review with auto enabled, retaining deployment quiescence guards', () => {
    selectEnvironment()
    selectDatabase()
    db.prepare(
      'UPDATE product_app_control SET auto_deploy_paused=0,pause_reason=NULL WHERE app_id=1'
    ).run()
    const before = material(),
      c = read()
    expect(c.auto_deploy_paused).toBe(false)
    const authority = {
      ...input,
      expected_ownership_generation: 1,
      expected_source_generation: c.source.generation,
      expected_source_config_sha256: c.source.config_sha256,
      expected_target_security_revision: 1
    }
    expect(() => ProductEnvironmentPreflight.review(db, authority, cipher)).toThrow()
    expect(() => ProductPostgresPreflight.review(db, authority, cipher)).toThrow()
    expect(material()).toBe(before)
  })
  it('refuses an old snapshot after legitimate source selection and policy drift', () => {
    const old = read()
    selectDatabase()
    expect(() => read({ ...input, expected_snapshot_sha256: old.snapshot_sha256 })).toThrow(
      'PROJECT_RECONNECTION_AUTHORITY_CHANGED'
    )
    const c = read()
    db.prepare(
      'UPDATE product_app_control SET auto_deploy_paused=0,pause_reason=NULL WHERE app_id=1'
    ).run()
    expect(() => read({ ...input, expected_snapshot_sha256: c.snapshot_sha256 })).toThrow(
      'PROJECT_RECONNECTION_AUTHORITY_CHANGED'
    )
  })
  it('refuses wrong controller/app, extra caller authority and malformed digests', () => {
    expect(() => read({ ...input, controller_id: 'another' })).toThrow(
      'PROJECT_RECONNECTION_AUTHORITY_CHANGED'
    )
    expect(() => read({ ...input, app_id: 2 })).toThrow('PROJECT_RECONNECTION_AUTHORITY_CHANGED')
    for (const extra of [
      { target: {} },
      { administrator_id: 'root' },
      { expected_snapshot_sha256: 'invalid' }
    ])
      expect(() => read({ ...input, ...extra })).toThrow('PROJECT_RECONNECTION_INPUT_INVALID')
    db.transaction(() => expect(() => read()).toThrow('PROJECT_RECONNECTION_INPUT_INVALID'))()
  })
  it('refuses archived targets without exposing their profile', () => {
    db.prepare("UPDATE vps SET archived_at='2026-11-17T00:00:00Z' WHERE id=1").run()
    expect(() => read()).toThrow('PROJECT_RECONNECTION_UNAVAILABLE')
  })
  it('rejects a foreign cipher even for a Git source without ENV/PG references', () => {
    cipher = new AesGcmCredentialCipher(randomBytes(32))
    expect(() => read()).toThrow('PROJECT_RECONNECTION_AUTHORITY_CHANGED')
  })
  it('refuses a changed target revision instead of replacing the previous snapshot', () => {
    const c = read()
    db.prepare('UPDATE vps SET ssh_security_revision=2 WHERE id=1').run()
    expect(() => read({ ...input, expected_snapshot_sha256: c.snapshot_sha256 })).toThrow(
      'PROJECT_RECONNECTION_AUTHORITY_CHANGED'
    )
  })
  it('requires another review after ownership changes and refuses a revoked controller', () => {
    const c = read()
    db.prepare('UPDATE product_app_control SET ownership_generation=2 WHERE app_id=1').run()
    expect(() => read({ ...input, expected_snapshot_sha256: c.snapshot_sha256 })).toThrow(
      'PROJECT_RECONNECTION_AUTHORITY_CHANGED'
    )
    db.prepare("UPDATE product_controller SET status='revoked'").run()
    expect(() => read()).toThrow('PROJECT_RECONNECTION_AUTHORITY_CHANGED')
  })
  it.each(['environment', 'postgres'])('refuses %s ciphertext tampering', (kind) => {
    selectEnvironment()
    selectDatabase()
    const table =
      kind === 'environment' ? 'product_environment_revision' : 'product_managed_postgres'
    db.exec(`DROP TRIGGER ${table}_immutable`)
    db.prepare(`UPDATE ${table} SET auth_tag=zeroblob(16)`).run()
    expect(() => read()).toThrow('PROJECT_RECONNECTION_UNAVAILABLE')
  })
  it('does not release an earlier snapshot if source authority changes during metadata review', () => {
    const original = ProductEnvironmentPreflight.reviewForInspection.bind(
      ProductEnvironmentPreflight
    )
    vi.spyOn(ProductEnvironmentPreflight, 'reviewForInspection').mockImplementation((...args) => {
      const result = original(...args)
      db.prepare("UPDATE app SET git_ref='different' WHERE id=1").run()
      return result
    })
    expect(() => read()).toThrow('PROJECT_RECONNECTION_AUTHORITY_CHANGED')
  })
  it('rejects forged response digests and cross-app selected metadata even if digest is recomputed', () => {
    selectDatabase()
    const c = read()
    expect(
      projectReconnectionContextSchema.safeParse({ ...c, snapshot_sha256: '0'.repeat(64) }).success
    ).toBe(false)
    const body = structuredClone(c)
    Reflect.deleteProperty(body, 'snapshot_sha256')
    body.selected_database = { ...body.selected_database!, app_id: 2 }
    const forged = createHash('sha256').update(canonicalH2Json(body)).digest('hex')
    expect(
      projectReconnectionContextSchema.safeParse({ ...body, snapshot_sha256: forged }).success
    ).toBe(false)
  })
  it.each([
    'https://user:fixture-only@github.com/example/demo.git',
    'https://example.test/demo.git'
  ])('rejects unsafe repository metadata despite a recomputed digest: %s', (repository_url) => {
    const body = structuredClone(read())
    Reflect.deleteProperty(body, 'snapshot_sha256')
    body.source = { ...body.source, repository_url }
    const snapshot_sha256 = createHash('sha256').update(canonicalH2Json(body)).digest('hex')
    expect(projectReconnectionContextSchema.safeParse({ ...body, snapshot_sha256 }).success).toBe(
      false
    )
  })
})
