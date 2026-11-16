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
assert.equal(process.argv.slice(2).join(' '), '--confirm-local-postgres-inspection')
assert(process.version.startsWith('v22.'))
const project = resolve(import.meta.dirname, '../..'),
  require = createRequire(join(project, 'package.json')),
  nonce = randomBytes(6).toString('hex'),
  output = join(project, '.out-scripts/product-postgres-inspection-lab', nonce),
  scratch = mkdtempSync(join(tmpdir(), 'opspilot-pg-inspection-')),
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
let f, code
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
  const basis = () => ({
    format: 1,
    controller_id: f.controllerId,
    app_id: 42,
    expected_ownership_generation: 1,
    expected_source_generation: 1,
    expected_source_config_sha256: f.projects.registeredContext(f.projectKey).registration
      .source_config_sha256,
    expected_target_security_revision: 1,
    database_id: '11111111-1111-4111-8111-111111111111'
  })
  assert.throws(() =>
    code.reviewPostgresInspection(f.remote, f.remoteCipher, f.controllerId, basis())
  )
  check('no_selected_database_never_falls_back_to_a_name_or_container')
  let c = await f.postgres.context(f.projectKey)
  let row = await f.postgres.prepare({
    project_request_key: f.projectKey,
    expected_binding_revision: c.binding_revision,
    expected_source_generation: c.source_generation,
    expected_source_config_sha256: c.source_config_sha256,
    operation: 'prepare'
  })
  await f.postgres.send(row.request_key)
  c = await f.postgres.context(f.projectKey)
  row = await f.postgres.prepare({
    project_request_key: f.projectKey,
    expected_binding_revision: c.binding_revision,
    expected_source_generation: c.source_generation,
    expected_source_config_sha256: c.source_config_sha256,
    operation: 'select',
    database_id: c.database.prepared.database_id
  })
  await f.postgres.send(row.request_key)
  c = await f.postgres.context(f.projectKey)
  const input = {
    ...basis(),
    expected_source_generation: c.source_generation,
    expected_source_config_sha256: c.source_config_sha256,
    database_id: c.database.selected.database_id
  }
  const before = f.remote.prepare('SELECT total_changes() n').get().n
  const context = code.reviewPostgresInspection(f.remote, f.remoteCipher, f.controllerId, input)
  assert.equal(context.state, 'configuration_verified')
  assert.equal(context.runtime_status, 'not_checked')
  assert.equal(context.database.database_id, input.database_id)
  assert.equal(f.remote.prepare('SELECT total_changes() n').get().n, before)
  check('exact_selected_instance_authenticated_metadata_without_SSH_SQL_or_runtime_health_claim')
  for (const change of [
    { database_id: '22222222-2222-4222-8222-222222222222' },
    { expected_source_generation: 1 },
    { expected_target_security_revision: 2 },
    { controller_id: 'foreign' },
    { sql: 'SELECT 1' },
    { database: 'opspilot' }
  ])
    assert.throws(() =>
      code.reviewPostgresInspection(f.remote, f.remoteCipher, f.controllerId, {
        ...input,
        ...change
      })
    )
  check('wrong_instance_source_target_controller_or_extra_SQL_cannot_route_the_read')
  assert.equal(f.remote.prepare('SELECT count(*) n FROM product_deploy_job').get().n, 0)
  assert(!JSON.stringify(context).includes('password'))
  assert(!JSON.stringify(context).includes('encrypted_secret'))
  check('no_credentials_provisioning_or_deployment_job')
  proof.status = 'PASS'
} catch (error) {
  proof.error =
    error?.code === 'ERR_ASSERTION' ? 'ASSERTION_FAILED' : 'POSTGRES_INSPECTION_LAB_FAILED'
  proof.failure_location =
    /(?:run\.mjs|desktop\w*\.ts):\d+:\d+/.exec(error?.stack ?? '')?.[0] ?? null
  process.exitCode = 1
} finally {
  code?.closeDatabase()
  if (f?.remote.open) f.remote.close()
  assert.equal(dirname(realpathSync(scratch)), realpathSync(tmpdir()))
  assert(!lstatSync(scratch).isSymbolicLink())
  assert.equal(readFileSync(join(scratch, '.owner'), 'utf8'), nonce)
  assert(scratch.startsWith(join(tmpdir(), 'opspilot-pg-inspection-')))
  rmSync(scratch, { recursive: true })
  proof.private_cleanup = true
  writeFileSync(join(output, 'proof.json'), JSON.stringify(proof, null, 2) + '\n')
  console.log(
    JSON.stringify({ status: proof.status, nonce, checks: checks.length, private_cleanup: true })
  )
}
