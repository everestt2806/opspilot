import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import { initializeDatabase, closeDatabase, runMigrations } from './index'
import { ProductEnvironmentRepository } from './productEnvironmentRepository'
import type {
  ProductEnvironmentStageInput,
  ProductEnvironmentStateInput
} from '../../../../docs/contracts/product-environment'

let root: string,
  db: Database.Database,
  cipher: AesGcmCredentialCipher,
  store: ProductEnvironmentRepository
const controllerId = 'environment-admin',
  principal = 'unix:1000'
const config = '{"framework":"nextjs"}',
  hash = createHash('sha256').update(config).digest('hex')
const secret = 'SYNTHETIC_ONLY_ENV_ADMIN_MARKER_7729'
const input = (): ProductEnvironmentStageInput => ({
  format: 1,
  request_key: randomUUID(),
  scope: {
    controller_id: controllerId,
    app_id: 1,
    ownership_generation: 1,
    target: {
      vps_id: 1,
      host: 'fixture.test',
      port: 22,
      username: 'operator',
      auth_type: 'key',
      host_fingerprint: 'SHA256:' + 'A'.repeat(43),
      ssh_security_revision: 1
    }
  },
  expected_latest_revision: null,
  expected_source_generation: 1,
  expected_source_config_sha256: hash,
  values: { runtime_env: { APP_TOKEN: secret }, public_build_args: { NEXT_PUBLIC_NAME: 'Sổ Đọc' } }
})
const stateInput = (request = input()): ProductEnvironmentStateInput => {
  const { format, request_key, scope, expected_source_generation, expected_source_config_sha256 } =
    request
  return { format, request_key, scope, expected_source_generation, expected_source_config_sha256 }
}
const count = (table: string): number =>
  (db.prepare('SELECT count(*) n FROM ' + table).get() as { n: number }).n

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'opspilot-environment-admin-'))
  db = initializeDatabase(root)
  cipher = new AesGcmCredentialCipher(randomBytes(32))
  store = new ProductEnvironmentRepository(db, cipher)
  db.prepare(
    "INSERT INTO vps(id,name,host,username,auth_type,host_fingerprint,encrypted_secret) VALUES(1,'fixture','fixture.test','operator','key',?,X'00')"
  ).run(input().scope.target.host_fingerprint)
  db.exec(
    "INSERT INTO app(id,vps_id,name,framework,host_port,container_port) VALUES(1,1,'env-admin','nextjs',30000,3000)"
  )
  db.prepare("INSERT INTO product_controller VALUES(?,'2026-11-14T00:00:00.000Z','active')").run(
    controllerId
  )
  db.prepare(
    "INSERT INTO product_source_config VALUES(1,1,'https://example.test/source.git','main','.',?,?,?)"
  ).run(config, hash, '2026-11-14T00:00:00.000Z')
  db.prepare(
    "INSERT INTO product_app_control(app_id,mode,controller_id,ownership_generation,source_generation,source_config_sha256,changed_at) VALUES(1,'product',?,1,1,?,'2026-11-14T00:00:00.000Z')"
  ).run(controllerId, hash)
})
afterEach(() => {
  closeDatabase()
  rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

it('returns metadata only, persists both ciphertexts and recovers a lost reply after cold reopen', () => {
  const request = input(),
    before = db.prepare('SELECT * FROM product_app_control').get()
  expect(store.state(stateInput(request), controllerId, principal)).toMatchObject({
    latest: null,
    requested: null
  })
  const first = store.stage(request, controllerId, principal)
  expect(first).toMatchObject({ state: 'staged', metadata: { revision: 1, activation: 'staged' } })
  closeDatabase()
  db = initializeDatabase(root)
  store = new ProductEnvironmentRepository(db, cipher)
  const again = store.stage(request, controllerId, principal)
  expect(again).toEqual({ ...first, state: 'already_staged' })
  const state = store.state(stateInput(request), controllerId, principal)
  expect(state).toMatchObject({ latest: first.metadata, requested: first.metadata })
  const serialized = JSON.stringify({ first, again, state })
  for (const forbidden of [
    secret,
    'Sổ Đọc',
    'encrypted_secret',
    'auth_tag',
    'runtime_env',
    'public_build_args'
  ])
    expect(serialized).not.toContain(forbidden)
  expect(count('product_environment_revision')).toBe(1)
  expect(count('product_environment_request')).toBe(1)
  expect(count('product_deploy_job')).toBe(0)
  expect(db.prepare('SELECT * FROM product_app_control').get()).toEqual(before)
  expect(db.pragma('foreign_key_check')).toEqual([])
  db.pragma('wal_checkpoint(TRUNCATE)')
  const disk = readFileSync(join(root, 'opspilot.db'))
  expect(disk.includes(Buffer.from(secret))).toBe(false)
  expect(disk.includes(Buffer.from(createHash('sha256').update(secret).digest('hex')))).toBe(false)
})
it('derives environment context from the app and rejects target/source overrides', () => {
  const request = input(),
    context = {
      format: 1,
      controller_id: controllerId,
      app_id: 1,
      expected_ownership_generation: 1,
      expected_source_generation: 1,
      expected_source_config_sha256: hash,
      expected_target_security_revision: 1
    }
  expect(store.context(context, controllerId, principal)).toMatchObject({
    scope: request.scope,
    latest: null,
    request_key: null
  })
  expect(() =>
    store.context({ ...context, target: request.scope.target }, controllerId, principal)
  ).toThrow('PRODUCT_ENVIRONMENT_INPUT_INVALID')
  expect(() =>
    store.context({ ...context, expected_target_security_revision: 2 }, controllerId, principal)
  ).toThrow('PRODUCT_ENVIRONMENT_AUTHORITY_REJECTED')
  expect(() =>
    store.context({ ...context, expected_source_generation: 2 }, controllerId, principal)
  ).toThrow('PRODUCT_ENVIRONMENT_SOURCE_CHANGED')
  store.stage(request, controllerId, principal)
  expect(store.context(context, controllerId, principal).latest?.revision).toBe(1)
})

it('replays the original revision after a newer snapshot, with canonical order-insensitive comparison', () => {
  const request = input(),
    first = store.stage(request, controllerId, principal)
  store.stage({ ...input(), expected_latest_revision: 1 }, controllerId, principal)
  const reordered = {
    ...request,
    values: {
      public_build_args: request.values.public_build_args,
      runtime_env: request.values.runtime_env
    }
  }
  expect(store.stage(reordered, controllerId, principal)).toEqual({
    ...first,
    state: 'already_staged'
  })
  expect(store.state(stateInput(request), controllerId, principal)).toMatchObject({
    latest: { revision: 2 },
    requested: { revision: 1 }
  })
})

it.each(['value', 'public', 'cas'] as const)(
  'rejects reuse of UUID with changed %s and commits nothing',
  (change) => {
    const request = input()
    store.stage(request, controllerId, principal)
    const changed = structuredClone(request)
    if (change === 'value') changed.values.runtime_env.APP_TOKEN = 'different'
    if (change === 'public') changed.values.public_build_args.NEXT_PUBLIC_NAME = 'different'
    if (change === 'cas') changed.expected_latest_revision = 1
    expect(() => store.stage(changed, controllerId, principal)).toThrow(
      'PRODUCT_ENVIRONMENT_IDEMPOTENCY_CONFLICT'
    )
    expect(count('product_environment_revision')).toBe(1)
  }
)

it('namespaces request lookup by OS principal and rejects stale CAS on a separate connection', () => {
  const request = input()
  store.stage(request, controllerId, principal)
  expect(store.state(stateInput(request), controllerId, 'unix:1001').requested).toBeNull()
  const other = new Database(join(root, 'opspilot.db'))
  try {
    const second = new ProductEnvironmentRepository(other, cipher)
    expect(() => second.stage(request, controllerId, 'unix:1001')).toThrow(
      'PRODUCT_ENVIRONMENT_REVISION_CONFLICT'
    )
    expect(() => second.stage({ ...input() }, controllerId, principal)).toThrow(
      'PRODUCT_ENVIRONMENT_REVISION_CONFLICT'
    )
    expect(second.stage(request, controllerId, principal).state).toBe('already_staged')
  } finally {
    other.close()
  }
})

it.each(['format', 'extra', 'principal', 'controller', 'transaction', 'source'] as const)(
  'rejects invalid %s before secret encryption',
  (change) => {
    const request: Record<string, unknown> = { ...input() }
    const encrypt = vi.spyOn(cipher, 'encrypt')
    if (change === 'format') request.format = 2
    if (change === 'extra') request.secret = secret
    if (change === 'source') request.expected_source_generation = 2
    if (change === 'transaction') db.exec('BEGIN')
    try {
      expect(() =>
        store.stage(
          request,
          change === 'controller' ? 'other' : controllerId,
          change === 'principal' ? 'payload:admin' : principal
        )
      ).toThrow(/PRODUCT_ENVIRONMENT_/)
      expect(encrypt).not.toHaveBeenCalled()
      expect(count('product_environment_revision')).toBe(0)
    } finally {
      if (db.inTransaction) db.exec('ROLLBACK')
    }
  }
)

it.each(['receipt_encrypt', 'receipt_insert', 'authority_change'] as const)(
  'rolls back the revision if %s fails',
  (change) => {
    const original = cipher.encrypt.bind(cipher)
    if (change === 'receipt_insert')
      db.exec(
        "CREATE TRIGGER fail_receipt BEFORE INSERT ON product_environment_request BEGIN SELECT RAISE(ABORT,'SYNTHETIC_ONLY_ENV_ADMIN_MARKER_7729'); END"
      )
    else {
      let calls = 0
      vi.spyOn(cipher, 'encrypt').mockImplementation((value) => {
        calls++
        if (calls === 2) {
          if (change === 'receipt_encrypt') throw new Error(secret)
          db.prepare("UPDATE product_controller SET status='stopped'").run()
        }
        return original(value)
      })
    }
    expect(() => store.stage(input(), controllerId, principal)).toThrow(
      /^PRODUCT_ENVIRONMENT_[A-Z_]+$/
    )
    expect(count('product_environment_revision')).toBe(0)
    expect(count('product_environment_request')).toBe(0)
    expect(db.inTransaction).toBe(false)
    expect(db.prepare('SELECT status FROM product_controller').get()).toEqual({ status: 'active' })
  }
)

it.each(['tag', 'request_key', 'principal', 'purpose', 'values'] as const)(
  'refuses tampered receipt %s for retry and lookup',
  (change) => {
    const request = input()
    store.stage(request, controllerId, principal)
    db.exec('DROP TRIGGER product_environment_request_immutable')
    if (change === 'tag') {
      const row = db.prepare('SELECT auth_tag FROM product_environment_request').get() as {
        auth_tag: Buffer
      }
      row.auth_tag[0] ^= 1
      db.prepare('UPDATE product_environment_request SET auth_tag=?').run(row.auth_tag)
    } else if (change === 'request_key') {
      request.request_key = randomUUID()
      db.prepare('UPDATE product_environment_request SET request_key=?').run(request.request_key)
    } else if (change === 'principal')
      db.prepare('UPDATE product_environment_request SET administrator_id=?').run('unix:1001')
    else {
      const row = db.prepare('SELECT * FROM product_environment_request').get() as Parameters<
        typeof cipher.decrypt
      >[0]
      const envelope = JSON.parse(cipher.decrypt(row))
      if (change === 'purpose') envelope.purpose = 'other'
      else envelope.request.values.runtime_env.APP_TOKEN = 'changed'
      const encrypted = cipher.encrypt(JSON.stringify(envelope))
      db.prepare('UPDATE product_environment_request SET encrypted_secret=?,iv=?,auth_tag=?').run(
        encrypted.encrypted_secret,
        encrypted.iv,
        encrypted.auth_tag
      )
    }
    const who = change === 'principal' ? 'unix:1001' : principal
    expect(() => store.stage(request, controllerId, who)).toThrow('PRODUCT_ENVIRONMENT_UNAVAILABLE')
    expect(() => store.state(stateInput(request), controllerId, who)).toThrow(
      'PRODUCT_ENVIRONMENT_UNAVAILABLE'
    )
  }
)

it('refuses old requests and lookup when source, target or owner authority changes', () => {
  const request = input()
  store.stage(request, controllerId, principal)
  db.prepare("UPDATE vps SET archived_at='2026-11-14T00:00:00Z'").run()
  expect(() => store.stage(request, controllerId, principal)).toThrow(
    'PRODUCT_ENVIRONMENT_AUTHORITY_REJECTED'
  )
  expect(() => store.state(stateInput(request), controllerId, principal)).toThrow(
    'PRODUCT_ENVIRONMENT_AUTHORITY_REJECTED'
  )
  db.prepare('UPDATE vps SET archived_at=NULL').run()
  expect(() =>
    store.stage({ ...request, expected_source_generation: 2 }, controllerId, principal)
  ).toThrow('PRODUCT_ENVIRONMENT_SOURCE_CHANGED')
})

it('rechecks current source after decrypt before committing the staged receipt', () => {
  const original = cipher.decrypt.bind(cipher)
  let changed = false
  vi.spyOn(cipher, 'decrypt').mockImplementation((row) => {
    if (!changed) {
      changed = true
      db.exec(`INSERT INTO product_source_config SELECT app_id,2,repository_url,production_ref,
        repository_root,deploy_config_json,config_sha256,created_at FROM product_source_config WHERE app_id=1;
        UPDATE product_app_control SET source_generation=2 WHERE app_id=1`)
    }
    return original(row)
  })
  expect(() => store.stage(input(), controllerId, principal)).toThrow(
    'PRODUCT_ENVIRONMENT_SOURCE_CHANGED'
  )
  expect(count('product_environment_revision')).toBe(0)
  expect(count('product_environment_request')).toBe(0)
  expect(db.prepare('SELECT source_generation n FROM product_app_control').get()).toEqual({ n: 1 })
})

it('authenticates the stored receipt before returning success and rolls back invalid cipher output', () => {
  const original = cipher.encrypt.bind(cipher)
  let calls = 0
  vi.spyOn(cipher, 'encrypt').mockImplementation((value) =>
    original(++calls === 2 ? '{"purpose":"other"}' : value)
  )
  expect(() => store.stage(input(), controllerId, principal)).toThrow(
    'PRODUCT_ENVIRONMENT_UNAVAILABLE'
  )
  expect(count('product_environment_revision')).toBe(0)
  expect(count('product_environment_request')).toBe(0)
})

it('retains immutable receipt and revision and upgrades schema032 without losing ciphertext', () => {
  const request = input(),
    staged = store.stage(request, controllerId, principal)
  expect(() => db.exec('DELETE FROM product_environment_request')).toThrow(
    'PRODUCT_ENVIRONMENT_REQUEST_IMMUTABLE'
  )
  expect(() => db.exec("UPDATE product_environment_request SET created_at='changed'")).toThrow(
    'PRODUCT_ENVIRONMENT_REQUEST_IMMUTABLE'
  )
  db.exec('DROP TABLE product_environment_request; DELETE FROM schema_version WHERE version=33')
  const before = db.prepare('SELECT encrypted_secret FROM product_environment_revision').get()
  // Fixture này là Desktop; không dùng controller role để bỏ qua role fence.
  runMigrations(db)
  expect(db.prepare('SELECT max(version) n FROM schema_version').get()).toEqual({ n: 34 })
  expect(db.prepare('SELECT encrypted_secret FROM product_environment_revision').get()).toEqual(
    before
  )
  expect(store.state(stateInput(request), controllerId, principal)).toMatchObject({
    latest: staged.metadata,
    requested: null
  })
})
