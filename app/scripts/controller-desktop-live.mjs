/* eslint-disable @typescript-eslint/explicit-function-return-type -- Explicit development VPS gate. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { journalKey } from './controller-upgrade-live/journal-key.mjs'
import { snapshotCommand } from './controller-desktop-live/snapshot.mjs'
import { finalizeRevoked } from './controller-desktop-live/finalize.mjs'

const args = process.argv.slice(2)
const fresh = args.length === 1 && args[0] === '--confirm-development-desktop-preflight'
const resume = args.length === 2 && args[0] === '--resume' && /^[a-f0-9]{16}$/.test(args[1])
if (!fresh && !resume) {
  console.log('{"status":"REJECTED","error_code":"EXPLICIT_DEVELOPMENT_DESKTOP_GATE_REQUIRED"}')
  process.exit(2)
}
const project = resolve(import.meta.dirname, '..'),
  require = createRequire(join(project, 'package.json')),
  nonce = fresh ? randomBytes(8).toString('hex') : args[1],
  directory = join(project, '.out-scripts/controller-desktop-live', nonce),
  local = join(directory, 'private-profile')
let db, ssh, config
const evidence = { status: 'RUNNING', record: nonce, checks: [], production_profile_used: false }
const save = () =>
  writeFileSync(join(directory, 'preflight.json'), JSON.stringify(evidence, null, 2) + '\n')
try {
  if (fresh) {
    let input = ''
    for await (const chunk of process.stdin) {
      input += chunk
      if (Buffer.byteLength(input) > 32768) throw Error('INPUT_LIMIT')
    }
    config = JSON.parse(input)
    input = ''
    if (
      config.host !== '167.71.202.116' ||
      config.port !== 22 ||
      config.username !== 'root' ||
      config.host_fingerprint !== 'SHA256:0X8J5LfPr6iZqEspsD379FvFEWrLfYpN0wfNYjQ87+E' ||
      typeof config.password !== 'string' ||
      !config.password
    )
      throw Error('KNOWN_DEVELOPMENT_VPS_REQUIRED')
    mkdirSync(local, { recursive: true })
    writeFileSync(join(directory, '.owner'), nonce, { flag: 'wx', mode: 0o600 })
  } else {
    assert.equal(realpathSync(directory), resolve(directory))
    assert.equal(readFileSync(join(directory, '.owner'), 'utf8'), nonce)
    assert(existsSync(join(local, 'opspilot.db')))
  }
  const verifier = require(join(project, 'out/main/controllerResourceVerifier.js'))
  verifier.verifyPackagedControllerResources(join(project, 'resources/controller-releases'))
  if (fresh) {
    const esbuild = createRequire(require.resolve('vite/package.json'))('esbuild')
    await esbuild.build({
      entryPoints: [join(project, 'scripts/controller-desktop-live/entry.ts')],
      outfile: join(directory, 'entry.cjs'),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      packages: 'external',
      plugins: [
        {
          name: 'raw',
          setup(b) {
            b.onResolve({ filter: /\?raw$/ }, (a) => ({
              path: resolve(a.resolveDir, a.path.slice(0, -4)),
              namespace: 'raw'
            }))
            b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({
              contents: readFileSync(a.path, 'utf8'),
              loader: 'text'
            }))
          }
        }
      ]
    })
  }
  const code = require(join(directory, 'entry.cjs')),
    key = journalKey(local, fresh),
    cipher = new code.AesGcmCredentialCipher(key)
  key.fill(0)
  db = code.initializeDatabase(local)
  const repository = new code.VpsRepository(db)
  if (fresh) {
    repository.create({
      name: 'Live Desktop verification ' + nonce,
      host: config.host,
      port: 22,
      username: 'root',
      auth_type: 'password',
      host_fingerprint: config.host_fingerprint,
      credential: cipher.encrypt(config.password)
    })
    config.password = ''
  }
  const checkedVps = repository.getById(1)
  assert.equal(checkedVps.host, '167.71.202.116')
  assert.equal(checkedVps.port, 22)
  assert.equal(checkedVps.username, 'root')
  assert.equal(checkedVps.host_fingerprint, 'SHA256:0X8J5LfPr6iZqEspsD379FvFEWrLfYpN0wfNYjQ87+E')
  ssh = new code.SshManager((id) => {
    const v = repository.getById(id)
    return {
      host: v.host,
      port: v.port,
      username: v.username,
      authType: v.auth_type,
      hostFingerprint: v.host_fingerprint,
      secret: code.loadSecret(db, cipher, id)
    }
  })
  const response = await ssh.exec(1, snapshotCommand, {
    logCommand: false,
    retryOnReconnect: false,
    timeoutMs: 20000,
    maxStdoutBytes: 65536,
    maxStderrBytes: 1024
  })
  assert.equal(response.code, 0)
  const before = JSON.parse(response.stdout)
  assert.equal(before.receipt.request_key, '7573f0b1-4262-4305-8b7d-9a1edce49626')
  assert.equal(before.receipt.controller_id, 'dc586bb7-cd83-484c-b036-e5ad40ec106d')
  assert.equal(before.receipt.uid, 997)
  assert.equal(before.upgrade.request_key, '37a115d5-71c6-4b87-bacb-6375a64c0c65')
  assert.equal(before.upgrade.phase, 'active')
  assert.equal(before.schema, 29)
  assert.equal(before.active_experiments, 0)
  assert.equal(before.active_jobs, 0)
  assert(before.desired.every((v) => v.auto_paused === 1))
  assert(before.service.includes('ActiveState=active'))
  assert.equal(before.apps.find((v) => v.id === 1).current_deployment_id, 4)
  const health = await fetch('http://167.71.202.116:30000/health', {
    redirect: 'error',
    signal: AbortSignal.timeout(10000)
  })
  assert.equal(health.status, 200)
  if (fresh) assert.equal(before.active_clients, 0)
  evidence.before = before
  evidence.checks.push(
    'actual_pinned_ssh_current_controller_paused_policy_no_active_jobs_or_experiments_original_demo_http200'
  )
  evidence.status = 'READONLY_PREFLIGHT_PASS'
  save()
  let finalized = false
  const completedFile = join(directory, 'result.json')
  if (
    resume &&
    existsSync(completedFile) &&
    JSON.parse(readFileSync(completedFile, 'utf8')).temporary_client_revoked === true
  ) {
    await finalizeRevoked({ directory, nonce, db, cipher, code, ssh, current: before })
    finalized = true
  }
  await ssh.disconnectAll()
  db.close()
  if (resume) {
    const executable = require('electron')
    const environment = { ...process.env }
    delete environment.ELECTRON_RUN_AS_NODE
    for (const phase of finalized ? [] : ['--onboard', '--deploy']) {
      if (phase === '--onboard' && existsSync(join(directory, 'onboarding.json'))) {
        assert.equal(
          JSON.parse(readFileSync(join(directory, 'onboarding.json'), 'utf8')).status,
          'PASS'
        )
        continue
      }
      const child = spawn(
        executable,
        [join(project, 'scripts/controller-desktop-live/electron.mjs'), nonce, phase],
        { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true, env: environment }
      )
      const exit = await new Promise((done) => child.once('exit', done))
      assert.equal(exit, 0, 'LIVE_ELECTRON_GATE_FAILED')
    }
    const result = JSON.parse(readFileSync(join(directory, 'result.json'), 'utf8'))
    assert.equal(result.status, 'PASS')
    assert.equal(result.temporary_client_revoked, true)
    assert.equal(dirname(local), directory)
    assert.equal(realpathSync(local), resolve(local))
    rmSync(local, { recursive: true })
    result.private_db_removed = !existsSync(local)
    writeFileSync(join(directory, 'result.json'), JSON.stringify(result, null, 2) + '\n')
  }
  console.log(JSON.stringify({ status: resume ? 'PASS' : evidence.status, record: nonce }))
} catch (error) {
  evidence.status = 'FAIL'
  const value = error?.context?.cause?.message ?? error?.code ?? error?.message
  evidence.error_code =
    typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,80}$/.test(value)
      ? value
      : 'LIVE_DESKTOP_PREFLIGHT_FAILED'
  if (existsSync(directory)) save()
  console.log(JSON.stringify({ status: 'FAIL', record: nonce, error_code: evidence.error_code }))
  process.exitCode = 1
} finally {
  if (config) config.password = ''
  await ssh?.disconnectAll()
  if (db?.open) db.close()
}
