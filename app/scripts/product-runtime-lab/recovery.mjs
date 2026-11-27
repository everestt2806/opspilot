import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

if (process.platform !== 'linux') throw new Error('LINUX_REQUIRED')
const scenarios = [
  'before-seal',
  'after-seal',
  'after-t1',
  'after-ack',
  'after-idle',
  'after-t2',
  'expired-t1',
  'changed-pin',
  'stale-fence'
]
const selected = process.argv.slice(2)
assert.ok(selected.every((name) => scenarios.includes(name)))
const nonce = randomBytes(6).toString('hex')
const directory = resolve(import.meta.dirname, '../../.out-scripts/product-runtime-recovery', nonce)
mkdirSync(directory, { recursive: true })
const results = []
for (const scenario of selected.length ? selected : scenarios) {
  const output = join(directory, `${scenario}.json`)
  console.log(JSON.stringify({ scenario, status: 'RUNNING' }))
  const childResult = await new Promise((resolveChild) => {
    const child = spawn(
      process.execPath,
      [
        '--import',
        join(import.meta.dirname, 'recovery-preload.mjs'),
        join(import.meta.dirname, 'run.mjs')
      ],
      {
        env: { ...process.env, OPSPILOT_R2_SCENARIO: scenario, OPSPILOT_R2_RESULT: output },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    let text = ''
    let tooLarge = false
    child.stdout.on('data', (data) => {
      if (text.length + data.length < 512 * 1024) text += data
      else tooLarge = true
    })
    child.stderr.on('data', () => {
      /* Never forward arbitrary subprocess output. */
    })
    child.once('error', () => resolveChild({ code: null, text: '', tooLarge: true }))
    child.once('exit', (code) => resolveChild({ code, text, tooLarge }))
  })
  let record
  try {
    assert.equal(childResult.code, 1)
    assert.equal(childResult.tooLarge, false)
    assert.ok(existsSync(output))
    record = JSON.parse(readFileSync(output, 'utf8'))
    assert.equal(record.status, 'PASS')
    const report = childResult.text
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line))
      .find((value) => value.scope === 'PINNED_SSH_SQLITE_DOCKER_RUNTIME')
    assert.ok(report)
    assert.equal(report.failure?.code, 'R2_CHECKPOINT_FINISHED')
    assert.equal(report.cleanup, true)
    assert.equal(report.subject_unchanged, true)
    record = {
      ...record,
      cleanup: true,
      r1_artifact_nonce: report.nonce,
      base_commit: report.source_sha,
      subject_sha256: report.subject_sha256
    }
  } catch {
    record = { scenario, status: 'FAIL', code: 'R2_CRASH_RECOVERY_ASSERTION_FAILED' }
  }
  results.push(record)
  writeFileSync(
    join(directory, 'result.json'),
    JSON.stringify({ nonce, scope: 'REAL_SSH_DOCKER_CRASH_RECOVERY', results }, null, 2) + '\n'
  )
  console.log(JSON.stringify(record))
  if (record.status !== 'PASS') break
}
const passed = results.filter((item) => item.status === 'PASS').length
console.log(
  JSON.stringify({ nonce, passed, total: (selected.length ? selected : scenarios).length })
)
process.exitCode = passed === (selected.length ? selected : scenarios).length ? 0 : 1
