// Credential chỉ qua stdin tắt echo; profile riêng mã hóa bằng DPAPI.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { privateInput } from '../product-environment-live/input.mjs'
const args = process.argv.slice(2)
assert(args.length === 1 && /^[a-f0-9]{12}$/.test(args[0]))
let config = await privateInput()
const require = createRequire(import.meta.url)
const child = spawn(require('electron'), [join(import.meta.dirname, 'inspect.mjs'), ...args], {
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
