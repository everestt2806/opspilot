import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { runMigrations } from '../db'
import { assertReleaseDirectory, readReleaseFile } from './controllerRelease'
import type { ControllerUpgradeSnapshot } from '../../../../docs/contracts/product-controller-upgrade'
export const controllerUpgradeDigest = (value: string | Buffer): string =>
  createHash('sha256').update(value).digest('hex')
const fail = (): never => {
  throw Error('CONTROLLER_INSTALL_UPGRADE_CHECK_FAILED')
}
export function controllerUpgradeSchemaHash(db: Database.Database): string {
  return controllerUpgradeDigest(
    JSON.stringify(
      db
        .prepare(
          "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name"
        )
        .all()
    )
  )
}
/** Revision startup checks schema only; normal history growth must not inherit the upgrade hash cap. */
export function assertControllerRuntimeSchema(directory: string): void {
  if (!isAbsolute(directory) || resolve(directory) !== directory) fail()
  assertReleaseDirectory(directory)
  const file = join(directory, 'opspilot.db'),
    info = lstatSync(file)
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    (process.platform !== 'win32' &&
      (info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o600))
  )
    fail()
  const db = new Database(file, { readonly: true, fileMustExist: true, timeout: 5000 }),
    expected = new Database(':memory:')
  try {
    db.exec('BEGIN')
    runMigrations(expected, 35, 'controller')
    if (
      controllerUpgradeSchemaHash(db) !== controllerUpgradeSchemaHash(expected) ||
      JSON.stringify(db.prepare('SELECT version FROM schema_version ORDER BY version').all()) !==
        JSON.stringify(
          expected.prepare('SELECT version FROM schema_version ORDER BY version').all()
        )
    )
      fail()
  } finally {
    db.close()
    expected.close()
  }
}
/** Trusted internal inspection. Caller owns the transaction; no migration or DB open. */
export function inspectControllerUpgradeDatabase(
  directory: string,
  db: Database.Database,
  project29 = false
): ControllerUpgradeSnapshot {
  if (!db.inTransaction || !isAbsolute(directory) || resolve(directory) !== directory) fail()
  assertReleaseDirectory(directory)
  const uid = process.getuid?.(),
    info = lstatSync(join(directory, 'opspilot.db')),
    keyInfo = lstatSync(join(directory, '.controller-runtime-key'))
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    (process.platform !== 'win32' && (info.uid !== uid || (info.mode & 0o777) !== 0o600))
  )
    fail()
  const marker = JSON.parse(
    readReleaseFile(join(directory, '.product-controller-initialized'), 512).toString('utf8')
  )
  const key = readReleaseFile(join(directory, '.controller-runtime-key'), 32)
  if (key.length !== 32 || (process.platform !== 'win32' && (keyInfo.mode & 0o777) !== 0o600)) {
    key.fill(0)
    fail()
  }
  const keyHash = controllerUpgradeDigest(key)
  key.fill(0)
  const rawVersion = (
    db.prepare('SELECT MAX(version) v FROM schema_version').get() as { v: number }
  ).v
  const version: 29 | 35 = rawVersion === 29 ? 29 : rawVersion === 35 ? 35 : fail()
  const expected = new Database(':memory:')
  let projection: Database.Database | undefined
  try {
    expected.pragma('foreign_keys=ON')
    runMigrations(expected, version, 'controller')
    const schemaHash = controllerUpgradeSchemaHash(db)
    if (
      schemaHash !== controllerUpgradeSchemaHash(expected) ||
      JSON.stringify(db.prepare('SELECT version FROM schema_version ORDER BY version').all()) !==
        JSON.stringify(
          expected.prepare('SELECT version FROM schema_version ORDER BY version').all()
        )
    )
      fail()
    if (
      db.pragma('integrity_check', { simple: true }) !== 'ok' ||
      (db.pragma('foreign_key_check') as unknown[]).length !== 0
    )
      fail()
    const controllers = db
      .prepare('SELECT controller_id,status FROM product_controller')
      .all() as Array<{ controller_id: string; status: string }>
    if (
      controllers.length !== 1 ||
      controllers[0].status !== 'active' ||
      marker.format !== 1 ||
      marker.controller_id !== controllers[0].controller_id
    )
      fail()
    const busy = db
      .prepare(
        "SELECT 1 FROM product_app_control WHERE mode='product' AND auto_deploy_paused<>1 UNION ALL SELECT 1 FROM product_deploy_job WHERE state IN ('queued','claimed','deploying','retry_wait','uncertain') UNION ALL SELECT 1 FROM product_app_lease WHERE released_at IS NULL UNION ALL SELECT 1 FROM product_worker_lease WHERE released_at IS NULL UNION ALL SELECT 1 FROM deployment_activation WHERE state='prepared' UNION ALL SELECT 1 FROM product_runtime_terminal WHERE settled_at IS NULL OR leases_released_at IS NULL UNION ALL SELECT 1 FROM experiment_run WHERE status='running' LIMIT 1"
      )
      .get()
    let tableSource = expected,
      resultSchema = schemaHash
    if (project29 && version === 35) {
      projection = new Database(':memory:')
      projection.pragma('foreign_keys=ON')
      runMigrations(projection, 29, 'controller')
      tableSource = projection
      resultSchema = controllerUpgradeSchemaHash(projection)
    }
    const tables = tableSource
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as Array<{ name: string }>
    const hash = createHash('sha256')
    let rows = 0
    for (const { name } of tables) {
      if (['metric_sample', 'score_sample', 'alert'].includes(name)) continue
      if (!/^[a-z][a-z0-9_]*$/.test(name)) fail()
      hash.update(name + '\n')
      const filter = project29 && name === 'schema_version' ? ' WHERE version<=29' : ''
      for (const row of db
        .prepare('SELECT * FROM "' + name + '"' + filter + ' ORDER BY rowid')
        .iterate()) {
        if (++rows > 100000) fail()
        const text = JSON.stringify(row)
        if (Buffer.byteLength(text) > 8 * 1024 * 1024) fail()
        hash.update(text + '\n')
      }
    }
    return {
      format: 1,
      controller_id: controllers[0].controller_id,
      schema_sha256: resultSchema,
      state_sha256: hash.digest('hex'),
      key_sha256: keyHash,
      database_inode: info.ino,
      key_inode: keyInfo.ino,
      quiescent: !busy,
      schema_version: project29 ? 29 : version
    }
  } finally {
    projection?.close()
    expected.close()
  }
}
/** Default exact latest; the trusted upgrade CLI explicitly admits only29/35. */
export function openControllerUpgradeCheck(
  directory: string,
  hold = false,
  acceptLegacy = false
): { snapshot: ControllerUpgradeSnapshot; close: () => void } {
  process.umask(0o077)
  if (!isAbsolute(directory) || resolve(directory) !== directory) fail()
  assertReleaseDirectory(directory)
  let db: Database.Database | undefined
  try {
    db = new Database(join(directory, 'opspilot.db'), {
      readonly: !hold,
      fileMustExist: true,
      timeout: 5000
    })
    db.exec(hold ? 'BEGIN IMMEDIATE' : 'BEGIN')
    if (hold) db.pragma('query_only=ON')
    const snapshot = inspectControllerUpgradeDatabase(directory, db)
    if (!acceptLegacy && snapshot.schema_version !== 35) fail()
    const opened = db
    return {
      snapshot,
      close: () => {
        if (opened.open) {
          if (opened.inTransaction) opened.exec('ROLLBACK')
          opened.close()
        }
      }
    }
  } catch {
    if (db?.open) db.close()
    return fail()
  }
}
export async function runControllerUpgradeCheck(directory: string, hold: boolean): Promise<void> {
  const check = openControllerUpgradeCheck(directory, hold, true)
  try {
    console.log(JSON.stringify(check.snapshot))
    if (!hold) return
    await new Promise<void>((done) => {
      const timer = setTimeout(finish, 90000)
      function finish(): void {
        clearTimeout(timer)
        process.stdin.pause()
        process.stdin.removeListener('data', finish)
        process.stdin.removeListener('end', finish)
        process.stdin.removeListener('error', finish)
        process.removeListener('SIGTERM', finish)
        done()
      }
      process.stdin.once('data', finish)
      process.stdin.once('end', finish)
      process.stdin.once('error', finish)
      process.once('SIGTERM', finish)
      process.stdin.resume()
    })
  } finally {
    check.close()
  }
}
