import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { spawn, spawnSync } from 'node:child_process'
import {
  chmodSync,
  closeSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  writeSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'

if (process.platform !== 'linux' || process.getuid() === 0)
  throw Error('LINUX_NONROOT_LAB_REQUIRED')
const modules = process.env.OPSPILOT_CONTROL_PLANE_MODULES
const release = process.env.OPSPILOT_CONTROLLER_RELEASE_OUTPUT
const pin = process.env.OPSPILOT_CONTROLLER_RELEASE_PIN
if (!modules || !release || !pin) throw Error('LAB_INPUT_REQUIRED')
const require = createRequire(import.meta.url)
const esbuild = require(resolve(modules, 'esbuild'))
const { Server } = require(resolve(modules, 'ssh2'))
const nonce = randomBytes(6).toString('hex')
const evidence = resolve(import.meta.dirname, '../../.out-scripts/controller-release', nonce)
mkdirSync(evidence, { recursive: true })
const tool = join(dirname(release), 'release-lab-' + nonce + '.cjs')
await esbuild.build({
  entryPoints: [resolve(import.meta.dirname, 'entry.ts')],
  outfile: tool,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  packages: 'external',
  plugins: [
    {
      name: 'raw-python',
      setup(build) {
        build.onResolve({ filter: /\.py\?raw$/ }, (args) => ({
          path: resolve(args.resolveDir, args.path.slice(0, -4)),
          namespace: 'raw-python'
        }))
        build.onLoad({ filter: /.*/, namespace: 'raw-python' }, (args) => ({
          contents: readFileSync(args.path, 'utf8'),
          loader: 'text'
        }))
      }
    }
  ]
})
const {
  verifyControllerRelease,
  probeControllerHost,
  SshManager,
  buildControllerRelease
} = require(tool)
let checks = 0
const results = []
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- Hàm harness JavaScript, không có cú pháp type annotation.
const check = (name, action) => {
  action()
  checks++
  results.push({ name, state: 'PASS' })
}
const manifest = verifyControllerRelease(release, pin)
check('builder_refuses_existing_destination_without_overwrite', () => {
  assert.throws(
    () =>
      buildControllerRelease({
        modules,
        artifact: join(release, 'payload/control-plane.cjs'),
        payloadPin: manifest.payload_sha256,
        output: release
      }),
    /RELEASE_DESTINATION_EXISTS/
  )
})
const badModules = join(dirname(release), 'bad-modules-' + nonce, 'node_modules')
const first = manifest.packages[0]
mkdirSync(join(dirname(badModules), first.path), { recursive: true, mode: 0o700 })
writeFileSync(
  join(dirname(badModules), first.path, 'package.json'),
  JSON.stringify({ name: first.name, version: '0.0.0' }),
  { mode: 0o600 }
)
check('builder_rejects_dependency_version_drift_before_loading_module', () => {
  assert.throws(
    () =>
      buildControllerRelease({
        modules: badModules,
        artifact: join(release, 'payload/control-plane.cjs'),
        payloadPin: manifest.payload_sha256,
        output: join(dirname(release), 'must-not-build-' + nonce)
      }),
    /RUNTIME_LOCK_MISMATCH/
  )
})
check('release_pin_exact_files_linux_x64_nonroot', () => {
  assert.equal(manifest.node_version, process.versions.node)
  assert(!manifest.packages.some((p) => p.name === 'esbuild'))
  assert(!manifest.files.some((p) => /(?:win32|darwin|linuxmusl|linux-arm64)\.node$/.test(p.path)))
  assert.notEqual(process.getuid(), 0)
})
const node = join(release, 'node')
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- Hàm harness JavaScript, trả SpawnSyncReturns.
const cold = (args) =>
  spawnSync(node, args, {
    cwd: '/',
    env: { PATH: '/usr/bin:/bin', HOME: dirname(release) },
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 65536
  })
check('cold_native_sqlite_and_runtime_dependencies_no_global_modules', () => {
  const code = `const r=require(${JSON.stringify(join(release, 'node_modules') + '/better-sqlite3')});const d=new r(':memory:');d.exec('create table t(n integer);insert into t values(7)');if(d.prepare('select n from t').get().n!==7)throw Error();d.close();for(const n of ['ssh2','tar','zod'])require(${JSON.stringify(join(release, 'node_modules') + '/')}+n);console.log('COLD_NATIVE_OK')`
  const run = cold(['-e', code])
  assert.equal(run.status, 0, 'cold native process must exit0')
  assert.equal(run.stdout.trim(), 'COLD_NATIVE_OK')
})
const data = join(dirname(release), 'cold-data-' + nonce)
const cli = join(release, 'payload/control-plane.cjs')
check('cold_cli_init_private_fixture', () => {
  const run = cold([cli, 'init', '--data-dir', data])
  assert.equal(run.status, 0, 'init must exit0')
  assert.equal(JSON.parse(run.stdout).state, 'initialized')
})
check('cold_cli_status_schema028_no_vps_no_jobs', () => {
  const run = cold([cli, 'status', '--data-dir', data])
  assert.equal(run.status, 0, 'status must exit0')
  const status = JSON.parse(run.stdout)
  assert(status.controller_id)
  const code = `const D=require(${JSON.stringify(join(release, 'node_modules/better-sqlite3'))});const d=new D(${JSON.stringify(join(data, 'opspilot.db'))},{readonly:true,fileMustExist:true});console.log(JSON.stringify({tables:d.prepare("select count(*) n from sqlite_master where type='table'").get().n,versions:d.prepare('select * from schema_version').all(),counts:Object.fromEntries(['vps','app','deployment','product_deploy_job'].map(t=>[t,d.prepare('select count(*) n from '+t).get().n]))}));d.close()`
  // CLI status/independent schema snapshot cùng cold runtime; path DB lấy bằng listing fixture.
  const files = readdirSync(data)
  const dbName = files.find((v) => v.endsWith('.db'))
  assert(dbName)
  const dbCode = code.replace(
    JSON.stringify(join(data, 'opspilot.db')),
    JSON.stringify(join(data, dbName))
  )
  const inspect = cold(['-e', dbCode])
  assert.equal(inspect.status, 0)
  const schema = JSON.parse(inspect.stdout)
  // sqlite_sequence là bảng nội bộ SQLite, không phải bảng ứng dụng.
  assert.equal(schema.tables, 41)
  assert.equal(Math.max(...schema.versions.map((v) => v.version)), 28)
  assert.equal(schema.versions.length, 28)
  assert.deepEqual(schema.counts, { vps: 0, app: 0, deployment: 0, product_deploy_job: 0 })
})
check('cold_cli_refuses_reinit_without_overwrite', () =>
  assert.notEqual(cold([cli, 'init', '--data-dir', data]).status, 0)
)
check('wrong_independent_pin_fails_passively', () =>
  assert.throws(() => verifyControllerRelease(release, '0'.repeat(64)))
)
for (const [name, bytes] of [
  ['windows_native', Buffer.from('MZ')],
  ['arm_native', Buffer.from('7f454c460201010000000000000000000300b700', 'hex')]
]) {
  const fd = openSync(node, 'r+')
  const before = Buffer.alloc(bytes.length)
  readSync(fd, before, 0, before.length, 0)
  try {
    writeSync(fd, bytes, 0, bytes.length, 0)
    check(name + '_rejected_before_execution', () =>
      assert.throws(() => verifyControllerRelease(release, pin))
    )
  } finally {
    writeSync(fd, before, 0, before.length, 0)
    closeSync(fd)
  }
}
const extra = join(release, 'unexpected')
try {
  symlinkSync(node, extra)
  check('symlink_rejected', () => assert.throws(() => verifyControllerRelease(release, pin)))
} finally {
  unlinkSync(extra)
}
try {
  linkSync(node, extra)
  check('hardlink_rejected', () => assert.throws(() => verifyControllerRelease(release, pin)))
} finally {
  unlinkSync(extra)
}
check('restored_release_verified', () => verifyControllerRelease(release, pin))
try {
  chmodSync(node, 0o777)
  check('group_world_writable_node_rejected', () =>
    assert.throws(() => verifyControllerRelease(release, pin))
  )
} finally {
  chmodSync(node, 0o700)
}
check('restored_release_permissions_verified', () => verifyControllerRelease(release, pin))

// Localhost fixture server; ephemeral keys chỉ trong memory, không ghi/log/commit.
const hostKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
  format: 'pem',
  type: 'pkcs1'
})
const clientKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
  format: 'pem',
  type: 'pkcs1'
})
const { utils } = require(resolve(modules, 'ssh2'))
const publicHost = utils.parseKey(hostKey).getPublicSSH()
const hostFingerprint =
  'SHA256:' + createHash('sha256').update(publicHost).digest('base64').replace(/=+$/, '')
let authentications = 0
let executions = 0
const clients = new Set()
const children = new Set()
const server = new Server({ hostKeys: [hostKey] }, (client) => {
  clients.add(client)
  client.on('error', () => {})
  client.on('close', () => clients.delete(client))
  client.on('authentication', (ctx) => {
    authentications++
    if (ctx.username === 'fixture' && ctx.method === 'publickey') ctx.accept()
    else ctx.reject()
  })
  client.on('session', (accept) => {
    const session = accept()
    session.on('exec', (acceptExec, reject, info) => {
      if (!info.command.startsWith("python3 -B -u -c '")) return reject()
      executions++
      const stream = acceptExec()
      const child = spawn('/bin/sh', ['-c', info.command], { stdio: ['pipe', 'pipe', 'pipe'] })
      children.add(child)
      child.stdout.pipe(stream, { end: false })
      child.stderr.pipe(stream.stderr, { end: false })
      stream.pipe(child.stdin)
      child.on('close', (code) => {
        children.delete(child)
        stream.exit(code ?? 1)
        stream.end()
      })
      stream.on('close', () => {
        if (child.exitCode === null) child.kill()
      })
    })
  })
})
await new Promise((ok, fail) => {
  server.once('error', fail)
  server.listen(0, '127.0.0.1', ok)
})
const endpoint = {
  vpsId: 1,
  host: '127.0.0.1',
  port: server.address().port,
  hostFingerprint,
  username: 'fixture',
  authType: 'key'
}
const manager = new SshManager(() => ({ ...endpoint, secret: clientKey.toString() }))
let hostPreflight
try {
  const snapshot = await probeControllerHost({
    ssh: manager,
    vpsId: 1,
    expectedIdentity: endpoint,
    release: manifest
  })
  hostPreflight = {
    state: snapshot.state,
    service_mode: snapshot.service_mode,
    reasons: snapshot.reasons
  }
  check('real_pinned_ssh_readonly_probe', () => {
    assert.equal(snapshot.facts.uid, process.getuid())
    assert.equal(snapshot.facts.system, 'Linux')
    assert.equal(snapshot.facts.architecture, 'x86_64')
    assert(snapshot.facts.free_disk_bytes > 0)
    assert(snapshot.facts.available_memory_bytes > 0)
    assert.equal(executions, 1)
  })
  const beforeAuth = authentications
  const beforeExec = executions
  await assert.rejects(() =>
    probeControllerHost({
      ssh: manager,
      vpsId: 1,
      expectedIdentity: { ...endpoint, hostFingerprint: 'SHA256:' + 'A'.repeat(43) },
      release: manifest
    })
  )
  check('wrong_expected_pin_no_auth_or_exec', () => {
    assert.equal(authentications, beforeAuth)
    assert.equal(executions, beforeExec)
  })
} finally {
  await manager.disconnectAll()
  for (const child of children) child.kill()
  for (const client of clients) client.end()
  await new Promise((ok) => server.close(ok))
}
const receipt = {
  state: 'PASS',
  checks,
  uid: process.getuid(),
  node: process.version,
  release_pin: pin,
  release_files: manifest.files.length,
  release_bytes: manifest.files.reduce((n, f) => n + f.size, 0),
  host_preflight: hostPreflight,
  results,
  production_vps_used: false,
  production_database_used: false
}
writeFileSync(join(evidence, 'result.json'), JSON.stringify(receipt, null, 2) + '\n')
console.log(JSON.stringify({ state: 'PASS', checks, evidence }))
