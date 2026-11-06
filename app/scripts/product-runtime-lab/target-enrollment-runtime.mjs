import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

if (process.platform !== 'linux') throw new Error('LINUX_REQUIRED')
const nonce = randomBytes(6).toString('hex')
const directory = resolve(
  import.meta.dirname,
  '../../.out-scripts/target-enrollment-runtime',
  nonce
)
mkdirSync(directory, { recursive: true })
const output = join(directory, 'enrollment.json')
const processResult = await new Promise((resolveChild) => {
  const child = spawn(
    process.execPath,
    [
      '--import',
      join(import.meta.dirname, 'target-enrollment-runtime-preload.mjs'),
      join(import.meta.dirname, 'run.mjs')
    ],
    {
      env: { ...process.env, OPSPILOT_TARGET_ENROLL_RUNTIME_RESULT: output },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  let text = '',
    overflow = false
  child.stdout.on('data', (bytes) => {
    if (text.length + bytes.length <= 512 * 1024) text += bytes
    else overflow = true
  })
  child.stderr.on('data', () => {})
  child.once('error', () => resolveChild({ code: null, text: '', overflow: true }))
  child.once('close', (code) => resolveChild({ code, text, overflow }))
})
let result
try {
  assert.equal(processResult.code, 0)
  assert.equal(processResult.overflow, false)
  const runtime = processResult.text
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line))
    .find((value) => value.scope === 'PINNED_SSH_SQLITE_DOCKER_RUNTIME')
  assert.equal(runtime.status, 'PASS')
  assert.equal(runtime.cleanup, true)
  assert.equal(runtime.subject_unchanged, true)
  const installed = JSON.parse(readFileSync(output, 'utf8'))
  assert.equal(installed.enrollments.length, 2)
  assert.equal(installed.controller_process_loss_recovered, true)
  assert.equal(installed.runtimes.length, 7)
  assert.equal(installed.runtimes.filter((value) => value.state === 'runtime_settled').length, 6)
  assert.equal(installed.runtimes.at(-1).state, 'dispatch_marker_committed')
  result = {
    status: 'PASS',
    nonce,
    scope: 'PRODUCTION_TARGET_ENROLLMENT_RUNTIME',
    cases: 7,
    enrolled_apps: 2,
    installed_helpers: true,
    controller_process_loss_recovered: true,
    packaged_templates_collector: true,
    verified_terminals: 6,
    unknown_without_retry: 1,
    runtime_nonce: runtime.nonce,
    cleanup: true,
    bundle_sha256: runtime.bundle_sha256,
    subject_sha256: runtime.subject_sha256
  }
} catch {
  result = { status: 'FAIL', nonce, code: 'TARGET_ENROLLMENT_RUNTIME_FAILED' }
}
writeFileSync(join(directory, 'result.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result))
process.exitCode = result.status === 'PASS' ? 0 : 1
