/* eslint-disable @typescript-eslint/explicit-function-return-type -- Standalone Linux SSH/CLI/cold SQLite integration lab. */
import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  cpSync,
  copyFileSync,
  chmodSync,
  chownSync,
  lstatSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { connect } from 'node:net'

if (process.platform !== 'linux') throw new Error('LINUX_REQUIRED')
const artifact = process.env.OPSPILOT_R1_ARTIFACT,
  controllerArtifact = process.env.OPSPILOT_CONTROLLER_ARTIFACT
if (!artifact || !controllerArtifact) throw new Error('ENROLLMENT_LAB_ENV_REQUIRED')
const require = createRequire(artifact),
  api = require(artifact)
if (process.argv.includes('--cold')) {
  let input = ''
  for await (const chunk of process.stdin) {
    input += chunk
    if (input.length > 8192) throw new Error('LAB_INPUT_LIMIT')
  }
  const request = JSON.parse(input),
    db = api.initializeDatabase(request.directory)
  const cipher = new api.AesGcmCredentialCipher(Buffer.from(request.key, 'base64')),
    vault = new api.DesktopControllerVault(db, cipher),
    ssh = new api.SshManager(() => ({
      ...vault.resolve(request.binding_id).principal,
      secret: request.ssh_secret
    }))
  try {
    const client = new api.ControllerHttpClient(ssh, () => vault.resolve(request.binding_id))
    const dto = await client.call('identity', {})
    assert.equal(dto.state, 'response_received')
    process.stdout.write(
      JSON.stringify({ status: 'PASS', controller_id: dto.response.controller_id }) + '\n'
    )
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        status: 'BLOCKED',
        code: /^[A-Z_]{1,80}$/.test(error.code) ? error.code : 'UNEXPECTED'
      }) + '\n'
    )
  } finally {
    await ssh.disconnectAll()
    api.closeDatabase()
  }
  process.exit(0)
}
const { Server, utils } = require('ssh2'),
  Database = require('better-sqlite3'),
  nonce = randomBytes(6).toString('hex'),
  install = mkdtempSync('/var/tmp/opspilot-desktop-enroll-'),
  data = join(install, 'controller-data'),
  local = join(install, 'desktop'),
  output = resolve(import.meta.dirname, '../../.out-scripts/desktop-controller-enrollment', nonce)
mkdirSync(output, { recursive: true })
mkdirSync(data, { mode: 0o700 })
mkdirSync(local, { mode: 0o700 })
cpSync(dirname(controllerArtifact), join(install, 'payload'), { recursive: true })
cpSync(join(dirname(controllerArtifact), '../node_modules'), join(install, 'node_modules'), {
  recursive: true,
  dereference: false
})
copyFileSync(process.execPath, join(install, 'node'))
assert.equal(lstatSync(join(install, 'node')).isSymbolicLink(), false)
assert.notEqual(lstatSync(join(install, 'node')).ino, lstatSync(process.execPath).ino)
chownSync(join(install, 'node'), process.getuid(), process.getgid())
chmodSync(join(install, 'node'), 0o700)
const cli = join(install, 'payload/control-plane.cjs'),
  pin = createHash('sha256')
    .update(readFileSync(join(install, 'payload/bundle-manifest.json')))
    .digest('hex')
execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(install, 'host-key')], {
  stdio: 'ignore',
  timeout: 10000
})
const hostKey = readFileSync(join(install, 'host-key')),
  hostPin =
    'SHA256:' +
    createHash('sha256')
      .update(utils.parseKey(hostKey).getPublicSSH())
      .digest('base64')
      .replace(/=+$/, ''),
  password = randomBytes(32).toString('base64url'),
  masterKey = randomBytes(32),
  cases = [],
  connections = new Set(),
  children = new Set()
let observedCatalogSize,
  serverApi,
  remote,
  manager,
  result,
  discardReply = false
const http = createServer((req, res) => {
  if (!serverApi.handle(req, res)) {
    res.writeHead(404)
    res.end()
  }
})
const ssh = new Server({ hostKeys: [hostKey] }, (connection) => {
  connections.add(connection)
  connection.on('error', () => {})
  connection.once('close', () => connections.delete(connection))
  connection.on('authentication', (ctx) =>
    ctx.method === 'password' && ctx.username === 'root' && ctx.password === password
      ? ctx.accept()
      : ctx.reject()
  )
  connection.on('ready', () => {
    connection.on('session', (accept) => {
      const session = accept()
      session.on('exec', (acceptExec, rejectExec, info) => {
        if (!info.command.startsWith('python3 -B -u -c ')) {
          rejectExec()
          return
        }
        const channel = acceptExec(),
          drop = discardReply
        discardReply = false
        const child = spawn('/bin/sh', ['-c', info.command], {
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: true
        })
        children.add(child)
        child.on('error', () => channel.close())
        child.stdin.on('error', () => {})
        channel.on('error', () => {})
        channel.pipe(child.stdin)
        if (drop) child.stdout.resume()
        else child.stdout.pipe(channel, { end: false })
        child.stderr.resume()
        child.once('close', (code) => {
          children.delete(child)
          channel.exit(drop ? 1 : (code ?? 1))
          channel.end()
        })
        channel.once('close', () => {
          if (child.exitCode === null) {
            try {
              process.kill(-child.pid, 'SIGTERM')
            } catch {
              /* Already stopped. */
            }
          }
        })
      })
    })
    connection.on('tcpip', (accept, reject, info) => {
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
  })
})
const cold = (bindingId) =>
  new Promise((resolveChild, rejectChild) => {
    const child = spawn(process.execPath, [import.meta.filename, '--cold'], {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let text = '',
      overflow = false
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      rejectChild(new Error('COLD_PROCESS_TIMEOUT'))
    }, 25000)
    child.stdout.on('data', (chunk) => {
      if (text.length + chunk.length > 8192) overflow = true
      else text += chunk
    })
    child.stderr.resume()
    child.once('error', () => {
      clearTimeout(timer)
      rejectChild(new Error('COLD_PROCESS_FAILED'))
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code !== 0 || overflow) {
        rejectChild(new Error('COLD_PROCESS_FAILED'))
        return
      }
      try {
        resolveChild(JSON.parse(text))
      } catch {
        rejectChild(new Error('COLD_PROCESS_INVALID'))
      }
    })
    child.stdin.end(
      JSON.stringify({
        directory: local,
        key: masterKey.toString('base64'),
        binding_id: bindingId,
        ssh_secret: password
      })
    )
  })
try {
  const initialized = api.initializeController(data),
    controller = initialized.controllerId
  remote = new Database(join(data, 'opspilot.db'))
  remote.pragma('foreign_keys=ON')
  serverApi = new api.ControllerReadApi(
    remote,
    controller,
    data,
    new api.ControllerReadCursor(new api.AesGcmCredentialCipher(randomBytes(32)), controller),
    () => ({ service_state: 'ready', last_branch_poll_at: null, reason_code: null }),
    { commands: new api.ControllerCommands(remote, controller, () => true) }
  )
  await new Promise((resolveListen, rejectListen) => {
    http.once('error', rejectListen)
    http.listen(8768, '127.0.0.1', resolveListen)
  })
  await new Promise((resolveListen) => ssh.listen(0, '127.0.0.1', resolveListen))
  const db = api.initializeDatabase(local),
    cipher = new api.AesGcmCredentialCipher(masterKey),
    vault = new api.DesktopControllerVault(db, cipher),
    principal = {
      vpsId: 1,
      host: '127.0.0.1',
      port: ssh.address().port,
      hostFingerprint: hostPin,
      username: 'root',
      authType: 'password'
    }
  db.prepare(
    "INSERT INTO vps(id,name,host,port,host_fingerprint,username,auth_type,encrypted_secret) VALUES(1,'native-controller',?,?,?,?,?,X'0102')"
  ).run(
    principal.host,
    principal.port,
    principal.hostFingerprint,
    principal.username,
    principal.authType
  )
  manager = new api.SshManager(() => ({ ...principal, secret: password }))
  const enrollment = new api.DesktopControllerEnrollment(vault, {
      openProductBootstrapChannel: (vpsId, script, options) => {
        const line = script.text.split('\n').find((value) => value.startsWith('APPROVED_ASSETS = '))
        observedCatalogSize = JSON.parse(line.slice('APPROVED_ASSETS = '.length)).length
        return manager.openProductBootstrapChannel(vpsId, script, options)
      }
    }),
    intent = {
      binding_id: randomUUID(),
      controller_id: controller,
      vps_id: 1,
      ssh_security_revision: 1,
      principal,
      artifact_path: cli,
      data_directory: data,
      node_path: join(install, 'node'),
      manifest_sha256: pin,
      display_name: 'Native Desktop',
      requested_scopes: ['read', 'deploy:manual', 'policy:write']
    }
  vault.prepare(intent)
  const enrolled = await enrollment.enroll(intent.binding_id)
  assert.equal(enrolled.state, 'active')
  assert.equal(enrolled.remote_client_id, enrolled.client.client_id)
  assert.equal(remote.prepare('SELECT count(*) AS n FROM product_desktop_client').get().n, 1)
  cases.push('actual_pinned_ssh_verified_payload_and_admin_cli_enrollment')
  const token = vault.resolve(intent.binding_id).accessToken
  assert.equal(
    JSON.stringify(db.prepare('SELECT * FROM desktop_controller_binding').all()).includes(token),
    false
  )
  assert.equal(JSON.stringify(enrolled).includes(token), false)
  cases.push('encrypted_local_bearer_and_public_metadata_only')
  assert.deepEqual(await cold(intent.binding_id), { status: 'PASS', controller_id: controller })
  cases.push('new_node_process_cold_sqlite_decrypt_to_authenticated_http')
  assert.deepEqual(await enrollment.enroll(intent.binding_id), enrolled)
  assert.equal(remote.prepare('SELECT count(*) AS n FROM product_desktop_client').get().n, 1)
  cases.push('active_enrollment_replay_does_not_issue_another_client')
  const wrongPin = { ...intent, binding_id: randomUUID(), manifest_sha256: '0'.repeat(64) }
  vault.prepare(wrongPin)
  await assert.rejects(enrollment.enroll(wrongPin.binding_id), {
    code: 'CONTROLLER_BUNDLE_VERIFICATION_FAILED'
  })
  assert.equal(remote.prepare('SELECT count(*) AS n FROM product_desktop_client').get().n, 1)
  cases.push('wrong_manifest_pin_rejected_before_cli_credential_issue')
  const original = readFileSync(cli)
  try {
    writeFileSync(
      cli,
      Buffer.concat([original, Buffer.from('\nthrow new Error("UNVERIFIED_CODE_EXECUTED");\n')])
    )
    const changed = { ...intent, binding_id: randomUUID() }
    vault.prepare(changed)
    await assert.rejects(enrollment.enroll(changed.binding_id), {
      code: 'CONTROLLER_BUNDLE_VERIFICATION_FAILED'
    })
    assert.equal(remote.prepare('SELECT count(*) AS n FROM product_desktop_client').get().n, 1)
  } finally {
    writeFileSync(cli, original)
  }
  cases.push('modified_candidate_never_executes_to_verify_itself')
  const foreign = { ...intent, binding_id: randomUUID(), controller_id: 'foreign-controller' }
  vault.prepare(foreign)
  await assert.rejects(enrollment.enroll(foreign.binding_id), {
    code: 'CONTROLLER_IDENTITY_MISMATCH'
  })
  assert.equal(remote.prepare('SELECT count(*) AS n FROM product_desktop_client').get().n, 1)
  cases.push('actual_controller_identity_mismatch_prevents_enrollment')
  const lost = { ...intent, binding_id: randomUUID(), display_name: 'Lost delivery fixture' }
  vault.prepare(lost)
  discardReply = true
  await assert.rejects(enrollment.enroll(lost.binding_id), { code: 'CONTROLLER_ADMIN_FAILED' })
  assert.equal(vault.get(lost.binding_id).state, 'delivery_unknown')
  assert.equal(remote.prepare('SELECT count(*) AS n FROM product_desktop_client').get().n, 2)
  const replay = await enrollment.enroll(lost.binding_id)
  assert.equal(replay.state, 'delivery_unknown')
  assert.ok(replay.remote_client_id)
  assert.equal(replay.client, null)
  assert.equal(remote.prepare('SELECT count(*) AS n FROM product_desktop_client').get().n, 2)
  assert.throws(() => vault.resolve(lost.binding_id), { code: 'BINDING_UNAVAILABLE' })
  cases.push('lost_secret_delivery_replay_keeps_uuid_and_single_remote_grant')
  discardReply = true
  await assert.rejects(enrollment.revoke(lost.binding_id), { code: 'CONTROLLER_ADMIN_FAILED' })
  assert.ok(
    remote
      .prepare('SELECT revoked_at FROM product_desktop_client WHERE client_id=?')
      .get(replay.remote_client_id).revoked_at
  )
  const revokedLost = await enrollment.revoke(lost.binding_id)
  assert.equal(revokedLost.state, 'disabled')
  assert.equal(
    remote
      .prepare(
        "SELECT count(*) AS n FROM product_desktop_admin_request WHERE operation='revoke-desktop-client' AND client_id=?"
      )
      .get(replay.remote_client_id).n,
    1
  )
  cases.push('lost_revoke_response_retries_stable_admin_key_and_disables_local_binding')
  execFileSync(join(install, 'node'), [cli, 'revoke-desktop-client', '--data-dir', data], {
    input: JSON.stringify({ request_key: randomUUID(), client_id: enrolled.remote_client_id }),
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 10000
  })
  assert.deepEqual(await cold(intent.binding_id), { status: 'BLOCKED', code: 'CLIENT_REVOKED' })
  cases.push('remote_revoke_blocks_cold_desktop_http_immediately')
  db.exec('UPDATE vps SET ssh_security_revision=ssh_security_revision+1 WHERE id=1')
  assert.throws(() => vault.resolve(intent.binding_id), { code: 'BINDING_UNAVAILABLE' })
  cases.push('local_ssh_security_revision_change_blocks_old_binding')
  const uiService = new api.DesktopControllerService(db, cipher, manager)
  const uiInput = {
    binding_id: randomUUID(),
    controller_id: controller,
    vps_id: 1,
    artifact_path: cli,
    data_directory: data,
    node_path: join(install, 'node'),
    manifest_sha256: pin,
    display_name: 'UI read-only connection'
  }
  const uiBinding = await uiService.register(uiInput)
  assert.equal(uiBinding.state, 'active')
  assert.deepEqual(
    JSON.parse(
      remote
        .prepare('SELECT scopes_json FROM product_desktop_client WHERE client_id=?')
        .get(uiBinding.remote_client_id).scopes_json
    ),
    ['read']
  )
  const uiSnapshot = await uiService.apps({ binding_id: uiBinding.binding_id })
  assert.deepEqual(uiSnapshot.items, [])
  assert.equal(uiSnapshot.controller_id, controller)
  assert.equal(uiSnapshot.service_state, 'ready')
  assert.equal(JSON.stringify(uiSnapshot).includes(token), false)
  assert.equal((await uiService.revoke(uiBinding.binding_id)).state, 'disabled')
  cases.push('ui_service_actual_register_read_only_http_snapshot_and_revoke')
  assert.deepEqual(db.pragma('foreign_key_check'), [])
  assert.deepEqual(remote.pragma('foreign_key_check'), [])
  cases.push('native_migration024_and_foreign_key_integrity')
  result = {
    status: 'PASS',
    nonce,
    scope: 'DESKTOP_PINNED_SSH_CLI_ENROLLMENT_COLD_VAULT_HTTP',
    passed: cases.length,
    cases,
    manifest_sha256: pin,
    artifact_sha256: createHash('sha256').update(readFileSync(artifact)).digest('hex'),
    credential_fixture_key_in_stdin_only: true,
    electron_safe_storage_ui_exercised: false,
    runtime_dispatch_executed: false,
    production_vps_used: false
  }
} catch (error) {
  result = {
    status: 'FAIL',
    nonce,
    passed: cases.length,
    cases,
    code: /^[A-Z_]{1,80}$/.test(error.code) ? error.code : error.name,
    approved_catalog_size: observedCatalogSize,
    public_install_metadata: [
      install,
      join(install, 'payload'),
      cli,
      join(install, 'node'),
      data
    ].map((path) => {
      const s = lstatSync(path)
      return {
        role:
          path === install
            ? 'install'
            : path === cli
              ? 'artifact'
              : path === data
                ? 'data'
                : path.endsWith('/node')
                  ? 'node'
                  : 'payload',
        uid: s.uid,
        mode: (s.mode & 0o7777).toString(8),
        symlink: s.isSymbolicLink()
      }
    }),
    assertion_location:
      error.stack?.match(/desktop-controller-enrollment\.mjs:\d+:\d+/)?.[0] ?? null
  }
} finally {
  await manager?.disconnectAll()
  for (const connection of connections) connection.end()
  for (const child of children) {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      /* Already stopped. */
    }
  }
  await new Promise((resolveClose) => ssh.close(resolveClose))
  await serverApi?.close()
  http.closeAllConnections()
  await new Promise((resolveClose) => http.close(resolveClose))
  remote?.close()
  api.closeDatabase()
  assert.equal(resolve(install), install)
  assert.match(install, /^\/var\/tmp\/opspilot-desktop-enroll-[A-Za-z0-9]+$/)
  rmSync(install, { recursive: true })
  if (result) result.cleanup = true
}
writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result))
process.exitCode = result.status === 'PASS' ? 0 : 1
