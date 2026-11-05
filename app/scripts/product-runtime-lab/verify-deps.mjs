import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

if (process.platform !== 'linux') throw new Error('LINUX_REQUIRED')
const repo = resolve(import.meta.dirname, '../../..')
const scratch = mkdtempSync(join(tmpdir(), 'opspilot-r1-deps-'))
chmodSync(scratch, 0o700)
const environment = { ...process.env, PATH: `${dirname(process.execPath)}:${process.env.PATH}` }
try {
  for (const file of ['package.json', 'package-lock.json'])
    copyFileSync(join(repo, 'app/control-plane-runtime', file), join(scratch, file))
  execFileSync('npm', ['ci', '--no-audit', '--no-fund'], {
    cwd: scratch,
    env: environment,
    stdio: 'pipe',
    timeout: 180000
  })
  const artifact = join(scratch, 'lab.cjs')
  execFileSync(process.execPath, [join(import.meta.dirname, 'build.mjs')], {
    env: {
      ...environment,
      OPSPILOT_R1_MODULES: join(scratch, 'node_modules'),
      OPSPILOT_R1_ARTIFACT: artifact
    },
    stdio: 'pipe',
    timeout: 30000
  })
  const controllerArtifact = join(scratch, 'controller/control-plane.cjs')
  execFileSync(process.execPath, [join(repo, 'app/scripts/build-control-plane.mjs')], {
    env: {
      ...environment,
      OPSPILOT_CONTROL_PLANE_MODULES: join(scratch, 'node_modules'),
      OPSPILOT_CONTROL_PLANE_OUTPUT: controllerArtifact
    },
    stdio: 'pipe',
    timeout: 30000
  })
  for (const helper of [
    'target_execution_guard.py',
    'target_guarded_ssh_helper.py',
    'target_product_runtime.py'
  ])
    assert.deepEqual(
      readFileSync(join(scratch, 'controller/target-helper', helper)),
      readFileSync(join(repo, 'app/src/main/controlPlane', helper))
    )
  const initialized = JSON.parse(
    execFileSync(
      process.execPath,
      [controllerArtifact, 'init', '--data-dir', join(scratch, 'controller-data')],
      { env: environment, encoding: 'utf8', stdio: 'pipe', timeout: 30000 }
    )
  )
  assert.equal(initialized.state, 'initialized')
  execFileSync(
    process.execPath,
    [controllerArtifact, 'status', '--data-dir', join(scratch, 'controller-data')],
    { env: environment, stdio: 'pipe', timeout: 30000 }
  )
  const require = createRequire(artifact)
  const { initializeDatabase, closeDatabase } = require(artifact)
  const db = initializeDatabase(join(scratch, 'db'))
  try {
    assert.ok(
      db.prepare("SELECT name FROM sqlite_master WHERE name='product_runtime_terminal'").get()
    )
    assert.equal(require('zod/package.json').version, '4.4.3')
    console.log(
      JSON.stringify({
        status: 'PASS',
        node: process.version,
        sqlite: db.prepare('SELECT sqlite_version() AS version').get().version,
        zod: require('zod/package.json').version,
        migration_020: true,
        fresh_install: true,
        controller_cli_init_status: true,
        target_helper_files: 3
      })
    )
  } finally {
    closeDatabase()
  }
} catch {
  console.log(JSON.stringify({ status: 'FAIL', code: 'R1_FRESH_RUNTIME_INSTALL_FAILED' }))
  process.exitCode = 1
} finally {
  assert.equal(dirname(realpathSync(scratch)), realpathSync(tmpdir()))
  rmSync(scratch, { recursive: true })
}
