/* eslint-disable @typescript-eslint/explicit-function-return-type -- Private controller/SSH integration fixture. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const observations = []
/** Original fixture uses production CLI end-to-end; fault cases use fresh private enrollments. */
export function checkHelperController(
  database,
  dataDirectory,
  controllerId,
  sourceInput,
  final,
  files
) {
  const output = process.env.OPSPILOT_HELPER_CONTROLLER_RESULT
  if (!output) return null
  const artifact = process.env.OPSPILOT_CONTROLLER_READINESS_ARTIFACT
  if (!artifact) throw Error('CURRENT_ARTIFACT_REQUIRED')
  const Database = createRequire(artifact)('better-sqlite3')
  const pin = sha(readFileSync(join(dirname(artifact), 'bundle-manifest.json')))
  const call = (directory, command, input, fault) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          ...(fault ? ['--import', join(import.meta.dirname, 'helper-controller-fault.mjs')] : []),
          artifact,
          command,
          '--data-dir',
          directory
        ],
        {
          input: JSON.stringify(input),
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 45000,
          maxBuffer: 128 * 1024,
          env: {
            ...process.env,
            ...(fault
              ? {
                  OPSPILOT_HELPER_CONTROLLER_FAULT: fault,
                  OPSPILOT_HELPER_CONTROLLER_FAULT_REQUEST: input.request_key
                }
              : {})
          }
        }
      )
    )
  const identity = (request_key) => ({
    format: 1,
    controller_id: controllerId,
    app_id: sourceInput.app_id,
    ownership_generation: sourceInput.ownership_generation,
    request_key
  })
  const row = (directory) => {
    const db = new Database(join(directory, 'opspilot.db'), { readonly: true })
    try {
      return db
        .prepare('SELECT * FROM product_target_enrollment WHERE app_id=?')
        .get(sourceInput.app_id)
    } finally {
      db.close()
    }
  }
  const reviewInput = (directory) => ({
    format: 1,
    controller_id: controllerId,
    app_id: sourceInput.app_id,
    ownership_generation: sourceInput.ownership_generation,
    artifact,
    manifest_sha256: pin,
    retained_manifest: readFileSync(join(directory, 'release-manifest.json'), 'utf8')
  })
  const prepare = (directory, target) => {
    const request = reviewInput(target),
      review = call(directory, 'review-target-helper-upgrade', request),
      request_key = randomUUID()
    const value = {
      ...request,
      request_key,
      expected_review_sha256: review.review_sha256,
      confirm: true
    }
    assert.equal(call(directory, 'prepare-target-helper-upgrade', value).state, 'pending')
    assert.equal(call(directory, 'upgrade-check', undefined).quiescent, false)
    return identity(request_key)
  }
  const materials = (directory, names) =>
    names.map((name) => {
      const path = join(directory, name),
        info = lstatSync(path)
      return [name, info.ino, sha(readFileSync(path))]
    })
  const clones = []
  try {
    // Fault fixture: a consistent DB copy with enrollment rows removed only before fresh
    // production enroll-target provisioning. No post-failure SQL pin adoption or key edits.
    for (const fault of ['dispatch-link', 'after-dispatch', 'outcome-link', 'commit-link']) {
      const directory = mkdtempSync(join(dirname(dataDirectory), 'helper-controller-'))
      clones.push(directory)
      chmodSync(directory, 0o700)
      for (const entry of readdirSync(dataDirectory, { withFileTypes: true })) {
        if (!entry.isFile() || entry.name.startsWith('opspilot.db')) continue
        copyFileSync(join(dataDirectory, entry.name), join(directory, entry.name))
        chmodSync(join(directory, entry.name), 0o600)
      }
      database.prepare('VACUUM INTO ?').run(join(directory, 'opspilot.db'))
      chmodSync(join(directory, 'opspilot.db'), 0o600)
      const db = new Database(join(directory, 'opspilot.db'))
      db.exec('DELETE FROM product_target_enrollment')
      db.close()
      const enrolled = call(directory, 'enroll-target', {
        ...sourceInput,
        target_root: join(directory, 'targets')
      })
      assert.equal(enrolled.state, 'enrolled')
      const target = dirname(dirname(enrolled.helper_path)),
        before = row(directory),
        id = prepare(directory, target)
      const stateFiles = readdirSync(join(target, 'state'))
        .filter((name) => name.endsWith('.key') || name.endsWith('.json'))
        .map((name) => 'state/' + name)
      const protectedBefore = materials(target, stateFiles)
      let killed = false
      try {
        call(directory, 'apply-target-helper-upgrade', { ...id, confirm: true }, fault)
      } catch (error) {
        assert.equal(error.signal, 'SIGKILL')
        killed = true
      }
      assert.equal(killed, true)
      const interrupted = row(directory)
      if (fault === 'commit-link') {
        assert.equal(interrupted.state, 'enrolled')
        assert.equal(interrupted.manifest_sha256, pin)
      } else {
        assert.equal(interrupted.state, 'unknown')
        assert.equal(interrupted.manifest_sha256, before.manifest_sha256)
      }
      const after = call(directory, 'apply-target-helper-upgrade', { ...id, confirm: true })
      if (fault === 'dispatch-link' || fault === 'after-dispatch') {
        assert.equal(after.state, 'pending')
        assert.equal(
          call(directory, 'cancel-target-helper-upgrade', { ...id, confirm: true }).state,
          'not_applied'
        )
        assert.equal(row(directory).manifest_sha256, before.manifest_sha256)
      } else {
        assert.equal(after.state, 'applied')
        assert.equal(row(directory).manifest_sha256, pin)
      }
      const terminal = row(directory),
        status = call(directory, 'helper-upgrade-state', id)
      assert(['applied', 'not_applied'].includes(status.state))
      assert.deepEqual(
        call(directory, 'apply-target-helper-upgrade', { ...id, confirm: true }),
        status
      )
      assert.deepEqual(row(directory), terminal)
      assert.deepEqual(materials(target, stateFiles), protectedBefore)
      observations.push({
        app_id: sourceInput.app_id,
        fault,
        actual_SIGKILL: true,
        state: status.state,
        pin_finalized_by_production_CLI: true,
        key_marker_preserved: true,
        cold_retry_no_revision_advance: true
      })
    }
    const old = row(dataDirectory),
      protectedNames = files.filter(
        (name) =>
          name.startsWith('state/') ||
          name.includes('/target_execution_guard.py') ||
          name.includes('/target_guarded_ssh_helper.py')
      )
    const before = materials(final, protectedNames)
    const id = prepare(dataDirectory, final)
    assert.equal(
      call(dataDirectory, 'apply-target-helper-upgrade', { ...id, confirm: true }).state,
      'applied'
    )
    const after = row(dataDirectory)
    assert.equal(after.manifest_sha256, pin)
    assert.equal(after.state, 'enrolled')
    assert.equal(after.last_error_code, null)
    assert.equal(after.revision, old.revision + 2)
    assert.deepEqual(materials(final, protectedNames), before)
    const settled = call(dataDirectory, 'helper-upgrade-state', id)
    assert.equal(settled.state, 'applied')
    assert.deepEqual(
      call(dataDirectory, 'apply-target-helper-upgrade', { ...id, confirm: true }),
      settled
    )
    assert.deepEqual(row(dataDirectory), after)
    observations.push({
      app_id: sourceInput.app_id,
      state: 'applied',
      actual_pinned_SSH: true,
      old_pin: old.manifest_sha256,
      new_pin: pin,
      exact_revision_transition: true,
      key_marker_guards_preserved: true
    })
  } finally {
    for (const directory of clones) {
      assert.equal(dirname(realpathSync(directory)), realpathSync(dirname(dataDirectory)))
      assert(directory.startsWith(join(dirname(dataDirectory), 'helper-controller-')))
      rmSync(directory, { recursive: true })
    }
  }
  writeFileSync(
    output,
    JSON.stringify(
      {
        status: 'PASS',
        scope: 'CONTROLLER_HELPER_UPGRADE_PINNED_SSH_SQLITE',
        observations,
        private_fault_fixture_cleanup: true
      },
      null,
      2
    ) + '\n',
    { mode: 0o600 }
  )
  return pin
}
