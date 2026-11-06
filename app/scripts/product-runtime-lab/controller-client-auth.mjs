/* eslint-disable @typescript-eslint/explicit-function-return-type -- Standalone JavaScript integration lab. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomUUID, randomBytes } from 'node:crypto'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

if (process.platform !== 'linux') throw new Error('LINUX_REQUIRED')
const artifact = process.env.OPSPILOT_CONTROLLER_ARTIFACT,
  lab = process.env.OPSPILOT_R1_ARTIFACT
if (!artifact || !lab) throw new Error('CLIENT_AUTH_LAB_ENV_REQUIRED')
const require = createRequire(lab),
  { ControllerClientAuth } = require(lab),
  Database = require('better-sqlite3')
const nonce = randomBytes(6).toString('hex'),
  directory = mkdtempSync('/tmp/opspilot-client-auth-')
chmodSync(directory, 0o700)
const cases = []
const record = (name) => cases.push(name)
const output = resolve(import.meta.dirname, '../../.out-scripts/controller-client-auth', nonce)
mkdirSync(output, { recursive: true })
const run = (command, input) =>
  new Promise((resolveChild) => {
    const child = spawn(process.execPath, [artifact, command, '--data-dir', directory], {
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = '',
      stderr = '',
      overflow = false
    child.stdout.on('data', (bytes) => {
      if (stdout.length + bytes.length <= 16384) stdout += bytes
      else overflow = true
    })
    child.stderr.on('data', (bytes) => {
      if (stderr.length + bytes.length <= 8192) stderr += bytes
      else overflow = true
    })
    child.once('error', () => resolveChild({ code: null, overflow: true }))
    child.once('close', (code) => resolveChild({ code, stdout, stderr, overflow }))
    child.stdin.end(input === undefined ? '' : JSON.stringify(input))
  })
const ok = (result) => {
  assert.equal(result.code, 0)
  assert.equal(result.overflow, false)
  assert.equal(result.stderr, '')
  return JSON.parse(result.stdout)
}
let database, result
try {
  const identity = ok(await run('init'))
  database = new Database(join(directory, 'opspilot.db'))
  database.pragma('foreign_keys=ON')
  assert.equal(database.prepare('SELECT MAX(version) AS n FROM schema_version').get().n, 24)
  assert.equal(database.prepare('SELECT count(*) AS n FROM product_desktop_client').get().n, 0)
  record('native_migration022_empty_grants')
  const request = {
    request_key: randomUUID(),
    display_name: 'Linux client lab',
    requested_scopes: ['read', 'deploy:manual']
  }
  const issued = ok(await run('enroll-desktop-client', request))
  assert.equal(issued.state, 'issued_once')
  assert.equal(issued.controller_id, identity.controller_id)
  assert.match(issued.credential.access_token, /^opspilot_[A-Za-z0-9_-]{43}$/)
  record('actual_cli_one_time_issue')
  const auth = new ControllerClientAuth(
    database,
    identity.controller_id,
    `unix:${process.getuid()}`
  )
  assert.equal(
    auth.authenticate(`Bearer ${issued.credential.access_token}`, 'deploy:manual').client_id,
    issued.client.client_id
  )
  record('native_digest_authenticate')
  const expected = createHash('sha256').update(issued.credential.access_token).digest('hex')
  assert.equal(
    database.prepare('SELECT token_sha256 FROM product_desktop_credential').get().token_sha256,
    expected
  )
  for (const table of [
    'product_desktop_client',
    'product_desktop_credential',
    'product_desktop_admin_request'
  ])
    assert.equal(
      JSON.stringify(database.prepare(`SELECT * FROM ${table}`).all()).includes(
        issued.credential.access_token
      ),
      false
    )
  record('database_digest_only_no_bearer')
  const replay = ok(await run('enroll-desktop-client', request))
  assert.deepEqual(replay, {
    state: 'credential_delivery_unknown',
    controller_id: identity.controller_id,
    client_id: issued.client.client_id
  })
  record('independent_process_replay_no_secret')
  const conflict = await run('enroll-desktop-client', { ...request, display_name: 'Changed' })
  assert.equal(conflict.code, 1)
  assert.equal(conflict.stdout, '')
  assert.equal(conflict.stderr.trim(), 'CONTROL_PLANE_ERROR IDEMPOTENCY_CONFLICT')
  record('changed_body_conflict_safe_error')
  const raceRequest = { ...request, request_key: randomUUID() }
  const race = (
    await Promise.all([
      run('enroll-desktop-client', raceRequest),
      run('enroll-desktop-client', raceRequest)
    ])
  ).map(ok)
  assert.deepEqual(race.map((r) => r.state).sort(), ['credential_delivery_unknown', 'issued_once'])
  const winner = race.find((r) => r.state === 'issued_once'),
    duplicate = race.find((r) => r.state === 'credential_delivery_unknown')
  assert.equal(winner.client.client_id, duplicate.client_id)
  assert.equal(database.prepare('SELECT count(*) AS n FROM product_desktop_client').get().n, 2)
  record('two_process_concurrency_one_credential')
  const actor = await run('enroll-desktop-client', {
    ...request,
    request_key: randomUUID(),
    administrator_identity: 'unix:0'
  })
  assert.equal(actor.code, 1)
  assert.equal(actor.stdout, '')
  assert.equal(actor.stderr.trim(), 'CONTROL_PLANE_ERROR REQUEST_INVALID')
  record('body_administrator_rejected')
  const revokeRequest = { request_key: randomUUID(), client_id: issued.client.client_id }
  const revoked = ok(await run('revoke-desktop-client', revokeRequest))
  assert.equal(revoked.client_id, issued.client.client_id)
  assert.throws(
    () => auth.authenticate(`Bearer ${issued.credential.access_token}`),
    /CLIENT_REVOKED/
  )
  record('actual_cli_revoke_blocks_old_token')
  assert.deepEqual(ok(await run('revoke-desktop-client', revokeRequest)), revoked)
  record('revocation_replay_stable')
  assert.equal(ok(await run('enroll-desktop-client', request)).state, 'credential_delivery_unknown')
  assert.throws(
    () => auth.authenticate(`Bearer ${issued.credential.access_token}`),
    /CLIENT_REVOKED/
  )
  record('enrollment_replay_never_reactivates')
  database.exec("UPDATE product_controller SET status='revoked'")
  const revokedController = await run('enroll-desktop-client', request)
  assert.equal(revokedController.code, 1)
  assert.equal(revokedController.stdout, '')
  assert.equal(revokedController.stderr.trim(), 'CONTROL_PLANE_ERROR CONTROLLER_NOT_ACTIVE')
  record('current_controller_rechecked_before_replay')
  assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [])
  record('foreign_key_integrity')
  result = {
    status: 'PASS',
    scope: 'CONTROLLER_CLIENT_AUTH_NATIVE_CLI',
    nonce,
    passed: cases.length,
    cases
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
  database?.close()
  assert.match(directory, /^\/tmp\/opspilot-client-auth-[A-Za-z0-9]+$/)
  rmSync(directory, { recursive: true })
}
writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result))
process.exitCode = result.status === 'PASS' ? 0 : 1
