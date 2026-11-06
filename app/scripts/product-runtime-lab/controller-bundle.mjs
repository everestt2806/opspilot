/* eslint-disable @typescript-eslint/explicit-function-return-type -- CLI JavaScript kiểm gói offline. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import {
  chmodSync,
  chownSync,
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

if (process.platform !== 'linux' || process.getuid?.() !== 0)
  throw new Error('ROOT_LINUX_LAB_REQUIRED')
const modules = process.env.OPSPILOT_CONTROL_PLANE_MODULES
if (!modules) throw new Error('APPROVED_MODULES_REQUIRED')
const repo = resolve(import.meta.dirname, '../../..')
const scratch = mkdtempSync(join(tmpdir(), 'opspilot-bundle-'))
chmodSync(scratch, 0o700)
const nonce = randomBytes(6).toString('hex')
const output = join(repo, 'app/.out-scripts/controller-bundle', nonce)
mkdirSync(output, { recursive: true })
const trusted = join(scratch, 'trusted', 'control-plane.cjs')
const candidate = join(scratch, 'candidate', 'control-plane.cjs')
const root = dirname(candidate)
const environment = { ...process.env, NODE_PATH: modules, NODE_ENV: 'production' }
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const driverHash = sha(readFileSync(import.meta.filename))
const builderHash = sha(readFileSync(join(repo, 'app/scripts/build-control-plane.mjs')))
const cases = []
let failure
let pin
const record = (name) => cases.push({ name, status: 'PASS' })
const build = (destination) =>
  execFileSync(process.execPath, [join(repo, 'app/scripts/build-control-plane.mjs')], {
    env: { ...environment, OPSPILOT_CONTROL_PLANE_OUTPUT: destination },
    stdio: 'pipe',
    timeout: 30000
  })
const verify = (expected = 0, digest = pin) => {
  const args = [trusted, 'verify-bundle', '--artifact', candidate, '--manifest-sha256', digest]
  try {
    const bytes = execFileSync(process.execPath, args, {
      env: environment,
      cwd: tmpdir(),
      stdio: 'pipe',
      timeout: 15000
    })
    assert.equal(expected, 0)
    return JSON.parse(bytes.toString())
  } catch (error) {
    assert.equal(expected, 1)
    assert.equal(error.status, 1)
    assert.equal(error.stdout.toString(), '')
    assert.equal(
      error.stderr.toString().trim(),
      'CONTROL_PLANE_ERROR CONTROLLER_BUNDLE_VERIFICATION_FAILED'
    )
    return undefined
  }
}

try {
  build(trusted)
  cpSync(dirname(trusted), root, { recursive: true })
  const manifestPath = join(root, 'bundle-manifest.json')
  const manifestBytes = readFileSync(manifestPath)
  pin = sha(manifestBytes)
  const catalog = JSON.parse(
    readFileSync(join(repo, 'app/control-plane-runtime/bundle-files.json'), 'utf8')
  )
  for (const [file, source] of Object.entries(catalog))
    assert.deepEqual(readFileSync(join(root, file)), readFileSync(join(repo, source)))
  record('all_eleven_approved_assets_are_byte_identical')
  const result = verify()
  assert.equal(result.files, 12)
  assert.equal(result.root_directory, root)
  assert.equal(result.templates_directory, join(root, 'templates'))
  assert.equal(result.collector_directory, join(root, 'collector'))
  assert.equal(existsSync(join(root, 'opspilot.db')), false)
  record('trusted_cli_verifies_candidate_from_unrelated_cwd_without_db')
  verify(1, 'a'.repeat(64))
  record('wrong_manifest_pin_rejected')
  const entryBytes = readFileSync(candidate)
  const sentinel = join(scratch, 'MUST_NOT_EXECUTE')
  writeFileSync(candidate, `require('node:fs').writeFileSync(${JSON.stringify(sentinel)},'BAD')`)
  verify(1)
  assert.equal(existsSync(sentinel), false)
  writeFileSync(candidate, entryBytes)
  record('candidate_code_is_never_executed_to_verify_it')
  const helper = join(root, 'target-helper/target_product_runtime.py')
  const helperBytes = readFileSync(helper)
  writeFileSync(helper, 'CHANGED')
  verify(1)
  writeFileSync(helper, helperBytes)
  record('modified_helper_rejected')
  renameSync(helper, join(scratch, 'helper-retained'))
  verify(1)
  renameSync(join(scratch, 'helper-retained'), helper)
  record('missing_helper_rejected')
  writeFileSync(join(root, '.env'), 'SYNTHETIC_UNIT_MATERIAL')
  verify(1)
  unlinkSync(join(root, '.env'))
  mkdirSync(join(root, 'extra-directory'))
  verify(1)
  rmSync(join(root, 'extra-directory'), { recursive: true })
  record('unknown_file_and_empty_directory_rejected')
  for (const file of [helper, manifestPath]) {
    const saved = join(scratch, `saved-${basename(file)}`)
    renameSync(file, saved)
    symlinkSync(saved, file)
    verify(1)
    unlinkSync(file)
    renameSync(saved, file)
  }
  record('file_and_manifest_symlinks_rejected')
  const collector = join(root, 'collector')
  renameSync(collector, join(scratch, 'collector-retained'))
  symlinkSync(join(scratch, 'collector-retained'), collector)
  verify(1)
  unlinkSync(collector)
  renameSync(join(scratch, 'collector-retained'), collector)
  record('asset_directory_symlink_rejected')
  linkSync(helper, join(scratch, 'outside-hardlink'))
  verify(1)
  unlinkSync(join(scratch, 'outside-hardlink'))
  record('hardlink_outside_bundle_rejected')
  for (const path of [helper, collector, root]) {
    const mode = statSync(path).mode & 0o777
    chmodSync(path, 0o777)
    verify(1)
    chmodSync(path, mode)
  }
  chownSync(helper, 65534, 65534)
  verify(1)
  chownSync(helper, 0, 0)
  record('unsafe_file_directory_and_foreign_owner_rejected')
  const invalid = JSON.parse(manifestBytes.toString())
  invalid.files[0].path = '../outside'
  const invalidBytes = JSON.stringify(invalid)
  writeFileSync(manifestPath, invalidBytes)
  verify(1, sha(invalidBytes))
  writeFileSync(manifestPath, manifestBytes)
  record('traversal_rejected_even_when_manifest_pin_matches')
  const outside = join(scratch, 'outside-destination')
  writeFileSync(outside, 'MUST_STAY_UNCHANGED')
  renameSync(candidate, candidate + '.saved')
  symlinkSync(outside, candidate)
  assert.throws(() => build(candidate))
  assert.equal(readFileSync(outside, 'utf8'), 'MUST_STAY_UNCHANGED')
  unlinkSync(candidate)
  linkSync(outside, candidate)
  assert.throws(() => build(candidate))
  assert.equal(readFileSync(outside, 'utf8'), 'MUST_STAY_UNCHANGED')
  unlinkSync(candidate)
  renameSync(candidate + '.saved', candidate)
  record('builder_refuses_linked_entrypoint_without_overwriting_other_files')
  verify()
  record('restored_bundle_still_verifies')
} catch {
  failure = 'CONTROLLER_BUNDLE_LAB_FAILED'
} finally {
  assert.equal(dirname(realpathSync(scratch)), realpathSync(tmpdir()))
  rmSync(scratch, { recursive: true })
  const report = {
    status: failure ? 'FAIL' : 'PASS',
    nonce,
    scope: 'REAL_CONTROLLER_BUNDLE_CLI_FILESYSTEM',
    cases,
    failure,
    manifest_sha256: pin,
    driver_sha256: driverHash,
    builder_sha256: builderHash,
    cleanup: !existsSync(scratch)
  }
  writeFileSync(join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
  process.exitCode = failure ? 1 : 0
}
