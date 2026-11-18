// Node TTY nhận credential không echo; Electron chỉ nhận qua stdin trong RAM.
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { createConnection } from 'node:net'
import { privateInput } from '../product-environment-live/input.mjs'
if (process.argv.length !== 2) throw Error('READONLY_LAUNCH_ARGUMENT_INVALID')
const reachable = await new Promise((resolve) => {
  const socket = createConnection({ host: '167.71.202.116', port: 22 })
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- JavaScript launcher closure.
  const finish = (value) => {
    socket.destroy()
    resolve(value)
  }
  socket.setTimeout(5000, () => finish(false))
  socket.once('connect', () => finish(true))
  socket.once('error', () => finish(false))
})
if (!reachable) {
  console.log(
    '{"status":"BLOCKED","code":"VPS_TCP22_UNREACHABLE","credentials_requested":false,"remote_mutation_attempted":false}'
  )
  process.exit(1)
}
const config = await privateInput()
const require = createRequire(import.meta.url)
const child = spawn(
  require('electron'),
  [join(import.meta.dirname, 'read-only.mjs'), '--confirm-readonly-reconnection-baseline'],
  {
    windowsHide: true,
    stdio: ['pipe', 'inherit', 'inherit'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  }
)
child.stdin.on('error', () => {})
child.stdin.end(JSON.stringify(config))
config.password = ''
child.on('error', () => {
  console.log('{"status":"FAIL","code":"READONLY_CHILD_START_FAILED"}')
  process.exitCode = 1
})
child.on('close', (code) => {
  process.exitCode = code ?? 1
})
