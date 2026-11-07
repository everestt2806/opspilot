/* eslint-disable @typescript-eslint/explicit-function-return-type -- Standalone Linux CLI/SSH/SQLite registration lab. */
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, chmodSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

if (process.platform !== 'linux' || !process.env.OPSPILOT_CONTROLLER_ARTIFACT)
  throw new Error('LINUX_CLI_ARTIFACT_REQUIRED')
const artifact = process.env.OPSPILOT_CONTROLLER_ARTIFACT,
  require = createRequire(artifact),
  Database = require('better-sqlite3'),
  { Server, utils } = require('ssh2'),
  root = mkdtempSync('/var/tmp/opspilot-project-register-'),
  data = join(root, 'controller'),
  nonce = randomBytes(6).toString('hex'),
  output = resolve(import.meta.dirname, '../../.out-scripts/project-registration', nonce),
  cases = [],
  connections = new Set(),
  password = randomBytes(32).toString('base64url')
chmodSync(root, 0o700)
mkdirSync(output, { recursive: true })
const hostPath = join(root, 'host-key')
execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', hostPath], {
  stdio: 'ignore',
  timeout: 10000
})
const hostKey = readFileSync(hostPath),
  pin =
    'SHA256:' +
    createHash('sha256')
      .update(utils.parseKey(hostKey).getPublicSSH())
      .digest('base64')
      .replace(/=+$/, '')
let remoteCommands = 0,
  result,
  db
const ssh = new Server({ hostKeys: [hostKey] }, (connection) => {
  connections.add(connection)
  connection.on('error', () => {})
  connection.once('close', () => connections.delete(connection))
  connection.on('authentication', (ctx) => {
    if (ctx.method === 'password' && ctx.username === 'operator' && ctx.password === password)
      ctx.accept()
    else ctx.reject()
  })
  connection.on('ready', () =>
    connection.on('session', (_accept, reject) => {
      remoteCommands++
      reject()
    })
  )
})
const run = (command, input) =>
  new Promise((done, fail) => {
    const child = spawn(process.execPath, [artifact, command, '--data-dir', data], {
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = '',
      stderr = '',
      overflow = false
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      fail(new Error('CLI_TIMEOUT'))
    }, 30000)
    child.stdout.on('data', (chunk) => {
      if (stdout.length + chunk.length > 65536) overflow = true
      else stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      if (stderr.length + chunk.length > 65536) overflow = true
      else stderr += chunk
    })
    child.once('error', () => {
      clearTimeout(timer)
      fail(new Error('CLI_FAILED'))
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (overflow) {
        fail(new Error('CLI_OUTPUT_LIMIT'))
        return
      }
      assert.equal(stdout.includes(password), false)
      assert.equal(stderr.includes(password), false)
      done({ code, stdout, stderr })
    })
    child.stdin.end(input === undefined ? '' : JSON.stringify(input))
  })
const ok = async (command, input) => {
  const response = await run(command, input)
  assert.equal(response.code, 0)
  assert.equal(response.stderr, '')
  return JSON.parse(response.stdout)
}
const rejected = async (input, code) => {
  const response = await run('register-project', input)
  assert.equal(response.code, 1)
  assert.equal(response.stdout, '')
  assert.equal(response.stderr.trim(), 'CONTROL_PLANE_ERROR ' + code)
}
try {
  await new Promise((done) => ssh.listen(0, '127.0.0.1', done))
  const initialized = await ok('init'),
    controller = initialized.controller_id
  await ok('secrets-init')
  const enrolled = await ok('enroll-vps', {
    format: 1,
    controller_id: controller,
    profile: {
      name: 'registered-target',
      host: '127.0.0.1',
      port: ssh.address().port,
      username: 'operator',
      auth_type: 'password',
      host_fingerprint: pin
    },
    secret: password
  })
  assert.equal(enrolled.vps_id, 1)
  assert.equal(remoteCommands, 0)
  cases.push('real_cli_init_secrets_and_host_pinned_target_enrollment_without_exec')
  db = new Database(join(data, 'opspilot.db'))
  db.pragma('foreign_keys=ON')
  const input = {
    format: 1,
    controller_id: controller,
    request_key: randomUUID(),
    target_vps_id: 1,
    app_name: 'registered-api',
    framework: 'express',
    repository_url: 'https://github.com/example/api',
    production_ref: 'main',
    repository_root: '.',
    host_port: null,
    container_port: 3000,
    healthcheck_path: '/health'
  }
  const pair = await Promise.all([ok('register-project', input), ok('register-project', input)])
  assert.deepEqual(pair.map((item) => item.state).sort(), ['already_registered', 'registered'])
  assert.equal(pair[0].app_id, pair[1].app_id)
  assert.equal(pair[0].host_port, 30000)
  assert.equal(db.prepare('SELECT count(*) AS n FROM app').get().n, 1)
  assert.equal(db.prepare('SELECT count(*) AS n FROM product_history_event').get().n, 1)
  cases.push('two_real_cli_processes_same_key_one_atomic_app_source_owner_request')
  const cold = await ok('register-project', {
    ...input,
    repository_url: 'https://github.com/example/api.git'
  })
  assert.equal(cold.state, 'already_registered')
  assert.equal(cold.app_id, pair[0].app_id)
  cases.push('cold_cli_canonical_url_replay_same_app_no_mutation')
  await rejected({ ...input, app_name: 'different-api' }, 'PROJECT_IDEMPOTENCY_CONFLICT')
  await rejected({ ...input, request_key: randomUUID() }, 'PROJECT_NAME_CONFLICT')
  await rejected(
    { ...input, app_name: 'second-api', request_key: randomUUID(), host_port: 30000 },
    'PROJECT_PORT_CONFLICT'
  )
  assert.equal(db.prepare('SELECT count(*) AS n FROM app').get().n, 1)
  cases.push('changed_body_new_key_name_and_port_conflicts_preserve_original')
  const second = await ok('register-project', {
    ...input,
    app_name: 'second-api',
    request_key: randomUUID()
  })
  assert.equal(second.host_port, 30001)
  for (const table of [
    'deployment',
    'product_deploy_job',
    'product_branch_observation',
    'product_target_enrollment'
  ])
    assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0)
  assert.deepEqual(
    db
      .prepare(
        'SELECT mode,auto_deploy_paused,pause_policy_provenance FROM product_app_control ORDER BY app_id'
      )
      .all(),
    [1, 2].map(() => ({
      mode: 'product',
      auto_deploy_paused: 1,
      pause_policy_provenance: 'explicit'
    }))
  )
  assert.equal(remoteCommands, 0)
  cases.push('port_allocation_paused_policy_no_deployment_job_or_remote_target_write')
  await rejected({ ...input, secret: password }, 'PROJECT_REQUEST_INVALID')
  await rejected({ ...input, administrator_id: 'unix:0' }, 'PROJECT_REQUEST_INVALID')
  await rejected(
    { ...input, repository_url: 'https://token@github.com/example/api' },
    'PROJECT_REQUEST_INVALID'
  )
  await rejected({ ...input, framework: 'nextjs' }, 'PROJECT_REQUEST_INVALID')
  await rejected({ ...input, target_vps_id: 999 }, 'PROJECT_TARGET_UNAVAILABLE')
  cases.push('strict_cli_contract_rejects_credential_actor_source_and_unsupported_stack')
  db.exec('UPDATE vps SET ssh_security_revision=2 WHERE id=1')
  await rejected(input, 'PROJECT_TARGET_UNAVAILABLE')
  db.exec('UPDATE vps SET ssh_security_revision=1 WHERE id=1')
  db.exec("UPDATE app SET name='changed-api' WHERE id=1")
  await rejected(input, 'PROJECT_REVIEW_REQUIRED')
  db.exec("UPDATE app SET name='registered-api' WHERE id=1")
  db.exec("UPDATE product_controller SET status='maintenance'")
  const maintenance = await run('register-project', input)
  assert.equal(maintenance.code, 1)
  db.exec("UPDATE product_controller SET status='active'")
  cases.push('current_credential_revision_app_and_controller_authority_rechecked_on_replay')
  const contents = JSON.stringify(db.prepare('SELECT * FROM product_project_registration').all())
  assert.equal(contents.includes(password), false)
  assert.equal(db.prepare('SELECT MAX(version) AS n FROM schema_version').get().n, 26)
  assert.deepEqual(db.pragma('foreign_key_check'), [])
  cases.push('native_migration026_integrity_and_secret_free_registration_records')
  result = {
    status: 'PASS',
    nonce,
    passed: cases.length,
    cases,
    scope: 'REAL_LINUX_CLI_PROJECT_REGISTRATION',
    artifact_sha256: createHash('sha256').update(readFileSync(artifact)).digest('hex'),
    remote_commands: remoteCommands,
    production_vps_used: false,
    runtime_dispatch_executed: false
  }
} catch (error) {
  result = {
    status: 'FAIL',
    nonce,
    passed: cases.length,
    cases,
    code: /^[A-Z_]{1,80}$/.test(error.code) ? error.code : error.name,
    location: error.stack?.match(/project-registration\.mjs:\d+:\d+/)?.[0] ?? null
  }
} finally {
  db?.close()
  for (const connection of connections) connection.end()
  await new Promise((done) => ssh.close(done))
  assert.equal(resolve(root), root)
  assert.match(root, /^\/var\/tmp\/opspilot-project-register-[A-Za-z0-9]+$/)
  rmSync(root, { recursive: true })
  if (result) result.cleanup = true
}
writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result))
process.exitCode = result.status === 'PASS' ? 0 : 1
