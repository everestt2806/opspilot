/* eslint-disable @typescript-eslint/explicit-function-return-type -- Standalone Linux SSH/SQLite/HTTP integration lab. */
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { connect } from 'node:net'

if (process.platform !== 'linux') throw new Error('LINUX_REQUIRED')
const artifact = process.env.OPSPILOT_R1_ARTIFACT
if (!artifact) throw new Error('HTTP_CLIENT_LAB_ENV_REQUIRED')
const require = createRequire(artifact),
  api = require(artifact),
  { Server, utils } = require('ssh2'),
  nonce = randomBytes(6).toString('hex'),
  directory = mkdtempSync('/tmp/opspilot-http-client-'),
  output = resolve(import.meta.dirname, '../../.out-scripts/controller-http-client', nonce)
mkdirSync(output, { recursive: true })
const hostPath = join(directory, 'host-key')
execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', hostPath], {
  stdio: 'ignore',
  timeout: 10000
})
const hostKey = readFileSync(hostPath),
  publicKey = utils.parseKey(hostKey).getPublicSSH(),
  pin = 'SHA256:' + createHash('sha256').update(publicKey).digest('base64').replace(/=+$/, ''),
  password = randomBytes(32).toString('base64url'),
  connections = new Set(),
  cases = [],
  controller = 'http-client-controller',
  destinations = []
let dropResponse = false,
  changeBindingOnResponse = false,
  binding,
  serverApi,
  db,
  manager,
  result
const http = createServer((req, res) => {
  if (dropResponse || changeBindingOnResponse) {
    const drop = dropResponse,
      change = changeBindingOnResponse,
      end = res.end
    dropResponse = false
    changeBindingOnResponse = false
    res.end = function (...args) {
      if (change) binding.revision++
      if (drop) {
        req.socket.destroy()
        return this
      }
      return end.apply(this, args)
    }
  }
  if (!serverApi.handle(req, res)) {
    res.writeHead(404)
    res.end()
  }
})
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
    connection.on('tcpip', (accept, reject, info) => {
      destinations.push([info.destIP, info.destPort])
      if (info.destIP !== '127.0.0.1' || info.destPort !== 8768) {
        reject()
        return
      }
      const channel = accept(),
        target = connect({ host: info.destIP, port: info.destPort })
      channel.on('error', () => target.destroy())
      target.on('error', () => channel.destroy())
      channel.once('close', () => target.destroy())
      target.once('close', () => channel.destroy())
      target.pipe(channel).pipe(target)
    })
  )
})
try {
  db = api.initializeDatabase(directory)
  const now = new Date().toISOString(),
    hash = createHash('sha256').update('{}').digest('hex')
  db.prepare('INSERT INTO product_controller VALUES(?,?,?)').run(controller, now, 'active')
  db.prepare('INSERT INTO product_controller VALUES(?,?,?)').run(
    'foreign-controller',
    now,
    'active'
  )
  db.exec(
    "INSERT INTO vps(id,name,host,username,auth_type,encrypted_secret) VALUES(1,'unit-target','127.0.0.1','unit','key',X'0102')"
  )
  for (const appId of [1, 2, 3]) {
    db.prepare(
      `INSERT INTO app(id,vps_id,name,framework,host_port,container_port,source_type,git_repo_url,git_ref,git_root)
      VALUES(?,1,?,'express',?,3000,'git','https://github.com/demo/app.git','main','.')`
    ).run(appId, 'http-lab-' + appId, 30000 + appId)
    db.prepare(
      "INSERT INTO product_source_config VALUES(?,1,'https://github.com/demo/app.git','main','.','{}',?,?)"
    ).run(appId, hash, now)
    db.prepare(
      `INSERT INTO product_app_control(app_id,mode,controller_id,ownership_generation,source_generation,source_config_sha256,changed_at,auto_deploy_paused,pause_reason,pause_policy_provenance)
      VALUES(?,'product',?,1,1,?,?,1,'operator','explicit')`
    ).run(appId, appId === 3 ? 'foreign-controller' : controller, hash, now)
  }
  new api.ProductDeployRepository(db).observeTip({
    controllerId: controller,
    appId: 1,
    ownershipGeneration: 1,
    sourceGeneration: 1,
    configSha256: hash,
    ref: 'main',
    expectedObservationSequence: null,
    tipSha: 'a'.repeat(40)
  })
  const auth = new api.ControllerClientAuth(db, controller, 'unix:0'),
    issued = auth.enroll({
      request_key: randomUUID(),
      display_name: 'Native HTTP client lab',
      requested_scopes: ['read', 'deploy:manual', 'policy:write']
    })
  assert.equal(issued.state, 'issued_once')
  serverApi = new api.ControllerReadApi(
    db,
    controller,
    directory,
    new api.ControllerReadCursor(new api.AesGcmCredentialCipher(randomBytes(32)), controller),
    () => ({ service_state: 'ready', last_branch_poll_at: null, reason_code: null }),
    { commands: new api.ControllerCommands(db, controller, () => true) }
  )
  await new Promise((resolveListen, rejectListen) => {
    http.once('error', rejectListen)
    http.listen(8768, '127.0.0.1', resolveListen)
  })
  await new Promise((resolveListen) => ssh.listen(0, '127.0.0.1', resolveListen))
  binding = {
    controllerId: controller,
    revision: 1,
    accessToken: issued.credential.access_token,
    principal: {
      vpsId: 1,
      host: '127.0.0.1',
      port: ssh.address().port,
      hostFingerprint: pin,
      username: 'operator',
      authType: 'password'
    }
  }
  manager = new api.SshManager(() => ({ ...binding.principal, secret: password }))
  const client = new api.ControllerHttpClient(manager, () => binding)
  const call = async (operation, input = {}) => {
    const response = await client.call(operation, input)
    assert.equal(JSON.stringify(response).includes(binding.accessToken), false)
    assert.equal(response.state, 'response_received')
    return response.response
  }
  const [initialIdentity, status] = await Promise.all([call('identity'), call('status')])
  assert.equal(initialIdentity.controller_id, controller)
  cases.push('actual_pinned_ssh_to_authenticated_controller_api')
  assert.equal(connections.size, 1)
  cases.push('concurrent_initial_reads_share_one_real_ssh_handshake')
  assert.equal(status.active_job_count, 0)
  assert.equal(status.queued_job_count, 0)
  assert.equal((await call('capabilities')).manual_redeploy.state, 'available')
  cases.push('strict_current_status_capabilities_dto')
  const first = await call('apps', { query: { limit: 1 } })
  assert.deepEqual(
    first.items.map((app) => app.app_id),
    [1]
  )
  assert.equal(first.has_more, true)
  const second = await call('apps', { query: { limit: 1, cursor: first.next_cursor } })
  assert.deepEqual(
    second.items.map((app) => app.app_id),
    [2]
  )
  assert.equal(second.has_more, false)
  cases.push('cursor_pages_preserve_owner_and_exclude_foreign_app')
  const detail = await call('app', { app_id: 1 })
  assert.equal(detail.current_deployment_id, null)
  assert.equal(detail.current_deployment_state, null)
  assert.equal((await call('deployments', { app_id: 1 })).items.length, 0)
  cases.push('no_fabricated_runtime_success_or_deployment')
  const key = randomUUID(),
    body = {
      expected_ownership_generation: 1,
      expected_source_generation: 1,
      target: { kind: 'current_desired' }
    },
    input = { app_id: 1, request_key: key, body }
  dropResponse = true
  assert.deepEqual(await client.call('redeploy', input), {
    state: 'outcome_unknown',
    idempotency_key: key,
    may_have_been_accepted: true,
    next_step: 'query_same_request_key'
  })
  assert.equal(db.prepare('SELECT count(*) AS n FROM product_api_request').get().n, 1)
  assert.equal(db.prepare('SELECT count(*) AS n FROM product_deploy_job').get().n, 1)
  cases.push('response_lost_after_actual_transaction_returns_unknown_once')
  const lookup = await call('lookup', { request_key: key })
  assert.equal(lookup.found, true)
  assert.equal(lookup.status.state, 'accepted')
  const replay = await call('redeploy', input)
  assert.equal(replay.job_id, lookup.status.job_id)
  assert.equal(replay.target_sha, 'a'.repeat(40))
  assert.equal(db.prepare('SELECT count(*) AS n FROM product_deploy_job').get().n, 1)
  cases.push('same_key_lookup_and_replay_return_original_single_job')
  const jobs = await call('jobs', { app_id: 1 }),
    history = await call('history', { app_id: 1 })
  assert.equal(jobs.items[0].job_id, replay.job_id)
  assert.equal(jobs.items[0].state, 'queued')
  assert.ok(history.items.some((event) => event.kind === 'api_manual_redeploy'))
  cases.push('job_and_history_schema_preserve_durable_intent_not_runtime_success')
  await assert.rejects(
    client.call('redeploy', {
      ...input,
      request_key: randomUUID(),
      body: { ...body, expected_source_generation: 2 }
    }),
    { code: 'SOURCE_GENERATION_STALE', httpStatus: 409 }
  )
  assert.equal(db.prepare('SELECT count(*) AS n FROM product_deploy_job').get().n, 1)
  cases.push('definitive_server_rejection_uses_safe_code_no_new_job')
  const policy = await call('policy', {
    app_id: 1,
    request_key: randomUUID(),
    body: { expected_ownership_generation: 1, expected_source_generation: 1, action: 'pause' }
  })
  assert.equal(policy.auto_deploy_paused, true)
  cases.push('policy_route_and_body_use_authenticated_command_contract')
  changeBindingOnResponse = true
  await assert.rejects(client.call('identity', {}), { code: 'BINDING_CHANGED' })
  cases.push('binding_changed_during_response_does_not_return_stale_data')
  auth.revoke({ request_key: randomUUID(), client_id: issued.client.client_id })
  await assert.rejects(client.call('identity', {}), { code: 'CLIENT_REVOKED', httpStatus: 401 })
  cases.push('revocation_visible_immediately_through_actual_ssh_transport')
  assert.ok(destinations.every(([host, port]) => host === '127.0.0.1' && port === 8768))
  assert.equal(
    JSON.stringify(db.prepare('SELECT * FROM product_desktop_credential').all()).includes(
      binding.accessToken
    ),
    false
  )
  assert.equal(
    JSON.stringify(db.prepare('SELECT * FROM product_api_request').all()).includes(
      binding.accessToken
    ),
    false
  )
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  cases.push('fixed_destination_digest_only_no_bearer_in_durable_results')
  result = {
    status: 'PASS',
    nonce,
    scope: 'PINNED_SSH_CONTROLLER_HTTP_SQLITE_CLIENT',
    passed: cases.length,
    cases,
    runtime_dispatch_executed: false,
    public_management_listener: false,
    production_vps_used: false,
    artifact_sha256: createHash('sha256').update(readFileSync(artifact)).digest('hex')
  }
} catch (error) {
  result = {
    status: 'FAIL',
    nonce,
    passed: cases.length,
    cases,
    code: /^[A-Z_]{1,80}$/.test(error.code) ? error.code : error.name,
    assertion_location: error.stack?.match(/controller-http-client\.mjs:\d+:\d+/)?.[0] ?? null
  }
} finally {
  await manager?.disconnectAll()
  for (const connection of connections) connection.end()
  await new Promise((resolveClose) => ssh.close(resolveClose))
  await serverApi?.close()
  http.closeAllConnections()
  await new Promise((resolveClose) => http.close(resolveClose))
  api.closeDatabase()
  assert.match(directory, /^\/tmp\/opspilot-http-client-[A-Za-z0-9]+$/)
  rmSync(directory, { recursive: true })
  if (result) result.cleanup = true
}
writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result))
process.exitCode = result.status === 'PASS' ? 0 : 1
