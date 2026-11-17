/* eslint-disable @typescript-eslint/explicit-function-return-type -- CLI riêng, transport giả và hai SQLite thật. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomBytes, createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  realpathSync,
  rmSync,
  lstatSync
} from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
assert.equal(process.argv.slice(2).join(' '), '--confirm-local-project-reconnection-ui-main')
assert(process.version.startsWith('v22.'))
const project = resolve(import.meta.dirname, '../..'),
  require = createRequire(join(project, 'package.json')),
  nonce = randomBytes(6).toString('hex'),
  output = join(project, '.out-scripts/product-project-reconnection-ui-lab', nonce),
  scratch = mkdtempSync(join(tmpdir(), 'opspilot-reconnection-desktop-')),
  artifact = join(output, 'entry.cjs'),
  checks = []
mkdirSync(output, { recursive: true })
writeFileSync(join(scratch, '.owner'), nonce, { flag: 'wx' })
const proof = {
  status: 'FAIL',
  nonce,
  checks,
  transport: 'SYNTHETIC_SQLITE_ONLY',
  SSH_used: false,
  Docker_used: false,
  VPS_used: false,
  GUI_used: false
}
let f, code, reopened
const check = (name) => {
  checks.push(name)
  console.log('PASS ' + name)
}
try {
  const esbuild = createRequire(require.resolve('vite/package.json'))('esbuild')
  await esbuild.build({
    entryPoints: [join(import.meta.dirname, 'entry.ts')],
    outfile: artifact,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    packages: 'external',
    plugins: [
      {
        name: 'raw',
        setup(build) {
          build.onResolve({ filter: /\?raw$/ }, (a) => ({
            path: resolve(a.resolveDir, a.path.slice(0, -4)),
            namespace: 'raw'
          }))
          build.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({
            contents: readFileSync(a.path, 'utf8'),
            loader: 'text'
          }))
        }
      }
    ]
  })
  proof.artifact_sha256 = createHash('sha256').update(readFileSync(artifact)).digest('hex')
  code = require(artifact)
  f = await code.fixture(scratch)
  assert.equal(f.db.prepare('SELECT max(version) v FROM schema_version').get().v, 39)
  assert.equal(f.remote.prepare('SELECT max(version) v FROM schema_version').get().v, 37)
  const legacy = () =>
    JSON.stringify(
      [
        'desktop_project_setup',
        'desktop_environment_intent',
        'desktop_environment_selection',
        'desktop_postgres_intent'
      ].map((t) => f.db.prepare('SELECT * FROM ' + t).all())
    )
  const original = legacy()
  const plan = await f.subject.review({ binding_id: f.bindingId, app_id: 42 })
  assert.equal(plan.context.source.generation, 2)
  const record = await f.subject.confirm({ plan_id: plan.plan_id, consent: true })
  const input = {
    reconnection_request_key: record.request_key,
    expected_binding_revision: record.binding_revision,
    expected_snapshot_sha256: record.snapshot_sha256,
    database_id: f.pg.metadata.database_id,
    read: { operation: 'tables' }
  }
  check('real_Main_consent_separate_from_original_registration_source2_database')
  const remoteBefore = createHash('sha256').update(f.remote.serialize()).digest('hex')
  const localBefore = createHash('sha256').update(f.db.serialize()).digest('hex')
  const tables = await f.reader.read(input)
  assert.equal(tables.data[0].name, 'notes')
  const rows = await f.reader.read({
    ...input,
    read: { operation: 'rows', schema: 'public', table: 'notes', limit: 10 }
  })
  assert.equal(rows.data.length, 2)
  assert.equal(legacy(), original)
  assert.equal(createHash('sha256').update(f.db.serialize()).digest('hex'), localBefore)
  assert.equal(createHash('sha256').update(f.remote.serialize()).digest('hex'), remoteBefore)
  check(
    'readonly_inspector_exact_consent_and_database_tables_rows_no_SQLite_mutation_or_fake_selection'
  )
  code.closeDatabase()
  reopened = new code.Database(join(scratch, 'desktop', 'opspilot.db'))
  reopened.pragma('foreign_keys=ON')
  const vault = new code.DesktopControllerVault(reopened, f.cipher)
  const subject = new code.DesktopProjectReconnections(
    reopened,
    f.cipher,
    vault,
    f.admin,
    () => f.clock.now
  )
  const reader = new code.DesktopReconnectedPostgresInspection(subject, f.inspector)
  assert.equal((await subject.current(record.request_key)).request_key, record.request_key)
  assert.equal((await reader.read(input)).data.length, 1)
  check('reopened_SQLite_recomposed_real_Main_uses_authenticated_consent_without_reconfirmation')
  const count = f.reads.count
  await assert.rejects(() =>
    reader.read({ ...input, database_id: '99999999-9999-4999-8999-999999999999' })
  )
  assert.equal(f.reads.count, count)
  f.reads.after = () =>
    f.remote.exec('UPDATE product_app_control SET auto_deploy_paused=0,pause_reason=NULL')
  await assert.rejects(() => reader.read(input), /RECONNECTION_CHANGED/)
  check('foreign_database_refused_before_target_and_policy_drift_drops_data_after_target')
  f.reads.after = undefined
  const b = await subject.review({ binding_id: f.bindingId, app_id: 42 })
  await subject.confirm({ plan_id: b.plan_id, consent: true })
  f.remote.exec("UPDATE product_app_control SET auto_deploy_paused=1,pause_reason='operator'")
  const a = await subject.review({ binding_id: f.bindingId, app_id: 42 })
  assert.equal(a.matching_confirmation_key, record.request_key)
  assert.equal((await subject.current(a.matching_confirmation_key)).request_key, record.request_key)
  assert.equal((await reader.read(input)).data.length, 1)
  assert.equal(reopened.prepare('SELECT count(*) n FROM desktop_project_reconnection').get().n, 2)
  check(
    'policy_A_B_A_finds_authenticated_matching_consent_and_rechecks_without_fake_receipts_or_duplicate_rows'
  )
  proof.status = 'PASS'
} catch (error) {
  proof.error =
    error?.code === 'ERR_ASSERTION' ? 'ASSERTION_FAILED' : 'DESKTOP_RECONNECTION_LAB_FAILED'
  proof.failure_location =
    /(?:run\.mjs|desktop\w*\.ts):\d+:\d+/.exec(error?.stack ?? '')?.[0] ?? null
  process.exitCode = 1
} finally {
  code?.closeDatabase()
  if (reopened?.open) reopened.close()
  if (f?.remote.open) f.remote.close()
  assert.equal(dirname(realpathSync(scratch)), realpathSync(tmpdir()))
  assert(!lstatSync(scratch).isSymbolicLink())
  assert.equal(readFileSync(join(scratch, '.owner'), 'utf8'), nonce)
  assert(scratch.startsWith(join(tmpdir(), 'opspilot-reconnection-desktop-')))
  rmSync(scratch, { recursive: true })
  proof.private_cleanup = true
  writeFileSync(join(output, 'proof.json'), JSON.stringify(proof, null, 2) + '\n')
  console.log(
    JSON.stringify({ status: proof.status, nonce, checks: checks.length, private_cleanup: true })
  )
}
