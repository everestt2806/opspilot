/* eslint-disable @typescript-eslint/explicit-function-return-type -- Private packaged Electron/ML native lab. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import {
  copyFileSync,
  lstatSync,
  readdirSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
if (
  process.platform !== 'win32' ||
  !process.version.startsWith('v22.') ||
  process.argv[2] !== '--run' ||
  process.argv.length !== 3
) {
  console.log('{"status":"REJECTED","error":"EXPLICIT_WINDOWS_NODE22_LAB_REQUIRED"}')
  process.exit(2)
}
const project = resolve(import.meta.dirname, '..'),
  require = createRequire(join(project, 'package.json')),
  nonce = randomBytes(6).toString('hex'),
  directory = join(project, '.out-scripts/ml-runtime-native', nonce),
  privateRoot = join(directory, 'Bản cài thử OpsPilot'),
  resources = join(privateRoot, 'resources'),
  hostApp = join(resources, 'app'),
  source = join(project, 'resources/ml-runtime')
mkdirSync(directory, { recursive: true })
writeFileSync(join(directory, '.owner'), nonce, { flag: 'wx' })
assert(!existsSync(privateRoot))
const electron = require('electron'),
  esbuild = createRequire(require.resolve('vite/package.json'))('esbuild')
// Node22 fs.cpSync C++ fast path corrupts non-ASCII destination names on this host.
// mkdir/copyFile use the Unicode-safe Win32 path; reject symlinks in this private copy.
function copyTree(source, destination) {
  const stat = lstatSync(source)
  assert(!stat.isSymbolicLink())
  if (stat.isDirectory()) {
    mkdirSync(destination, { recursive: true })
    for (const name of readdirSync(source)) copyTree(join(source, name), join(destination, name))
  } else {
    assert(stat.isFile())
    copyFileSync(source, destination)
  }
}
copyTree(realpathSync(dirname(electron)), privateRoot)
assert.equal(realpathSync(privateRoot), resolve(privateRoot))
const executable = join(privateRoot, 'OpsPilotMLProbe.exe')
assert.equal(dirname(executable), privateRoot)
renameSync(join(privateRoot, 'electron.exe'), executable)
mkdirSync(hostApp, { recursive: true })
copyTree(source, join(resources, 'ml-runtime'))
const pin = createHash('sha256')
  .update(readFileSync(join(source, 'manifest.json')))
  .digest('hex')
await esbuild.build({
  entryPoints: [join(project, 'scripts/ml-runtime-lab/entry.mjs')],
  outfile: join(hostApp, 'main.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  define: { __OPSPILOT_ML_RUNTIME_SHA256__: JSON.stringify(pin) },
  plugins: [
    {
      name: 'private-logger',
      setup(build) {
        build.onResolve({ filter: /^\.\/logger$/ }, () => ({
          path: 'logger',
          namespace: 'private-logger'
        }))
        build.onLoad({ filter: /.*/, namespace: 'private-logger' }, () => ({
          contents: 'export const logger={info(){},warn(){},error(){}}',
          loader: 'js'
        }))
      }
    }
  ]
})
writeFileSync(
  join(hostApp, 'package.json'),
  JSON.stringify({ name: 'opspilot-ml-probe', version: '0.1.0', main: 'main.cjs' })
)
writeFileSync(
  join(hostApp, 'proof-config.json'),
  JSON.stringify({ pin, evidence: directory, user_data: join(privateRoot, 'Dữ liệu ML') })
)
const system = process.env.SystemRoot ?? 'C:\\Windows'
const child = spawn(executable, [], {
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  cwd: directory,
  env: {
    SystemRoot: system,
    WINDIR: system,
    PATH: join(system, 'System32'),
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    PYTHONHOME: join(directory, 'forbidden-python'),
    PYTHONPATH: join(directory, 'forbidden-site')
  }
})
let bytes = 0
const output = []
for (const stream of [child.stdout, child.stderr])
  stream.on('data', (value) => {
    bytes += value.length
    if (bytes < 65536) output.push(value)
  })
const watchdog = setTimeout(() => child.kill(), 150000)
const exit = await new Promise((done) => child.once('close', done))
clearTimeout(watchdog)
writeFileSync(join(directory, 'process.log'), Buffer.concat(output))
let result
try {
  result = JSON.parse(readFileSync(join(directory, 'result.json'), 'utf8'))
} catch {
  result = { status: 'FAIL', error: 'PACKAGED_PROBE_RESULT_MISSING', checks: [] }
}
assert.equal(realpathSync(privateRoot), resolve(privateRoot))
assert.equal(dirname(privateRoot), directory)
assert.equal(readFileSync(join(directory, '.owner'), 'utf8'), nonce)
if (exit === 0 && result.status === 'PASS') {
  try {
    rmSync(privateRoot, { recursive: true, maxRetries: 10, retryDelay: 100 })
    result.private_fixture_removed = !existsSync(privateRoot)
  } catch {
    result.status = 'FAIL'
    result.error = 'PRIVATE_FIXTURE_CLEANUP_FAILED'
    result.private_fixture_retained_for_diagnostics = true
  }
} else result.private_fixture_retained_for_diagnostics = true
result.logger_adapter =
  'No-op logger only; actual Electron app context, manager, filesystem, Python, HTTP and models.'
writeFileSync(join(directory, 'result.json'), JSON.stringify(result, null, 2) + '\n')
console.log(
  JSON.stringify({
    status: result.status,
    checks: result.checks.length,
    record: nonce,
    exit_code: exit,
    error: result.error
  })
)
process.exitCode = exit === 0 && result.status === 'PASS' ? 0 : 1
