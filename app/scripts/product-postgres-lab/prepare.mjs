/* eslint-disable @typescript-eslint/explicit-function-return-type -- Local Linux CLI/SQLite acceptance. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { spawn, execFileSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
if (process.platform !== 'linux' || !process.version.startsWith('v22.'))
  throw Error('LINUX_NODE22_REQUIRED')
if (process.argv.slice(2).join(' ') !== '--confirm-local-postgres-preparation')
  throw Error('EXPLICIT_LOCAL_POSTGRES_GATE_REQUIRED')
const modules = process.env.OPSPILOT_CONTROL_PLANE_MODULES,
  artifact = process.env.OPSPILOT_CONTROL_PLANE_OUTPUT
if (!modules || !artifact) throw Error('APPROVED_LINUX_INPUT_REQUIRED')
const require = createRequire(join(modules, 'package.json')),
  esbuild = require('esbuild'),
  helper = join(dirname(dirname(artifact)), 'prepare-lab.cjs')
await esbuild.build({
  entryPoints: [join(import.meta.dirname, 'entry.ts')],
  outfile: helper,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  packages: 'external',
  plugins: [
    {
      name: 'raw',
      setup(b) {
        b.onResolve({ filter: /\.sql\?raw$/ }, (a) => ({
          path: resolve(a.resolveDir, a.path.slice(0, -4)),
          namespace: 'raw'
        }))
        b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({
          contents: readFileSync(a.path, 'utf8'),
          loader: 'text'
        }))
      }
    }
  ]
})
const code = createRequire(helper)(helper),
  nonce = randomBytes(6).toString('hex'),
  scratch = mkdtempSync(join(tmpdir(), 'opspilot-postgres-prepare-')),
  output = resolve(import.meta.dirname, '../../.out-scripts/product-postgres-preparation', nonce),
  checks = []
chmodSync(scratch, 0o700)
mkdirSync(output, { recursive: true })
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const proof = {
  status: 'FAIL',
  scope: 'LINUX_PRIVATE_MANAGED_POSTGRES_PREPARATION_CLI_SQLITE_ONLY',
  nonce,
  checks,
  artifact_sha256: sha(readFileSync(artifact)),
  VPS_used: false,
  Docker_runtime_used: false,
  initialized_schema_registered: false
}
let db
const call = (command, input) =>
  JSON.parse(
    execFileSync(process.execPath, [artifact, command, '--data-dir', scratch], {
      input: JSON.stringify(input),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 20000,
      maxBuffer: 16384
    })
  )
const denied = (command, input, expected) => {
  let rejected = false
  try {
    call(command, input)
  } catch (error) {
    assert.equal(error.status, 1)
    assert(String(error.stderr).includes('CONTROL_PLANE_ERROR ' + expected))
    rejected = true
  }
  assert(rejected)
}
const childPrepare = (input) =>
  new Promise((resolveChild, reject) => {
    const child = spawn(
      process.execPath,
      [artifact, 'prepare-managed-postgres', '--data-dir', scratch],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    )
    let bytes = '',
      size = 0
    child.stdout.on('data', (b) => {
      size += b.length
      if (size > 16384) child.kill('SIGKILL')
      else bytes += b
    })
    child.stderr.on('data', () => {})
    child.once('error', () => reject(Error('CHILD_PREPARATION_FAILED')))
    child.once('close', (code) => {
      try {
        assert.equal(code, 0)
        resolveChild(JSON.parse(bytes))
      } catch {
        reject(Error('CHILD_PREPARATION_FAILED'))
      }
    })
    child.stdin.end(JSON.stringify(input))
  })
try {
  const bundlePin = sha(readFileSync(join(dirname(artifact), 'bundle-manifest.json')))
  const verified = JSON.parse(
    execFileSync(
      process.execPath,
      [artifact, 'verify-bundle', '--artifact', artifact, '--manifest-sha256', bundlePin],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 }
    )
  )
  assert.equal(verified.manifest_sha256, bundlePin)
  checks.push('compiled_controller_bundle_remains_exact_verified_separate_lab_artifact')
  db = code.initializeDatabase(scratch, 'controller')
  const config = '{"framework":"express"}',
    hash = sha(config),
    controller = 'postgres-native',
    pin = 'SHA256:' + 'A'.repeat(43)
  db.prepare(
    "INSERT INTO vps(id,name,host,port,username,auth_type,host_fingerprint,encrypted_secret) VALUES(1,'fixture','example.test',22,'operator','key',?,X'00')"
  ).run(pin)
  db.exec(
    "INSERT INTO app(id,vps_id,name,framework,host_port,container_port) VALUES(1,1,'postgres-native','express',30000,3000);INSERT INTO product_controller VALUES('postgres-native','2026-11-16T00:00:00.000Z','active')"
  )
  db.prepare(
    "INSERT INTO product_source_config VALUES(1,1,'https://example.test/app.git','main','.',?,?,'2026-11-16T00:00:00.000Z')"
  ).run(config, hash)
  db.prepare(
    "INSERT INTO product_app_control(app_id,mode,controller_id,ownership_generation,source_generation,source_config_sha256,auto_deploy_paused,pause_reason,pause_policy_provenance,changed_at) VALUES(1,'product','postgres-native',1,1,?,1,'operator','explicit','2026-11-16T00:00:00.000Z')"
  ).run(hash)
  writeFileSync(
    join(scratch, '.product-controller-initialized'),
    JSON.stringify({ format: 1, controller_id: controller }),
    { mode: 0o600 }
  )
  const scope = {
      controller_id: controller,
      app_id: 1,
      ownership_generation: 1,
      target: {
        vps_id: 1,
        host: 'example.test',
        port: 22,
        username: 'operator',
        auth_type: 'key',
        host_fingerprint: pin,
        ssh_security_revision: 1
      }
    },
    state = { format: 1, scope }
  const request = () => ({
    ...state,
    request_key: randomUUID(),
    expected_source_generation: 1,
    expected_source_config_sha256: hash
  })
  denied('prepare-managed-postgres', request(), 'PRODUCT_POSTGRES_SCHEMA_UNSUPPORTED')
  assert(!existsSync(join(scratch, '.controller-runtime-key')))
  assert.equal(
    db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='product_managed_postgres'").get()
      .n,
    0
  )
  checks.push('current035_refused_no_auto_schema_or_key_creation')
  db.transaction(() => {
    db.exec(
      readFileSync(
        resolve(
          import.meta.dirname,
          '../../src/main/db/migrations/037_product_managed_postgres.sql'
        ),
        'utf8'
      )
    )
    db.prepare('INSERT INTO schema_version(version) VALUES(37)').run()
  })()
  denied('prepare-managed-postgres', request(), 'CONTROLLER_SECRET_KEY_UNAVAILABLE')
  assert.equal(db.prepare('SELECT count(*) n FROM product_managed_postgres').get().n, 0)
  code.initializeControllerSecretKey(scratch)
  const originalKey = readFileSync(join(scratch, '.controller-runtime-key')),
    keyHash = sha(originalKey)
  assert.deepEqual(call('managed-postgres-state', state), { metadata: null })
  checks.push('explicit_private037_fixture_existing_key_required_metadata_empty')
  const a = request(),
    b = request(),
    results = await Promise.all([childPrepare(a), childPrepare(b)])
  assert.deepEqual(results.map((r) => r.state).sort(), ['already_prepared', 'prepared'])
  assert.deepEqual(results[0].metadata, results[1].metadata)
  assert.equal(db.prepare('SELECT count(*) n FROM product_managed_postgres').get().n, 1)
  assert.equal(db.prepare('SELECT count(*) n FROM product_managed_postgres_request').get().n, 2)
  checks.push('two_actual_CLI_processes_atomic_single_resource_separate_receipts')
  const replay = call('prepare-managed-postgres', a)
  assert.equal(replay.state, 'already_prepared')
  assert.deepEqual(replay.metadata, results[0].metadata)
  assert.deepEqual(call('managed-postgres-state', state).metadata, replay.metadata)
  const credentials = new code.ProductPostgresRepository(
    db,
    code.loadControllerCredentialCipher(scratch)
  ).readCredentials(scope, replay.metadata.database_id)
  assert.notEqual(credentials.application_password, credentials.administrator_password)
  const serialized = JSON.stringify([results, replay])
  for (const value of Object.values(credentials)) assert(!serialized.includes(value))
  checks.push('cold_CLI_replay_and_lookup_preserve_identity_separate_credentials_no_readback')
  writeFileSync(join(scratch, '.controller-runtime-key'), randomBytes(32), { mode: 0o600 })
  denied('prepare-managed-postgres', request(), 'PRODUCT_POSTGRES_UNAVAILABLE')
  writeFileSync(join(scratch, '.controller-runtime-key'), originalKey, { mode: 0o600 })
  originalKey.fill(0)
  assert.equal(sha(readFileSync(join(scratch, '.controller-runtime-key'))), keyHash)
  assert.deepEqual(call('managed-postgres-state', state).metadata, replay.metadata)
  checks.push('wrong_private_fixture_key_refused_not_rotated_original_key_restored')
  db.pragma('wal_checkpoint(FULL)')
  const bytes = Buffer.concat(
    ['opspilot.db', 'opspilot.db-wal']
      .filter((n) => existsSync(join(scratch, n)))
      .map((n) => readFileSync(join(scratch, n)))
  )
  for (const value of Object.values(credentials)) assert(!bytes.includes(Buffer.from(value)))
  checks.push('actual_SQLite_files_no_plain_passwords_and_no_deploy_job_or_source_activation')
  for (const table of [
    'deployment',
    'product_deploy_job',
    'product_history_event',
    'product_source_environment'
  ])
    assert.equal(db.prepare('SELECT count(*) n FROM ' + table).get().n, 0)
  proof.status = 'PASS'
} catch (error) {
  proof.error_code =
    error?.code === 'ERR_ASSERTION' ? 'NATIVE_ASSERTION_FAILED' : 'POSTGRES_PREPARATION_LAB_FAILED'
  process.exitCode = 1
} finally {
  code.closeDatabase()
  assert.equal(realpathSync(scratch), scratch)
  assert.equal(dirname(scratch), realpathSync(tmpdir()))
  assert(scratch.startsWith(join(tmpdir(), 'opspilot-postgres-prepare-')))
  rmSync(scratch, { recursive: true })
  proof.private_cleanup = !existsSync(scratch)
  writeFileSync(join(output, 'result.json'), JSON.stringify(proof, null, 2) + '\n')
  console.log(
    JSON.stringify({
      status: proof.status,
      nonce,
      checks: checks.length,
      private_cleanup: proof.private_cleanup
    })
  )
}
