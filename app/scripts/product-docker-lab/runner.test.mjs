/* eslint-disable @typescript-eslint/explicit-function-return-type -- JavaScript không hỗ trợ kiểu trả về TypeScript. */
/** Regression không phụ thuộc Docker; HTTP dùng loopback server thật. */
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { executeLabRun } from './runner.mjs'

function fixture(mode = '') {
  const calls = [],
    labels = {}
  const imageId = `sha256:${'a'.repeat(64)}`,
    containerId = 'b'.repeat(64)
  const runCommand = async (_cmd, args) => {
    calls.push(args)
    const ok = { exitCode: 0, stdout: '', stderr: '' }
    if (mode === 'preflight' && args[0] === 'ps') return { ...ok, exitCode: 1 }
    if (mode === 'collision' && args[0] === 'ps' && args.some((a) => a.startsWith('name=')))
      return { ...ok, stdout: containerId }
    if (args[0] === 'build') {
      if (mode === 'build') return { ...ok, exitCode: 1 }
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--label') {
          const [key, value] = args[i + 1].split('=')
          labels[key] = value
        }
      }
      writeFileSync(args[args.indexOf('--iidfile') + 1], imageId)
    }
    if (args[0] === 'run') {
      writeFileSync(args[args.indexOf('--cidfile') + 1], containerId)
      return { ...ok, stdout: containerId, exitCode: mode === 'partial-run' ? 1 : 0 }
    }
    if (args[1] === 'inspect')
      return {
        ...ok,
        stdout: JSON.stringify([
          {
            Id: args[0] === 'container' ? containerId : imageId,
            Config: { Labels: mode === 'wrong-owner' ? {} : labels }
          }
        ])
      }
    if (mode === 'cleanup' && ['rm', 'rmi'].includes(args[0])) return { ...ok, exitCode: 1 }
    if (mode === 'verify' && args.some((a) => a.startsWith('label='))) return { ...ok, exitCode: 1 }
    return ok
  }
  return { calls, runCommand }
}
async function serverRun(mode, handler) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { runCommand, calls } = fixture(mode)
  try {
    const started = performance.now()
    const result = await executeLabRun({
      runId: 'controlled',
      port: server.address().port,
      runCommand,
      healthTimeoutMs: 150,
      pollIntervalMs: 5
    })
    return { result, calls, elapsed: performance.now() - started }
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}
const healthy = (_req, res) => res.end('{"status":"ok","run_id":"controlled"}')
for (const mode of ['build', 'collision', 'preflight']) {
  test(`POST-002/003: ${mode} never deletes unowned resources`, async () => {
    const { runCommand, calls } = fixture(mode)
    const result = await executeLabRun({
      runId: 'controlled',
      port: 31000,
      runCommand,
      allowPreexisting: true
    })
    assert.equal(result.success, false)
    assert(!calls.some((a) => ['rm', 'rmi'].includes(a[0])))
    if (mode !== 'build') assert(!calls.some((a) => ['build', 'run'].includes(a[0])))
  })
}
test('POST-002: removes verified container ID and only its image tag without force', async () => {
  const { result, calls } = await serverRun('', healthy)
  assert.equal(result.success, true)
  assert.deepEqual(
    calls.find((a) => a[0] === 'rmi'),
    ['rmi', 'opspilot-lab-express:controlled']
  )
  assert.deepEqual(
    calls.find((a) => a[0] === 'rm'),
    ['rm', '-f', 'b'.repeat(64)]
  )
})
for (const mode of ['cleanup', 'verify', 'wrong-owner']) {
  test(`POST-002: ${mode} fails closed`, async () => {
    const { result, calls } = await serverRun(mode, healthy)
    assert.equal(result.success, false)
    assert.equal(result.cleanupReport.unverified, true)
    if (mode === 'wrong-owner') assert(!calls.some((a) => ['rm', 'rmi'].includes(a[0])))
  })
}
test('POST-002: failed run cleans a verified partially created container', async () => {
  const { runCommand, calls } = fixture('partial-run')
  const result = await executeLabRun({ runId: 'controlled', port: 31000, runCommand })
  assert.equal(result.success, false)
  assert(calls.some((a) => a[0] === 'rm' && a[2] === 'b'.repeat(64)))
})
for (const bodyMode of ['stalled-headers', 'stalled-body', 'oversize', 'wrong-run']) {
  test(`POST-001/003: rejects ${bodyMode} within budget`, async () => {
    const { result, elapsed } = await serverRun('', (_req, res) => {
      if (bodyMode === 'stalled-headers') return
      if (bodyMode === 'stalled-body') {
        res.writeHead(200)
        res.write('{')
        return
      }
      if (bodyMode === 'oversize') {
        res.end('x'.repeat(65537))
        return
      }
      res.end('{"status":"ok","run_id":"someone-else"}')
    })
    assert.equal(result.success, false)
    assert.equal(result.failedAtStep, 'HEALTH_CHECK')
    assert(elapsed < 1500, `Health exceeded bounded budget: ${elapsed}ms`)
  })
}
