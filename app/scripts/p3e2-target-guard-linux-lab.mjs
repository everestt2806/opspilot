/* eslint-disable @typescript-eslint/explicit-function-return-type -- Plain Node harness uses JSDoc types. */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'linux') throw new Error('LINUX_REQUIRED')

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const harness = resolve(appRoot, 'scripts/p3e2-target-guard-linux-lab.py')
const python = process.env.OPSPILOT_LAB_PYTHON || 'python3'
const timeoutMs = 20_000
const scratch = mkdtempSync(join(tmpdir(), 'opspilot-p3e2-harness-'))
const child = spawn(python, [harness, scratch], {
  cwd: '/tmp',
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }
})
let output = ''
let settled = false
let timer
let stopError
/** @type {(value: void | PromiseLike<void>) => void} */
let resolveClosed = () => undefined
const closed = new Promise((resolveClose) => {
  resolveClosed = resolveClose
})
/** @param {Buffer} chunk @returns {void} */
const append = (chunk) => {
  output += chunk.toString('utf8')
  if (output.length > 64 * 1024) {
    void stopTree(new Error('LAB_OUTPUT_LIMIT'))
  }
}
child.stdout.on('data', append)
child.stderr.on('data', append)

/** @param {Error | null} error @param {number | null | undefined} [code] @returns {void} */
function finish(error, code) {
  if (settled) return
  settled = true
  clearTimeout(timer)
  rmSync(scratch, { recursive: true, force: false })
  if (error) {
    process.stderr.write(output.slice(-16 * 1024))
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  } else if (code !== 0) {
    process.stderr.write(output.slice(-16 * 1024))
    process.stderr.write(`LAB_EXIT_${code}\n`)
    process.exitCode = 1
  } else {
    process.stdout.write(output)
  }
}

/** @param {Error} error @returns {Promise<void>} */
async function stopTree(error) {
  if (stopError) return
  stopError = error
  if (!child.pid) {
    finish(error)
    return
  }
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    // The group can exit between the pid check and signal.
  }
  await new Promise((resolveWait) => setTimeout(resolveWait, 300))
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    // The close promise below confirms the child lifecycle has settled.
  }
  await closed
  finish(error)
}

timer = setTimeout(() => void stopTree(new Error('LAB_WATCHDOG_TIMEOUT')), timeoutMs)
child.once('error', (error) => finish(new Error(error.code || 'LAB_SPAWN_FAILED')))
child.once('close', (code) => {
  resolveClosed(code)
  if (!stopError) finish(null, code)
})
