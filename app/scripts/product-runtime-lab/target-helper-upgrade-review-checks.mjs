/* eslint-disable @typescript-eslint/explicit-function-return-type -- Native integration lab. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const checks = []
/** Called only for private generated lab fixtures, before runtime jobs are created. */
export function checkHelperUpgradeReview(
  database,
  dataDirectory,
  controllerId,
  input,
  final,
  files
) {
  const artifact = process.env.OPSPILOT_TARGET_HELPER_REVIEW_ARTIFACT
  if (!artifact) return
  const output = process.env.OPSPILOT_TARGET_HELPER_REVIEW_RESULT
  if (!output) throw Error('TARGET_HELPER_REVIEW_RESULT_REQUIRED')
  const rows = () =>
    database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all()
      .map(({ name }) => [
        name,
        database.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '" ORDER BY rowid').all()
      ])
  const snapshot = () =>
    sha(
      JSON.stringify({
        rows: rows(),
        files: files.map((name) => [name, sha(readFileSync(join(final, name)))])
      })
    )
  const request = {
    format: 1,
    controller_id: controllerId,
    app_id: input.app_id,
    ownership_generation: input.ownership_generation,
    artifact,
    manifest_sha256: sha(readFileSync(join(dirname(artifact), 'bundle-manifest.json'))),
    retained_manifest: readFileSync(join(final, 'release-manifest.json'), 'utf8')
  }
  const call = (value = request) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [artifact, 'review-target-helper-upgrade', '--data-dir', dataDirectory],
        {
          input: JSON.stringify(value),
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 30000
        }
      )
    )
  const rejected = (action, expected) => {
    let code
    try {
      action()
    } catch (error) {
      code = /CONTROL_PLANE_ERROR ([A-Z0-9_]+)/.exec(String(error.stderr ?? ''))?.[1]
    }
    assert.equal(code, expected)
  }
  const before = snapshot()
  const review = call()
  assert.equal(review.apply_available, false)
  assert.equal(review.purpose, 'product-target-helper-upgrade-review')
  assert.equal(review.changes.length, 1)
  assert.equal(review.changes[0].path, 'target-helper/target_product_runtime.py')
  assert.equal(
    review.changes[0].after.sha256,
    'f591e2f4bd8b1a770204af8645c499ba05955090a32464c1ae5c32dd37443cb5'
  )
  assert.deepEqual(
    call(),
    review,
    'readonly review has stable digest and does not advance SQL inspection metadata'
  )
  assert.equal(snapshot(), before)
  rejected(
    () => call({ ...request, retained_manifest: request.retained_manifest + ' ' }),
    'TARGET_HELPER_REVIEW_RETAINED_PIN_MISMATCH'
  )
  assert.equal(snapshot(), before)
  const path = join(final, 'enrollment.json')
  const receipt = readFileSync(path)
  try {
    const corrupt = JSON.parse(receipt)
    corrupt.signature = '0'.repeat(64)
    writeFileSync(path, JSON.stringify(corrupt), { mode: 0o600 })
    rejected(() => call(), 'TARGET_ENROLLMENT_UNKNOWN')
  } finally {
    writeFileSync(path, receipt, { mode: 0o600 })
  }
  assert.equal(snapshot(), before)
  const controller = database
    .prepare('SELECT * FROM product_app_control WHERE app_id=?')
    .get(input.app_id)
  try {
    database
      .prepare(
        "UPDATE product_app_control SET auto_deploy_paused=0,pause_reason=NULL,pause_policy_provenance='explicit' WHERE app_id=?"
      )
      .run(input.app_id)
    rejected(() => call(), 'TARGET_ENROLLMENT_REQUIRES_QUIESCENCE')
  } finally {
    database
      .prepare(
        'UPDATE product_app_control SET auto_deploy_paused=?,pause_reason=?,pause_policy_provenance=? WHERE app_id=?'
      )
      .run(
        controller.auto_deploy_paused,
        controller.pause_reason,
        controller.pause_policy_provenance,
        input.app_id
      )
  }
  assert.equal(snapshot(), before)
  checks.push({
    app_id: input.app_id,
    cases: 5,
    repeated_review_stable: true,
    SQL_and_material_unchanged: true,
    remote_receipt_tamper_rejected: true,
    unpaused_rejected: true,
    review
  })
  writeFileSync(
    output,
    JSON.stringify(
      { status: 'PASS', scope: 'NATIVE_CLI_PINNED_SSH_SQLITE_HELPER_REVIEW', checks },
      null,
      2
    ) + '\n',
    { mode: 0o600 }
  )
}
