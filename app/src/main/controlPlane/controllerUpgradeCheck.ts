import Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { runMigrations } from '../db'
import { assertReleaseDirectory, readReleaseFile } from './controllerRelease'
import type { ControllerUpgradeSnapshot } from '../../../../docs/contracts/product-controller-upgrade'

const digest = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
const fail = (): never => {
  throw Error('CONTROLLER_INSTALL_UPGRADE_CHECK_FAILED')
}
const schema = (db: Database.Database): string =>
  digest(
    JSON.stringify(
      db
        .prepare(
          "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name"
        )
        .all()
    )
  )

/** Pure inspection of an existing DB. Fresh expected schema exists in RAM only. */
export function openControllerUpgradeCheck(
  directory: string,
  hold = false
): {
  snapshot: ControllerUpgradeSnapshot
  close: () => void
} {
  process.umask(0o077)
  if (!isAbsolute(directory) || resolve(directory) !== directory) fail()
  assertReleaseDirectory(directory)
  const uid = process.getuid?.(),
    file = join(directory, 'opspilot.db'),
    keyPath = join(directory, '.controller-runtime-key'),
    info = lstatSync(file),
    keyInfo = lstatSync(keyPath)
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
  const key = readReleaseFile(keyPath, 32)
  if (key.length !== 32 || (process.platform !== 'win32' && (keyInfo.mode & 0o777) !== 0o600)) {
    key.fill(0)
    fail()
  }
  const keyHash = digest(key)
  key.fill(0)
  const expected = new Database(':memory:')
  let db: Database.Database | undefined
  try {
    expected.pragma('journal_mode = WAL')
    expected.pragma('foreign_keys = ON')
    runMigrations(expected)
    db = new Database(file, { readonly: !hold, fileMustExist: true, timeout: 5000 })
    db.exec(hold ? 'BEGIN IMMEDIATE' : 'BEGIN')
    if (hold) db.pragma('query_only = ON') // No row/schema writes even in the mutex transaction.
    const schemaHash = schema(db)
    if (schemaHash !== schema(expected)) fail()
    const versions = 'SELECT version FROM schema_version ORDER BY version'
    if (
      JSON.stringify(db.prepare(versions).all()) !==
      JSON.stringify(expected.prepare(versions).all())
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
        `SELECT 1 FROM product_app_control WHERE mode='product' AND auto_deploy_paused<>1
      UNION ALL SELECT 1 FROM product_deploy_job WHERE state IN ('queued','claimed','deploying','retry_wait','uncertain')
      UNION ALL SELECT 1 FROM product_app_lease WHERE released_at IS NULL
      UNION ALL SELECT 1 FROM product_worker_lease WHERE released_at IS NULL
      UNION ALL SELECT 1 FROM deployment_activation WHERE state='prepared'
      UNION ALL SELECT 1 FROM product_runtime_terminal WHERE settled_at IS NULL OR leases_released_at IS NULL LIMIT 1`
      )
      .get()
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as Array<{ name: string }>
    const hash = createHash('sha256')
    let rows = 0
    for (const { name } of tables) {
      // Bulk operational samples do not define upgrade authority. No raw row leaves this process.
      if (['metric_sample', 'score_sample', 'alert'].includes(name)) continue
      if (!/^[a-z][a-z0-9_]*$/.test(name)) fail()
      hash.update(name + '\n')
      for (const row of db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).iterate()) {
        if (++rows > 100_000) fail()
        const text = JSON.stringify(row)
        if (Buffer.byteLength(text) > 8 * 1024 * 1024) fail()
        hash.update(text + '\n')
      }
    }
    const opened = db
    return {
      snapshot: {
        format: 1,
        controller_id: controllers[0].controller_id,
        schema_sha256: schemaHash,
        state_sha256: hash.digest('hex'),
        key_sha256: keyHash,
        database_inode: info.ino,
        key_inode: keyInfo.ino,
        quiescent: !busy
      },
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
  } finally {
    expected.close()
  }
}

export async function runControllerUpgradeCheck(directory: string, hold: boolean): Promise<void> {
  const check = openControllerUpgradeCheck(directory, hold)
  try {
    console.log(JSON.stringify(check.snapshot))
    if (!hold) return
    // Root parent owns the pipe. Any EOF/SIGTERM/timeout releases DB and inherited flock.
    await new Promise<void>((done) => {
      const timer = setTimeout(finish, 90_000)
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
