/* eslint-disable @typescript-eslint/explicit-function-return-type -- CLI ri?ng t?, transport gi? v? hai SQLite th?t. */
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
assert.equal(process.argv.slice(2).join(' '), '--confirm-local-product-postgres-desktop')
assert(process.version.startsWith('v22.'))
const project = resolve(import.meta.dirname, '../..'),
  require = createRequire(join(project, 'package.json')),
  nonce = randomBytes(6).toString('hex'),
  output = join(project, '.out-scripts/product-postgres-desktop-lab', nonce),
  scratch = mkdtempSync(join(tmpdir(), 'opspilot-pg-desktop-')),
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
  assert.equal(f.db.prepare('SELECT max(version) v FROM schema_version').get().v, 38)
  assert.equal(f.remote.prepare('SELECT max(version) v FROM schema_version').get().v, 37)
  assert.equal(
    f.remote
      .prepare("SELECT count(*) n FROM sqlite_master WHERE name='desktop_postgres_intent'")
      .get().n,
    0
  )
  check('Desktop038_Controller037_role_separation')
  const basis = f.projects.registeredContext(f.projectKey)
  let c = await f.postgres.context(f.projectKey)
  let row = await f.postgres.prepare({
    project_request_key: f.projectKey,
    expected_binding_revision: c.binding_revision,
    expected_source_generation: c.source_generation,
    expected_source_config_sha256: c.source_config_sha256,
    operation: 'prepare'
  })
  assert.equal((await f.postgres.send(row.request_key)).state, 'resource_prepared')
  c = await f.postgres.context(f.projectKey)
  row = await f.postgres.prepare({
    project_request_key: f.projectKey,
    expected_binding_revision: c.binding_revision,
    expected_source_generation: c.source_generation,
    expected_source_config_sha256: c.source_config_sha256,
    operation: 'select',
    database_id: c.database.prepared.database_id
  })
  assert.equal((await f.postgres.send(row.request_key)).state, 'selected')
  check('Main_prepare_select_immutable_authenticated_journal_without_runtime_provisioning')
  let e = await f.main.context(f.projectKey)
  row = await f.main.prepare({
    project_request_key: f.projectKey,
    expected_binding_revision: e.binding_revision,
    expected_latest_revision: null,
    runtime_env: { APP_TOKEN: 'SYNTHETIC_DESKTOP_PG_ENV' },
    public_build_args: { NEXT_PUBLIC_TITLE: 'PG fixture' }
  })
  await f.main.send(row.request_key)
  e = await f.main.context(f.projectKey)
  row = await f.environmentSelections.prepare({
    project_request_key: f.projectKey,
    expected_binding_revision: e.binding_revision,
    expected_source_generation: e.source_generation,
    expected_source_config_sha256: e.source_config_sha256,
    expected_latest_revision: e.latest.revision,
    environment_revision: e.latest.revision
  })
  await f.environmentSelections.send(row.request_key)
  assert.equal((await f.projects.currentContext(f.projectKey)).registration.source_generation, 3)
  assert.deepEqual(f.projects.registeredContext(f.projectKey), basis)
  check('ENV_after_DB_preserves_database_reference_and_original_registration')
  // ??ng SQLite Desktop, d?ng l?i vault/c?c service v?i c?ng cipher fixture. ??y l?
  // reopen connection, kh?ng gi? ki?m ch?ng DPAPI ho?c restart Electron th?c t?.
  code.closeDatabase()
  reopened = code.initializeDatabase(join(scratch, 'desktop'))
  const fresh = code.composeDesktop(
    reopened,
    f.cipher,
    new code.DesktopControllerVault(reopened, f.cipher),
    f.admin,
    f.pgAdmin
  )
  assert.equal(fresh.postgres.list(f.projectKey).filter((r) => r.state === 'selected').length, 1)
  assert.equal(
    (await fresh.projects.currentContext(f.projectKey)).registration.source_generation,
    3
  )
  assert.equal((await fresh.main.context(f.projectKey)).selected.revision, 1)
  check('SQLite_reopen_restores_own_authenticated_receipts_and_current_source_without_new_UUID')
  const serialized = reopened.serialize()
  assert(!serialized.includes(Buffer.from('SYNTHETIC_DESKTOP_PG_ENV')))
  assert(!JSON.stringify(fresh.postgres.list(f.projectKey)).includes('encrypted_secret'))
  assert.equal(f.remote.prepare('SELECT count(*) n FROM product_deploy_job').get().n, 0)
  assert.equal(f.remote.prepare('SELECT count(*) n FROM product_managed_postgres').get().n, 1)
  check('no_secret_readback_job_or_duplicate_resource')
  proof.status = 'PASS'
} catch (error) {
  proof.error = error?.code === 'ERR_ASSERTION' ? 'ASSERTION_FAILED' : 'DESKTOP_POSTGRES_LAB_FAILED'
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
  assert(scratch.startsWith(join(tmpdir(), 'opspilot-pg-desktop-')))
  rmSync(scratch, { recursive: true })
  proof.private_cleanup = true
  writeFileSync(join(output, 'proof.json'), JSON.stringify(proof, null, 2) + '\n')
  console.log(
    JSON.stringify({ status: proof.status, nonce, checks: checks.length, private_cleanup: true })
  )
}
