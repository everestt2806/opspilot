import Database from 'better-sqlite3'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  chmodSync,
  lstatSync,
  linkSync,
  unlinkSync
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes, randomUUID } from 'node:crypto'
import { beforeEach, afterEach, it, expect } from 'vitest'
import { runMigrations } from '../db'
import { assertControllerRuntimeSchema, openControllerUpgradeCheck } from './controllerUpgradeCheck'
import {
  backupControllerSchema,
  transitionControllerSchema,
  controllerBackupFileHash
} from './controllerSchemaUpgrade'
import type { ControllerUpgradeSnapshot } from '../../../../docs/contracts/product-controller-upgrade'
let root: string, data: string, backup: string, db: Database.Database, id: string
const request = randomUUID()
const snapshot = (): ControllerUpgradeSnapshot => {
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
  root = mkdtempSync(join(tmpdir(), 'opspilot-schema-transition-'))
  data = join(root, 'data')
  backup = join(root, 'backup')
  mkdirSync(data, { mode: 0o700 })
  mkdirSync(backup, { mode: 0o700 })
  db = new Database(join(data, 'opspilot.db'))
  db.pragma('journal_mode=WAL')
  db.pragma('foreign_keys=ON')
  runMigrations(db, 29, 'controller')
  id = randomUUID()
  db.prepare("INSERT INTO product_controller VALUES(?,'2026-11-14T00:00:00.000Z','active')").run(id)
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
    /* No backup in rejected cases. */
  }
  rmSync(root, { recursive: true, force: true })
})
it('backs up WAL state consistently and applies exact additive migrations atomically without changing old records/key/inodes', async () => {
  const before = snapshot(),
    key = readFileSync(join(data, '.controller-runtime-key'))
  expect(() => assertControllerRuntimeSchema(data)).toThrow('CHECK_FAILED')
  expect(snapshot()).toEqual(before)
  const proof = await backupControllerSchema(data, backup, request, before)
  const copy = new Database(join(backup, 'backup.sqlite'), { readonly: true })
  try {
    expect(copy.prepare('SELECT name FROM vps').get()).toEqual({ name: 'original' })
    expect(copy.pragma('integrity_check', { simple: true })).toBe('ok')
  } finally {
    copy.close()
  }
  seal()
  const result = transitionControllerSchema(data, backup, proof, before, 'apply')
  expect(result.snapshot.schema_version).toBe(35)
  expect(() => assertControllerRuntimeSchema(data)).not.toThrow()
  expect(result.projection29).toEqual(before)
  expect(result.snapshot.database_inode).toBe(before.database_inode)
  expect(result.snapshot.key_inode).toBe(before.key_inode)
  expect(readFileSync(join(data, '.controller-runtime-key'))).toEqual(key)
  expect(db.prepare('SELECT name FROM vps').get()).toEqual({ name: 'original' })
  expect(
    db.prepare('SELECT version FROM schema_version WHERE version IN(30,31,34,36)').all()
  ).toEqual([])
  expect(transitionControllerSchema(data, backup, proof, result.snapshot, 'apply')).toEqual(result)
  expect(transitionControllerSchema(data, backup, proof, before, 'apply')).toEqual(result)
})
it('reverses only empty added tables and preserves old-schema rows created after activation', async () => {
  const before = snapshot(),
    proof = await backupControllerSchema(data, backup, request, before)
  seal()
  transitionControllerSchema(data, backup, proof, before, 'apply')
  db.exec(
    "INSERT INTO vps(id,name,host,username,auth_type,encrypted_secret) VALUES(2,'created-later','other.test','operator','key',X'01')"
  )
  const current = snapshot(),
    projection = transitionControllerSchema(data, backup, proof, current, 'can-revert').projection29
  const result = transitionControllerSchema(data, backup, proof, current, 'revert')
  expect(result.snapshot).toEqual(projection)
  expect(result.snapshot.schema_version).toBe(29)
  expect(db.prepare('SELECT name FROM vps ORDER BY id').all()).toEqual([
    { name: 'original' },
    { name: 'created-later' }
  ])
  expect(controllerBackupFileHash(join(backup, 'backup.sqlite'))).toBe(proof.backup_sha256)
  expect(transitionControllerSchema(data, backup, proof, current, 'revert', projection)).toEqual(
    result
  )
})
it('refuses rollback when an environment source reference exists, without changing schema or records', async () => {
  const before = snapshot(),
    proof = await backupControllerSchema(data, backup, request, before)
  seal()
  transitionControllerSchema(data, backup, proof, before, 'apply')
  db.prepare(
    "INSERT INTO product_source_config VALUES(1,1,'https://github.com/example/app.git','main','.',?,?,?)"
  ).run('{"environment":{"revision":1}}', 'a'.repeat(64), new Date().toISOString())
  const current = snapshot()
  expect(() => transitionControllerSchema(data, backup, proof, current, 'can-revert')).toThrow(
    'ROLLBACK_UNSAFE'
  )
  expect(() => transitionControllerSchema(data, backup, proof, current, 'revert')).toThrow(
    'ROLLBACK_UNSAFE'
  )
  expect(snapshot()).toEqual(current)
})
it('rejects stale source state and does not migrate or overwrite a backup', async () => {
  const before = snapshot(),
    proof = await backupControllerSchema(data, backup, request, before)
  db.exec("UPDATE vps SET name='changed'")
  await expect(backupControllerSchema(data, backup, request, before)).rejects.toThrow(
    'STATE_CHANGED'
  )
  seal()
  expect(() => transitionControllerSchema(data, backup, proof, before, 'apply')).toThrow(
    'STATE_CHANGED'
  )
  expect(snapshot().schema_version).toBe(29)
})
it('reuses a completed backup without overwriting and repairs only a matching interrupted promotion link', async () => {
  const before = snapshot(),
    proof = await backupControllerSchema(data, backup, request, before)
  const file = join(backup, 'backup.sqlite'),
    ino = lstatSync(file).ino,
    partial = join(backup, '.backup-' + 'a'.repeat(32) + '.partial')
  linkSync(file, partial)
  expect(lstatSync(file).nlink).toBe(2)
  expect(await backupControllerSchema(data, backup, request, before)).toEqual(proof)
  expect(lstatSync(file).ino).toBe(ino)
  expect(lstatSync(file).nlink).toBe(1)
})
it('rejects an unrecognized hardlink or changed backup bytes before mutation', async () => {
  const before = snapshot(),
    proof = await backupControllerSchema(data, backup, request, before),
    file = join(backup, 'backup.sqlite'),
    other = join(backup, 'not-an-owned-partial')
  linkSync(file, other)
  await expect(backupControllerSchema(data, backup, request, before)).rejects.toThrow(
    'BACKUP_INVALID'
  )
  unlinkSync(other)
  const raw = readFileSync(file)
  raw[raw.length - 1] ^= 1
  writeFileSync(file, raw)
  seal()
  expect(() => transitionControllerSchema(data, backup, proof, before, 'apply')).toThrow(
    'BACKUP_CHANGED'
  )
  expect(snapshot().schema_version).toBe(29)
})
it('rejects unapproved schema and a changed key before creating a backup', async () => {
  const before = snapshot()
  db.exec('CREATE TABLE not_supported(value TEXT)')
  await expect(backupControllerSchema(data, backup, request, before)).rejects.toThrow()
  db.exec('DROP TABLE not_supported')
  writeFileSync(join(data, '.controller-runtime-key'), randomBytes(32))
  await expect(backupControllerSchema(data, backup, request, before)).rejects.toThrow(
    'STATE_CHANGED'
  )
})
it('reads rollback eligibility while another connection holds the IMMEDIATE no-write mutex', async () => {
  const before = snapshot(),
    proof = await backupControllerSchema(data, backup, request, before)
  seal()
  transitionControllerSchema(data, backup, proof, before, 'apply')
  const hold = openControllerUpgradeCheck(data, true)
  try {
    expect(
      transitionControllerSchema(data, backup, proof, hold.snapshot, 'can-revert').snapshot
    ).toEqual(hold.snapshot)
  } finally {
    hold.close()
  }
})
it('rejects replay after legitimate old-schema changes', async () => {
  const before = snapshot(),
    proof = await backupControllerSchema(data, backup, request, before)
  seal()
  transitionControllerSchema(data, backup, proof, before, 'apply')
  db.exec("UPDATE vps SET name='new-name'")
  const current = snapshot()
  expect(() => transitionControllerSchema(data, backup, proof, before, 'apply')).toThrow(
    'STATE_CHANGED'
  )
  expect(snapshot()).toEqual(current)
})
