/* eslint-disable @typescript-eslint/explicit-function-return-type -- Private same-UID CLI acceptance. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

/** Called after the selection lab stops its private SSHD. No production VPS/DB. */
export function reviewReconnection({ db, cli, check, controllerId, databaseId, repository }) {
  const fingerprint = () => createHash('sha256').update(db.serialize()).digest('hex')
  const input = { format: 1, controller_id: controllerId, app_id: 1 }
  const before = fingerprint()
  const current = cli('project-reconnection-context', input)
  assert.equal(current.state, 'review_required')
  assert.equal(current.source.repository_url, repository)
  assert.equal(current.selected_database.database_id, databaseId)
  assert.equal(current.runtime_status, 'not_checked')
  assert.equal(current.desktop_authority, 'not_granted')
  assert.equal(current.consent_required, true)
  assert.deepEqual(
    cli('project-reconnection-context', {
      ...input,
      expected_snapshot_sha256: current.snapshot_sha256
    }),
    current
  )
  assert.equal(fingerprint(), before)
  check(
    'actual_same_UID_CLI_reads_current_Git_and_authenticated_PG_metadata_with_SSHD_off_and_no_SQLite_writes'
  )
  for (const wrong of [
    { ...input, app_id: 2 },
    { ...input, controller_id: 'wrong-controller' },
    { ...input, expected_snapshot_sha256: '0'.repeat(64) }
  ])
    cli('project-reconnection-context', wrong, /PROJECT_RECONNECTION_AUTHORITY_CHANGED/)
  cli(
    'project-reconnection-context',
    { ...input, target: {} },
    /PROJECT_RECONNECTION_INPUT_INVALID/
  )
  assert.equal(fingerprint(), before)
  check(
    'actual_same_UID_CLI_refuses_wrong_controller_app_previous_snapshot_and_caller_target_without_writes'
  )

  // Fixture policy changes are outside the operation under test. The readonly
  // command itself must preserve auto enabled and reject the prior digest.
  db.exec('UPDATE product_app_control SET auto_deploy_paused=0,pause_reason=NULL WHERE app_id=1')
  const enabledBefore = fingerprint()
  const enabled = cli('project-reconnection-context', input)
  assert.equal(enabled.auto_deploy_paused, false)
  assert.notEqual(enabled.snapshot_sha256, current.snapshot_sha256)
  cli(
    'project-reconnection-context',
    {
      ...input,
      expected_snapshot_sha256: current.snapshot_sha256
    },
    /PROJECT_RECONNECTION_AUTHORITY_CHANGED/
  )
  assert.equal(fingerprint(), enabledBefore)
  assert.equal(db.prepare('SELECT count(*) n FROM product_deploy_job').get().n, 0)
  db.exec(
    "UPDATE product_app_control SET auto_deploy_paused=1,pause_reason='operator' WHERE app_id=1"
  )
  check(
    'actual_same_UID_CLI_review_keeps_auto_enabled_creates_no_job_and_requires_review_after_policy_drift'
  )
}
