// Gate Linux key-store/SQLite; không SSH hoặc VPS.
/* eslint-disable @typescript-eslint/explicit-function-return-type -- CLI lab JavaScript, không dùng cú pháp type TypeScript. */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createHash, randomBytes } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  chmodSync,
  readFileSync,
  existsSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
if (process.argv.slice(2).join(' ') !== '--confirm-local-environment-selection') {
  console.log('{"status":"REJECTED","code":"EXPLICIT_LOCAL_ENVIRONMENT_SELECTION_GATE_REQUIRED"}')
  process.exit(2)
}
if (process.platform !== 'linux' || !process.version.startsWith('v22.'))
  throw Error('LINUX_NODE22_REQUIRED')
const modules = process.env.OPSPILOT_R1_MODULES,
  artifact = process.env.OPSPILOT_R1_ARTIFACT
if (!modules || !artifact) throw Error('APPROVED_LINUX_MODULES_AND_PRIVATE_ARTIFACT_REQUIRED')
const esbuild = createRequire(resolve(modules, 'package.json'))('esbuild')
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
      name: 'sql',
      setup(b) {
        b.onResolve({ filter: /\.(sql|py)\?raw$/ }, (a) => ({
          path: resolve(a.resolveDir, a.path.slice(0, -4)),
          namespace: 'sql'
        }))
        b.onLoad({ filter: /.*/, namespace: 'sql' }, (a) => ({
          contents: readFileSync(a.path, 'utf8'),
          loader: 'text'
        }))
      }
    }
  ]
})
const code = createRequire(artifact)(artifact),
  nonce = randomBytes(6).toString('hex'),
  root = resolve(import.meta.dirname, '../../..'),
  scratch = mkdtempSync(join(tmpdir(), 'opspilot-r7h3a-')),
  directory = join(root, 'app/.out-scripts/product-environment-selection-lab', nonce)
chmodSync(scratch, 0o700)
mkdirSync(directory, { recursive: true })
const proof = {
  status: 'FAIL',
  scope: 'NATIVE_LINUX_CLI_SOURCE_SELECTION_ONLY',
  nonce,
  checks: [],
  vps_used: false,
  ssh_used: false,
  execution_implemented: false,
  artifact_sha256: createHash('sha256').update(readFileSync(artifact)).digest('hex')
}
const marker = 'SYNTHETIC_SELECTION_' + randomBytes(24).toString('hex')
let db
function call(command, request, ok = true) {
  const child = spawnSync(process.execPath, [artifact, command, '--data-dir', scratch], {
    input: request ? JSON.stringify(request) : '',
    encoding: 'utf8',
    timeout: 20000,
    maxBuffer: 131072,
    env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', NODE_ENV: 'production' }
  })
  assert(!child.error)
  assert(!child.stdout.includes(marker) && !child.stderr.includes(marker))
  if (ok) {
    assert.equal(child.status, 0)
    assert.equal(child.stderr, '')
    return JSON.parse(child.stdout)
  }
  assert.equal(child.status, 1)
  assert.equal(child.stdout, '')
  assert(/^CONTROL_PLANE_ERROR [A-Z][A-Z0-9_]+\n$/.test(child.stderr))
  return child.stderr.trim().split(' ')[1]
}
function concurrentSelect(request) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [artifact, 'select-project-environment', '--data-dir', scratch],
      {
        env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', NODE_ENV: 'production' },
        stdio: 'pipe'
      }
    )
    let out = '',
      error = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), 20000)
    child.stdout.on('data', (bytes) => {
      out += bytes
      if (out.length > 131072) child.kill('SIGKILL')
    })
    child.stderr.on('data', (bytes) => {
      error += bytes
      if (error.length > 4096) child.kill('SIGKILL')
    })
    child.stdin.on('error', () => {})
    child.once('error', () => {
      clearTimeout(timer)
      reject(Error('SELECTION_RACE_SPAWN_FAILED'))
    })
    child.once('close', (status) => {
      clearTimeout(timer)
      try {
        assert.equal(status, 0)
        assert.equal(error, '')
        assert(!out.includes(marker))
        resolve(JSON.parse(out))
      } catch {
        reject(Error('SELECTION_RACE_FAILED'))
      }
    })
    child.stdin.end(JSON.stringify(request))
  })
}
try {
  const controllerId = call('init').controller_id
  code.initializeControllerSecretKey(scratch)
  db = code.initializeDatabase(scratch, 'controller')
  const config = JSON.stringify({
      container_port: 3000,
      framework: 'nextjs',
      healthcheck_path: '/',
      host_port: 30000,
      needs_db: false
    }),
    hash = createHash('sha256').update(config).digest('hex'),
    pin = 'SHA256:' + 'A'.repeat(43),
    scope = {
      controller_id: controllerId,
      app_id: 1,
      ownership_generation: 1,
      target: {
        vps_id: 1,
        host: 'fixture.test',
        port: 22,
        username: 'operator',
        auth_type: 'key',
        host_fingerprint: pin,
        ssh_security_revision: 1
      }
    }
  db.prepare(
    "INSERT INTO vps(id,name,host,username,auth_type,host_fingerprint,encrypted_secret) VALUES(1,'fixture','fixture.test','operator','key',?,X'00')"
  ).run(pin)
  db.exec(
    "INSERT INTO app(id,vps_id,name,framework,host_port,container_port,source_type,git_repo_url,git_ref,git_root) VALUES(1,1,'env-select','nextjs',30000,3000,'git','https://github.com/example/app.git','main','.')"
  )
  db.prepare(
    "INSERT INTO product_source_config VALUES(1,1,'https://github.com/example/app.git','main','.',?,?,?)"
  ).run(config, hash, '2026-11-14T00:00:00.000Z')
  db.prepare(
    "INSERT INTO product_app_control(app_id,mode,controller_id,ownership_generation,source_generation,source_config_sha256,changed_at,auto_deploy_paused,pause_reason,pause_policy_provenance) VALUES(1,'product',?,1,1,?,'2026-11-14T00:00:00.000Z',1,'operator','explicit')"
  ).run(controllerId, hash)
  db.exec(
    "INSERT INTO deployment(id,app_id,version,image_tag,status) VALUES(1,1,1,'env-select:v1','running');UPDATE app SET current_deployment_id=1"
  )
  const env = {
    format: 1,
    request_key: 'e7e0982e-1b5b-4935-ab1f-213d49f8834d',
    scope,
    expected_latest_revision: null,
    expected_source_generation: 1,
    expected_source_config_sha256: hash,
    values: {
      runtime_env: { APP_TOKEN: marker },
      public_build_args: { NEXT_PUBLIC_TITLE: 'Sổ Đọc' }
    }
  }
  call('stage-project-environment', env)
  const request = {
    format: 1,
    request_key: 'b24473ce-994a-4501-bf8f-628961421be4',
    scope,
    expected_source_generation: 1,
    expected_source_config_sha256: hash,
    expected_latest_revision: 1,
    environment_revision: 1
  }
  const first = call('select-project-environment', request)
  assert.equal(first.state, 'selected')
  assert.equal(first.source_generation, 2)
  assert.equal(first.execution, 'requires_environment_runtime')
  code.closeDatabase()
  assert.deepEqual(call('select-project-environment', request), {
    ...first,
    state: 'already_selected'
  })
  assert.equal(
    call('select-project-environment', { ...request, expected_latest_revision: 2 }, false),
    'PRODUCT_ENVIRONMENT_IDEMPOTENCY_CONFLICT'
  )
  proof.checks.push('actual_cli_select_cold_process_retry_exactly_one_source_generation')
  db = code.initializeDatabase(scratch, 'controller')
  assert.equal(db.prepare('SELECT count(*) n FROM product_source_config').get().n, 2)
  assert.equal(db.prepare('SELECT count(*) n FROM product_source_environment').get().n, 1)
  assert.equal(db.prepare('SELECT count(*) n FROM product_history_event').get().n, 1)
  assert.equal(db.prepare('SELECT current_deployment_id n FROM app').get().n, 1)
  assert.deepEqual(
    db
      .prepare(
        'SELECT auto_deploy_paused,pause_reason,pause_policy_provenance FROM product_app_control'
      )
      .get(),
    { auto_deploy_paused: 1, pause_reason: 'operator', pause_policy_provenance: 'explicit' }
  )
  assert.equal(db.prepare('SELECT count(*) n FROM product_deploy_job').get().n, 0)
  const visible = JSON.stringify({
    first,
    source: db.prepare('SELECT * FROM product_source_config').all(),
    binding: db.prepare('SELECT * FROM product_source_environment').all(),
    history: db.prepare('SELECT * FROM product_history_event').all()
  })
  for (const bad of [marker, 'APP_TOKEN', 'NEXT_PUBLIC_TITLE', 'Sổ Đọc'])
    assert(!visible.includes(bad))
  proof.checks.push(
    'source_binding_and_audit_contain_no_values_keys_or_secret_hash_live_and_pause_preserved'
  )
  assert.throws(
    () =>
      code.validateProductSourceAndPlan(
        db,
        1,
        join(scratch, 'missing-source'),
        join(scratch, 'missing-collector')
      ),
    /PRODUCT_SOURCE_RENDER_UNSUPPORTED_PLAN/
  )
  proof.checks.push('source_preflight_refuses_environment_reference_before_source_io_or_ssh')
  assert.throws(
    () => db.exec('DELETE FROM product_source_environment'),
    /PRODUCT_SOURCE_ENVIRONMENT_IMMUTABLE/
  )
  assert.deepEqual(db.pragma('foreign_key_check'), [])
  assert.equal(db.prepare('SELECT max(version) n FROM schema_version').get().n, 35)
  assert.deepEqual(
    db.prepare('SELECT version FROM schema_version WHERE version IN(30,31,34)').all(),
    []
  )
  db.pragma('wal_checkpoint(TRUNCATE)')
  assert(!readFileSync(join(scratch, 'opspilot.db')).includes(Buffer.from(marker)))
  proof.checks.push(
    'shared035_controller_role_no_desktop_migrations_immutable_binding_no_plaintext_db'
  )
  const raceRequest = {
    ...request,
    request_key: 'c2fb1691-de8d-49b2-96fb-7a5adefdbd99',
    expected_source_generation: 2,
    expected_source_config_sha256: first.source_config_sha256
  }
  const race = await Promise.allSettled([
    concurrentSelect(raceRequest),
    concurrentSelect(raceRequest)
  ])
  assert(race.every((result) => result.status === 'fulfilled'))
  assert.deepEqual(race.map((result) => result.value.state).sort(), [
    'already_selected',
    'selected'
  ])
  assert(race.every((result) => result.value.source_generation === 3))
  assert.equal(db.prepare('SELECT count(*) n FROM product_source_environment').get().n, 2)
  proof.checks.push('two_actual_cli_processes_same_uuid_create_one_new_generation')
  db.exec('UPDATE product_app_control SET auto_deploy_paused=0,pause_reason=NULL')
  assert.equal(
    call('select-project-environment', raceRequest, false),
    'PRODUCT_ENVIRONMENT_REQUIRES_QUIESCENCE'
  )
  proof.checks.push('replay_does_not_claim_paused_after_operator_resumes_policy')
  proof.status = 'PASS'
} catch (error) {
  proof.error_code = /^[A-Z][A-Z0-9_]+$/.test(error.message ?? '')
    ? error.message
    : 'ENVIRONMENT_SELECTION_GATE_FAILED'
} finally {
  code.closeDatabase()
  assert.equal(dirname(realpathSync(scratch)), realpathSync(tmpdir()))
  assert(/^opspilot-r7h3a-/.test(scratch.slice(scratch.lastIndexOf('/') + 1)))
  rmSync(scratch, { recursive: true })
  proof.private_scratch_removed = !existsSync(scratch)
  writeFileSync(join(directory, 'result.json'), JSON.stringify(proof, null, 2) + '\n')
  console.log(JSON.stringify(proof))
  process.exitCode = proof.status === 'PASS' ? 0 : 1
}
