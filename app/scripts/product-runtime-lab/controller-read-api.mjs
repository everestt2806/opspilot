/* eslint-disable @typescript-eslint/explicit-function-return-type -- Standalone JavaScript Linux integration lab. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomUUID, randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

if (process.platform !== 'linux') throw new Error('LINUX_REQUIRED')
const artifact = process.env.OPSPILOT_CONTROLLER_ARTIFACT
if (!artifact) throw new Error('READ_API_LAB_ENV_REQUIRED')
const nonce = randomBytes(6).toString('hex'),
  directory = mkdtempSync('/tmp/opspilot-read-api-')
chmodSync(directory, 0o700)
const output = resolve(import.meta.dirname, '../../.out-scripts/controller-read-api', nonce)
mkdirSync(output, { recursive: true })
const pin = createHash('sha256')
  .update(readFileSync(join(dirname(artifact), 'bundle-manifest.json')))
  .digest('hex')
const cases = [],
  record = (name) => cases.push(name)
const start = (command, input) => {
  const child = spawn(process.execPath, [artifact, command, '--data-dir', directory], {
    cwd: '/',
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const state = { child, stdout: '', stderr: '', overflow: false, closed: null }
  state.closed = new Promise((resolveChild) => {
    child.once('error', () => resolveChild(null))
    child.once('close', resolveChild)
  })
  child.stdout.on('data', (bytes) => {
    if (state.stdout.length + bytes.length <= 16384) state.stdout += bytes
    else state.overflow = true
  })
  child.stderr.on('data', (bytes) => {
    if (state.stderr.length + bytes.length <= 8192) state.stderr += bytes
    else state.overflow = true
  })
  child.stdin.end(input === undefined ? '' : JSON.stringify(input))
  return state
}
const run = async (command, input) => {
  const state = start(command, input),
    code = await state.closed
  assert.equal(code, 0)
  assert.equal(state.stderr, '')
  assert.equal(state.overflow, false)
  return JSON.parse(state.stdout)
}
const health = async () => {
  try {
    return (await (await fetch('http://127.0.0.1:8768/healthz')).json()).service_state
  } catch {
    return null
  }
}
const waitFor = async (check) => {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    const value = await check()
    if (value) return value
    await delay(50)
  }
  throw new Error('READ_API_LAB_TIMEOUT')
}
let active, result
const stop = async () => {
  if (!active) return
  const state = active
  active = null
  state.child.kill('SIGTERM')
  const code = await Promise.race([state.closed, delay(10000).then(() => 'timeout')])
  if (code === 'timeout') {
    state.child.kill('SIGKILL')
    await state.closed
    throw new Error('READ_API_STOP_TIMEOUT')
  }
  assert.equal(code, 0)
  assert.equal(state.overflow, false)
  assert.equal(state.stderr, '')
}
try {
  const identity = await run('init'),
    controller = identity.controller_id
  await run('secrets-init')
  const issued = await run('enroll-desktop-client', {
    request_key: randomUUID(),
    display_name: 'Native read API lab',
    requested_scopes: ['read']
  })
  assert.equal(issued.state, 'issued_once')
  const token = issued.credential.access_token,
    prefix = `http://127.0.0.1:8768/v1/controllers/${controller}`
  const get = (path, authorized = true) =>
    fetch(prefix + path, { headers: authorized ? { authorization: `Bearer ${token}` } : {} })
  active = start('run')
  await waitFor(async () => (await health()) === 'maintenance')
  assert.equal((await get('/apps')).status, 404)
  await stop()
  record('default_polling_keeps_management_api_closed')
  active = start('run-product', { format: 1, artifact, manifest_sha256: pin })
  await waitFor(async () => (await health()) === 'ready')
  record('explicit_execution_starts_after_recovery')
  assert.equal((await get('/identity', false)).status, 401)
  record('unauthenticated_http_rejected')
  const dto = await (await get('/identity')).json()
  assert.equal(dto.controller_id, controller)
  assert.equal(dto.api_version, 'v1')
  assert.equal(dto.data_freshness, 'current')
  assert.equal(dto.api_bind_address, '127.0.0.1')
  assert.equal(JSON.stringify(dto).includes(token), false)
  record('native_bearer_identity_no_secret')
  const status = await (await get('/status')).json()
  assert.equal(status.queued_job_count, 0)
  assert.equal(status.active_job_count, 0)
  assert.equal(status.uncertain_job_count, 0)
  record('native_current_sql_status')
  const apps = await (await get('/apps')).json()
  assert.deepEqual(apps.items, [])
  assert.equal(apps.next_cursor, null)
  assert.equal(apps.has_more, false)
  record('empty_collection_is_explicit_not_error')
  const capabilities = await (await get('/capabilities')).json()
  assert.equal(capabilities.read.state, 'available')
  assert.equal(capabilities.manual_redeploy.state, 'unsupported')
  record('unsupported_mutations_not_advertised')
  assert.equal((await get('/apps?limit=101')).status, 400)
  assert.equal((await get('/apps?token=synthetic-unit')).status, 400)
  record('query_and_limit_guards')
  await run('revoke-desktop-client', {
    request_key: randomUUID(),
    client_id: issued.client.client_id
  })
  const revoked = await get('/apps')
  assert.equal(revoked.status, 401)
  assert.equal((await revoked.json()).error.code, 'CLIENT_REVOKED')
  record('fresh_cli_revoke_immediate_in_running_http_service')
  await stop()
  assert.equal(await health(), null)
  record('graceful_shutdown_drains_before_db_close')
  result = {
    status: 'PASS',
    scope: 'CONTROLLER_READ_API_NATIVE_CLI_HTTP',
    nonce,
    passed: cases.length,
    cases,
    manifest_sha256: pin
  }
} catch (error) {
  result = {
    status: 'FAIL',
    nonce,
    passed: cases.length,
    cases,
    code: typeof error.code === 'string' ? error.code : error.name
  }
} finally {
  await stop()
  assert.match(directory, /^\/tmp\/opspilot-read-api-[A-Za-z0-9]+$/)
  rmSync(directory, { recursive: true })
}
writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result))
process.exitCode = result.status === 'PASS' ? 0 : 1
