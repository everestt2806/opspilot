import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
if (process.platform !== 'linux') throw new Error('LINUX_REQUIRED')
const nonce = randomBytes(6).toString('hex')
const directory = resolve(import.meta.dirname, '../../.out-scripts/public-git-systemd', nonce)
mkdirSync(directory, { recursive: true })
const output = join(directory, 'service.json')
console.log(JSON.stringify({ status: 'RUNNING', nonce, progress: output }))
const child = spawn(
  process.execPath,
  [
    '--import',
    join(import.meta.dirname, 'public-git-systemd-preload.mjs'),
    join(import.meta.dirname, 'run.mjs')
  ],
  {
    env: {
      ...process.env,
      OPSPILOT_PUBLIC_SERVICE_RESULT: output,
      OPSPILOT_TARGET_ENROLL_RUNTIME_RESULT: join(directory, 'enrollment.json')
    },
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
const code = await new Promise((resolveChild) => {
  child.once('error', () => resolveChild(null))
  child.once('close', resolveChild)
})
let result
try {
  assert.equal(code, 1)
  assert.equal(overflow, false)
  const runtime = text
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line))
    .find((value) => value.scope === 'PINNED_SSH_SQLITE_DOCKER_RUNTIME')
  assert.equal(runtime.failure?.code, 'PUBLIC_SYSTEMD_LAB_FINISHED')
  assert.equal(runtime.cleanup, true)
  assert.equal(runtime.subject_unchanged, true)
  const service = JSON.parse(readFileSync(output, 'utf8'))
  assert.equal(service.status, 'PASS')
  assert.equal(service.cleanup, true)
  assert.equal(service.actual_github_push_observed, true)
  result = {
    ...service,
    nonce,
    scope: 'PUBLIC_GITHUB_SYSTEMD_EXECUTION',
    runtime_nonce: runtime.nonce,
    artifact_sha256: runtime.bundle_sha256
  }
} catch {
  result = { status: 'FAIL', nonce, code: 'PUBLIC_SYSTEMD_LAB_FAILED' }
}
writeFileSync(join(directory, 'result.json'), JSON.stringify(result, null, 2) + '\n')
console.log(JSON.stringify(result))
process.exitCode = result.status === 'PASS' ? 0 : 1
