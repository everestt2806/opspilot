import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname, basename } from 'node:path'
if (process.argv.slice(2).join(' ') !== '--confirm-local-environment-ui') {
  console.log('{"status":"REJECTED","code":"EXPLICIT_LOCAL_ENVIRONMENT_UI_GATE_REQUIRED"}')
  process.exit(2)
}
const root = resolve(import.meta.dirname, '../../..'),
  require = createRequire(join(root, 'app/package.json')),
  executable = require('electron'),
  environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE
const child = spawn(
  executable,
  [join(import.meta.dirname, 'electron.mjs'), '--confirm-local-environment-ui'],
  {
    cwd: root,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  }
)
let output = '',
  stderrBytes = 0
const timer = setTimeout(() => child.kill(), 200000)
child.stdout.on('data', (chunk) => {
  if (output.length + chunk.length > 131072) child.kill()
  else output += chunk
})
child.stderr.on('data', (chunk) => {
  stderrBytes += chunk.length
  if (stderrBytes > 131072) child.kill()
})
child.once('error', () => {
  clearTimeout(timer)
  console.log('{"status":"FAIL","code":"ELECTRON_GATE_SPAWN_FAILED"}')
  process.exitCode = 2
})
child.once('close', (code) => {
  clearTimeout(timer)
  try {
    const proof = output
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      })
      .find(
        (value) =>
          value?.scope === 'REAL_ELECTRON_PRODUCTION_PRELOAD_MAIN_SQLITE_SYNTHETIC_SSH_CONTROLLER'
      )
    if (!proof || !/^[a-f0-9]{12}$/.test(proof.nonce)) throw Error()
    const parent = realpathSync(join(root, 'app/.out-scripts/product-environment-desktop-lab')),
      directory = realpathSync(join(parent, proof.nonce)),
      profile = join(directory, 'profile')
    if (dirname(directory) !== parent || basename(directory) !== proof.nonce) throw Error()
    if (existsSync(profile)) {
      if (
        dirname(realpathSync(profile)) !== directory ||
        basename(realpathSync(profile)) !== 'profile'
      )
        throw Error()
      rmSync(profile, { recursive: true, maxRetries: 10, retryDelay: 100 })
    }
    proof.private_data_removed =
      proof.private_data_removed && !existsSync(profile) && !existsSync(join(directory, 'private'))
    proof.profile_cleanup = 'REMOVED_AFTER_ELECTRON_EXIT'
    proof.child_exit = code
    proof.stderr_bytes = stderrBytes
    writeFileSync(join(directory, 'result.json'), JSON.stringify(proof, null, 2) + '\n')
    console.log(JSON.stringify(proof))
    process.exitCode = proof.status === 'PASS' && proof.private_data_removed && code === 0 ? 0 : 1
  } catch {
    console.log('{"status":"FAIL","code":"ELECTRON_GATE_RESULT_OR_CLEANUP_INVALID"}')
    process.exitCode = 1
  }
})
