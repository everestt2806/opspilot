import Database from 'better-sqlite3'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes, randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { runMigrations } from '../db'
import { assertControllerRuntimeSchema, openControllerUpgradeCheck } from './controllerUpgradeCheck'
import {
  backupControllerSchema,
  transitionControllerPostgresSchema
} from './controllerSchemaUpgrade'
import { controllerPostgresSchemaCommandSchema } from './controllerSchemaUpgradeProtocol'

let root: string, data: string, backup: string, db: Database.Database
const request = randomUUID(),
  id = randomUUID()
const snapshot = (): ReturnType<typeof openControllerUpgradeCheck>['snapshot'] => {
  const check = openControllerUpgradeCheck(data, false, true)
  try {
    return check.snapshot
  } finally {
    check.close()
  }
}
const seal = (): void => {
  chmodSync(join(backup, 'backup.sqlite'), 0o440)
  chmodSync(backup, 0o550)
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'opspilot-postgres-schema-'))
  data = join(root, 'data')
  backup = join(root, 'backup')
  mkdirSync(data, { mode: 0o700 })
  mkdirSync(backup, { mode: 0o700 })
  db = new Database(join(data, 'opspilot.db'))
  db.pragma('journal_mode=WAL')
  db.pragma('foreign_keys=ON')
  runMigrations(db, 35, 'controller')
  db.prepare("INSERT INTO product_controller VALUES(?,'2026-11-16T00:00:00.000Z','active')").run(id)
  db.exec(
    "INSERT INTO vps(id,name,host,username,auth_type,encrypted_secret) VALUES(1,'original','fixture.test','operator','key',X'00');INSERT INTO app(id,vps_id,name,framework,host_port,container_port) VALUES(1,1,'sample','express',30000,3000)"
  )
  writeFileSync(
    join(data, '.product-controller-initialized'),
    JSON.stringify({ format: 1, controller_id: id }),
    { mode: 0o600 }
  )
  writeFileSync(join(data, '.controller-runtime-key'), randomBytes(32), { mode: 0o600 })
  chmodSync(join(data, 'opspilot.db'), 0o600)
})
afterEach(() => {
  db.close()
  chmodSync(backup, 0o700)
  try {
    chmodSync(join(backup, 'backup.sqlite'), 0o600)
  } catch {
    /* rejected/no backup */
  }
  rmSync(root, { recursive: true, force: true })
})

it('backs up WAL35, atomically applies private037 and replays only unchanged projection/key/inodes', async () => {
  const before = snapshot(),
    key = readFileSync(join(data, '.controller-runtime-key')),
    proof = await backupControllerSchema(data, backup, request, before, 35)
  seal()
  const after = transitionControllerPostgresSchema(data, backup, proof, before, 'apply')
  expect(after.snapshot.schema_version).toBe(37)
  expect(after.projection35).toEqual(before)
  expect(after.snapshot.database_inode).toBe(before.database_inode)
  expect(after.snapshot.key_inode).toBe(before.key_inode)
  expect(readFileSync(join(data, '.controller-runtime-key'))).toEqual(key)
  expect(db.prepare('SELECT name FROM vps').get()).toEqual({ name: 'original' })
  expect(transitionControllerPostgresSchema(data, backup, proof, before, 'apply')).toEqual(after)
  expect(transitionControllerPostgresSchema(data, backup, proof, after.snapshot, 'apply')).toEqual(
    after
  )
  // Production startup remains035 until the Root release upgrade has been integrated.
  expect(() => assertControllerRuntimeSchema(data)).toThrow('CHECK_FAILED')
})
it('reverts only empty PG schema, preserves later35 rows and reconciles a lost revert reply', async () => {
  const before = snapshot(),
    proof = await backupControllerSchema(data, backup, request, before, 35)
  seal()
  transitionControllerPostgresSchema(data, backup, proof, before, 'apply')
  db.exec(
    "INSERT INTO vps(id,name,host,username,auth_type,encrypted_secret) VALUES(2,'later','later.test','operator','key',X'01')"
  )
  const current = snapshot(),
    check = transitionControllerPostgresSchema(data, backup, proof, current, 'can-revert'),
    result = transitionControllerPostgresSchema(
      data,
      backup,
      proof,
      current,
      'revert',
      check.projection35
    )
  expect(result.snapshot).toEqual(check.projection35)
  expect(result.snapshot.schema_version).toBe(35)
  expect(db.prepare('SELECT name FROM vps WHERE id=2').get()).toEqual({ name: 'later' })
  expect(
    transitionControllerPostgresSchema(data, backup, proof, current, 'revert', check.projection35)
  ).toEqual(result)
})
it('retained encrypted prepared resource blocks downgrade and is never deleted', async () => {
  const before = snapshot(),
    proof = await backupControllerSchema(data, backup, request, before, 35)
  seal()
  transitionControllerPostgresSchema(data, backup, proof, before, 'apply')
  db.prepare(
    `INSERT INTO product_managed_postgres(database_id,controller_id,app_id,ownership_generation,target_binding_json,framework,image,crypto_scheme,encrypted_secret,iv,auth_tag,created_at)
    VALUES(?,?,1,1,'{}','express','fixture','aes_256_gcm',X'00',zeroblob(12),zeroblob(16),'2026-11-16T00:00:00.000Z')`
  ).run(randomUUID(), id)
  const current = snapshot()
  expect(() =>
    transitionControllerPostgresSchema(data, backup, proof, current, 'can-revert')
  ).toThrow('ROLLBACK_UNSAFE')
  expect(() => transitionControllerPostgresSchema(data, backup, proof, current, 'revert')).toThrow(
    'ROLLBACK_UNSAFE'
  )
  expect(snapshot()).toEqual(current)
  expect(db.prepare('SELECT count(*) n FROM product_managed_postgres').get()).toEqual({ n: 1 })
})
it('rollback permission distinguishes existing user environment from empty managed database state', async () => {
  const before = snapshot(),
    proof = await backupControllerSchema(data, backup, request, before, 35)
  seal()
  transitionControllerPostgresSchema(data, backup, proof, before, 'apply')
  db.prepare(
    "INSERT INTO product_source_config VALUES(1,1,'https://example.test/app.git','main','.','{}',?,'2026-11-16T00:00:00.000Z')"
  ).run('a'.repeat(64))
  db.prepare(
    `INSERT INTO product_environment_revision(controller_id,app_id,ownership_generation,revision,basis_source_generation,basis_source_config_sha256,target_binding_json,framework,runtime_keys_json,public_build_keys_json,crypto_scheme,encrypted_secret,iv,auth_tag,created_at)
    VALUES(?,1,1,1,1,?,'{}','express','[]','[]','aes_256_gcm',X'00',zeroblob(12),zeroblob(16),'2026-11-16T00:00:00.000Z')`
  ).run(id, 'a'.repeat(64))
  const check = transitionControllerPostgresSchema(data, backup, proof, snapshot(), 'can-revert')
  expect(check.legacy_environment_reversible).toBe(false)
  expect(check.projection29).toBeUndefined()
  expect(
    transitionControllerPostgresSchema(
      data,
      backup,
      proof,
      snapshot(),
      'revert',
      check.projection35
    ).snapshot.schema_version
  ).toBe(35)
  expect(db.prepare('SELECT count(*) n FROM product_environment_revision').get()).toEqual({ n: 1 })
})
it('changed retained target pin blocks downgrade even before any database is prepared', async () => {
  db.prepare(
    `INSERT INTO product_target_enrollment(controller_id,app_id,ownership_generation,target_binding_json,manifest_sha256,target_root,state,receipt_json,created_at,updated_at)
    VALUES(?,1,1,'{}',?,'/private/targets','enrolled','{}','2026-11-16T00:00:00.000Z','2026-11-16T00:00:00.000Z')`
  ).run(id, 'a'.repeat(64))
  const before = snapshot(),
    proof = await backupControllerSchema(data, backup, request, before, 35)
  seal()
  transitionControllerPostgresSchema(data, backup, proof, before, 'apply')
  db.prepare('UPDATE product_target_enrollment SET manifest_sha256=?').run('b'.repeat(64))
  const current = snapshot()
  expect(() =>
    transitionControllerPostgresSchema(data, backup, proof, current, 'can-revert')
  ).toThrow('ROLLBACK_UNSAFE')
  expect(snapshot()).toEqual(current)
})
it('failed version insertion rolls back all new DDL and baseline tables', async () => {
  const before = snapshot(),
    proof = await backupControllerSchema(data, backup, request, before, 35)
  seal()
  expect(() =>
    transitionControllerPostgresSchema(data, backup, proof, before, 'apply', undefined, {
      afterMigration: () => {
        throw Error('PRIVATE_TRANSACTION_FAULT')
      }
    })
  ).toThrow('POSTGRES_TRANSITION_FAILED')
  expect(snapshot()).toEqual(before)
  expect(
    db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'product_%postgres%'").all()
  ).toEqual([])
})
it('rejects unsealed/tampered backup and stale baseline before applying DDL', async () => {
  const before = snapshot(),
    proof = await backupControllerSchema(data, backup, request, before, 35)
  // Windows has no root-owned immutable mode check, but hash protection still applies.
  seal()
  chmodSync(join(backup, 'backup.sqlite'), 0o600)
  const bytes = readFileSync(join(backup, 'backup.sqlite'))
  bytes[bytes.length - 1] ^= 1
  writeFileSync(join(backup, 'backup.sqlite'), bytes)
  seal()
  expect(() => transitionControllerPostgresSchema(data, backup, proof, before, 'apply')).toThrow(
    'BACKUP_CHANGED'
  )
  expect(snapshot()).toEqual(before)
})
it('accepts only exact35/37 and rejects SQL, paths and UID overrides in dedicated command protocol', () => {
  const before = snapshot(),
    input = {
      format: 1,
      request_key: request,
      expected: { ...before, database_inode: 1, key_inode: 2 }
    }
  expect(controllerPostgresSchemaCommandSchema.safeParse(input).success).toBe(true)
  for (const value of [undefined, 29, 30, 32, 33, 36, 38])
    expect(
      controllerPostgresSchemaCommandSchema.safeParse({
        ...input,
        expected: { ...input.expected, schema_version: value }
      }).success
    ).toBe(false)
  for (const value of [{ sql: 'DROP TABLE app' }, { path: '/other' }, { uid: 0 }])
    expect(controllerPostgresSchemaCommandSchema.safeParse({ ...input, ...value }).success).toBe(
      false
    )
})
