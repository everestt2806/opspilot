/* eslint-disable @typescript-eslint/explicit-function-return-type -- CLI lab Node22/Linux. */
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync, lstatSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'

assert.equal(process.platform, 'linux')
assert(process.version.startsWith('v22.'))
const artifact = process.env.OPSPILOT_CURRENT_CONTROLLER_PAYLOAD
const pin = process.env.OPSPILOT_CURRENT_CONTROLLER_PAYLOAD_PIN
const modules = process.env.OPSPILOT_CONTROL_PLANE_MODULES
assert(artifact && pin && modules)
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const manifestBytes = readFileSync(join(dirname(artifact), 'bundle-manifest.json'))
assert.equal(sha(manifestBytes), pin)
const manifest = JSON.parse(manifestBytes)
assert.equal(manifest.format, 1)
for (const file of manifest.files) {
  assert(/^[A-Za-z0-9_./-]+$/.test(file.path) && !file.path.split('/').includes('..'))
  const path = join(dirname(artifact), file.path),
    info = lstatSync(path)
  assert(
    info.isFile() &&
      !info.isSymbolicLink() &&
      info.nlink === 1 &&
      info.size === file.size &&
      info.size <= 8 * 1024 * 1024
  )
  assert.equal(sha(readFileSync(path)), file.sha256)
}
const require = createRequire(import.meta.url),
  Database = require(join(modules, 'better-sqlite3'))
const nonce = randomBytes(6).toString('hex'),
  root = '/var/tmp/opspilot-controller-role-' + nonce
mkdirSync(root, { mode: 0o700 })
writeFileSync(join(root, '.lab-owner'), nonce, { mode: 0o600, flag: 'wx' })
const directory = join(root, 'controller'),
  checks = [],
  result = {
    status: 'FAIL',
    scope: 'CURRENT_BUNDLED_CONTROLLER_SCHEMA_ROLE',
    checks,
    bundle_manifest_sha256: pin,
    artifact_sha256: sha(readFileSync(artifact)),
    production_database_used: false
  }
const run = (command) => {
  const child = spawnSync(process.execPath, [artifact, command, '--data-dir', directory], {
    env: { PATH: '/usr/bin:/bin', NODE_PATH: modules, LANG: 'C.UTF-8' },
    encoding: 'utf8',
    maxBuffer: 65536,
    timeout: 30000
  })
  assert.equal(child.status, 0, 'CURRENT_BUNDLE_COMMAND_FAILED')
  return JSON.parse(child.stdout)
}
let db
try {
  const initialized = run('init')
  run('secrets-init')
  const marker = readFileSync(join(directory, '.product-controller-initialized')),
    key = readFileSync(join(directory, '.controller-runtime-key'))
  const keyHash = sha(key)
  key.fill(0)
  const dbInode = lstatSync(join(directory, 'opspilot.db')).ino
  db = new Database(join(directory, 'opspilot.db'), { readonly: true, fileMustExist: true })
  assert.equal(db.prepare('SELECT MAX(version) n FROM schema_version').get().n, 29)
  assert.equal(
    db.prepare("SELECT name FROM sqlite_master WHERE name='desktop_controller_upgrade'").get(),
    undefined
  )
  db.close()
  db = undefined
  checks.push('current_source_bundle_initializes_controller029_without_desktop030')
  const check = run('upgrade-check')
  assert.equal(check.controller_id, initialized.controller_id)
  assert.equal(check.quiescent, true)
  checks.push('current_upgrade_checker_builds_expected_schema_using_controller_role')
  run('status')
  assert(readFileSync(join(directory, '.product-controller-initialized')).equals(marker))
  assert.equal(sha(readFileSync(join(directory, '.controller-runtime-key'))), keyHash)
  assert.equal(lstatSync(join(directory, 'opspilot.db')).ino, dbInode)
  checks.push('cold_cli_reopen_preserves_identity_key_and_database_inode')
  result.status = 'PASS'
} catch {
  result.error = 'CURRENT_BUNDLE_ROLE_CHECK_FAILED'
  process.exitCode = 1
} finally {
  if (db?.open) db.close()
  assert.equal(resolve(root), '/var/tmp/opspilot-controller-role-' + nonce)
  assert(!lstatSync(root).isSymbolicLink())
  assert.equal(readFileSync(join(root, '.lab-owner'), 'utf8'), nonce)
  rmSync(root, { recursive: true })
  result.fixture_root_removed = !existsSync(root)
  const output = resolve(import.meta.dirname, '../../.out-scripts/r3c6h4c2a-role-current.json')
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
  console.log(
    JSON.stringify({
      status: result.status,
      checks: checks.length,
      fixture_root_removed: result.fixture_root_removed
    })
  )
}
