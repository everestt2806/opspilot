// Gate SSH chỉ đọc; credential chỉ stdin/RAM.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { privateInput } from './input.mjs'
import { snapshotCommand } from './snapshot.mjs'

if (process.argv.slice(2).join(' ') !== '--inspect-only') throw Error('READONLY_FLAG_REQUIRED')
const project = resolve(import.meta.dirname, '../..'),
  require = createRequire(join(project, 'package.json')),
  nonce = randomBytes(6).toString('hex'),
  directory = join(project, '.out-scripts/product-environment-inspect', nonce),
  pin = 'SHA256:0X8J5LfPr6iZqEspsD379FvFEWrLfYpN0wfNYjQ87+E'
let ssh, config
try {
  config = await privateInput()
  assert(
    config.host === '167.71.202.116' &&
      config.username === 'root' &&
      config.port === 22 &&
      config.host_fingerprint === pin &&
      typeof config.password === 'string' &&
      config.password
  )
  mkdirSync(directory, { recursive: true })
  const esbuild = createRequire(require.resolve('vite/package.json'))('esbuild'),
    artifact = join(directory, 'ssh.cjs')
  await esbuild.build({
    entryPoints: [join(project, 'src/main/ssh/manager.ts')],
    outfile: artifact,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    packages: 'external'
  })
  const { SshManager } = require(artifact)
  ssh = new SshManager(() => ({
    host: config.host,
    port: config.port,
    username: config.username,
    authType: 'password',
    hostFingerprint: pin,
    secret: config.password
  }))
  const result = await ssh.exec(1, snapshotCommand, {
    logCommand: false,
    retryOnReconnect: false,
    timeoutMs: 30000,
    maxStdoutBytes: 65536,
    maxStderrBytes: 1024
  })
  assert.equal(result.code, 0)
  const snapshot = JSON.parse(result.stdout)
  const expected =
    snapshot.receipt.controller_id === 'dc586bb7-cd83-484c-b036-e5ad40ec106d' &&
    snapshot.receipt.request_key === '7573f0b1-4262-4305-8b7d-9a1edce49626' &&
    snapshot.receipt.uid === 997 &&
    snapshot.upgrade.request_key === '4c90a650-dbae-4694-9c2b-5eb2e8b9fdd4' &&
    snapshot.upgrade.release_sha256 ===
      'b6803bc794cb39987936395d8d1f12cd06720a08f2e0ba2c3307ec619368ab45' &&
    snapshot.upgrade.phase === 'active' &&
    snapshot.schema === 29 &&
    snapshot.apps.length === 4 &&
    snapshot.containers.length === 8 &&
    JSON.stringify(snapshot.apps.map((a) => [a.id, a.name, a.current_deployment_id])) ===
      JSON.stringify([
        [1, 'san-nha-live', 4],
        [2, 'desktop-live-69eeeb78', 5],
        [3, 'spa-live-6ab247675f19', 10],
        [4, 'next-live-ba8a98aed302', 15]
      ]) &&
    new Set(snapshot.containers.map((c) => c.id)).size === 8 &&
    snapshot.owners.length === 4 &&
    snapshot.owners.every((r) => r.controller_id === snapshot.receipt.controller_id) &&
    snapshot.containers.every((c) => c.status === 'running') &&
    [
      'active_experiments',
      'active_jobs',
      'active_clients',
      'app_leases',
      'worker_leases',
      'unsettled_terminals',
      'prepared_activations'
    ].every((k) => snapshot[k] === 0) &&
    snapshot.owners.every((r) => r.auto_deploy_paused === 1) &&
    snapshot.desired.every((r) => r.auto_paused === 1) &&
    snapshot.service.includes('ActiveState=active')
  writeFileSync(
    join(directory, 'snapshot.json'),
    JSON.stringify(
      {
        checked_at: new Date().toISOString(),
        pinned_host: config.host,
        mutation_attempted: false,
        expected_baseline: expected,
        snapshot
      },
      null,
      2
    ) + '\n'
  )
  console.log(
    JSON.stringify({
      status: expected ? 'PASS' : 'BASELINE_CHANGED',
      record: nonce,
      schema: snapshot.schema,
      apps: snapshot.apps.length,
      containers: snapshot.containers.length,
      active_jobs: snapshot.active_jobs,
      active_experiments: snapshot.active_experiments,
      mutation_attempted: false
    })
  )
  if (!expected) process.exitCode = 1
} catch (error) {
  console.log(
    JSON.stringify({
      status: 'FAIL',
      record: nonce,
      mutation_attempted: false,
      code:
        typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(error.code)
          ? error.code
          : 'READONLY_INSPECTION_FAILED'
    })
  )
  process.exitCode = 1
} finally {
  if (config) config.password = ''
  ssh?.disconnectAll()
}
