/* eslint-disable @typescript-eslint/explicit-function-return-type -- Linux filesystem and concurrent-create integration gate. */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
  chmodSync,
  chownSync,
  copyFileSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
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
const artifact = process.env.OPSPILOT_R1_ARTIFACT
const api = createRequire(artifact)(artifact)
const root = mkdtempSync(join(tmpdir(), 'opspilot-runtime-keys-'))
chmodSync(root, 0o700)
const buffers = []
const cases = []
const scope = { controller_id: 'runtime-key-lab', app_id: 1, ownership_generation: 1 }
const other = { ...scope, app_id: 2 }
const next = { ...scope, ownership_generation: 2 }
const anotherController = { ...scope, controller_id: 'other-controller' }
const unavailable = /^Error: CONTROLLER_RUNTIME_KEY_UNAVAILABLE$/
const check = async (name, callback) => {
  await callback()
  cases.push({ name, status: 'PASS' })
}
const read = (identity) => {
  const key = api.loadControllerRuntimeKey(root, identity)
  buffers.push(key)
  return key
}
const create = (identity) => {
  const before = readdirSync(root)
  const key = api.createControllerRuntimeKey(root, identity)
  buffers.push(key)
  const added = readdirSync(root).filter((name) => !before.includes(name))
  assert.equal(added.length, 1)
  return { key, path: join(root, added[0]) }
}
let first, second, nextGeneration, separateController
try {
  api.initializeControllerSecretKey(root)
  await check('missing_key_load_does_not_create', () => {
    const before = readdirSync(root)
    assert.throws(() => read(scope), unavailable)
    assert.deepEqual(readdirSync(root), before)
  })
  await check('independent_app_generation_and_controller_keys', () => {
    first = create(scope)
    second = create(other)
    nextGeneration = create(next)
    separateController = create(anotherController)
    const keys = [first, second, nextGeneration, separateController].map((value) => value.key)
    assert.equal(new Set(keys.map((key) => key.toString('base64'))).size, 4)
    for (const key of keys) assert.equal(key.length, 32)
    assert.deepEqual(read(scope), first.key)
    assert.deepEqual(read(next), nextGeneration.key)
  })
  await check('ciphertext_only_private_material', () => {
    for (const value of [first, second, nextGeneration, separateController]) {
      assert.equal(lstatSync(value.path).mode & 0o777, 0o600)
      const stored = readFileSync(value.path, 'utf8')
      assert.equal(stored.includes(value.key.toString('base64')), false)
      assert.equal(stored.includes(value.key.toString('hex')), false)
    }
  })
  await check('duplicate_create_preserves_old_and_retained_generation', () => {
    const before = readFileSync(first.path)
    assert.throws(
      () => api.createControllerRuntimeKey(root, scope),
      /^Error: CONTROLLER_RUNTIME_KEY_CREATION_FAILED$/
    )
    assert.deepEqual(readFileSync(first.path), before)
    assert.deepEqual(read(scope), first.key)
    assert.deepEqual(read(next), nextGeneration.key)
  })
  await check('cross_app_generation_controller_record_swap_rejected', () => {
    const saved = readFileSync(first.path)
    for (const source of [second, nextGeneration, separateController]) {
      copyFileSync(source.path, first.path)
      assert.throws(() => read(scope), unavailable)
      writeFileSync(first.path, saved)
    }
  })
  await check('ciphertext_tampering_rejected', () => {
    const saved = readFileSync(first.path)
    const changed = JSON.parse(saved)
    const ciphertext = Buffer.from(changed.encrypted_secret, 'base64')
    ciphertext[0] ^= 1
    changed.encrypted_secret = ciphertext.toString('base64')
    writeFileSync(first.path, JSON.stringify(changed))
    assert.throws(() => read(scope), unavailable)
    writeFileSync(first.path, saved)
  })
  await check('wrong_purpose_and_key_length_rejected', () => {
    const saved = readFileSync(first.path)
    const cipher = api.loadControllerCredentialCipher(root)
    for (const [purpose, key] of [
      ['ssh', first.key.toString('base64')],
      ['product-h2-runtime', 'AA==']
    ]) {
      const encrypted = cipher.encrypt(JSON.stringify({ format: 1, purpose, identity: scope, key }))
      writeFileSync(
        first.path,
        JSON.stringify({
          format: 1,
          crypto_scheme: encrypted.crypto_scheme,
          encrypted_secret: encrypted.encrypted_secret.toString('base64'),
          iv: encrypted.iv.toString('base64'),
          auth_tag: encrypted.auth_tag.toString('base64')
        })
      )
      assert.throws(() => read(scope), unavailable)
    }
    writeFileSync(first.path, saved)
  })
  await check('unsafe_record_permissions_rejected', () => {
    chmodSync(first.path, 0o644)
    assert.throws(() => read(scope), unavailable)
    chmodSync(first.path, 0o600)
  })
  await check('symlink_and_hardlink_record_rejected', () => {
    const saved = join(root, 'saved-record')
    renameSync(first.path, saved)
    symlinkSync(saved, first.path)
    assert.throws(() => read(scope), unavailable)
    unlinkSync(first.path)
    renameSync(saved, first.path)
    linkSync(first.path, saved)
    assert.throws(() => read(scope), unavailable)
    unlinkSync(saved)
  })
  await check('foreign_record_owner_rejected', () => {
    assert.equal(process.getuid(), 0, 'isolated root lab required for owner gate')
    chownSync(first.path, 65534, 65534)
    assert.throws(() => read(scope), unavailable)
    chownSync(first.path, process.getuid(), process.getgid())
  })
  await check('invalid_json_oversize_encoding_and_schema_rejected', () => {
    const saved = readFileSync(first.path)
    for (const text of [
      '{',
      'x'.repeat(8193),
      JSON.stringify({ ...JSON.parse(saved), iv: '!!!!' }),
      JSON.stringify({ ...JSON.parse(saved), extra: 'unexpected' })
    ]) {
      writeFileSync(first.path, text)
      assert.throws(() => read(scope), unavailable)
      assert.throws(
        () => api.createControllerRuntimeKey(root, scope),
        /^Error: CONTROLLER_RUNTIME_KEY_CREATION_FAILED$/
      )
      assert.equal(readFileSync(first.path, 'utf8'), text)
    }
    writeFileSync(first.path, saved)
  })
  await check('invalid_identity_never_creates_material', () => {
    const before = readdirSync(root)
    for (const identity of [
      { ...scope, app_id: 0 },
      { ...scope, ownership_generation: -1 },
      { ...scope, controller_id: '../escape' },
      { ...scope, controller_id: 'controller\n' },
      { ...scope, app_id: Number.MAX_SAFE_INTEGER + 1 }
    ])
      assert.throws(
        () => api.createControllerRuntimeKey(root, identity),
        /^Error: CONTROLLER_RUNTIME_KEY_IDENTITY_INVALID$/
      )
    assert.deepEqual(readdirSync(root), before)
  })
  await check('concurrent_process_creation_has_one_winner', async () => {
    const identity = { ...scope, app_id: 3 }
    const compete = () =>
      new Promise((resolveResult, reject) => {
        const child = spawn(
          process.execPath,
          [
            join(import.meta.dirname, 'runtime-key-contender.mjs'),
            artifact,
            root,
            identity.controller_id,
            String(identity.app_id),
            String(identity.ownership_generation)
          ],
          { stdio: 'ignore' }
        )
        child.once('error', reject)
        child.once('close', resolveResult)
      })
    const results = await Promise.all([compete(), compete()])
    assert.deepEqual(results.sort(), [0, 2])
    assert.equal(read(identity).length, 32)
  })
  console.log(
    JSON.stringify({
      status: 'PASS',
      scope: 'LINUX_PER_APP_RUNTIME_KEYS',
      passed: cases.length,
      cases
    })
  )
} finally {
  for (const buffer of buffers) buffer.fill(0)
  assert.equal(dirname(realpathSync(root)), realpathSync(tmpdir()))
  rmSync(root, { recursive: true })
}
