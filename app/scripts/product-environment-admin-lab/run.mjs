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
if (process.argv.slice(2).join(' ') !== '--confirm-local-environment-admin') {
  console.log('{"status":"REJECTED","code":"EXPLICIT_LOCAL_ENVIRONMENT_ADMIN_GATE_REQUIRED"}')
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
  scratch = mkdtempSync(join(tmpdir(), 'opspilot-r7h2a-')),
  directory = join(root, 'app/.out-scripts/product-environment-admin-lab', nonce)
chmodSync(scratch, 0o700)
mkdirSync(directory, { recursive: true })
const checks = [],
  proof = {
    status: 'FAIL',
    scope: 'NATIVE_SAME_UID_CLI_STDIN_SQLITE_ONLY',
    nonce,
    checks,
    vps_used: false,
    ssh_used: false,
    gui_used: false,
    activation_implemented: false,
    artifact_sha256: createHash('sha256').update(readFileSync(artifact)).digest('hex')
  }
let db
const marker = 'SYNTHETIC_ENV_ADMIN_' + randomBytes(24).toString('hex')
function call(command, input, ok = true) {
  const child = spawnSync(process.execPath, [artifact, command, '--data-dir', scratch], {
    input: input === undefined ? '' : JSON.stringify(input),
    encoding: 'utf8',
    timeout: 20000,
    maxBuffer: 512 * 1024,
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
function concurrentStage(request) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [artifact, 'stage-project-environment', '--data-dir', scratch],
      {
        env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', NODE_ENV: 'production' },
        stdio: 'pipe'
      }
    )
    let output = '',
      errors = '',
      exceeded = false
    const timer = setTimeout(() => child.kill('SIGKILL'), 20000)
    const collect = (chunk, isError) => {
      if (output.length + errors.length + chunk.length > 131072) {
        exceeded = true
        child.kill('SIGKILL')
        return
      }
      if (isError) errors += chunk
      else output += chunk
    }
    child.stdout.on('data', (chunk) => collect(chunk, false))
    child.stderr.on('data', (chunk) => collect(chunk, true))
    child.once('error', () => {
      clearTimeout(timer)
      reject(Error('CLI_RACE_SPAWN_FAILED'))
    })
    child.stdin.on('error', () => {})
    child.once('close', (status) => {
      clearTimeout(timer)
      try {
        assert.equal(status, 0)
        assert(!exceeded)
        assert.equal(errors, '')
        assert(!output.includes(marker))
        resolve(JSON.parse(output))
      } catch {
        reject(Error('CLI_RACE_FAILED'))
      }
    })
    child.stdin.end(JSON.stringify(request))
  })
}
try {
  const initialized = call('init')
  code.initializeControllerSecretKey(scratch)
  const controllerId = initialized.controller_id
  db = code.initializeDatabase(scratch, 'controller')
  const config = '{"framework":"nextjs"}',
    hash = createHash('sha256').update(config).digest('hex')
  const scope = {
    controller_id: controllerId,
    app_id: 1,
    ownership_generation: 1,
    target: {
      vps_id: 1,
      host: 'fixture.test',
      port: 22,
      username: 'operator',
      auth_type: 'key',
      host_fingerprint: 'SHA256:' + 'A'.repeat(43),
      ssh_security_revision: 1
    }
  }
  db.prepare(
    "INSERT INTO vps(id,name,host,username,auth_type,host_fingerprint,encrypted_secret) VALUES(1,'fixture','fixture.test','operator','key',?,X'00')"
  ).run(scope.target.host_fingerprint)
  db.exec(
    "INSERT INTO app(id,vps_id,name,framework,host_port,container_port) VALUES(1,1,'env-admin','nextjs',30000,3000)"
  )
  db.prepare(
    "INSERT INTO product_source_config VALUES(1,1,'https://example.test/repo.git','main','.',?,?,?)"
  ).run(config, hash, '2026-11-14T00:00:00.000Z')
  db.prepare(
    "INSERT INTO product_app_control(app_id,mode,controller_id,ownership_generation,source_generation,source_config_sha256,changed_at) VALUES(1,'product',?,1,1,?,'2026-11-14T00:00:00.000Z')"
  ).run(controllerId, hash)
  const before = db.prepare('SELECT * FROM product_app_control').get()
  const request = {
    format: 1,
    request_key: 'b89fc50f-24e3-456b-bf91-cd3f580a27a3',
    scope,
    expected_latest_revision: null,
    expected_source_generation: 1,
    expected_source_config_sha256: hash,
    values: {
      runtime_env: {
        APP_TOKEN: marker,
        EMPTY: '',
        APP_PADDING: 'x'.repeat(8000),
        APP_PADDING_2: 'y'.repeat(8000),
        APP_PADDING_3: 'z'.repeat(8000)
      },
      public_build_args: { NEXT_PUBLIC_TITLE: 'Sổ Đọc' }
    }
  }
  const { values, expected_latest_revision, ...stateRequest } = request
  assert.equal(values.runtime_env.APP_TOKEN, marker)
  assert.equal(expected_latest_revision, null)
  assert.equal(call('project-environment-state', stateRequest).latest, null)
  const first = call('stage-project-environment', request)
  const bridged = spawnSync('/usr/bin/python3', [join(import.meta.dirname, 'bridge.py')], {
    input: JSON.stringify({
      operation: 'stage-project-environment',
      node_path: process.execPath,
      artifact_path: artifact,
      data_directory: scratch,
      payload: request
    }),
    encoding: 'utf8',
    timeout: 20000,
    maxBuffer: 131072
  })
  assert.equal(bridged.status, 0)
  assert(!bridged.stdout.includes(marker))
  assert.equal(bridged.stderr, '')
  assert.equal(JSON.parse(bridged.stdout).data.state, 'already_staged')
  const badBridge = spawnSync('/usr/bin/python3', [join(import.meta.dirname, 'bridge.py')], {
    input: JSON.stringify({
      operation: 'stage-project-environment',
      node_path: process.execPath,
      artifact_path: artifact,
      data_directory: scratch,
      payload: {
        ...request,
        values: { ...request.values, runtime_env: { APP_TOKEN: 'different' } }
      }
    }),
    encoding: 'utf8',
    timeout: 20000,
    maxBuffer: 131072
  })
  assert.equal(badBridge.status, 0)
  assert.equal(badBridge.stderr, '')
  assert.deepEqual(JSON.parse(badBridge.stdout), {
    ok: false,
    code: 'PRODUCT_ENVIRONMENT_IDEMPOTENCY_CONFLICT'
  })
  const contextInput = {
    format: 1,
    controller_id: controllerId,
    app_id: 1,
    expected_ownership_generation: 1,
    expected_source_generation: 1,
    expected_source_config_sha256: hash,
    expected_target_security_revision: 1
  }
  assert.deepEqual(call('project-environment-context', contextInput).scope, scope)
  checks.push('native_python_streaming_large_stdin_replay_and_derived_context')
  assert.equal(first.state, 'staged')
  assert.equal(first.metadata.revision, 1)
  code.closeDatabase()
  const again = call('stage-project-environment', request)
  assert.deepEqual(again, { ...first, state: 'already_staged' })
  const current = call('project-environment-state', stateRequest)
  assert.deepEqual(current.latest, first.metadata)
  assert.deepEqual(current.requested, first.metadata)
  checks.push('actual_cli_stdin_cold_process_retry_one_revision_metadata_only')
  assert.equal(
    call(
      'stage-project-environment',
      { ...request, values: { ...values, runtime_env: { APP_TOKEN: 'different' } } },
      false
    ),
    'PRODUCT_ENVIRONMENT_IDEMPOTENCY_CONFLICT'
  )
  assert.equal(
    call(
      'stage-project-environment',
      { ...request, request_key: '55ccf0de-b188-4d40-8ceb-c58f4d0c85d2' },
      false
    ),
    'PRODUCT_ENVIRONMENT_REVISION_CONFLICT'
  )
  checks.push('changed_body_same_uuid_and_stale_cas_new_uuid_refused')
  const next = {
    ...request,
    expected_latest_revision: 1,
    request_key: '5294d6f3-8542-4a83-bd3e-48a7c52740c1'
  }
  const raced = await Promise.allSettled([concurrentStage(next), concurrentStage(next)])
  assert(raced.every((result) => result.status === 'fulfilled'))
  const winners = raced.map((result) => result.value)
  assert.deepEqual(winners.map((result) => result.state).sort(), ['already_staged', 'staged'])
  assert(winners.every((result) => result.metadata.revision === 2))
  checks.push('two_actual_cli_processes_race_same_uuid_exactly_one_new_revision')
  db = code.initializeDatabase(scratch, 'controller')
  assert.deepEqual(db.prepare('SELECT * FROM product_app_control').get(), before)
  assert.equal(db.prepare('SELECT count(*) n FROM product_deploy_job').get().n, 0)
  assert.equal(db.prepare('SELECT count(*) n FROM product_environment_revision').get().n, 2)
  assert.equal(db.prepare('SELECT count(*) n FROM product_environment_request').get().n, 2)
  assert.equal(db.prepare('SELECT max(version) n FROM schema_version').get().n, 35)
  db.pragma('wal_checkpoint(TRUNCATE)')
  assert(!readFileSync(join(scratch, 'opspilot.db')).includes(Buffer.from(marker)))
  assert.deepEqual(db.pragma('foreign_key_check'), [])
  checks.push('encrypted_revision_and_receipt_only_no_policy_source_job_activation')
  db.exec('DROP TRIGGER product_environment_request_immutable')
  const tag = db.prepare('SELECT auth_tag FROM product_environment_request').get().auth_tag
  tag[0] ^= 1
  db.prepare('UPDATE product_environment_request SET auth_tag=?').run(tag)
  assert.equal(
    call('project-environment-state', stateRequest, false),
    'PRODUCT_ENVIRONMENT_UNAVAILABLE'
  )
  assert.equal(call('stage-project-environment', request, false), 'PRODUCT_ENVIRONMENT_UNAVAILABLE')
  checks.push('actual_sqlite_receipt_auth_tag_tamper_refused_before_replay')
  chmodSync(join(scratch, '.controller-runtime-key'), 0o644)
  assert.equal(
    call('stage-project-environment', request, false),
    'CONTROLLER_SECRET_KEY_UNAVAILABLE'
  )
  chmodSync(join(scratch, '.controller-runtime-key'), 0o600)
  db.prepare("UPDATE vps SET archived_at='2026-11-14T00:00:00.000Z'").run()
  assert.equal(
    call('stage-project-environment', request, false),
    'PRODUCT_ENVIRONMENT_AUTHORITY_REJECTED'
  )
  checks.push('unsafe_key_permissions_and_changed_current_authority_refused')
  proof.status = 'PASS'
} catch (error) {
  proof.error_code = /^[A-Z][A-Z0-9_]+$/.test(error.message ?? '')
    ? error.message
    : 'ENVIRONMENT_ADMIN_GATE_FAILED'
} finally {
  code.closeDatabase()
  assert.equal(dirname(realpathSync(scratch)), realpathSync(tmpdir()))
  assert(/^opspilot-r7h2a-/.test(scratch.slice(scratch.lastIndexOf('/') + 1)))
  rmSync(scratch, { recursive: true })
  proof.private_scratch_removed = !existsSync(scratch)
  writeFileSync(join(directory, 'result.json'), JSON.stringify(proof, null, 2) + '\n')
  console.log(JSON.stringify(proof))
  process.exitCode = proof.status === 'PASS' ? 0 : 1
}
