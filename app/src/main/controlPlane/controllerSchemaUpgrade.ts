import Database from 'better-sqlite3'
import { createHash, randomBytes } from 'node:crypto'
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  readSync,
  fsyncSync,
  lstatSync,
  existsSync,
  readdirSync,
  linkSync,
  unlinkSync,
  chmodSync
} from 'node:fs'
import { join, resolve, isAbsolute } from 'node:path'
import type { ControllerUpgradeSnapshot } from '../../../../docs/contracts/product-controller-upgrade'
import { assertReleaseDirectory } from './controllerRelease'
import { runMigrations } from '../db'
import { inspectControllerUpgradeDatabase } from './controllerUpgradeCheck'
import postgresMigration from '../db/migrations/037_product_managed_postgres.sql?raw'

const CAP = 512 * 1024 * 1024
const tables = [
  'product_source_environment',
  'product_environment_request',
  'product_environment_revision'
]
const fail = (code: string): never => {
  throw Error('CONTROLLER_INSTALL_SCHEMA_' + code)
}
export type ControllerSchemaBackup = {
  format: 1
  request_key: string
  backup_sha256: string
  before: ControllerUpgradeSnapshot
}
export type ControllerSchemaTransition = {
  snapshot: ControllerUpgradeSnapshot
  projection29: ControllerUpgradeSnapshot
}
export type ControllerPostgresSchemaTransition = {
  snapshot: ControllerUpgradeSnapshot
  projection35: ControllerUpgradeSnapshot
  legacy_environment_reversible: boolean
  projection29?: ControllerUpgradeSnapshot
}
function same(expected: ControllerUpgradeSnapshot, actual: ControllerUpgradeSnapshot): void {
  for (const field of [
    'controller_id',
    'schema_sha256',
    'state_sha256',
    'key_sha256',
    'database_inode',
    'key_inode',
    'quiescent'
  ] as const)
    if (expected[field] !== actual[field]) fail('STATE_CHANGED')
  if (!actual.quiescent) fail('NOT_QUIESCENT')
}
function directory(path: string): void {
  if (!isAbsolute(path) || resolve(path) !== path) fail('PATH_INVALID')
  assertReleaseDirectory(path)
  const info = lstatSync(path)
  if (process.platform !== 'win32' && (info.uid !== process.getuid?.() || info.mode & 0o077))
    fail('PATH_INVALID')
}
function identity(left: ControllerUpgradeSnapshot, right: ControllerUpgradeSnapshot): void {
  if (
    left.controller_id !== right.controller_id ||
    left.key_sha256 !== right.key_sha256 ||
    left.key_inode !== right.key_inode ||
    left.database_inode !== right.database_inode
  )
    fail('IDENTITY_CHANGED')
}
export function controllerBackupFileHash(file: string): string {
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const info = fstatSync(fd)
    if (!info.isFile() || info.nlink !== 1 || info.size < 512 || info.size > CAP)
      fail('BACKUP_INVALID')
    const hash = createHash('sha256'),
      chunk = Buffer.alloc(1024 * 1024)
    for (;;) {
      const n = readSync(fd, chunk)
      if (!n) break
      hash.update(chunk.subarray(0, n))
    }
    const after = fstatSync(fd),
      path = lstatSync(file)
    if (
      after.size !== info.size ||
      after.ino !== info.ino ||
      after.mtimeMs !== info.mtimeMs ||
      path.isSymbolicLink() ||
      path.ino !== info.ino ||
      path.dev !== info.dev
    )
      fail('BACKUP_CHANGED')
    return hash.digest('hex')
  } finally {
    closeSync(fd)
  }
}
function backupSnapshot(data: string, file: string): ControllerUpgradeSnapshot {
  const db = new Database(file, { readonly: true, fileMustExist: true })
  try {
    db.exec('BEGIN')
    return inspectControllerUpgradeDatabase(data, db)
  } finally {
    db.close()
  }
}
function repairedPromotion(file: string): void {
  const info = lstatSync(file)
  if (
    info.isSymbolicLink() ||
    !info.isFile() ||
    (process.platform !== 'win32' &&
      (info.uid !== process.getuid?.() || (info.mode & 0o777) !== 0o600))
  )
    fail('BACKUP_INVALID')
  if (info.nlink === 1) return
  if (info.nlink !== 2) fail('BACKUP_INVALID')
  const parent = resolve(file, '..'),
    matches = readdirSync(parent)
      .filter((name) => /^\.backup-[a-f0-9]{32}\.partial$/.test(name))
      .filter((name) => {
        const s = lstatSync(join(parent, name))
        return s.isFile() && !s.isSymbolicLink() && s.ino === info.ino && s.dev === info.dev
      })
  if (matches.length !== 1) fail('BACKUP_INVALID')
  unlinkSync(join(parent, matches[0]))
}
function sync(path: string): void {
  const folder = lstatSync(path).isDirectory()
  if (folder && process.platform === 'win32') return
  const fd = openSync(path, folder ? constants.O_RDONLY : constants.O_RDWR)
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}
/** Parent Root owns the installation flock and creates this service-owned private directory. */
export async function backupControllerSchema(
  data: string,
  backupDirectory: string,
  requestKey: string,
  expected: ControllerUpgradeSnapshot,
  baseline: 29 | 35 = 29
): Promise<ControllerSchemaBackup> {
  process.umask(0o077)
  directory(backupDirectory)
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(requestKey))
    fail('INPUT_INVALID')
  const db = new Database(join(data, 'opspilot.db'), {
      readonly: true,
      fileMustExist: true,
      timeout: 5000
    }),
    file = join(backupDirectory, 'backup.sqlite')
  const temporary = join(backupDirectory, '.backup-' + randomBytes(16).toString('hex') + '.partial')
  let phase = 'COPY'
  try {
    db.exec('BEGIN')
    const before = inspectControllerUpgradeDatabase(data, db)
    if (before.schema_version !== baseline) fail('VERSION_UNSUPPORTED')
    same(expected, before)
    if (existsSync(file)) {
      repairedPromotion(file)
      same(expected, backupSnapshot(data, file))
      return {
        format: 1,
        request_key: requestKey,
        backup_sha256: controllerBackupFileHash(file),
        before
      }
    }
    const pageSize = db.pragma('page_size', { simple: true }) as number,
      started = Date.now()
    await db.backup(temporary, {
      progress: ({ totalPages }) => {
        if (totalPages * pageSize > CAP || Date.now() - started > 60000) fail('BACKUP_LIMIT')
        return 128
      }
    })
    const standalone = new Database(temporary, { fileMustExist: true })
    try {
      standalone.pragma('journal_mode=DELETE')
    } finally {
      standalone.close()
    }
    chmodSync(temporary, 0o600)
    sync(temporary)
    phase = 'VERIFY'
    same(before, backupSnapshot(data, temporary))
    // Atomic exclusive promotion. A crash between link/unlink is repaired by inode, never by overwriting.
    phase = 'PROMOTE'
    linkSync(temporary, file)
    unlinkSync(temporary)
    phase = 'SYNC'
    sync(backupDirectory)
    return {
      format: 1,
      request_key: requestKey,
      backup_sha256: controllerBackupFileHash(file),
      before
    }
  } catch (error) {
    if (error instanceof Error && /^CONTROLLER_INSTALL_SCHEMA_[A-Z_]+$/.test(error.message))
      throw error
    return fail('BACKUP_' + phase + '_FAILED')
  } finally {
    db.close()
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}
function sealedBackup(data: string, backupDirectory: string, proof: ControllerSchemaBackup): void {
  const parent = lstatSync(backupDirectory),
    file = join(backupDirectory, 'backup.sqlite'),
    info = lstatSync(file)
  if (
    parent.isSymbolicLink() ||
    !parent.isDirectory() ||
    info.isSymbolicLink() ||
    !info.isFile() ||
    info.nlink !== 1
  )
    fail('BACKUP_INVALID')
  if (
    process.platform !== 'win32' &&
    (parent.uid !== 0 ||
      info.uid !== 0 ||
      (parent.mode & 0o222) !== 0 ||
      (info.mode & 0o222) !== 0 ||
      (info.mode & 0o007) !== 0)
  )
    fail('BACKUP_NOT_SEALED')
  if (controllerBackupFileHash(file) !== proof.backup_sha256) fail('BACKUP_CHANGED')
  same(proof.before, backupSnapshot(data, file))
}
function reversible(db: Database.Database): boolean {
  if (
    tables.some(
      (name) => (db.prepare('SELECT count(*) n FROM ' + name).get() as { n: number }).n !== 0
    )
  )
    return false
  return !db
    .prepare(
      "SELECT 1 FROM product_source_config WHERE NOT json_valid(deploy_config_json) OR json_type(deploy_config_json,'$.environment') IS NOT NULL LIMIT 1"
    )
    .get()
}
/** No automatic service startup, policy write, initializer or plaintext record leaves this module. */
export function transitionControllerSchema(
  data: string,
  backupDirectory: string,
  proof: ControllerSchemaBackup,
  expected: ControllerUpgradeSnapshot,
  operation: 'apply' | 'can-revert' | 'revert',
  rollbackProjection?: ControllerUpgradeSnapshot
): ControllerSchemaTransition {
  sealedBackup(data, backupDirectory, proof)
  const db = new Database(join(data, 'opspilot.db'), {
    fileMustExist: true,
    readonly: operation === 'can-revert',
    timeout: 5000
  })
  try {
    db.pragma('foreign_keys=ON')
    const transaction = db.transaction(() => {
      const before = inspectControllerUpgradeDatabase(data, db)
      identity(proof.before, before)
      if (operation === 'apply') {
        if (before.schema_version === 29) {
          same(expected, before)
          same(proof.before, before)
          runMigrations(db, 35, 'controller')
        } else if (before.schema_version === 35) {
          // A committed transaction may outlive its reply. Only the original29 intent
          // or this exact35 snapshot can recover it; the old projection is checked below.
          same(expected, expected.schema_version === 29 ? proof.before : before)
        } else fail('VERSION_UNSUPPORTED')
        const after = inspectControllerUpgradeDatabase(data, db),
          projection = inspectControllerUpgradeDatabase(data, db, true)
        same(proof.before, projection)
        if (!reversible(db)) fail('MIGRATION_CHANGED_DATA')
        return { snapshot: after, projection29: projection }
      }
      if (operation === 'revert' && before.schema_version === 29) {
        if (expected.schema_version !== 35 || !rollbackProjection) fail('STATE_CHANGED')
        identity(expected, before)
        same(rollbackProjection!, before)
        return { snapshot: before, projection29: before }
      }
      same(expected, before)
      if (before.schema_version !== 35) fail('VERSION_UNSUPPORTED')
      if (!reversible(db)) fail('ROLLBACK_UNSAFE')
      const projection = inspectControllerUpgradeDatabase(data, db, true)
      if (operation === 'can-revert') return { snapshot: before, projection29: projection }
      if (rollbackProjection) same(rollbackProjection, projection)
      for (const table of tables) db.exec('DROP TABLE ' + table)
      db.exec('DELETE FROM schema_version WHERE version IN(32,33,35)')
      const after = inspectControllerUpgradeDatabase(data, db)
      same(projection, after)
      return { snapshot: after, projection29: projection }
    })
    return operation === 'can-revert' ? transaction.deferred() : transaction.immediate()
  } catch (error) {
    if (error instanceof Error && /^CONTROLLER_INSTALL_SCHEMA_[A-Z_]+$/.test(error.message))
      throw error
    return fail('TRANSITION_FAILED')
  } finally {
    db.close()
  }
}

const postgresTables = [
  'product_postgres_selection_request',
  'product_source_postgres',
  'product_managed_postgres_request',
  'product_managed_postgres'
]
function reversiblePostgres(db: Database.Database): boolean {
  return (
    postgresTables.every(
      (name) => (db.prepare('SELECT count(*) n FROM ' + name).get() as { n: number }).n === 0
    ) &&
    !db
      .prepare(
        "SELECT 1 FROM product_source_config WHERE NOT json_valid(deploy_config_json) OR json_type(deploy_config_json,'$.database') IS NOT NULL LIMIT 1"
      )
      .get()
  )
}
function unchangedRetainedTargets(db: Database.Database, backupDirectory: string): boolean {
  const backup = new Database(join(backupDirectory, 'backup.sqlite'), {
    readonly: true,
    fileMustExist: true
  })
  try {
    const sql = `SELECT controller_id,app_id,ownership_generation,target_binding_json,manifest_sha256,target_root,state
      FROM product_target_enrollment ORDER BY controller_id,app_id,ownership_generation`
    return JSON.stringify(db.prepare(sql).all()) === JSON.stringify(backup.prepare(sql).all())
  } finally {
    backup.close()
  }
}
/** Private037 prerequisite gate. Root orchestration must seal a separate35 backup;
 * do not register the normal migration or start a37 service before that integration.
 * A retained resource/request/binding blocks downgrade even before Docker activation.
 */
export function transitionControllerPostgresSchema(
  data: string,
  backupDirectory: string,
  proof: ControllerSchemaBackup,
  expected: ControllerUpgradeSnapshot,
  operation: 'apply' | 'can-revert' | 'revert',
  rollbackProjection?: ControllerUpgradeSnapshot,
  hooks: { afterMigration?: () => void } = {}
): ControllerPostgresSchemaTransition {
  if (proof.before.schema_version !== 35 || ![35, 37].includes(expected.schema_version ?? 0))
    fail('VERSION_UNSUPPORTED')
  sealedBackup(data, backupDirectory, proof)
  const db = new Database(join(data, 'opspilot.db'), {
    fileMustExist: true,
    readonly: operation === 'can-revert',
    timeout: 5000
  })
  try {
    db.pragma('foreign_keys=ON')
    const run = db.transaction(() => {
      const before = inspectControllerUpgradeDatabase(data, db)
      identity(proof.before, before)
      if (operation === 'apply') {
        if (before.schema_version === 35) {
          same(expected, before)
          same(proof.before, before)
          db.exec(postgresMigration)
          hooks.afterMigration?.()
          db.prepare('INSERT INTO schema_version(version) VALUES(37)').run()
        } else if (before.schema_version === 37) {
          same(expected, expected.schema_version === 35 ? proof.before : before)
        } else fail('VERSION_UNSUPPORTED')
        const snapshot = inspectControllerUpgradeDatabase(data, db),
          projection35 = inspectControllerUpgradeDatabase(data, db, 35)
        same(proof.before, projection35)
        if (!reversiblePostgres(db)) fail('MIGRATION_CHANGED_DATA')
        return { snapshot, projection35, legacy_environment_reversible: reversible(db) }
      }
      if (operation === 'revert' && before.schema_version === 35) {
        if (expected.schema_version !== 37 || !rollbackProjection) fail('STATE_CHANGED')
        identity(expected, before)
        same(rollbackProjection!, before)
        const legacy_environment_reversible = reversible(db)
        return {
          snapshot: before,
          projection35: before,
          legacy_environment_reversible,
          ...(legacy_environment_reversible
            ? { projection29: inspectControllerUpgradeDatabase(data, db, true) }
            : {})
        }
      }
      same(expected, before)
      if (before.schema_version !== 37) fail('VERSION_UNSUPPORTED')
      if (!reversiblePostgres(db) || !unchangedRetainedTargets(db, backupDirectory))
        fail('ROLLBACK_UNSAFE')
      const projection35 = inspectControllerUpgradeDatabase(data, db, 35),
        legacy_environment_reversible = reversible(db),
        projection29 = legacy_environment_reversible
          ? inspectControllerUpgradeDatabase(data, db, true)
          : undefined
      if (operation === 'can-revert')
        return {
          snapshot: before,
          projection35,
          legacy_environment_reversible,
          ...(projection29 ? { projection29 } : {})
        }
      if (rollbackProjection) same(rollbackProjection, projection35)
      for (const table of postgresTables) db.exec('DROP TABLE ' + table)
      db.prepare('DELETE FROM schema_version WHERE version=37').run()
      const after = inspectControllerUpgradeDatabase(data, db)
      same(projection35, after)
      return {
        snapshot: after,
        projection35,
        legacy_environment_reversible,
        ...(projection29 ? { projection29 } : {})
      }
    })
    return operation === 'can-revert' ? run.deferred() : run.immediate()
  } catch (error) {
    if (error instanceof Error && /^CONTROLLER_INSTALL_SCHEMA_[A-Z_]+$/.test(error.message))
      throw error
    return fail('POSTGRES_TRANSITION_FAILED')
  } finally {
    db.close()
  }
}
