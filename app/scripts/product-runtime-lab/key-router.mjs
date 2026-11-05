import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

if (process.platform !== 'linux') throw new Error('LINUX_REQUIRED')
const nonce = randomBytes(6).toString('hex')
const boundSsh = process.env.OPSPILOT_KEY_ROUTER_BOUND_SSH === '1'
const directory = resolve(
  import.meta.dirname,
  boundSsh
    ? '../../.out-scripts/product-runtime-bound-ssh'
    : '../../.out-scripts/product-runtime-key-router',
  nonce
)
mkdirSync(directory, { recursive: true })
const output = join(directory, 'router.json')
const childResult = await new Promise((resolveChild) => {
  const child = spawn(
    process.execPath,
    [
      '--import',
      join(import.meta.dirname, 'key-router-preload.mjs'),
      join(import.meta.dirname, 'run.mjs')
    ],
    {
      env: { ...process.env, OPSPILOT_KEY_ROUTER_RESULT: output },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  let text = ''
  let overflow = false
  child.stdout.on('data', (data) => {
    if (text.length + data.length < 512 * 1024) text += data
    else overflow = true
  })
  child.stderr.on('data', () => {
    /* Never retain arbitrary SSH/build output. */
  })
  child.once('error', () => resolveChild({ code: null, text: '', overflow: true }))
  child.once('close', (code) => resolveChild({ code, text, overflow }))
})
let result
try {
  assert.equal(childResult.code, 0)
  assert.equal(childResult.overflow, false)
  const runtime = childResult.text
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line))
    .find((value) => value.scope === 'PINNED_SSH_SQLITE_DOCKER_RUNTIME')
  assert.equal(runtime.status, 'PASS')
  assert.equal(runtime.cleanup, true)
  assert.equal(runtime.subject_unchanged, true)
  const router = JSON.parse(readFileSync(output, 'utf8'))
  assert.equal(router.enrolled_scopes, 2)
  assert.equal(router.cold_pending_t1_verified, true)
  assert.equal(router.historical_generation_retained, true)
  assert.equal(router.results.length, 7)
  assert.equal(router.bound_ssh_connections, boundSsh ? 7 : 0)
  assert.equal(
    router.results.filter(
      (item) =>
        item.exact_key_verified && item.generation_mismatch_rejected && item.cold_record_verified
    ).length,
    6
  )
  assert.equal(router.results.at(-1).state, 'dispatch_marker_committed')
  result = {
    status: 'PASS',
    scope: boundSsh ? 'REAL_CONTROLLER_BOUND_SSH_RUNTIME' : 'REAL_PER_APP_KEY_ROUTER',
    nonce,
    cases: 7,
    distinct_app_keys: 2,
    bound_ssh_connections: router.bound_ssh_connections,
    verified_terminals: 6,
    unknown_without_retry: 1,
    cold_pending_t1_verified: true,
    historical_generation_retained: true,
    cleanup: true,
    runtime_nonce: runtime.nonce,
    subject_sha256: runtime.subject_sha256,
    bundle_sha256: runtime.bundle_sha256
  }
} catch {
  result = { status: 'FAIL', nonce, code: 'PER_APP_KEY_ROUTER_INTEGRATION_FAILED' }
}
writeFileSync(join(directory, 'result.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result))
process.exitCode = result.status === 'PASS' ? 0 : 1
