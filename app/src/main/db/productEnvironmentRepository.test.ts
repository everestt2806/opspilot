import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ProductEnvironmentScope,
  ProductEnvironmentWriteInput
} from '../../../../docs/contracts/product-environment'
import { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import { ProductEnvironmentRepository } from './productEnvironmentRepository'
import { initializeDatabase, closeDatabase, runMigrations } from './index'

let directory: string,
  db: Database.Database,
  cipher: AesGcmCredentialCipher,
  store: ProductEnvironmentRepository
const pin = 'SHA256:' + 'A'.repeat(43)
const source = '{"framework":"nextjs"}'
const hash = createHash('sha256').update(source).digest('hex')
const scope: ProductEnvironmentScope = {
  controller_id: 'env-controller',
  app_id: 1,
  ownership_generation: 1,
  target: {
    vps_id: 1,
    host: 'example.test',
    port: 22,
    username: 'operator',
    auth_type: 'key',
    host_fingerprint: pin,
    ssh_security_revision: 1
  }
}
const secret = 'SYNTHETIC_ENV_VALUE_NEVER_A_REAL_CREDENTIAL_47392'
const input = (): ProductEnvironmentWriteInput => ({
  scope: structuredClone(scope),
  expected_latest_revision: null,
  expected_source_generation: 1,
  expected_source_config_sha256: hash,
  values: {
    runtime_env: { APP_TOKEN: secret, EMPTY: '', QUOTED: 'a=b $literal "value" # comment' },
    public_build_args: { NEXT_PUBLIC_TITLE: 'Sổ Đọc' }
  }
})
function seed(database: Database.Database): void {
  database
    .prepare(
      "INSERT INTO vps(id,name,host,port,username,auth_type,host_fingerprint,ssh_security_revision,encrypted_secret) VALUES(1,'test','example.test',22,'operator','key',?,1,X'00')"
    )
    .run(pin)
  database.exec(
    "INSERT INTO app(id,vps_id,name,framework,host_port,container_port) VALUES(1,1,'env-app','nextjs',30000,3000); INSERT INTO product_controller VALUES('env-controller','2026-11-14T00:00:00.000Z','active')"
  )
  database
    .prepare(
      "INSERT INTO product_source_config VALUES(1,1,'https://example.test/repo.git','main','.',?,?,?)"
    )
    .run(source, hash, '2026-11-14T00:00:00.000Z')
  database
    .prepare(
      "INSERT INTO product_app_control(app_id,mode,controller_id,ownership_generation,source_generation,source_config_sha256,changed_at) VALUES(1,'product','env-controller',1,1,?,'2026-11-14T00:00:00.000Z')"
    )
    .run(hash)
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'opspilot-env-revision-'))
  db = initializeDatabase(directory)
  cipher = new AesGcmCredentialCipher(randomBytes(32))
  store = new ProductEnvironmentRepository(db, cipher)
  seed(db)
})
afterEach(() => {
  closeDatabase()
  rmSync(directory, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('Product staged environment encrypted revisions', () => {
  it.each(['express', 'static-spa'] as const)(
    'stores runtime/public scopes for %s without changing deployment settings',
    (framework) => {
      const config = JSON.stringify({ framework }),
        digest = createHash('sha256').update(config).digest('hex')
      db.transaction(() => {
        db.pragma('defer_foreign_keys=ON')
        db.prepare('UPDATE app SET framework=?').run(framework)
        db.prepare('UPDATE product_source_config SET deploy_config_json=?,config_sha256=?').run(
          config,
          digest
        )
        db.prepare('UPDATE product_app_control SET source_config_sha256=?').run(digest)
      })()
      const request = input()
      request.expected_source_config_sha256 = digest
      request.values.public_build_args = framework === 'express' ? {} : { VITE_TITLE: 'Sổ Đọc' }
      expect(store.append(request).framework).toBe(framework)
      expect(store.readValues(scope, 1)).toEqual(request.values)
      if (framework === 'express')
        expect(() =>
          store.append({
            ...request,
            expected_latest_revision: 1,
            values: { runtime_env: {}, public_build_args: { NEXT_PUBLIC_TEST: secret } }
          })
        ).toThrow('PRODUCT_ENVIRONMENT_INPUT_INVALID')
    }
  )
  it('never initializes a missing cipher/key, and new target revisions cannot decrypt old envelopes', () => {
    const missing = new ProductEnvironmentRepository(
      db,
      undefined as unknown as AesGcmCredentialCipher
    )
    expect(() => missing.append(input())).toThrow('PRODUCT_ENVIRONMENT_UNAVAILABLE')
    expect(existsSync(join(directory, '.controller-runtime-key'))).toBe(false)
    store.append(input())
    db.prepare('UPDATE vps SET port=2222').run()
    const revision = (db.prepare('SELECT ssh_security_revision n FROM vps').get() as { n: number })
      .n
    const changed = {
      ...scope,
      target: { ...scope.target, port: 2222, ssh_security_revision: revision }
    }
    expect(() => store.readValues(changed, 1)).toThrow('PRODUCT_ENVIRONMENT_UNAVAILABLE')
    expect(store.append({ ...input(), scope: changed, expected_latest_revision: 1 }).revision).toBe(
      2
    )
    expect(store.readValues(changed, 2)).toEqual(input().values)
  })
  it('roundtrips encrypted values after file-backed reopen, exposes keys only and never activates', () => {
    const before = db.prepare('SELECT * FROM product_app_control').get()
    const result = store.append(input())
    expect(result).toMatchObject({
      revision: 1,
      activation: 'staged',
      framework: 'nextjs',
      runtime_keys: ['APP_TOKEN', 'EMPTY', 'QUOTED'],
      public_build_keys: ['NEXT_PUBLIC_TITLE']
    })
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(JSON.stringify(result)).not.toContain('encrypted_secret')
    expect(db.prepare('SELECT * FROM product_app_control').get()).toEqual(before)
    for (const table of ['product_deploy_job', 'deployment', 'product_history_event'])
      expect(db.prepare('SELECT count(*) n FROM ' + table).get()).toEqual({ n: 0 })
    closeDatabase()
    db = initializeDatabase(directory)
    store = new ProductEnvironmentRepository(db, cipher)
    expect(store.metadata(scope, 1)).toEqual(result)
    expect(store.readValues(scope, 1)).toEqual(input().values)
    db.pragma('wal_checkpoint(TRUNCATE)')
    for (const suffix of ['', '-wal']) {
      const file = join(directory, 'opspilot.db' + suffix)
      if (existsSync(file)) expect(readFileSync(file).includes(Buffer.from(secret))).toBe(false)
    }
  })
  it('allocates CAS revisions across two real connections, retains old values, encrypts equal snapshots differently', () => {
    store.append(input())
    const other = new Database(join(directory, 'opspilot.db'))
    try {
      const second = new ProductEnvironmentRepository(other, cipher)
      expect(second.append({ ...input(), expected_latest_revision: 1 }).revision).toBe(2)
      expect(() => store.append({ ...input(), expected_latest_revision: 1 })).toThrow(
        'PRODUCT_ENVIRONMENT_REVISION_CONFLICT'
      )
      expect(store.readValues(scope, 1)).toEqual(store.readValues(scope, 2))
      const rows = db
        .prepare('SELECT encrypted_secret,iv FROM product_environment_revision ORDER BY revision')
        .all() as Array<{ encrypted_secret: Buffer; iv: Buffer }>
      expect(rows[0].iv.equals(rows[1].iv)).toBe(false)
      expect(rows[0].encrypted_secret.equals(rows[1].encrypted_secret)).toBe(false)
    } finally {
      other.close()
    }
  })
  it('requires expected source identity, validates actual canonical JSON digest and preserves caller transaction', () => {
    expect(() => store.append({ ...input(), expected_source_generation: 2 })).toThrow(
      'PRODUCT_ENVIRONMENT_SOURCE_CHANGED'
    )
    expect(() =>
      store.append({ ...input(), expected_source_config_sha256: 'b'.repeat(64) })
    ).toThrow('PRODUCT_ENVIRONMENT_SOURCE_CHANGED')
    db.exec('BEGIN IMMEDIATE')
    try {
      expect(() => store.append(input())).toThrow('PRODUCT_ENVIRONMENT_INPUT_INVALID')
      expect(db.inTransaction).toBe(true)
    } finally {
      db.exec('ROLLBACK')
    }
    db.prepare("UPDATE product_source_config SET deploy_config_json='{}'").run()
    expect(() => store.append(input())).toThrow('PRODUCT_ENVIRONMENT_AUTHORITY_REJECTED')
    expect(db.prepare('SELECT count(*) n FROM product_environment_revision').get()).toEqual({
      n: 0
    })
  })
  it.each([
    ['controller', "UPDATE product_controller SET status='maintenance'"],
    ['owner', 'UPDATE product_app_control SET ownership_generation=2'],
    ['mode', "UPDATE product_app_control SET mode='desktop',controller_id=NULL"],
    ['archived', "UPDATE vps SET archived_at='2026-11-14T00:00:00Z'"],
    ['pin', "UPDATE vps SET host_fingerprint='SHA256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'"],
    ['port', 'UPDATE vps SET port=2222'],
    ['user', "UPDATE vps SET username='changed'"],
    ['host', "UPDATE vps SET host='other.test'"],
    ['revision', 'UPDATE vps SET ssh_security_revision=2']
  ])('rejects changed %s before append or decrypt', (_kind, sql) => {
    store.append(input())
    db.exec(sql)
    const decrypt = vi.spyOn(cipher, 'decrypt')
    expect(() => store.append({ ...input(), expected_latest_revision: 1 })).toThrow(
      'PRODUCT_ENVIRONMENT_AUTHORITY_REJECTED'
    )
    expect(() => store.readValues(scope, 1)).toThrow('PRODUCT_ENVIRONMENT_AUTHORITY_REJECTED')
    expect(decrypt).not.toHaveBeenCalled()
  })
  it('keeps old revision available for explicit rollback after source advances; stale writer is refused', () => {
    const meta = store.append(input())
    db.prepare(
      "INSERT INTO product_source_config VALUES(1,2,'https://example.test/repo.git','main','.',?,?,?)"
    ).run(source, hash, '2026-11-14T00:00:01.000Z')
    db.prepare('UPDATE product_app_control SET source_generation=2').run()
    expect(store.metadata(scope, 1)).toEqual(meta)
    expect(store.readValues(scope, 1)).toEqual(input().values)
    expect(() => store.append({ ...input(), expected_latest_revision: 1 })).toThrow(
      'PRODUCT_ENVIRONMENT_SOURCE_CHANGED'
    )
    expect(
      store.append({ ...input(), expected_latest_revision: 1, expected_source_generation: 2 })
        .revision
    ).toBe(2)
  })
  it.each([
    'controller_id',
    'app_id',
    'ownership_generation',
    'target',
    'cipher',
    'iv',
    'tag',
    'metadata',
    'purpose',
    'wrong-key'
  ])('refuses authenticated envelope/row swapping or %s tamper', (kind) => {
    store.append(input())
    db.exec('DROP TRIGGER product_environment_revision_immutable')
    if (kind === 'wrong-key') {
      store = new ProductEnvironmentRepository(db, new AesGcmCredentialCipher(randomBytes(32)))
    } else if (kind === 'cipher' || kind === 'iv' || kind === 'tag') {
      const column = kind === 'cipher' ? 'encrypted_secret' : kind === 'tag' ? 'auth_tag' : 'iv'
      const row = db
        .prepare('SELECT ' + column + ' AS bytes FROM product_environment_revision')
        .get() as { bytes: Buffer }
      row.bytes[0] ^= 1
      db.prepare('UPDATE product_environment_revision SET ' + column + '=?').run(row.bytes)
    } else if (kind === 'metadata')
      db.prepare("UPDATE product_environment_revision SET runtime_keys_json='[]'").run()
    else {
      const row = db.prepare('SELECT * FROM product_environment_revision').get() as Parameters<
        AesGcmCredentialCipher['decrypt']
      >[0]
      const decoded = JSON.parse(cipher.decrypt(row))
      if (kind === 'purpose') decoded.purpose = 'other-purpose'
      else if (kind === 'target') decoded.scope.target.host = 'other.test'
      else decoded.scope[kind] = kind === 'controller_id' ? 'other-controller' : 2
      const enc = cipher.encrypt(JSON.stringify(decoded))
      db.prepare('UPDATE product_environment_revision SET encrypted_secret=?,iv=?,auth_tag=?').run(
        enc.encrypted_secret,
        enc.iv,
        enc.auth_tag
      )
    }
    expect(() => store.readValues(scope, 1)).toThrow('PRODUCT_ENVIRONMENT_UNAVAILABLE')
    expect(() => store.metadata(scope, 1)).toThrow('PRODUCT_ENVIRONMENT_UNAVAILABLE')
  })
  it('retains immutable revision, hides cipher/storage errors and rolls back encryption callback authority changes', () => {
    store.append(input())
    expect(() => db.exec('DELETE FROM product_environment_revision')).toThrow(
      'PRODUCT_ENVIRONMENT_IMMUTABLE'
    )
    expect(() => db.exec("UPDATE product_environment_revision SET runtime_keys_json='[]'")).toThrow(
      'PRODUCT_ENVIRONMENT_IMMUTABLE'
    )
    const encrypt = vi.spyOn(cipher, 'encrypt').mockImplementationOnce(() => {
      throw Error(secret)
    })
    expect(() => store.append({ ...input(), expected_latest_revision: 1 })).toThrow(
      'PRODUCT_ENVIRONMENT_UNAVAILABLE'
    )
    encrypt.mockRestore()
    const original = cipher.encrypt.bind(cipher)
    vi.spyOn(cipher, 'encrypt').mockImplementationOnce((value) => {
      db.exec("UPDATE product_controller SET status='maintenance'")
      return original(value)
    })
    expect(() => store.append({ ...input(), expected_latest_revision: 1 })).toThrow(
      'PRODUCT_ENVIRONMENT_AUTHORITY_REJECTED'
    )
    expect(db.prepare('SELECT status FROM product_controller').get()).toEqual({ status: 'active' })
    expect(db.prepare('SELECT count(*) n FROM product_environment_revision').get()).toEqual({
      n: 1
    })
  })
  it.each([
    'NODE_ENV',
    'PORT',
    'DATABASE_URL',
    'POSTGRES_PASSWORD',
    'NODE_OPTIONS',
    'OPSPILOT_TEST',
    'NPM_CONFIG_TEST',
    'LD_PRELOAD',
    'NEXT_PUBLIC_TOKEN',
    'VITE_TOKEN'
  ])('rejects reserved or public key %s in secret runtime scope without storing it', (key) => {
    const request = input()
    request.values.runtime_env = { [key]: secret }
    expect(() => store.append(request)).toThrow('PRODUCT_ENVIRONMENT_INPUT_INVALID')
    expect(db.prepare('SELECT count(*) n FROM product_environment_revision').get()).toEqual({
      n: 0
    })
  })
  it.each([
    'bad-key',
    'value-type',
    'newline',
    'null',
    'value-bytes',
    'total-bytes',
    'count',
    'scope-prefix',
    'unknown-field'
  ])('bounds %s and never leaks supplied values', (kind) => {
    const request: unknown = kind === 'unknown-field' ? { ...input(), api_token: secret } : input()
    const values = (request as ProductEnvironmentWriteInput).values
    if (kind === 'bad-key') values.runtime_env = { 'BAD=NAME': secret }
    if (kind === 'value-type')
      (values.runtime_env as Record<string, unknown>).APP_TOKEN = { secret }
    if (kind === 'newline') values.runtime_env.APP_TOKEN = secret + '\nINJECT=x'
    if (kind === 'null') values.runtime_env.APP_TOKEN = secret + '\0'
    if (kind === 'value-bytes') values.runtime_env.APP_TOKEN = 'ế'.repeat(3000)
    if (kind === 'total-bytes')
      values.runtime_env = Object.fromEntries(
        Array.from({ length: 9 }, (_, i) => ['KEY_' + i, 'a'.repeat(8000)])
      )
    if (kind === 'count')
      values.runtime_env = Object.fromEntries(
        Array.from({ length: 129 }, (_, i) => ['KEY_' + i, ''])
      )
    if (kind === 'scope-prefix') values.public_build_args = { VITE_NAME: secret }
    try {
      store.append(request)
      throw Error('EXPECTED_REJECTION')
    } catch (error) {
      expect((error as Error).message).toBe('PRODUCT_ENVIRONMENT_INPUT_INVALID')
      expect(JSON.stringify(error)).not.toContain(secret)
    }
  })
  it('migration031 upgrade and controller role create additive empty table while keeping app/source/credentials', () => {
    closeDatabase()
    const prior = new Database(join(directory, 'prior.db'))
    prior.pragma('journal_mode=WAL')
    prior.pragma('foreign_keys=ON')
    try {
      runMigrations(prior, 31)
      seed(prior)
      const before = prior.prepare('SELECT * FROM vps').get()
      runMigrations(prior)
      expect(prior.prepare('SELECT * FROM vps').get()).toEqual(before)
      expect(prior.prepare('SELECT count(*) n FROM product_environment_revision').get()).toEqual({
        n: 0
      })
      expect(prior.prepare('SELECT max(version) n FROM schema_version').get()).toEqual({ n: 32 })
      expect(prior.pragma('foreign_key_check')).toEqual([])
      expect(new ProductEnvironmentRepository(prior, cipher).append(input()).revision).toBe(1)
    } finally {
      prior.close()
    }
    db = initializeDatabase(join(directory, 'controller'), 'controller')
    expect(db.prepare('SELECT max(version) n FROM schema_version').get()).toEqual({ n: 32 })
    expect(db.prepare('SELECT version FROM schema_version WHERE version IN(30,31)').all()).toEqual(
      []
    )
  })
})
