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
assert.equal(process.argv.slice(2).join(' '), '--confirm-local-project-reconnection-desktop')
assert(process.version.startsWith('v22.'))
const project = resolve(import.meta.dirname, '../..'),
  require = createRequire(join(project, 'package.json')),
  nonce = randomBytes(6).toString('hex'),
  output = join(project, '.out-scripts/product-project-reconnection-desktop-lab', nonce),
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
  check('Desktop039_Controller037_roles_separate')
  const legacy = () =>
    JSON.stringify(
      [
        'desktop_project_setup',
        'desktop_environment_intent',
        'desktop_environment_selection',
        'desktop_postgres_intent'
      ].map((t) => f.db.prepare('SELECT * FROM ' + t).all())
    )
  const history = legacy()
  const context = await f.admin.reconnectionContext(f.bindingId, {
    format: 1,
    controller_id: f.controllerId,
    app_id: 42
  })
  const request = {
    format: 1,
    request_key: require('node:crypto').randomUUID(),
    scope: context.scope,
    expected_source_generation: context.source.generation,
    expected_source_config_sha256: context.source.config_sha256
  }
  const resource = new code.ProductPostgresRepository(f.remote, f.remoteCipher).prepare(
    request,
    f.controllerId,
    'unix:1000'
  )
  new code.ProductPostgresSelection(f.remote, f.remoteCipher).select(
    { ...request, database_id: resource.metadata.database_id },
    f.controllerId,
    'unix:1000'
  )
  const remoteBefore = createHash('sha256').update(f.remote.serialize()).digest('hex')
  const plan = await f.subject.review({ binding_id: f.bindingId, app_id: 42 })
  assert.equal(plan.context.source.generation, 2)
  assert.equal(plan.context.selected_database.database_id, resource.metadata.database_id)
  assert.equal(f.db.prepare('SELECT count(*) n FROM desktop_project_reconnection').get().n, 0)
  check('source2_PG_without_own_selection_receipt_is_preview_only_until_explicit_consent')
  const result = await f.subject.confirm({ plan_id: plan.plan_id, consent: true })
  assert.equal(result.provenance, 'explicit_reconnection_v1')
  assert.equal(result.execution, 'fresh_review_required')
  assert.equal(legacy(), history)
  assert.equal(
    (await f.subject.confirm({ plan_id: plan.plan_id, consent: true })).request_key,
    result.request_key
  )
  assert.equal(createHash('sha256').update(f.remote.serialize()).digest('hex'), remoteBefore)
  check(
    'confirmed_provenance_is_local_atomic_idempotent_and_preserves_legacy_receipts_and_controller_bytes'
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
  assert.deepEqual(subject.get(result.request_key), result)
  assert.deepEqual(await subject.current(result.request_key), result)
  assert.deepEqual(subject.latest(f.bindingId, 42), result)
  check(
    'closed_reopened_SQLite_and_recomposed_real_vault_recovers_authenticated_record_without_registration_fabrication'
  )
  f.remote.exec('UPDATE product_app_control SET auto_deploy_paused=0,pause_reason=NULL')
  await assert.rejects(() => subject.current(result.request_key), /RECONNECTION_CHANGED/)
  const p2 = await subject.review({ binding_id: f.bindingId, app_id: 42 })
  const next = await subject.confirm({ plan_id: p2.plan_id, consent: true })
  assert.notEqual(next.request_key, result.request_key)
  assert.equal(reopened.prepare('SELECT count(*) n FROM desktop_project_reconnection').get().n, 2)
  check('policy_drift_requires_fresh_review_and_explicit_consent_preserves_both_versions')
  vault.disable(f.bindingId, vault.get(f.bindingId).revision)
  assert.throws(() => subject.get(next.request_key), /RECONNECTION_UNAVAILABLE/)
  assert.equal(f.remote.prepare('SELECT count(*) n FROM product_deploy_job').get().n, 0)
  assert(!JSON.stringify(next).includes('encrypted_secret'))
  check('binding_disable_revokes_record_use_no_job_or_credential_readback')
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
