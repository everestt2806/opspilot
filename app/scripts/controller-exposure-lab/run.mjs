/* eslint-disable @typescript-eslint/explicit-function-return-type -- Standalone private Linux HTTP/SQLite lab. */
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { once } from 'node:events'
import { createRequire, Module } from 'node:module'
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join, resolve } from 'node:path'

if (process.platform !== 'linux' || !process.version.startsWith('v22.'))
  throw Error('LINUX_NODE22_REQUIRED')
const modules = process.env.OPSPILOT_CONTROL_PLANE_MODULES
if (!modules) throw Error('APPROVED_LINUX_MODULES_REQUIRED')
process.env.NODE_PATH = modules
Module._initPaths()
const require = createRequire(import.meta.url),
  esbuild = require(join(modules, 'esbuild'))
const root = mkdtempSync('/var/tmp/opspilot-exposure-lab-'),
  marker = randomBytes(16).toString('hex')
writeFileSync(join(root, '.lab-owner'), marker, { mode: 0o600, flag: 'wx' })
const evidence = resolve(import.meta.dirname, '../../.out-scripts/controller-exposure', marker)
mkdirSync(evidence, { recursive: true })
const bundle = join(root, 'entry.cjs'),
  checks = []
await esbuild.build({
  entryPoints: [resolve(import.meta.dirname, 'entry.ts')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  packages: 'external',
  plugins: [
    {
      name: 'raw',
      setup(build) {
        build.onResolve({ filter: /\?raw$/ }, (args) => ({
          path: resolve(args.resolveDir, args.path.slice(0, -4)),
          namespace: 'raw'
        }))
        build.onLoad({ filter: /.*/, namespace: 'raw' }, (args) => ({
          contents: readFileSync(args.path, 'utf8'),
          loader: 'text'
        }))
      }
    }
  ]
})
const code = require(bundle),
  desktopMode = process.argv.includes('--desktop-public-probe'),
  profileKey = randomBytes(32)
let db = code.initializeDatabase(join(root, 'db'))
const seeded = code.seedExposureFixture(db, Date.now(), desktopMode ? '167.71.202.116' : undefined)
seeded.settle()
const auth = new code.ControllerClientAuth(db, seeded.controllerId, `unix:${process.getuid()}`)
const grant = auth.enroll({
  request_key: randomUUID(),
  display_name: 'Private exposure lab',
  requested_scopes: ['read', 'policy:write']
})
assert.equal(grant.state, 'issued_once')
let vault, bindingId
if (desktopMode) {
  bindingId = randomUUID()
  vault = new code.DesktopControllerVault(db, new code.AesGcmCredentialCipher(profileKey))
  vault.prepare({
    binding_id: bindingId,
    controller_id: seeded.controllerId,
    vps_id: 1,
    ssh_security_revision: 1,
    principal: {
      vpsId: 1,
      host: '167.71.202.116',
      port: 22,
      hostFingerprint: 'SHA256:' + 'A'.repeat(43),
      username: 'ops',
      authType: 'key'
    },
    artifact_path: '/opt/opspilot/payload/control-plane.cjs',
    data_directory: '/var/lib/opspilot',
    node_path: '/opt/opspilot/node',
    manifest_sha256: 'a'.repeat(64),
    display_name: 'Private exposure lab',
    requested_scopes: ['read', 'policy:write']
  })
  vault.activate(bindingId, 1, grant)
  code.closeDatabase()
  db = code.initializeDatabase(join(root, 'db'))
  vault = new code.DesktopControllerVault(db, new code.AesGcmCredentialCipher(profileKey))
  assert.equal(vault.resolve(bindingId).accessToken, grant.credential.access_token)
  checks.push('cold_native_profile_encrypted_vault_resolves_same_binding')
}
const header = { authorization: `Bearer ${grant.credential.access_token}` }
const api = new code.ControllerReadApi(
  db,
  seeded.controllerId,
  root,
  new code.ControllerReadCursor(
    new code.AesGcmCredentialCipher(randomBytes(32)),
    seeded.controllerId
  ),
  () => ({ service_state: 'ready', last_branch_poll_at: null, reason_code: null }),
  { commands: new code.ControllerCommands(db, seeded.controllerId, () => true) }
)
let drop = false,
  result = {
    status: 'FAIL',
    scope: desktopMode
      ? 'NATIVE_LINUX_MAIN_PUBLIC_PROBE_HTTP_SQLITE_SYNTHETIC_RUNTIME'
      : 'NATIVE_LINUX_AUTHENTICATED_HTTP_SQLITE_SYNTHETIC_RUNTIME',
    checks,
    actual_network_probe_performed: false,
    root_removed: false
  }
const server = createServer((req, res) => {
  if (drop && req.method === 'POST') {
    drop = false
    res.end = () => {
      req.socket.destroy()
      return res
    }
  }
  if (!api.handle(req, res)) {
    res.writeHead(404)
    res.end()
  }
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const address = server.address()
assert.ok(address && typeof address !== 'string')
const url = `http://127.0.0.1:${address.port}/v1/controllers/${seeded.controllerId}/apps/1/exposure`
const read = async () => {
  const response = await fetch(url, { headers: header })
  assert.equal(response.status, 200)
  return response.json()
}
const post = (body, key) =>
  fetch(url, {
    method: 'POST',
    headers: { ...header, 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify(body)
  })
try {
  const initial = await read()
  assert.equal(initial.status, 'not_checked')
  assert.equal(
    initial.context.url,
    desktopMode ? 'http://167.71.202.116:30000' : 'http://203.0.113.10:30000'
  )
  checks.push('native_h2_settlement_and_authorized_context')
  const { deployment_id, authority_sha256, previous_observation_id } = initial.context
  const body = {
    deployment_id,
    authority_sha256,
    previous_observation_id,
    observer: 'desktop_external',
    started_at: new Date().toISOString(),
    checked_at: new Date().toISOString(),
    outcome: 'reachable',
    http_status: 200,
    reason: 'none'
  }
  const key = randomUUID(),
    terminal = db.prepare('SELECT * FROM product_runtime_terminal').all()
  drop = true
  await assert.rejects(post(body, key))
  const stored = await read()
  assert.equal(stored.observation.observation_id, key)
  assert.equal(stored.status, 'reachable')
  checks.push('lost_http_reply_lookup_current_observation_without_retry_write')
  assert.equal((await post(body, key)).status, 200)
  assert.equal((await post(body, randomUUID())).status, 409)
  checks.push('same_key_idempotence_and_previous_observation_cas')
  db.exec('UPDATE vps SET ssh_security_revision=2')
  assert.equal((await post(body, key)).status, 409)
  assert.equal((await read()).status, 'not_checked')
  checks.push('current_target_change_fences_read_and_write')
  assert.deepEqual(db.prepare('SELECT * FROM product_runtime_terminal').all(), terminal)
  assert.equal(db.prepare('SELECT status FROM deployment').get().status, 'running')
  assert.equal(db.prepare('SELECT count(*) n FROM product_deploy_job').get().n, 1)
  checks.push('no_h2_runtime_policy_or_deployment_mutation')
  if (desktopMode) {
    db.exec('UPDATE vps SET ssh_security_revision=1')
    const principal = vault.resolve(bindingId).principal
    const service = new code.DesktopExposure(vault, {
      async openControllerApiChannel() {
        // Authenticated HTTP is real; this adapter substitutes the SSH transport only.
        const channel = connect({ host: '127.0.0.1', port: address.port })
        await once(channel, 'connect')
        return { channel, identity: principal }
      }
    })
    drop = true
    const observed = await service.run({ binding_id: bindingId, app_id: 1 }, true)
    assert.equal(observed.state, 'recorded')
    assert.equal(observed.view.status, 'reachable')
    assert.equal(observed.view.observation.http_status, 200)
    assert.equal(observed.view.observation.url, 'http://167.71.202.116:30000')
    result.actual_network_probe_performed = true
    checks.push('independent_public_http_probe_real_main_persist_and_lost_reply_read_current')
    const stored = await service.run({ binding_id: bindingId, app_id: 1 }, false)
    assert.equal(stored.view.observation.observation_id, observed.view.observation.observation_id)
    assert.deepEqual(db.prepare('SELECT * FROM product_runtime_terminal').all(), terminal)
    checks.push('public_result_readback_without_h2_runtime_mutation')
  }
  result.status = 'PASS'
} catch (error) {
  result.error = 'EXPOSURE_LAB_CHECK_FAILED'
  result.failure_location =
    /run\.mjs:\d+:\d+/.exec(error instanceof Error ? (error.stack ?? '') : '')?.[0] ?? 'unknown'
  process.exitCode = 1
} finally {
  await api.close()
  server.closeAllConnections()
  await new Promise((done, fail) => server.close((error) => (error ? fail(error) : done())))
  code.closeDatabase()
  assert.ok(root.startsWith('/var/tmp/opspilot-exposure-lab-'))
  assert.equal(realpathSync(root), root)
  assert.equal(lstatSync(root).isSymbolicLink(), false)
  assert.equal(readFileSync(join(root, '.lab-owner'), 'utf8'), marker)
  rmSync(root, { recursive: true })
  result.root_removed = true
  writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ ...result, evidence }))
}
