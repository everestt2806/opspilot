// Node TTY nhận credential không echo; chỉ truyền qua stdin của Electron-as-Node.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { privateInput } from './input.mjs'
const args = process.argv.slice(2),
  operationArgs = args.filter(
    (arg) => !['--active-exposure', '--rollback-for-measurement'].includes(arg)
  )
assert(
  args.filter((arg) => arg === '--active-exposure').length <= 1 &&
    args.filter((arg) => arg === '--rollback-for-measurement').length <= 1 &&
    (!args.includes('--rollback-for-measurement') ||
      (args.includes('--active-exposure') && operationArgs[0] === '--resume')) &&
    (operationArgs.join(' ') === '--start' ||
      (operationArgs.length === 2 &&
        operationArgs[0] === '--resume' &&
        /^[a-f0-9]{12}$/.test(operationArgs[1])))
)
const require = createRequire(import.meta.url)
let config
if (operationArgs[0] === '--start') config = await privateInput()
const child = spawn(require('electron'), [join(import.meta.dirname, 'run.mjs'), ...args], {
  windowsHide: true,
  stdio: ['pipe', 'inherit', 'inherit'],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})
child.stdin.on('error', () => {})
child.stdin.end(config ? JSON.stringify(config) : '')
if (config) config.password = ''
child.on('error', () => {
  console.log('{"status":"FAIL","code":"CHILD_START_FAILED"}')
  process.exitCode = 1
})
child.on('close', (code) => {
  process.exitCode = code ?? 1
})
