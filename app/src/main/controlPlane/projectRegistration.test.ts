import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { initializeDatabase, closeDatabase, runMigrations } from '../db'
import { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import { encryptControllerCredential } from './controllerSecrets'
import { ProductProjectRegistration } from './projectRegistration'
import type { ProductProjectRegistrationInput } from '../../../../docs/contracts/product-project-registration'
let directory: string,
  db: Database.Database,
  cipher: AesGcmCredentialCipher,
  registration: ProductProjectRegistration,
  input: ProductProjectRegistrationInput,
  secret: string
const snapshot = (): unknown =>
  Object.fromEntries(
    [
      'app',
      'product_source_config',
      'product_app_control',
      'product_project_registration',
      'product_history_event'
    ].map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()])
  )
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'opspilot-project-registration-'))
  db = initializeDatabase(directory)
  db.prepare("INSERT INTO product_controller VALUES('controller-test',?,'active')").run(
    new Date().toISOString()
  )
  cipher = new AesGcmCredentialCipher(randomBytes(32))
  secret = randomBytes(32).toString('base64url')
  const target = {
    vps_id: 1,
    host: 'target.test',
    port: 22,
    username: 'operator',
    auth_type: 'key' as const,
    host_fingerprint: 'SHA256:' + 'A'.repeat(43),
    ssh_security_revision: 1
  }
  const encrypted = encryptControllerCredential(
    cipher,
    { controller_id: 'controller-test', target },
    secret
  )
  db.prepare(
    "INSERT INTO vps(id,name,host,port,username,auth_type,host_fingerprint,ssh_security_revision,crypto_scheme,encrypted_secret,iv,auth_tag) VALUES(1,'target',?,?,?,?,?,1,'aes_256_gcm',?,?,?)"
  ).run(
    target.host,
    target.port,
    target.username,
    target.auth_type,
    target.host_fingerprint,
    encrypted.encrypted_secret,
    encrypted.iv,
    encrypted.auth_tag
  )
  input = {
    format: 1,
    controller_id: 'controller-test',
    request_key: randomUUID(),
    target_vps_id: 1,
    expected_target_security_revision: 1,
    app_name: 'example-api',
    framework: 'express',
    repository_url: 'https://github.com/example/api',
    production_ref: 'main',
    repository_root: '.',
    host_port: null,
    container_port: 3000,
    healthcheck_path: '/health'
  }
  registration = new ProductProjectRegistration(db, 'controller-test', 'unix:1000', cipher)
})
afterEach(() => {
  closeDatabase()
  rmSync(directory, { recursive: true })
})
describe('Atomic Product project registration', () => {
  it('đăng ký SPA với cấu hình canonical, replay giữ framework và không tạo deployment', () => {
    input = { ...input, framework: 'static-spa', container_port: 80, healthcheck_path: '/' }
    const result = registration.register(input)
    expect(
      db.prepare('SELECT framework,container_port,current_deployment_id FROM app').get()
    ).toEqual({ framework: 'static-spa', container_port: 80, current_deployment_id: null })
    const source = db
      .prepare('SELECT deploy_config_json,config_sha256 FROM product_source_config')
      .get() as { deploy_config_json: string; config_sha256: string }
    expect(JSON.parse(source.deploy_config_json).framework).toBe('static-spa')
    expect(source.config_sha256).toBe(result.source_config_sha256)
    expect(registration.register(input)).toMatchObject({ ...result, state: 'already_registered' })
    expect(() => registration.register({ ...input, framework: 'express' })).toThrow(
      'PROJECT_IDEMPOTENCY_CONFLICT'
    )
    db.prepare("UPDATE app SET framework='express'").run()
    expect(() => registration.register(input)).toThrow('PROJECT_REVIEW_REQUIRED')
    expect(db.prepare('SELECT COUNT(*) AS n FROM product_deploy_job').get()).toEqual({ n: 0 })
  })
  it('đăng ký Next.js, canonical source/replay và chặn đổi framework cùng key', () => {
    input = { ...input, framework: 'nextjs', healthcheck_path: '/' }
    const result = registration.register(input)
    const source = db
      .prepare('SELECT deploy_config_json,config_sha256 FROM product_source_config')
      .get() as { deploy_config_json: string; config_sha256: string }
    expect(JSON.parse(source.deploy_config_json)).toMatchObject({
      framework: 'nextjs',
      container_port: 3000,
      needs_db: false
    })
    expect(source.config_sha256).toBe(result.source_config_sha256)
    expect(registration.register(input)).toMatchObject({ ...result, state: 'already_registered' })
    expect(() => registration.register({ ...input, framework: 'express' })).toThrow(
      'PROJECT_IDEMPOTENCY_CONFLICT'
    )
    expect(db.prepare('SELECT COUNT(*) AS n FROM deployment').get()).toEqual({ n: 0 })
  })
  it('từ chối cổng SPA sai trước khi tạo app hoặc journal', () => {
    const before = snapshot()
    expect(() => registration.register({ ...input, framework: 'static-spa' })).toThrow(
      'PROJECT_REQUEST_INVALID'
    )
    expect(snapshot()).toEqual(before)
  })
  it('lists only current usable controller targets with bounded pagination and never imports local profiles', () => {
    db.prepare(
      "INSERT INTO vps(id,name,host,username,auth_type,encrypted_secret) VALUES(2,'legacy','other.test','unit','key',X'0102')"
    ).run()
    const first = registration.targets({
      controller_id: 'controller-test',
      after_id: null,
      limit: 1
    })
    expect(first.items.map((item) => item.id)).toEqual([1])
    expect(first.has_more).toBe(true)
    expect(first.next_after_id).toBe(1)
    expect(JSON.stringify(first)).not.toContain(secret)
    expect(
      registration.targets({ controller_id: 'controller-test', after_id: 1, limit: 1 })
    ).toMatchObject({ items: [], has_more: false, next_after_id: null })
    expect(registration.targets({ controller_id: 'controller-test', target_id: 2 }).items).toEqual(
      []
    )
    expect(() =>
      registration.targets({ controller_id: 'controller-test', after_id: null, limit: 51 })
    ).toThrow('PROJECT_REQUEST_INVALID')
    expect(() => registration.register({ ...input, expected_target_security_revision: 2 })).toThrow(
      'PROJECT_TARGET_UNAVAILABLE'
    )
  })
  it('upgrades populated v025, retaining bindings and source data without implicit registrations', () => {
    const before = snapshot()
    db.exec(
      'DROP TABLE IF EXISTS desktop_controller_upgrade;DELETE FROM schema_version WHERE version=30;DROP TABLE IF EXISTS desktop_controller_installation;DELETE FROM schema_version WHERE version=29;DROP TABLE IF EXISTS desktop_target_setup;DROP TABLE IF EXISTS product_vps_registration;DELETE FROM schema_version WHERE version=28;DROP TABLE desktop_project_setup;DELETE FROM schema_version WHERE version=27;DROP TABLE product_project_registration;DELETE FROM schema_version WHERE version=26'
    )
    runMigrations(db)
    runMigrations(db)
    expect(snapshot()).toEqual(before)
    expect(db.prepare('SELECT MAX(version) AS n FROM schema_version').get()).toEqual({ n: 35 })
    expect(db.pragma('foreign_key_check')).toEqual([])
    const sql = readFileSync(
      new URL('../db/migrations/026_product_project_registration.sql', import.meta.url),
      'utf8'
    )
      .replaceAll('\r\n', '\n')
      .trim()
    expect(
      readFileSync(
        new URL('../../../../docs/contracts/schema.sql', import.meta.url),
        'utf8'
      ).replaceAll('\r\n', '\n')
    ).toContain(sql)
  })
  it('creates canonical source, paused ownership and one history record atomically without jobs or remote enrollment', () => {
    const result = registration.register(input)
    expect(result).toMatchObject({
      state: 'registered',
      app_id: 1,
      host_port: 30000,
      auto_deploy_paused: true,
      target_enrollment: 'required',
      runtime_preflight: 'required'
    })
    expect(
      db
        .prepare(
          'SELECT git_repo_url,source_type,needs_db,source_path,current_deployment_id FROM app'
        )
        .get()
    ).toEqual({
      git_repo_url: 'https://github.com/example/api.git',
      source_type: 'git',
      needs_db: 0,
      source_path: null,
      current_deployment_id: null
    })
    expect(
      db
        .prepare('SELECT mode,auto_deploy_paused,pause_policy_provenance FROM product_app_control')
        .get()
    ).toEqual({ mode: 'product', auto_deploy_paused: 1, pause_policy_provenance: 'explicit' })
    for (const table of [
      'deployment',
      'product_deploy_job',
      'product_branch_observation',
      'product_target_enrollment'
    ])
      expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT count(*) AS n FROM product_history_event').get()).toEqual({ n: 1 })
    expect(JSON.stringify(snapshot())).not.toContain(secret)
  })
  it('replays after cold SQLite reopen with same app and no extra audit or rows', () => {
    const first = registration.register(input),
      before = snapshot()
    closeDatabase()
    db = initializeDatabase(directory)
    const cold = new ProductProjectRegistration(db, 'controller-test', 'unix:1000', cipher)
    expect(
      cold.register({ ...input, repository_url: 'https://github.com/example/api.git' })
    ).toEqual({ ...first, state: 'already_registered' })
    expect(snapshot()).toEqual(before)
  })
  it('serializes competing SQLite connections and distinguishes admin namespaces', () => {
    const other = new Database(join(directory, 'opspilot.db'))
    other.pragma('foreign_keys=ON')
    try {
      const first = registration.register(input)
      expect(
        new ProductProjectRegistration(other, 'controller-test', 'unix:1000', cipher).register(
          input
        )
      ).toEqual({ ...first, state: 'already_registered' })
      expect(() =>
        new ProductProjectRegistration(other, 'controller-test', 'unix:1001', cipher).register(
          input
        )
      ).toThrow('PROJECT_NAME_CONFLICT')
      expect(other.prepare('SELECT count(*) AS n FROM app').get()).toEqual({ n: 1 })
    } finally {
      other.close()
    }
  })
  it('rejects changed request body or key collision without mutation', () => {
    registration.register(input)
    const before = snapshot()
    for (const update of [
      { app_name: 'changed-app' },
      { container_port: 4000 },
      { production_ref: 'develop' },
      { repository_root: 'apps/api' },
      { host_port: 30003 }
    ])
      expect(() => registration.register({ ...input, ...update })).toThrow(
        'PROJECT_IDEMPOTENCY_CONFLICT'
      )
    expect(snapshot()).toEqual(before)
  })
  it('does not overwrite existing Desktop app names or occupied ports', () => {
    db.prepare(
      "INSERT INTO app(vps_id,name,framework,host_port,container_port) VALUES(1,'desktop-api','express',30000,3000)"
    ).run()
    expect(() => registration.register({ ...input, app_name: 'desktop-api' })).toThrow(
      'PROJECT_NAME_CONFLICT'
    )
    expect(() => registration.register({ ...input, host_port: 30000 })).toThrow(
      'PROJECT_PORT_CONFLICT'
    )
    expect(registration.register(input).host_port).toBe(30001)
    expect(db.prepare('SELECT count(*) AS n FROM product_app_control').get()).toEqual({ n: 1 })
  })
  it('rolls back app/source/owner/history when request persistence fails', () => {
    const before = snapshot()
    db.exec(
      "CREATE TRIGGER fail_registration BEFORE INSERT ON product_project_registration BEGIN SELECT RAISE(ABORT,'SIMULATED_STORAGE_FAILURE'); END"
    )
    expect(() => registration.register(input)).toThrow('PROJECT_STORAGE_UNAVAILABLE')
    expect(snapshot()).toEqual(before)
  })
  it('rejects missing/archived/unpinned/wrong cipher targets without creating any app', () => {
    const original = db
      .prepare(
        'SELECT archived_at,host_fingerprint,crypto_scheme,ssh_security_revision FROM vps WHERE id=1'
      )
      .get() as Record<string, unknown>
    for (const sql of [
      "UPDATE vps SET archived_at='2026-11-07T00:00:00Z'",
      'UPDATE vps SET host_fingerprint=NULL',
      "UPDATE vps SET crypto_scheme='safe_storage'",
      'UPDATE vps SET ssh_security_revision=2'
    ]) {
      db.exec(sql)
      expect(() => registration.register(input)).toThrow('PROJECT_TARGET_UNAVAILABLE')
      db.prepare(
        'UPDATE vps SET archived_at=@archived_at,host_fingerprint=@host_fingerprint,crypto_scheme=@crypto_scheme,ssh_security_revision=@ssh_security_revision WHERE id=1'
      ).run(original)
    }
    expect(() => registration.register({ ...input, target_vps_id: 999 })).toThrow(
      'PROJECT_TARGET_UNAVAILABLE'
    )
    expect(db.prepare('SELECT count(*) AS n FROM app').get()).toEqual({ n: 0 })
  })
  it('requires active matching sole controller and trusted unix principal', () => {
    expect(() => registration.register({ ...input, controller_id: 'foreign' })).toThrow(
      'PROJECT_CONTROLLER_UNAVAILABLE'
    )
    expect(() =>
      new ProductProjectRegistration(
        db,
        'controller-test',
        'caller-supplied-admin',
        cipher
      ).register(input)
    ).toThrow('PROJECT_REQUEST_INVALID')
    db.exec("UPDATE product_controller SET status='maintenance'")
    expect(() => registration.register(input)).toThrow('PROJECT_CONTROLLER_UNAVAILABLE')
  })
  it('validates URLs, branch/root, supported runtime, health path and unknown secret fields strictly', () => {
    const changes: Record<string, unknown>[] = [
      { repository_url: 'https://token@github.com/example/api' },
      { repository_url: 'http://github.com/example/api' },
      { repository_url: 'https://example.com/api' },
      { repository_url: 'https://github.com/example/api?secret=1' },
      { repository_url: 'file:///tmp/app' },
      { production_ref: 'refs/heads/main' },
      { production_ref: 'a'.repeat(40) },
      { production_ref: 'main.lock' },
      { production_ref: 'main//a' },
      { repository_root: '../api' },
      { repository_root: '/api' },
      { repository_root: 'apps/../api' },
      { repository_root: '.git' },
      { framework: 'flask' },
      { healthcheck_path: '/health\n' },
      { app_name: 'Bad Name' },
      { env: { PASSWORD: secret } },
      { secret },
      { administrator_id: 'unix:0' },
      { buildCommand: 'arbitrary' },
      { host_port: 29999 },
      { container_port: 0 }
    ]
    for (const change of changes)
      expect(() => registration.register({ ...input, ...change })).toThrow(
        'PROJECT_REQUEST_INVALID'
      )
    expect(db.prepare('SELECT count(*) AS n FROM app').get()).toEqual({ n: 0 })
  })
  it('fails closed when replay finds changed current app/source/owner/target and preserves tombstones', () => {
    registration.register(input)
    for (const [sql, restore] of [
      ["UPDATE app SET name='renamed'", "UPDATE app SET name='example-api'"],
      ['UPDATE app SET container_port=4000', 'UPDATE app SET container_port=3000'],
      [
        "UPDATE product_source_config SET repository_root='other'",
        "UPDATE product_source_config SET repository_root='.'"
      ],
      [
        'UPDATE product_app_control SET ownership_generation=2',
        'UPDATE product_app_control SET ownership_generation=1'
      ]
    ]) {
      db.exec(sql)
      expect(() => registration.register(input)).toThrow('PROJECT_REVIEW_REQUIRED')
      db.exec(restore)
    }
    expect(() => db.exec("UPDATE product_project_registration SET body_json='{}'")).toThrow(
      'PRODUCT_PROJECT_REGISTRATION_IMMUTABLE'
    )
    expect(db.prepare('SELECT count(*) AS n FROM product_project_registration').get()).toEqual({
      n: 1
    })
  })
  it('does not reinterpret a historical paused registration as the current auto-deploy policy', () => {
    const first = registration.register(input)
    db.exec(
      "UPDATE product_app_control SET auto_deploy_paused=0,pause_reason=NULL,pause_policy_provenance='explicit'"
    )
    expect(registration.register(input)).toEqual({ ...first, state: 'already_registered' })
    expect(db.prepare('SELECT auto_deploy_paused FROM product_app_control').get()).toEqual({
      auto_deploy_paused: 0
    })
  })
  it('reports the controller port range as exhausted without partial source or ownership rows', () => {
    const seed = db.prepare(
      "INSERT INTO app(vps_id,name,framework,host_port,container_port) VALUES(1,?,'express',?,3000)"
    )
    db.transaction(() => {
      for (let port = 30000; port <= 30999; port++) seed.run('occupied-' + port, port)
    })()
    expect(() => registration.register(input)).toThrow('PROJECT_PORT_EXHAUSTED')
    expect(db.prepare('SELECT count(*) AS n FROM product_source_config').get()).toEqual({ n: 0 })
    expect(db.prepare('SELECT count(*) AS n FROM product_project_registration').get()).toEqual({
      n: 0
    })
  })
  it('leaves caller transaction untouched and never nests registration into it', () => {
    db.exec('BEGIN IMMEDIATE')
    try {
      expect(() => registration.register(input)).toThrow('PROJECT_REQUEST_INVALID')
      expect(db.inTransaction).toBe(true)
      expect(db.prepare('SELECT count(*) AS n FROM app').get()).toEqual({ n: 0 })
    } finally {
      db.exec('ROLLBACK')
    }
  })
})
