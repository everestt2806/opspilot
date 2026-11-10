/* eslint-disable @typescript-eslint/explicit-function-return-type -- Standalone private Linux HTTP/SQLite lab. */
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
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
  db = code.initializeDatabase(join(root, 'db'))
const seeded = code.seedExposureFixture(db, Date.now())
seeded.settle()
const auth = new code.ControllerClientAuth(db, seeded.controllerId, `unix:${process.getuid()}`)
const grant = auth.enroll({
  request_key: randomUUID(),
  display_name: 'Private exposure lab',
  requested_scopes: ['read', 'policy:write']
})
assert.equal(grant.state, 'issued_once')
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
    scope: 'NATIVE_LINUX_AUTHENTICATED_HTTP_SQLITE_SYNTHETIC_RUNTIME',
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
  assert.equal(initial.context.url, 'http://203.0.113.10:30000')
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
  result.status = 'PASS'
} catch {
  result.error = 'EXPOSURE_LAB_CHECK_FAILED'
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
