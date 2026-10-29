/* eslint-disable @typescript-eslint/explicit-function-return-type -- Công cụ QA JavaScript. */
import { execFileSync } from 'node:child_process'
import { randomBytes, createHash } from 'node:crypto'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

const app = resolve(import.meta.dirname, '../..')
const nonce = randomBytes(6).toString('hex')
const name = `opspilot-h2-controlled-${nonce}`
const label = `opspilot.review.run=${nonce}`
const command = (args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 128 * 1024,
    windowsHide: true
  }).trim()
const subject = join(app, 'src/main/controlPlane')
const sourceHash = () =>
  createHash('sha256')
    .update(readFileSync(join(subject, 'target_product_runtime.py')))
    .digest('hex')
const source = sourceHash()
let result
let cleanup = false
try {
  // Cached image; không tự pull/install, network hoặc Docker socket trong container test.
  command(['image', 'inspect', 'python:3.12-slim', '--format', '{{.Id}}'])
  result = JSON.parse(
    command([
      'run',
      '--rm',
      '--name',
      name,
      '--label',
      label,
      '--network',
      'none',
      '--read-only',
      '--tmpfs',
      '/tmp:rw,nosuid,nodev,size=64m',
      '--tmpfs',
      '/opt/opspilot:rw,nosuid,nodev,size=16m',
      '--mount',
      `type=bind,source=${subject},target=/subject,readonly`,
      '--mount',
      `type=bind,source=${join(import.meta.dirname, 'test_runtime.py')},target=/review.py,readonly`,
      '--mount',
      `type=bind,source=${join(import.meta.dirname, 'fixtures.json')},target=/fixtures.json,readonly`,
      'python:3.12-slim',
      'python',
      '-B',
      '/review.py'
    ])
  )
} catch (error) {
  try {
    result = JSON.parse(String(error.stdout))
    if (result.scope !== 'LINUX_REAL_TARGET_CONTROLLED_DOCKER') throw new Error('BAD_REPORT')
  } catch {
    result = { status: 'FAIL', code: 'H2_CONTROLLED_SUITE_FAILED' }
  }
} finally {
  try {
    const id = command(['ps', '-aq', '--no-trunc', '--filter', `name=^/${name}$`])
    let ownerMatches = true
    if (id) {
      const container = JSON.parse(command(['container', 'inspect', id]))[0]
      ownerMatches = container.Config.Labels['opspilot.review.run'] === nonce
      if (ownerMatches) command(['rm', '-f', id])
    }
    cleanup =
      ownerMatches && command(['ps', '-aq', '--no-trunc', '--filter', `label=${label}`]) === ''
  } catch {
    cleanup = false
  }
}
result = {
  ...result,
  nonce,
  cleanup,
  source_sha256: source,
  source_unchanged: sourceHash() === source
}
const output = join(app, '.out-scripts', 'h2-runtime-review', nonce)
mkdirSync(output, { recursive: true })
writeFileSync(join(output, 'result.json'), `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify(result))
process.exitCode =
  result.passed === result.total && result.total > 0 && cleanup && result.source_unchanged ? 0 : 1
