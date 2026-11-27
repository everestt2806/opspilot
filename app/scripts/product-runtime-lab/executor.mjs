import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

if (process.platform !== 'linux') throw new Error('LINUX_REQUIRED')
const nonce = randomBytes(6).toString('hex')
const directory = resolve(import.meta.dirname, '../../.out-scripts/product-runtime-executor', nonce)
mkdirSync(directory, { recursive: true })
const output = join(directory, 'adapter.json')
const result = await new Promise((resolveChild) => {
  const child = spawn(
    process.execPath,
    [
      '--import',
      join(import.meta.dirname, 'executor-preload.mjs'),
      join(import.meta.dirname, 'run.mjs')
    ],
    {
      env: { ...process.env, OPSPILOT_R3_RESULT: output },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  let stdout = ''
  let overflow = false
  child.stdout.on('data', (data) => {
    if (stdout.length + data.length < 512 * 1024) stdout += data
    else overflow = true
  })
  child.stderr.on('data', () => {
    /* No arbitrary build/SSH output in reports. */
  })
  child.once('error', () => resolveChild({ code: null, stdout: '', overflow: true }))
  child.once('exit', (code) => resolveChild({ code, stdout, overflow }))
})
let report
try {
  assert.equal(result.code, 0)
  assert.equal(result.overflow, false)
  const runtime = result.stdout
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line))
    .find((value) => value.scope === 'PINNED_SSH_SQLITE_DOCKER_RUNTIME')
  assert.equal(runtime.status, 'PASS')
  assert.equal(runtime.cleanup, true)
  const adapter = JSON.parse(readFileSync(output, 'utf8'))
  assert.equal(adapter.results.length, 7)
  assert.equal(
    adapter.results.filter(
      (value) => value.persisted_proof_verified && value.forged_reference_rejected
    ).length,
    6
  )
  assert.equal(adapter.results.at(-1).state, 'dispatch_marker_committed')
  report = {
    status: 'PASS',
    nonce,
    cases: 7,
    verified_terminal_results: 6,
    unknown_without_retry: 1,
    scope: 'REAL_RUNTIME_EXECUTOR_ADAPTER',
    cleanup: true,
    runtime_nonce: runtime.nonce,
    subject_sha256: runtime.subject_sha256,
    bundle_sha256: runtime.bundle_sha256
  }
} catch {
  report = { status: 'FAIL', nonce, code: 'R3_EXECUTOR_INTEGRATION_FAILED' }
}
writeFileSync(join(directory, 'result.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report))
process.exitCode = report.status === 'PASS' ? 0 : 1
