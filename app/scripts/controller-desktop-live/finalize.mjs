/* eslint-disable @typescript-eslint/explicit-function-return-type -- Readonly continuation after verified client revocation. */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** No token enrollment or deploy replay: independently verify the final remote state. */
export async function finalizeRevoked({ directory, nonce, db, cipher, code, ssh, current }) {
  const file = join(directory, 'result.json'),
    result = JSON.parse(readFileSync(file, 'utf8')),
    original = readFileSync(file),
    onboarding = JSON.parse(readFileSync(join(directory, 'onboarding.json'), 'utf8')),
    vault = new code.DesktopControllerVault(db, cipher)
  assert.equal(result.temporary_client_revoked, true)
  assert.equal(onboarding.status, 'PASS')
  assert.equal(result.stage, 'revoke-client-and-final-snapshot')
  assert(
    result.checks.includes(
      'independent_windows_public_http200_and_authenticated_exposure_persistence_preserve_original_demo_pid_key_db_and_paused_policies'
    )
  )
  assert.equal(vault.get(onboarding.binding.binding_id).state, 'disabled')
  const previous = result.after
  for (const key of [
    'receipt_sha256',
    'upgrade_sha256',
    'database_inode',
    'vps_digest',
    'service',
    'files'
  ])
    assert.deepEqual(current[key], previous[key])
  assert.equal(current.active_clients, 0)
  assert.equal(current.active_jobs, 0)
  assert.equal(current.active_experiments, 0)
  const { project, command, exposure } = result
  assert.equal(project.app_name, 'desktop-live-' + nonce.slice(0, 8))
  assert.equal(project.target_vps_id, 1)
  assert.equal(project.host_port, 30001)
  assert(Number.isSafeInteger(project.app_id) && project.app_id > 1)
  assert(
    Number.isSafeInteger(result.app_status.current_deployment_id) &&
      result.app_status.current_deployment_id > 4
  )
  const client = onboarding.binding.remote_client_id
  assert(/^[a-f0-9-]{36}$/.test(client))
  const script = `python3 - <<'PY'
import json,sqlite3
c=sqlite3.connect('file:/var/lib/opspilot-controller/opspilot.db?mode=ro',uri=True);c.row_factory=sqlite3.Row
app_id=${project.app_id};deployment_id=${result.app_status.current_deployment_id};client=${JSON.stringify(client)}
print(json.dumps({'app':dict(c.execute('SELECT id,name,current_deployment_id FROM app WHERE id=?',(app_id,)).fetchone()),
'deployment':dict(c.execute('SELECT id,status,git_commit_sha,exposure_status,exposure_evidence_json FROM deployment WHERE id=?',(deployment_id,)).fetchone()),
'policy':dict(c.execute('SELECT app_id,auto_paused FROM product_desired_branch WHERE app_id=?',(app_id,)).fetchone()),
'client':dict(c.execute('SELECT client_id,revoked_at FROM product_desktop_client WHERE client_id=?',(client,)).fetchone())}))
c.close()
PY`
  const response = await ssh.exec(1, script, {
    logCommand: false,
    retryOnReconnect: false,
    timeoutMs: 20000,
    maxStdoutBytes: 32768,
    maxStderrBytes: 1024
  })
  assert.equal(response.code, 0)
  const observed = JSON.parse(response.stdout)
  assert.equal(observed.app.name, project.app_name)
  assert.equal(observed.app.current_deployment_id, result.app_status.current_deployment_id)
  assert.equal(observed.deployment.status, 'running')
  assert.equal(observed.deployment.git_commit_sha, command.target_sha)
  assert.equal(observed.deployment.exposure_status, 'reachable')
  assert(
    observed.deployment.exposure_evidence_json.includes(exposure.view.observation.observation_id)
  )
  assert.equal(observed.policy.auto_paused, 1)
  assert.equal(observed.client.client_id, client)
  assert(observed.client.revoked_at)
  for (const port of [30000, 30001]) {
    const response = await fetch(`http://167.71.202.116:${port}/health`, {
      redirect: 'error',
      signal: AbortSignal.timeout(10000)
    })
    assert.equal(response.status, 200)
  }
  const history = join(directory, 'failed-before-finalization.json')
  if (!existsSync(history)) writeFileSync(history, original, { flag: 'wx' })
  result.status = 'PASS'
  result.finalization = {
    mode: 'READONLY_AFTER_ALREADY_REVOKED_CLIENT',
    observed,
    snapshot: current,
    reason:
      'Resumed preflight counted the same temporary client; after revocation the active count must be zero, not that pre-revoke count. No GUI reenrollment or deployment replay.'
  }
  result.checks.push(
    'readonly_finalization_confirms_exact_owned_app_deployment_observation_revoked_client_zero_active_clients_and_both_public_health200'
  )
  result.demo_application_retained = true
  result.finalized_after_recorded_harness_failure = true
  delete result.error_code
  delete result.failure_location
  writeFileSync(file, JSON.stringify(result, null, 2) + '\n')
}
