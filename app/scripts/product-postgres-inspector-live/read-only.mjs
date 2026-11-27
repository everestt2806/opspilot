import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { privateInput } from '../product-environment-live/input.mjs'
import { inspectorSnapshotCommand } from './snapshot.mjs'

assert.equal(process.argv.slice(2).join(' '), '--confirm-readonly-inspector-baseline')
const root = resolve(import.meta.dirname, '../../..')
const record = join(root, 'app/.out-scripts/product-postgres-desktop-app-live/2a6785f2e51e')
const old = JSON.parse(readFileSync(join(record, 'result.json'), 'utf8'))
const artifact = join(record, 'entry.cjs')
assert.equal(old.status, 'PASS')
assert.equal(
  createHash('sha256').update(readFileSync(artifact)).digest('hex'),
  old.main_artifact_sha256
)
const code = createRequire(join(root, 'app/package.json'))(artifact)
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
  assert.equal(value.upgrade.request_key, 'ce4d6711-d001-40c0-9fbb-0c62d89744fc')
  assert.equal(
    value.upgrade.release_sha256,
    '4bc45902888d7e3442e6cd44694c4abbe1685101c5eac94415cb677461e245a5'
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
    join(root, 'app/.out-scripts/r7h4d4-readonly-baseline.json'),
    JSON.stringify({ checked_at: new Date().toISOString(), snapshot: value }, null, 2) + '\n'
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
} catch {
  console.log('{"status":"FAIL","code":"INSPECTOR_READONLY_BASELINE_FAILED"}')
  process.exitCode = 1
} finally {
  await ssh?.disconnectAll()
  if (config) config.password = ''
}
