/* eslint-disable @typescript-eslint/explicit-function-return-type -- Gate Docker local, không dùng profile/credential. */
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

if (
  !process.version.startsWith('v22.') ||
  process.argv.slice(2).join(' ') !== '--confirm-local-postgres-runtime'
)
  throw Error('EXPLICIT_NODE22_LOCAL_POSTGRES_GATE_REQUIRED')
const repo = resolve(import.meta.dirname, '../../..'),
  nonce = randomBytes(6).toString('hex'),
  name = 'opspilot-pg-lab-' + nonce,
  volume = name + '-scratch',
  output = resolve(repo, 'app/.out-scripts/product-postgres-docker', nonce),
  docker = process.platform === 'win32' ? 'docker.exe' : 'docker',
  image = 'sha256:d61b4c18bd89a44c476ae4700a3666f683d79bc78633e547dcd820a4b2d51279',
  run = (args, options = {}) =>
    execFileSync(docker, args, {
      encoding: 'utf8',
      timeout: 180000,
      maxBuffer: 512 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options
    })?.trim() ?? '',
  inspect = (kind, value) => JSON.parse(run([kind, 'inspect', value]))[0]
mkdirSync(output, { recursive: true })
const proof = { format: 1, nonce, state: 'RUNNING', image, serving_vps_used: false }
let created = false,
  mounted = false
try {
  if (run(['info', '--format', '{{.OSType}}']) !== 'linux') throw Error('LINUX_DOCKER_REQUIRED')
  run(['volume', 'create', '--label', 'opspilot.lab=' + nonce, volume])
  mounted = true
  const mountpoint = inspect('volume', volume).Mountpoint
  if (
    !mountpoint.startsWith('/var/lib/docker/volumes/opspilot-pg-lab-') ||
    !mountpoint.endsWith('/_data')
  )
    throw Error('LAB_NATIVE_MOUNTPOINT_INVALID')
  run([
    'create',
    '--name',
    name,
    '--label',
    'opspilot.lab=' + nonce,
    '--network',
    'none',
    '--mount',
    'type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock',
    '--mount',
    `type=volume,source=${volume},target=${mountpoint}`,
    '-e',
    'PYTHONDONTWRITEBYTECODE=1',
    '-e',
    'OPSPILOT_POSTGRES_LAB_ROOT=' + mountpoint,
    '--entrypoint',
    'python3',
    image,
    '/lab/repository/app/scripts/product-postgres-lab/runtime.py',
    '--confirm-local-postgres-runtime'
  ])
  created = true
  // Copy only current reviewed Python helpers/driver, never the workspace DB/env.
  // Chỉ copy cây Python cần thiết; không truyền profile, env hoặc SQLite của desktop.
  const { mkdtempSync, cpSync, rmSync } = await import('node:fs'),
    { tmpdir } = await import('node:os'),
    scratch = mkdtempSync(resolve(tmpdir(), 'opspilot-pg-gate-'))
  try {
    for (const path of ['app/scripts/product-postgres-lab', 'app/src/main/controlPlane'])
      mkdirSync(resolve(scratch, 'repository', path), { recursive: true })
    for (const path of [
      'app/scripts/product-postgres-lab/runtime.py',
      'app/src/main/controlPlane/target_product_runtime.py',
      'app/src/main/controlPlane/target_execution_guard.py'
    ])
      cpSync(resolve(repo, path), resolve(scratch, 'repository', path))
    run(['cp', scratch + '/.', name + ':/lab'])
  } finally {
    const { realpathSync } = await import('node:fs')
    assert.ok(
      realpathSync(scratch).startsWith(realpathSync(tmpdir())) &&
        scratch.includes('opspilot-pg-gate-'),
      'LOCAL_SCRATCH_IDENTITY_INVALID'
    )
    rmSync(scratch, { recursive: true })
  }
  run(['start', '-a', name], { stdio: ['ignore', 'inherit', 'inherit'] })
  const result = inspect('container', name)
  if (result.State.ExitCode !== 0) throw Error('POSTGRES_RUNTIME_GATE_FAILED')
  proof.state = 'PASS'
} finally {
  if (created) {
    const record = inspect('container', name)
    assert.equal(record.Config.Labels['opspilot.lab'], nonce, 'CLEANUP_CONTAINER_IDENTITY_INVALID')
    try {
      run([
        'cp',
        name + ':/lab/repository/app/.out-scripts/product-postgres-runtime/.',
        output + '/'
      ])
    } catch {
      proof.native_proof_copy = 'UNAVAILABLE'
    }
    run(['rm', '-f', record.Id])
  }
  if (mounted) {
    assert.equal(
      inspect('volume', volume).Labels['opspilot.lab'],
      nonce,
      'CLEANUP_VOLUME_IDENTITY_INVALID'
    )
    run(['volume', 'rm', volume])
  }
  proof.cleanup = { outer_container_removed: created, scratch_volume_removed: mounted }
  writeFileSync(resolve(output, 'docker-proof.json'), JSON.stringify(proof, null, 2) + '\n')
  console.log('PROOF ' + output)
}
