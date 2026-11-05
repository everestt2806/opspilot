import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

if (process.platform !== 'linux') throw new Error('LINUX_REQUIRED')
const modules = process.env.OPSPILOT_CONTROL_PLANE_MODULES
if (!modules) throw new Error('OPSPILOT_CONTROL_PLANE_MODULES_REQUIRED')
const require = createRequire(import.meta.url)
const esbuild = createRequire(join(modules, 'package.json'))('esbuild')
const appRoot = resolve(import.meta.dirname, '..')
const bundle = join(tmpdir(), `opspilot-p3e1-snapshot-${process.pid}.cjs`)
await esbuild.build({
  entryPoints: [join(appRoot, 'src/main/git/snapshot.ts')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22'
})
const { createGitSnapshot } = require(bundle)
const sha = '7fd1a60b01f91b314f59955a4e4d4e80d8edf11d'
const live = await createGitSnapshot({
  repositoryUrl: 'https://github.com/octocat/Hello-World.git',
  ref: 'master',
  targetSha: sha,
  timeoutMs: 30_000,
  maxBytes: 64 * 1024 * 1024
})
let publicSnapshotCleanupFailed = false
try {
  const checked = spawnSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
    cwd: live.snapshotDirectory,
    encoding: 'ascii'
  })
  const symbolic = spawnSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
    cwd: live.snapshotDirectory,
    encoding: 'ascii'
  })
  if (
    live.commitSha !== sha ||
    checked.status !== 0 ||
    checked.stdout.trim() !== sha ||
    symbolic.status !== 1 ||
    live.rootDirectory !== live.snapshotDirectory
  ) {
    throw new Error('PUBLIC_SNAPSHOT_SHA_MISMATCH')
  }
  console.log(`PUBLIC_SNAPSHOT_OK sha=${sha} root=${live.rootDirectory}`)
} finally {
  const snapshotDirectory = live.snapshotDirectory
  live.cleanup()
  publicSnapshotCleanupFailed = existsSync(snapshotDirectory)
}
if (publicSnapshotCleanupFailed) throw new Error('PUBLIC_SNAPSHOT_CLEANUP_FAILED')

const scratch = mkdtempSync(join(tmpdir(), 'opspilot-p3e1-timeout-lab-'))
const proxy = createServer((socket) => {
  proxySockets.add(socket)
  socket.once('close', () => proxySockets.delete(socket))
  socket.once('data', () => {
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    // Keep the CONNECT tunnel open without TLS response until Git is cancelled.
  })
})
const proxySockets = new Set()
await new Promise((resolveListen) => proxy.listen(0, '127.0.0.1', resolveListen))
const address = proxy.address()
if (!address || typeof address === 'string') throw new Error('PROXY_LISTEN_FAILED')
const previousProxy = process.env.HTTPS_PROXY
process.env.HTTPS_PROXY = `http://127.0.0.1:${address.port}`
let connections = 0
proxy.on('connection', () => {
  connections += 1
})
try {
  const started = Date.now()
  await expectFailure('timeout', () =>
    createGitSnapshot({
      repositoryUrl: 'https://github.com/octocat/Hello-World.git',
      ref: 'master',
      targetSha: sha,
      tempDirectory: scratch,
      timeoutMs: 200
    })
  )
  const timeoutMs = Date.now() - started
  if (timeoutMs > 5_000 || connections === 0) throw new Error('TIMEOUT_GATE_FAILED')
  await waitForNoGitProcess()
  if (readdirSync(scratch).length !== 0) throw new Error('TIMEOUT_SCRATCH_NOT_CLEAN')

  const abort = new AbortController()
  const cancelStarted = Date.now()
  const pending = createGitSnapshot({
    repositoryUrl: 'https://github.com/octocat/Hello-World.git',
    ref: 'master',
    targetSha: sha,
    tempDirectory: scratch,
    timeoutMs: 5_000,
    signal: abort.signal
  })
  setTimeout(() => abort.abort(), 200).unref()
  await expectFailure('cancel', () => pending)
  const cancellationMs = Date.now() - cancelStarted
  await waitForNoGitProcess()
  if (cancellationMs > 5_000 || readdirSync(scratch).length !== 0) {
    throw new Error('CANCELLATION_GATE_FAILED')
  }
  console.log(
    `LINUX_TREE_LIFECYCLE_OK timeout_ms=${timeoutMs} cancel_ms=${cancellationMs} scratch_empty=true`
  )
} finally {
  if (previousProxy === undefined) delete process.env.HTTPS_PROXY
  else process.env.HTTPS_PROXY = previousProxy
  for (const socket of proxySockets) socket.destroy()
  await new Promise((resolveClose) => proxy.close(resolveClose))
  rmSync(scratch, { recursive: true, force: true })
  rmSync(bundle, { force: true })
}

/** @returns {Promise<void>} */
// JavaScript harness: this ESLint rule requires TS syntax unavailable in Node's .mjs.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function expectFailure(label, operation) {
  try {
    await operation()
    throw new Error(`${label.toUpperCase()}_EXPECTED_FAILURE`)
  } catch (error) {
    if (error.message === `${label.toUpperCase()}_EXPECTED_FAILURE`) throw error
    if (!/thời gian|hủy/i.test(error.message)) throw error
  }
}

/** @returns {Promise<void>} */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function waitForNoGitProcess() {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    const entries = readdirSync('/proc').filter((entry) => /^\d+$/.test(entry))
    const remains = entries.some((pid) => {
      try {
        const command = readFileSync(`/proc/${pid}/cmdline`).toString('utf8').split('\0')
        return (
          (command[0]?.endsWith('/git') && command.includes('fetch')) ||
          command[0]?.endsWith('/git-remote-https')
        )
      } catch {
        return false
      }
    })
    if (!remains) return
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50))
  }
  throw new Error('GIT_PROCESS_STILL_RUNNING')
}
