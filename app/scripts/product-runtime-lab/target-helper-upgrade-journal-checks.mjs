/* eslint-disable @typescript-eslint/explicit-function-return-type -- Native disposable SQLite/SSH fixture. */
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
  statSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const observations = []
export function checkHelperUpgradeJournal(
  database,
  dataDirectory,
  controllerId,
  sourceInput,
  final,
  files
) {
  const resultPath = process.env.OPSPILOT_TARGET_HELPER_JOURNAL_RESULT
  if (!resultPath) return
  const artifact = process.env.OPSPILOT_TARGET_HELPER_REVIEW_ARTIFACT
  if (!artifact) throw Error('JOURNAL_ARTIFACT_REQUIRED')
  const Database = createRequire(artifact)('better-sqlite3')
  const clones = []
  const clone = () => {
    const directory = mkdtempSync(join(dirname(dataDirectory), 'helper-journal-'))
    chmodSync(directory, 0o700)
    clones.push(directory)
    for (const entry of readdirSync(dataDirectory, { withFileTypes: true })) {
      if (entry.name.startsWith('opspilot.db')) continue
      assert(entry.isFile(), 'only generated fixture credential files may be copied')
      copyFileSync(join(dataDirectory, entry.name), join(directory, entry.name))
      chmodSync(join(directory, entry.name), 0o600)
    }
    database.prepare('VACUUM INTO ?').run(join(directory, 'opspilot.db'))
    chmodSync(join(directory, 'opspilot.db'), 0o600)
    return directory
  }
  const call = (directory, command, input, fault) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          ...(fault
            ? ['--import', join(import.meta.dirname, 'target-helper-upgrade-journal-fault.mjs')]
            : []),
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
          env: { ...process.env, ...(fault ? { OPSPILOT_HELPER_JOURNAL_FAULT: fault } : {}) }
        }
      )
    )
  const rejected = (action, expected) => {
    let actual
    try {
      action()
    } catch (error) {
      actual = /CONTROL_PLANE_ERROR ([A-Z0-9_]+)/.exec(String(error.stderr ?? ''))?.[1]
    }
    assert.equal(actual, expected)
  }
  const readRow = (directory) => {
    const db = new Database(join(directory, 'opspilot.db'), { readonly: true })
    try {
      return db
        .prepare('SELECT * FROM product_target_enrollment WHERE app_id=?')
        .get(sourceInput.app_id)
    } finally {
      db.close()
    }
  }
  const request = (directory) => {
    const reviewInput = {
      format: 1,
      controller_id: controllerId,
      app_id: sourceInput.app_id,
      ownership_generation: sourceInput.ownership_generation,
      artifact,
      manifest_sha256: sha(readFileSync(join(dirname(artifact), 'bundle-manifest.json'))),
      retained_manifest: readFileSync(join(final, 'release-manifest.json'), 'utf8')
    }
    const review = call(directory, 'review-target-helper-upgrade', reviewInput)
    return {
      ...reviewInput,
      request_key: randomUUID(),
      expected_review_sha256: review.review_sha256,
      confirm: true
    }
  }
  const lookup = (value) => ({
    format: 1,
    controller_id: controllerId,
    app_id: sourceInput.app_id,
    ownership_generation: sourceInput.ownership_generation,
    request_key: value.request_key
  })
  const material = () => files.map((name) => [name, sha(readFileSync(join(final, name)))])
  const baseline = material(),
    originalRow = readRow(dataDirectory)
  let cases = 0
  try {
    const normal = clone(),
      value = request(normal),
      before = readRow(normal)
    const prepared = call(normal, 'prepare-target-helper-upgrade', value)
    assert.equal(prepared.state, 'pending')
    assert.equal(prepared.apply_available, false)
    const pending = readRow(normal)
    assert.equal(pending.revision, before.revision + 1)
    assert.equal(pending.manifest_sha256, before.manifest_sha256)
    assert.equal(pending.receipt_json, before.receipt_json)
    assert.equal(pending.last_error_code, 'TARGET_HELPER_UPGRADE_PENDING:' + value.request_key)
    const journalRoot = join(normal, 'target-helper-upgrades')
    assert.equal(statSync(journalRoot).mode & 0o777, 0o700)
    const names = readdirSync(journalRoot)
    assert.equal(names.length, 1)
    const journal = join(journalRoot, names[0])
    assert.equal(statSync(journal).mode & 0o777, 0o600)
    assert.equal(statSync(journal).nlink, 1)
    const bytes = readFileSync(journal),
      info = lstatSync(journal)
    cases++
    assert.deepEqual(call(normal, 'helper-upgrade-state', lookup(value)), prepared)
    assert.deepEqual(call(normal, 'prepare-target-helper-upgrade', value), prepared)
    assert.deepEqual(readRow(normal), pending)
    assert.deepEqual(readFileSync(journal), bytes)
    assert.equal(lstatSync(journal).ino, info.ino)
    assert.equal(lstatSync(journal).mtimeMs, info.mtimeMs)
    cases++
    rejected(
      () =>
        call(normal, 'prepare-target-helper-upgrade', {
          ...value,
          artifact: '/foreign/control-plane.cjs'
        }),
      'TARGET_HELPER_UPGRADE_REQUEST_CONFLICT'
    )
    assert.deepEqual(readRow(normal), pending)
    cases++
    const recovery = call(normal, 'recover-runtime', {
      format: 1,
      artifact,
      manifest_sha256: value.manifest_sha256
    })
    assert.equal(recovery.state, 'reconciliation_required')
    assert.deepEqual(readRow(normal), pending)
    cases++
    const envelope = JSON.parse(bytes)
    envelope.signature = '0'.repeat(64)
    writeFileSync(journal, JSON.stringify(envelope), { mode: 0o600 })
    rejected(
      () => call(normal, 'helper-upgrade-state', lookup(value)),
      'TARGET_HELPER_UPGRADE_JOURNAL_INVALID'
    )
    assert.deepEqual(readRow(normal), pending)
    cases++
    const raceDirectory = clone(),
      first = request(raceDirectory),
      second = { ...first, request_key: randomUUID() }
    const results = JSON.parse(
      execFileSync(
        process.execPath,
        [join(import.meta.dirname, 'target-helper-upgrade-journal-race.mjs')],
        {
          input: JSON.stringify({ artifact, directory: raceDirectory, requests: [first, second] }),
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 60000,
          maxBuffer: 65536
        }
      )
    )
    assert.equal(results.filter((row) => row.code === 0).length, 1)
    assert.equal(results.find((row) => row.code === 0).result.state, 'pending')
    assert(
      [
        'TARGET_HELPER_UPGRADE_AUTHORITY_CHANGED',
        'TARGET_ENROLLMENT_NOT_READY',
        'TARGET_HELPER_REVIEW_AUTHORITY_CHANGED'
      ].includes(results.find((row) => row.code !== 0).error_code)
    )
    assert.equal(readRow(raceDirectory).revision, before.revision + 1)
    cases++
    for (const fault of ['after-intent', 'after-link']) {
      const directory = clone(),
        value = request(directory),
        before = readRow(directory)
      let killed = false
      try {
        call(directory, 'prepare-target-helper-upgrade', value, fault)
      } catch (error) {
        assert.equal(error.signal, 'SIGKILL')
        killed = true
      }
      assert.equal(killed, true)
      assert.deepEqual(readRow(directory), before)
      cases++
      if (fault === 'after-intent') {
        assert.equal(call(directory, 'helper-upgrade-state', lookup(value)).state, 'intent_only')
        assert.equal(call(directory, 'prepare-target-helper-upgrade', value).state, 'pending')
        assert.equal(readRow(directory).revision, before.revision + 1)
        cases++
      } else {
        rejected(
          () => call(directory, 'helper-upgrade-state', lookup(value)),
          'TARGET_HELPER_UPGRADE_JOURNAL_UNSAFE'
        )
        assert.deepEqual(readRow(directory), before)
        const next = { ...value, request_key: randomUUID() }
        assert.equal(call(directory, 'prepare-target-helper-upgrade', next).state, 'pending')
        cases++
      }
    }
    assert.deepEqual(material(), baseline)
    assert.deepEqual(readRow(dataDirectory), originalRow)
    observations.push({
      app_id: sourceInput.app_id,
      cases,
      original_SQL_remote_material_unchanged: true,
      cold_lookup_retry: true,
      startup_does_not_clear_barrier: true,
      SIGKILL_after_intent_recovers: true,
      SIGKILL_after_link_fails_closed_without_SQL: true,
      journal_permissions_verified: true
    })
  } finally {
    for (const directory of clones) {
      assert.equal(dirname(realpathSync(directory)), realpathSync(dirname(dataDirectory)))
      assert(directory.startsWith(join(dirname(dataDirectory), 'helper-journal-')))
      rmSync(directory, { recursive: true })
    }
  }
  writeFileSync(
    resultPath,
    JSON.stringify(
      {
        status: 'PASS',
        scope: 'NATIVE_HELPER_UPGRADE_JOURNAL_COLD_SIGKILL',
        observations,
        private_clone_cleanup: true
      },
      null,
      2
    ) + '\n',
    { mode: 0o600 }
  )
}
