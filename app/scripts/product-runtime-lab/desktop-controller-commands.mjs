/* eslint-disable @typescript-eslint/explicit-function-return-type -- Standalone Linux SSH/HTTP/cold SQLite command lab. */
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { connect } from 'node:net'

if (process.platform !== 'linux' || !process.env.OPSPILOT_R1_ARTIFACT)
  throw new Error('LINUX_LAB_ARTIFACT_REQUIRED')
const artifact = process.env.OPSPILOT_R1_ARTIFACT,
  require = createRequire(artifact),
  api = require(artifact)
if (process.argv.includes('--cold')) {
  let text = ''
  for await (const chunk of process.stdin) {
    text += chunk
    if (text.length > 8192) throw new Error('LAB_INPUT_LIMIT')
  }
  const input = JSON.parse(text),
    db = api.initializeDatabase(input.directory),
    cipher = new api.AesGcmCredentialCipher(Buffer.from(input.key, 'base64')),
    vault = new api.DesktopControllerVault(db, cipher),
    manager = new api.SshManager(() => ({
      ...vault.resolve(input.binding_id).principal,
      secret: input.ssh_secret
    })),
    service = new api.DesktopControllerService(db, cipher, manager)
  try {
    const before = await service.sendCommand(input.request_key)
    const after = await service.checkCommand(input.request_key)
    process.stdout.write(JSON.stringify({ before: before.state, after }) + '\n')
  } finally {
    await manager.disconnectAll()
    api.closeDatabase()
  }
  process.exit(0)
}
const { Server, utils } = require('ssh2'),
  Database = require('better-sqlite3'),
  nonce = randomBytes(6).toString('hex'),
  root = mkdtempSync('/var/tmp/opspilot-desktop-command-'),
  remoteDir = join(root, 'controller'),
  localDir = join(root, 'desktop'),
  output = resolve(import.meta.dirname, '../../.out-scripts/desktop-controller-commands', nonce),
  controller = 'native-command-controller',
  password = randomBytes(32).toString('base64url'),
  key = randomBytes(32),
  cases = [],
  connections = new Set(),
  destinations = []
mkdirSync(output, { recursive: true })
mkdirSync(remoteDir, { mode: 0o700 })
mkdirSync(localDir, { mode: 0o700 })
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
let remote,
  local,
  manager,
  serverApi,
  result,
  dropResponse = false,
  posts = 0
const http = createServer((req, res) => {
  if (req.method === 'POST') posts++
  if (dropResponse) {
    dropResponse = false
    res.end = function () {
      req.socket.destroy()
      return this
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
const cold = (bindingId, requestKey) =>
  new Promise((resolveChild, rejectChild) => {
    const child = spawn(process.execPath, [import.meta.filename, '--cold'], {
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let text = '',
      overflow = false
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      rejectChild(new Error('COLD_TIMEOUT'))
    }, 30000)
    child.stdout.on('data', (chunk) => {
      if (text.length + chunk.length > 16384) overflow = true
      else text += chunk
    })
    child.stderr.resume()
    child.once('error', () => {
      clearTimeout(timer)
      rejectChild(new Error('COLD_FAILED'))
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code !== 0 || overflow) {
        rejectChild(new Error('COLD_FAILED'))
        return
      }
      try {
        resolveChild(JSON.parse(text))
      } catch {
        rejectChild(new Error('COLD_INVALID'))
      }
    })
    child.stdin.end(
      JSON.stringify({
        directory: localDir,
        key: key.toString('base64'),
        binding_id: bindingId,
        request_key: requestKey,
        ssh_secret: password
      })
    )
  })
try {
  // Hai file SQLite độc lập, như Desktop và controller thật.
  const remoteApi = api.initializeDatabase(remoteDir)
  api.closeDatabase()
  assert.equal(remoteApi.open, false)
  remote = new Database(join(remoteDir, 'opspilot.db'))
  remote.pragma('foreign_keys=ON')
  const now = new Date().toISOString(),
    hash = createHash('sha256').update('{}').digest('hex')
  remote.prepare('INSERT INTO product_controller VALUES(?,?,?)').run(controller, now, 'active')
  remote.exec(
    "INSERT INTO vps(id,name,host,username,auth_type,encrypted_secret) VALUES(1,'target','127.0.0.1','unit','key',X'0102')"
  )
  for (const appId of [1, 2]) {
    remote
      .prepare(
        `INSERT INTO app(id,vps_id,name,framework,host_port,container_port,source_type,git_repo_url,git_ref,git_root)
      VALUES(?,1,?,'express',?,3000,'git','https://github.com/demo/app.git','main','.')`
      )
      .run(appId, 'journal-app-' + appId, 30000 + appId)
    remote
      .prepare(
        "INSERT INTO product_source_config VALUES(?,1,'https://github.com/demo/app.git','main','.','{}',?,?)"
      )
      .run(appId, hash, now)
    remote
      .prepare(
        `INSERT INTO product_app_control(app_id,mode,controller_id,ownership_generation,source_generation,source_config_sha256,changed_at,auto_deploy_paused,pause_reason,pause_policy_provenance)
      VALUES(?,'product',?,1,1,?,?,1,'operator','explicit')`
      )
      .run(appId, controller, hash, now)
    new api.ProductDeployRepository(remote).observeTip({
      controllerId: controller,
      appId,
      ownershipGeneration: 1,
      sourceGeneration: 1,
      configSha256: hash,
      ref: 'main',
      expectedObservationSequence: null,
      tipSha: 'a'.repeat(40)
    })
  }
  const auth = new api.ControllerClientAuth(remote, controller, 'unix:0')
  serverApi = new api.ControllerReadApi(
    remote,
    controller,
    remoteDir,
    new api.ControllerReadCursor(new api.AesGcmCredentialCipher(randomBytes(32)), controller),
    () => ({ service_state: 'ready', last_branch_poll_at: null, reason_code: null }),
    { commands: new api.ControllerCommands(remote, controller, () => true) }
  )
  await new Promise((done, fail) => {
    http.once('error', fail)
    http.listen(8768, '127.0.0.1', done)
  })
  await new Promise((done) => ssh.listen(0, '127.0.0.1', done))
  local = api.initializeDatabase(localDir)
  const cipher = new api.AesGcmCredentialCipher(key),
    vault = new api.DesktopControllerVault(local, cipher),
    principal = {
      vpsId: 1,
      host: '127.0.0.1',
      port: ssh.address().port,
      hostFingerprint: pin,
      username: 'operator',
      authType: 'password'
    }
  local
    .prepare(
      "INSERT INTO vps(id,name,host,port,host_fingerprint,username,auth_type,encrypted_secret) VALUES(1,'controller',?,?,?,?,?,X'0102')"
    )
    .run(principal.host, principal.port, pin, principal.username, principal.authType)
  const enroll = (scopes) => {
    const bindingId = randomUUID(),
      issued = auth.enroll({
        request_key: randomUUID(),
        display_name: 'Native journal',
        requested_scopes: scopes
      })
    vault.prepare({
      binding_id: bindingId,
      controller_id: controller,
      vps_id: 1,
      ssh_security_revision: 1,
      principal,
      artifact_path: '/opt/opspilot/control-plane.cjs',
      data_directory: '/var/lib/opspilot',
      node_path: '/opt/opspilot/node',
      manifest_sha256: 'a'.repeat(64),
      display_name: 'Native journal',
      requested_scopes: scopes
    })
    vault.activate(bindingId, 1, issued)
    return { bindingId, token: issued.credential.access_token }
  }
  const { bindingId, token } = enroll(['read', 'deploy:manual', 'policy:write'])
  manager = new api.SshManager(() => ({ ...principal, secret: password }))
  const service = new api.DesktopControllerService(local, cipher, manager),
    input = {
      binding_id: bindingId,
      app_id: 1,
      expected_ownership_generation: 1,
      expected_source_generation: 1,
      operation: 'redeploy',
      target: { kind: 'current_desired' }
    }
  const intent = await service.prepareCommand(input)
  assert.equal(intent.state, 'prepared')
  assert.equal(connections.size, 0)
  const independent = new Database(join(localDir, 'opspilot.db'))
  assert.equal(
    independent.prepare('SELECT request_key FROM desktop_controller_command').get().request_key,
    intent.request_key
  )
  independent.close()
  cases.push('intent_durable_before_network_in_independent_sqlite_connection')
  dropResponse = true
  const [sent, duplicate] = await Promise.all([
    service.sendCommand(intent.request_key),
    service.sendCommand(intent.request_key)
  ])
  assert.equal(sent.state, 'outcome_unknown')
  assert.equal(duplicate.state, 'in_flight')
  assert.equal(posts, 1)
  assert.equal(remote.prepare('SELECT count(*) AS n FROM product_deploy_job').get().n, 1)
  cases.push('actual_ssh_http_response_dropped_after_commit_one_post_one_job')
  const recovered = await cold(bindingId, intent.request_key)
  assert.equal(recovered.before, 'outcome_unknown')
  assert.equal(recovered.after.state, 'accepted')
  assert.equal(recovered.after.remote_state, 'accepted')
  assert.equal(posts, 1)
  assert.equal(remote.prepare('SELECT count(*) AS n FROM product_deploy_job').get().n, 1)
  cases.push('new_process_decrypts_same_binding_and_looks_up_original_key_without_post')
  const lostBeforeSend = await service.prepareCommand({ ...input, app_id: 2 })
  local
    .prepare("UPDATE desktop_controller_command SET state='in_flight' WHERE request_key=?")
    .run(lostBeforeSend.request_key)
  const notFound = await cold(bindingId, lostBeforeSend.request_key)
  assert.equal(notFound.after.state, 'outcome_unknown')
  assert.equal(posts, 1)
  await assert.rejects(
    service.prepareCommand({ ...input, app_id: 2 }),
    (error) => error.code === 'VALIDATION' && error.context?.cause?.message === 'COMMAND_PENDING'
  )
  await assert.rejects(
    service.cancelCommand(lostBeforeSend.request_key),
    (error) => error.code === 'VALIDATION' && error.context?.cause?.message === 'COMMAND_PENDING'
  )
  cases.push('cold_in_flight_not_found_stays_unknown_blocks_new_key_and_cancel')
  const policyInput = {
    binding_id: bindingId,
    app_id: 1,
    expected_ownership_generation: 1,
    expected_source_generation: 1,
    operation: 'policy',
    action: 'pause'
  }
  const cancelled = await service.prepareCommand(policyInput)
  assert.equal((await service.cancelCommand(cancelled.request_key)).state, 'cancelled')
  assert.equal((await service.sendCommand(cancelled.request_key)).state, 'cancelled')
  assert.equal(posts, 1)
  const pause = await service.prepareCommand(policyInput)
  assert.notEqual(pause.request_key, cancelled.request_key)
  assert.equal((await service.sendCommand(pause.request_key)).remote_state, 'completed')
  assert.equal(posts, 2)
  cases.push('cancel_unsent_only_and_explicit_new_policy_key_executes_once')
  const readOnly = enroll(['read'])
  await assert.rejects(
    service.prepareCommand({ ...input, binding_id: readOnly.bindingId }),
    (error) => error.code === 'VALIDATION' && error.context?.cause?.message === 'SCOPE_REQUIRED'
  )
  assert.equal(posts, 2)
  cases.push('read_only_registration_cannot_prepare_write_or_increase_scope')
  const stale = await service.prepareCommand(policyInput)
  local.exec('UPDATE vps SET ssh_security_revision=2 WHERE id=1')
  await assert.rejects(
    service.sendCommand(stale.request_key),
    (error) =>
      error.code === 'VALIDATION' && error.context?.cause?.message === 'BINDING_UNAVAILABLE'
  )
  assert.equal(posts, 2)
  cases.push('current_vps_revision_prevents_post_after_prepare')
  const records = JSON.stringify(local.prepare('SELECT * FROM desktop_controller_command').all())
  assert.equal(records.includes(token), false)
  assert.equal(records.includes(password), false)
  assert.equal(records.includes(key.toString('base64')), false)
  assert.equal(JSON.stringify(await service.listCommands(bindingId)).includes('body_json'), false)
  cases.push('journal_and_ipc_metadata_contain_no_token_password_key_or_raw_body')
  local.exec('DELETE FROM vps WHERE id=1')
  assert.equal((await service.listCommands(bindingId)).length, 5)
  assert.deepEqual(local.pragma('foreign_key_check'), [])
  assert.deepEqual(remote.pragma('foreign_key_check'), [])
  assert.ok(destinations.every(([host, port]) => host === '127.0.0.1' && port === 8768))
  cases.push('migration025_tombstones_survive_vps_removal_and_fixed_tunnel_integrity')
  result = {
    status: 'PASS',
    nonce,
    passed: cases.length,
    cases,
    posts,
    remote_jobs: remote.prepare('SELECT count(*) AS n FROM product_deploy_job').get().n,
    scope: 'DESKTOP_COMMAND_JOURNAL_REAL_SSH_HTTP_COLD_PROCESS',
    artifact_sha256: createHash('sha256').update(readFileSync(artifact)).digest('hex'),
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
    location: error.stack?.match(/desktop-controller-commands\.mjs:\d+:\d+/)?.[0] ?? null
  }
} finally {
  await manager?.disconnectAll()
  for (const connection of connections) connection.end()
  await new Promise((done) => ssh.close(done))
  await serverApi?.close()
  http.closeAllConnections()
  await new Promise((done) => http.close(done))
  remote?.close()
  api.closeDatabase()
  assert.equal(resolve(root), root)
  assert.match(root, /^\/var\/tmp\/opspilot-desktop-command-[A-Za-z0-9]+$/)
  rmSync(root, { recursive: true })
  if (result) result.cleanup = true
}
writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result))
process.exitCode = result.status === 'PASS' ? 0 : 1
