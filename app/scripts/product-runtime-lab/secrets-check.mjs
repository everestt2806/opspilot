import assert from 'node:assert/strict'
import {
  chmodSync,
  chownSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

if (process.platform !== 'linux' || !process.env.OPSPILOT_R1_ARTIFACT)
  throw new Error('LINUX_LAB_ARTIFACT_REQUIRED')
const { initializeControllerSecretKey, loadControllerCredentialCipher } = createRequire(
  process.env.OPSPILOT_R1_ARTIFACT
)(process.env.OPSPILOT_R1_ARTIFACT)
const root = mkdtempSync(join(tmpdir(), 'opspilot-controller-key-'))
chmodSync(root, 0o700)
const key = join(root, '.controller-runtime-key')
let material
let passed = 0
try {
  assert.throws(
    () => loadControllerCredentialCipher(root),
    /^Error: CONTROLLER_SECRET_KEY_UNAVAILABLE$/
  )
  passed += 1
  initializeControllerSecretKey(root)
  assert.equal(lstatSync(key).mode & 0o777, 0o600)
  material = readFileSync(key)
  assert.equal(material.length, 32)
  const cipher = loadControllerCredentialCipher(root)
  assert.equal(cipher.decrypt(cipher.encrypt('SYNTHETIC_UNIT_MATERIAL')), 'SYNTHETIC_UNIT_MATERIAL')
  passed += 1
  assert.throws(
    () => initializeControllerSecretKey(root),
    /^Error: CONTROLLER_SECRET_KEY_INITIALIZATION_FAILED$/
  )
  assert.deepEqual(readFileSync(key), material)
  passed += 1
  chmodSync(key, 0o644)
  assert.throws(
    () => loadControllerCredentialCipher(root),
    /^Error: CONTROLLER_SECRET_KEY_UNAVAILABLE$/
  )
  chmodSync(key, 0o600)
  passed += 1
  const saved = join(root, 'saved-key')
  renameSync(key, saved)
  symlinkSync(saved, key)
  assert.throws(
    () => loadControllerCredentialCipher(root),
    /^Error: CONTROLLER_SECRET_KEY_UNAVAILABLE$/
  )
  unlinkSync(key)
  renameSync(saved, key)
  passed += 1
  linkSync(key, saved)
  assert.throws(
    () => loadControllerCredentialCipher(root),
    /^Error: CONTROLLER_SECRET_KEY_UNAVAILABLE$/
  )
  unlinkSync(saved)
  passed += 1
  assert.equal(process.getuid(), 0, 'owner rejection gate requires isolated root lab')
  chownSync(key, 65534, 65534)
  assert.throws(
    () => loadControllerCredentialCipher(root),
    /^Error: CONTROLLER_SECRET_KEY_UNAVAILABLE$/
  )
  chownSync(key, process.getuid(), process.getgid())
  passed += 1
  writeFileSync(key, material.subarray(0, 16))
  assert.throws(
    () => loadControllerCredentialCipher(root),
    /^Error: CONTROLLER_SECRET_KEY_UNAVAILABLE$/
  )
  writeFileSync(key, material)
  passed += 1
  chmodSync(root, 0o755)
  assert.throws(
    () => loadControllerCredentialCipher(root),
    /^Error: CONTROLLER_SECRET_DIRECTORY_INVALID$/
  )
  chmodSync(root, 0o700)
  passed += 1
  const alias = join(root, 'directory-link')
  symlinkSync(root, alias)
  assert.throws(
    () => loadControllerCredentialCipher(alias),
    /^Error: CONTROLLER_SECRET_DIRECTORY_INVALID$/
  )
  passed += 1
  console.log(
    JSON.stringify({
      status: 'PASS',
      scope: 'LINUX_CONTROLLER_PRIVATE_KEY_STORE',
      passed,
      missing_key_rejected: true,
      no_implicit_rotation: true,
      symlink_hardlink_mode_owner_checks: true
    })
  )
} finally {
  material?.fill(0)
  assert.equal(dirname(realpathSync(root)), realpathSync(tmpdir()))
  rmSync(root, { recursive: true })
}
