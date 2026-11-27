import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { privateInput } from '../product-environment-live/input.mjs'

const operation = process.argv.slice(2).join(' ')
if (!['--confirm-readonly-assigned-vps', '--confirm-prepare-assigned-vps'].includes(operation))
  throw Error('CONFIRMATION_REQUIRED')
const config = await privateInput()
const require = createRequire(import.meta.url)
const child = spawn(require('electron'), [join(import.meta.dirname, 'run.mjs'), operation], {
  windowsHide: true,
  stdio: ['pipe', 'inherit', 'inherit'],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})
child.stdin.on('error', () => {})
child.stdin.end(JSON.stringify(config))
if (Array.isArray(config)) for (const host of config) host.password = ''
child.once('error', () => {
  console.log('INVENTORY_CHILD_FAILED')
  process.exitCode = 1
})
child.once('close', (code) => {
  process.exitCode = code ?? 1
})
