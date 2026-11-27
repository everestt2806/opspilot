import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { privateInput } from '../product-environment-live/input.mjs'
import { inspectorSnapshotCommand } from '../product-postgres-inspector-live/snapshot.mjs'

const buildOnly = process.argv.slice(2).join(' ') === '--confirm-readonly-reconnection-build'
assert(buildOnly || process.argv.slice(2).join(' ') === '--confirm-readonly-reconnection-baseline')
const root = resolve(import.meta.dirname, '../../..')
const record = join(
  root,
  'app/.out-scripts/product-project-reconnection-readonly',
  randomBytes(6).toString('hex')
)
mkdirSync(record, { recursive: true, mode: 0o700 })
const require = createRequire(join(root, 'app/package.json')),
  esbuild = createRequire(require.resolve('vite/package.json'))('esbuild'),
  artifact = join(record, 'entry.cjs')
await esbuild.build({
  entryPoints: [resolve(import.meta.dirname, '../product-helper-upgrade-live/entry.ts')],
  outfile: artifact,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  packages: 'external',
  plugins: [
    {
      name: 'raw',
      setup(b) {
        b.onResolve({ filter: /\?raw$/ }, (a) => ({
          path: resolve(a.resolveDir, a.path.slice(0, -4)),
          namespace: 'raw'
        }))
        b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({
          contents: readFileSync(a.path, 'utf8'),
          loader: 'text'
        }))
      }
    }
  ]
})
const main_artifact_sha256 = createHash('sha256').update(readFileSync(artifact)).digest('hex')
const code = require(artifact)
if (buildOnly) {
  console.log(
    JSON.stringify({
      status: 'PASS_CURRENT_MAIN_READONLY_BUILD',
      main_artifact_sha256,
      credentials_requested: false,
      SSH_used: false
    })
  )
  process.exit(0)
}
let config, ssh
try {
  config = await privateInput()
  assert.equal(config.host, '167.71.202.116')
  assert.equal(config.port, 22)
  assert.equal(config.username, 'root')
  assert.equal(config.host_fingerprint, 'SHA256:0X8J5LfPr6iZqEspsD379FvFEWrLfYpN0wfNYjQ87+E')
  assert.equal(typeof config.password, 'string')
  ssh = new code.SshManager(() => ({
    host: config.host,
    port: 22,
    username: 'root',
    authType: 'password',
    hostFingerprint: config.host_fingerprint,
    secret: config.password
  }))
  const result = await ssh.exec(1, inspectorSnapshotCommand, {
    logCommand: false,
    retryOnReconnect: false,
    timeoutMs: 45000,
    maxStdoutBytes: 524288,
    maxStderrBytes: 1024
  })
  assert.equal(result.code, 0)
  const value = JSON.parse(result.stdout)
  assert.equal(value.schema, 37)
  assert.equal(value.apps.length, 8)
  assert.equal(value.helpers.length, 8)
  assert.equal(value.containers.length, 16)
  assert.equal(value.upgrade.request_key, '5461c398-27e4-48b8-82e0-0ca0663aa760')
  assert.equal(
    value.upgrade.release_sha256,
    '63d1dca75f976d7cd06926ccf8f1407f221b505371cd32ea8132b39de8e01899'
  )
  for (const name of [
    'active_jobs',
    'active_experiments',
    'active_clients',
    'app_leases',
    'worker_leases',
    'unsettled_terminals',
    'prepared_activations'
  ])
    assert.equal(value[name], 0)
  assert(value.owners.every((row) => row.auto_deploy_paused === 1))
  assert(value.containers.every((row) => row.status === 'running'))
  assert.equal(value.postgres.data_count, 1000)
  assert.equal(value.postgres8.data_count, 1000)
  writeFileSync(
    join(root, 'app/.out-scripts/r7h4e4-readonly-baseline.json'),
    JSON.stringify(
      { checked_at: new Date().toISOString(), main_artifact_sha256, snapshot: value },
      null,
      2
    ) + '\n'
  )
  console.log(
    JSON.stringify({
      status: 'PASS_READONLY_PINNED_BASELINE',
      apps: 8,
      app_collectors: 16,
      PostgreSQL_instances: 2,
      rows_each: 1000,
      credentials_persisted: false,
      VPS_mutated: false
    })
  )
} catch (error) {
  const code =
    [error?.code, error?.context?.cause?.message, error?.message].find(
      (v) => typeof v === 'string' && /^[A-Z][A-Z0-9_]{1,90}$/.test(v)
    ) ?? 'RECONNECTION_BASELINE_FAILED'
  console.log(JSON.stringify({ status: 'FAIL', code, remote_mutation_attempted: false }))
  process.exitCode = 1
} finally {
  await ssh?.disconnectAll()
  if (config) config.password = ''
}
