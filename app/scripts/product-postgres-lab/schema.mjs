/* eslint-disable @typescript-eslint/explicit-function-return-type -- Native Linux SQL/FS prerequisite. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
if (
  process.platform !== 'linux' ||
  process.getuid() !== 0 ||
  !process.version.startsWith('v22.') ||
  process.argv.slice(2).join(' ') !== '--confirm-local-postgres-schema'
)
  throw Error('EXPLICIT_ROOT_LINUX_NODE22_LOCAL_SCHEMA_GATE_REQUIRED')
const artifact = process.env.OPSPILOT_CONTROL_PLANE_OUTPUT,
  modules = process.env.OPSPILOT_CONTROL_PLANE_MODULES
if (!artifact || !modules) throw Error('PRIVATE_LINUX_ARTIFACT_REQUIRED')
const helper = join(dirname(dirname(artifact)), 'prepare-lab.cjs'),
  {
    initializeController,
    backupControllerSchema,
    transitionControllerPostgresSchema,
    openControllerUpgradeCheck,
    assertControllerRuntimeSchema
  } = createRequire(helper)(helper),
  Database = createRequire(join(modules, 'package.json'))('better-sqlite3'),
  scratch = mkdtempSync(join(tmpdir(), 'opspilot-postgres-schema-')),
  nonce = randomBytes(6).toString('hex'),
  output = resolve(import.meta.dirname, '../../.out-scripts/product-postgres-schema', nonce),
  checks = []
chmodSync(scratch, 0o700)
mkdirSync(output, { recursive: true })
const proof = {
    format: 1,
    nonce,
    state: 'RUNNING',
    serving_vps_used: false,
    initializer_remains_035: true,
    artifact_sha256: createHash('sha256').update(readFileSync(helper)).digest('hex'),
    checks
  },
  check = (name, value = true) => {
    assert.ok(value, name)
    checks.push(name)
    console.log('PASS ' + name)
  },
  snapshot = (data) => {
    const opened = openControllerUpgradeCheck(data, false, true)
    try {
      return opened.snapshot
    } finally {
      opened.close()
    }
  }
let db
try {
  const data = join(scratch, 'data'),
    backup = join(scratch, 'backup'),
    request = randomUUID()
  initializeController(data)
  writeFileSync(join(data, '.controller-runtime-key'), randomBytes(32), { flag: 'wx', mode: 0o600 })
  mkdirSync(backup, { mode: 0o700 })
  db = new Database(join(data, 'opspilot.db'))
  db.pragma('journal_mode=WAL')
  db.pragma('foreign_keys=ON')
  db.exec(
    "INSERT INTO vps(id,name,host,username,auth_type,encrypted_secret) VALUES(1,'lab','fixture.test','operator','key',X'00')"
  )
  const before = snapshot(data),
    key = readFileSync(join(data, '.controller-runtime-key')),
    receipt = await backupControllerSchema(data, backup, request, before, 35)
  check(
    'native_wal35_consistent_backup',
    receipt.before.schema_version === 35 && receipt.backup_sha256.length === 64
  )
  assert.throws(
    () => transitionControllerPostgresSchema(data, backup, receipt, before, 'apply'),
    /BACKUP_NOT_SEALED/
  )
  check('service_writable_backup_rejected_before_migration', snapshot(data).schema_version === 35)
  chmodSync(join(backup, 'backup.sqlite'), 0o440)
  chmodSync(backup, 0o550)
  assert.throws(
    () =>
      transitionControllerPostgresSchema(data, backup, receipt, before, 'apply', undefined, {
        afterMigration() {
          throw Error('LOCAL_TRANSACTION_ABORT')
        }
      }),
    /POSTGRES_TRANSITION_FAILED/
  )
  check(
    'all_private037_ddl_rolled_back_on_transaction_abort',
    JSON.stringify(snapshot(data)) === JSON.stringify(before)
  )
  const applied = transitionControllerPostgresSchema(data, backup, receipt, before, 'apply')
  check(
    'native35_to_private37_preserves_baseline_projection_and_inodes',
    applied.snapshot.schema_version === 37 &&
      JSON.stringify(applied.projection35) === JSON.stringify(before) &&
      applied.snapshot.database_inode === before.database_inode &&
      applied.snapshot.key_inode === before.key_inode
  )
  assert.deepEqual(readFileSync(join(data, '.controller-runtime-key')), key)
  check('runtime_key_bytes_unchanged')
  assert.deepEqual(
    transitionControllerPostgresSchema(data, backup, receipt, before, 'apply'),
    applied
  )
  check('lost_apply_reply_reconciles_without_rekey_or_duplicate_schema')
  assert.throws(() => assertControllerRuntimeSchema(data), /CHECK_FAILED/)
  check('normal035_startup_refuses_private37_until_root_rollout_is_integrated')
  db.exec(
    "INSERT INTO vps(id,name,host,username,auth_type,encrypted_secret) VALUES(2,'later','later.test','operator','key',X'01')"
  )
  const current = snapshot(data),
    inspected = transitionControllerPostgresSchema(data, backup, receipt, current, 'can-revert'),
    reverted = transitionControllerPostgresSchema(
      data,
      backup,
      receipt,
      current,
      'revert',
      inspected.projection35
    )
  check(
    'empty37_downgrade_preserves_later35_rows',
    reverted.snapshot.schema_version === 35 &&
      db.prepare('SELECT name FROM vps WHERE id=2').get().name === 'later'
  )
  assert.deepEqual(
    transitionControllerPostgresSchema(
      data,
      backup,
      receipt,
      current,
      'revert',
      inspected.projection35
    ),
    reverted
  )
  check('lost_revert_reply_reconciles_exact_fresh_projection')
  assertControllerRuntimeSchema(data)
  check('original035_startup_accepts_reverted_exact_schema')
  proof.state = 'PASS'
} catch (error) {
  proof.state = 'FAIL'
  proof.error = /^[A-Z_]+$/.test(error?.message ?? '') ? error.message : error?.name
  throw error
} finally {
  db?.close()
  assert.equal(dirname(realpathSync(scratch)), realpathSync(tmpdir()))
  assert.ok(
    lstatSync(scratch).isDirectory() &&
      !lstatSync(scratch).isSymbolicLink() &&
      scratch.includes('opspilot-postgres-schema-')
  )
  rmSync(scratch, { recursive: true })
  proof.cleanup = true
  proof.checks_count = checks.length
  writeFileSync(join(output, 'proof.json'), JSON.stringify(proof, null, 2) + '\n')
  console.log('PROOF ' + output)
}
