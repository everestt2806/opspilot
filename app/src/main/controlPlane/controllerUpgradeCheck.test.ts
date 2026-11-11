import Database from 'better-sqlite3'
import { randomBytes } from 'node:crypto'
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  existsSync,
  lstatSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach, expect, it } from 'vitest'
import { initializeController } from './controllerDatabase'
import { openControllerUpgradeCheck } from './controllerUpgradeCheck'
let directory: string, db: Database.Database
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'opspilot-upgrade-check-'))
  initializeController(directory)
  writeFileSync(join(directory, '.controller-runtime-key'), randomBytes(32), { mode: 0o600 })
  db = new Database(join(directory, 'opspilot.db'))
  db.pragma('foreign_keys=ON')
})
afterEach(() => {
  db.close()
  expect(directory.startsWith(join(tmpdir(), 'opspilot-upgrade-check-'))).toBe(true)
  expect(lstatSync(directory).isSymbolicLink()).toBe(false)
  rmSync(directory, { recursive: true })
})
it('reads exact live schema/identity/key and hashes state without changing rows or key', () => {
  const bytes = readFileSync(join(directory, '.controller-runtime-key')),
    before = db.prepare('SELECT * FROM schema_version').all(),
    check = openControllerUpgradeCheck(directory)
  expect(check.snapshot).toMatchObject({ format: 1, quiescent: true })
  expect(check.snapshot.key_sha256).toMatch(/^[a-f0-9]{64}$/)
  check.close()
  expect(db.prepare('SELECT * FROM schema_version').all()).toEqual(before)
  expect(readFileSync(join(directory, '.controller-runtime-key')).equals(bytes)).toBe(true)
  expect(JSON.stringify(check.snapshot)).not.toContain(bytes.toString('base64'))
})
it('does not repair a changed schema or regenerate a missing key', () => {
  db.exec('CREATE TABLE unapproved(id INTEGER)')
  expect(() => openControllerUpgradeCheck(directory)).toThrow('UPGRADE_CHECK_FAILED')
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name='unapproved'").get()).toBeTruthy()
})
it('holds an IMMEDIATE no-write transaction so manual admission cannot race service stop', () => {
  const before = db.prepare('SELECT * FROM vps').all(),
    check = openControllerUpgradeCheck(directory, true)
  db.pragma('busy_timeout=30')
  expect(() =>
    db.exec(
      "INSERT INTO vps(name,host,username,auth_type,encrypted_secret) VALUES('blocked','example.test','ops','key',X'00')"
    )
  ).toThrow(/locked|busy/i)
  check.close()
  expect(db.prepare('SELECT * FROM vps').all()).toEqual(before)
  db.exec(
    "INSERT INTO vps(name,host,username,auth_type,encrypted_secret) VALUES('after','example.test','ops','key',X'00')"
  )
  const next = openControllerUpgradeCheck(directory)
  expect(next.snapshot.state_sha256).not.toBe(check.snapshot.state_sha256)
  next.close()
})
it('rejects a controller identity marker mismatch without rewriting it', () => {
  const file = join(directory, '.product-controller-initialized'),
    bad = JSON.stringify({ format: 1, controller_id: 'wrong' })
  writeFileSync(file, bad)
  expect(() => openControllerUpgradeCheck(directory)).toThrow('UPGRADE_CHECK_FAILED')
  expect(readFileSync(file, 'utf8')).toBe(bad)
})
it('does not create a missing key', () => {
  const file = join(directory, '.controller-runtime-key')
  unlinkSync(file)
  expect(() => openControllerUpgradeCheck(directory)).toThrow()
  expect(existsSync(file)).toBe(false)
})
