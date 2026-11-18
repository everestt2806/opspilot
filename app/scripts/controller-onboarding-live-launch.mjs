import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { privateInput } from './product-environment-live/input.mjs'

if (process.argv.slice(2).join(' ') !== '--confirm-install-assigned-controller')
  throw Error('CONFIRMATION_REQUIRED')
const config = await privateInput()
if (config.host !== '157.245.195.121' || typeof config.password !== 'string')
  throw Error('ASSIGNED_CONTROLLER_INPUT_INVALID')
const require = createRequire(import.meta.url)
const child = spawn(
  require('electron'),
  [
    join(import.meta.dirname, 'controller-onboarding-live.mjs'),
    '--confirm-install-development-controller'
  ],
  {
    windowsHide: true,
    stdio: ['pipe', 'inherit', 'inherit'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  }
)
child.stdin.on('error', () => {})
child.stdin.end(
  JSON.stringify({
    host: config.host,
    port: 22,
    username: 'root',
    host_fingerprint: 'SHA256:d1XH2CiZnh4Dy/AoIbI1n3Uo2N1je86U2Wsy3orvxA4',
    password: config.password
  })
)
config.password = ''
child.once('error', () => {
  console.log('CONTROLLER_CHILD_FAILED')
  process.exitCode = 1
})
child.once('close', (code) => {
  process.exitCode = code ?? 1
})
