/* eslint-disable @typescript-eslint/explicit-function-return-type -- Fault injection in isolated integration lab. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const artifact = process.env.OPSPILOT_R1_ARTIFACT
const scenario = process.env.OPSPILOT_R2_SCENARIO
const output = process.env.OPSPILOT_R2_RESULT
if (!artifact || !scenario || !output) throw new Error('R2_ENV_REQUIRED')
const require = createRequire(artifact)
const original = require(artifact)
const api = { ...original }
require.cache[require.resolve(artifact)].exports = api
const Database = require('better-sqlite3')
let calls = 0
const injected = () => Object.assign(new Error('R2_INJECTED_CRASH'), { code: 'R2_INJECTED_CRASH' })
const done = () =>
  Object.assign(new Error('R2_CHECKPOINT_FINISHED'), { code: 'R2_CHECKPOINT_FINISHED' })
const inspect = (name) =>
  JSON.parse(
    execFileSync('docker', ['container', 'inspect', name], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000
    })
  )[0]

api.executeProductDeployPipeline = async (db, runtime, deploys, ssh, snapshot, options) => {
  if (++calls !== 2)
    return original.executeProductDeployPipeline(db, runtime, deploys, ssh, snapshot, options)
  const candidateId = db.prepare('SELECT COALESCE(MAX(id),0)+1 AS id FROM deployment').get().id
  const attempt = snapshot.claim.attempt_id
  const appName = db.prepare('SELECT name FROM app WHERE id=?').get(snapshot.claim.app_id).name
  const markerPath = join(
    options.target_state_root,
    `${createHash('sha256').update(String(snapshot.claim.app_id)).digest('hex')}.json`
  )
  const realFinalize = runtime.finalize.bind(runtime)
  const realComplete = runtime.completeSettlement.bind(runtime)
  const realOpen = ssh.openGuardedExecutionChannelWithIdentity.bind(ssh)
  const targetFault = ['after-seal', 'after-ack', 'after-idle'].includes(scenario)
  const faultOptions = { ...options }
  if (targetFault) {
    const helperDirectory = dirname(options.target_helper_path)
    copyFileSync(
      join(import.meta.dirname, 'recovery-target.py'),
      join(helperDirectory, 'recovery-target.py')
    )
    writeFileSync(
      join(helperDirectory, 'recovery-fault.json'),
      JSON.stringify({
        scenario,
        deployment_id: candidateId,
        attempt_id: attempt
      }),
      { mode: 0o600 }
    )
    faultOptions.target_helper_path = join(helperDirectory, 'recovery-target.py')
  }
  if (scenario === 'before-seal') {
    ssh.openGuardedExecutionChannelWithIdentity = async (...args) => {
      const opened = await realOpen(...args)
      const write = opened.channel.write.bind(opened.channel)
      opened.channel.write = (chunk, ...rest) => {
        if (
          Buffer.isBuffer(chunk) &&
          chunk.length >= 4 &&
          chunk.readUInt32BE(0) === chunk.length - 4
        ) {
          const request = JSON.parse(chunk.subarray(4).toString('utf8'))
          if (request.operation === 'seal_runtime') {
            opened.channel.destroy()
            return false
          }
        }
        return write(chunk, ...rest)
      }
      return opened
    }
  }
  runtime.finalize = (envelope) => {
    const result = realFinalize(envelope)
    if (scenario === 'expired-t1') {
      const expired = new Date(Date.now() - 1000).toISOString()
      db.prepare('UPDATE product_app_lease SET expires_at=? WHERE lease_id=?').run(
        expired,
        snapshot.claim.app_lease_id
      )
      db.prepare('UPDATE product_worker_lease SET expires_at=? WHERE lease_id=?').run(
        expired,
        snapshot.claim.build_slot_lease_id
      )
    }
    if (scenario === 'changed-pin')
      db.prepare(
        'UPDATE vps SET host_fingerprint=?,ssh_security_revision=ssh_security_revision+1 WHERE id=1'
      ).run(`SHA256:${'A'.repeat(43)}`)
    if (['after-t1', 'expired-t1', 'changed-pin', 'stale-fence'].includes(scenario))
      throw injected()
    return result
  }
  runtime.completeSettlement = (...args) => {
    const result = realComplete(...args)
    if (scenario === 'after-t2') throw injected()
    return result
  }
  let error
  try {
    await original.executeProductDeployPipeline(db, runtime, deploys, ssh, snapshot, faultOptions)
  } catch (caught) {
    error = caught
  } finally {
    runtime.finalize = realFinalize
    runtime.completeSettlement = realComplete
    ssh.openGuardedExecutionChannelWithIdentity = realOpen
  }
  assert.ok(error, 'fault must actually interrupt the real pipeline')
  await ssh.disconnectAll()
  const before = inspect(`${appName}-app`)
  const collectorBefore = inspect(`${appName}-collector`)
  const markerBefore = JSON.parse(readFileSync(markerPath, 'utf8'))
  const terminalBefore = runtime.getTerminal(attempt)
  const coldDb = new Database(db.name)
  coldDb.pragma('foreign_keys = ON')
  const cold = new original.ProductRuntimeRepository(coldDb, { secret: runtime.secret })
  const result = {
    scenario,
    status: 'PASS',
    pipeline_interrupted: true,
    observed_code: error.code,
    cold_sqlite_connection: true,
    no_runtime_replay: false
  }
  try {
    if (['before-seal', 'after-seal'].includes(scenario)) {
      assert.equal(terminalBefore, null)
      assert.equal(markerBefore.execution_state, 'unknown')
      assert.equal(
        coldDb.prepare('SELECT current_deployment_id AS id FROM app WHERE id=1').get().id,
        1
      )
      assert.equal(
        coldDb
          .prepare('SELECT state FROM deployment_activation WHERE deployment_id=?')
          .get(candidateId).state,
        'prepared'
      )
      assert.equal(
        coldDb
          .prepare('SELECT released_at FROM product_app_lease WHERE lease_id=?')
          .get(snapshot.claim.app_lease_id).released_at,
        null
      )
      assert.equal(
        existsSync(
          join(options.target_state_root, 'product-runtime', `deployment-${candidateId}.json`)
        ),
        scenario === 'after-seal'
      )
      await assert.rejects(
        original.recoverProductRuntimeSession(cold, ssh, snapshot, faultOptions),
        (caught) => caught.code === 'SSH_SETTLEMENT_REJECTED'
      )
      result.outcome = 'unknown_without_t1_requires_reconciliation'
    } else if (['changed-pin', 'stale-fence'].includes(scenario)) {
      assert.ok(terminalBefore)
      assert.equal(terminalBefore.leases_released_at, null)
      if (scenario === 'stale-fence') {
        const marker = JSON.parse(readFileSync(markerPath, 'utf8'))
        marker.highest_accepted_fence += 1
        writeFileSync(markerPath, JSON.stringify(marker), { mode: 0o600 })
      }
      await assert.rejects(original.recoverProductRuntimeSession(cold, ssh, snapshot, faultOptions))
      assert.equal(cold.getTerminal(attempt).leases_released_at, null)
      result.outcome = 'stale_authority_rejected'
    } else {
      assert.ok(terminalBefore)
      if (scenario === 'after-t2') assert.ok(terminalBefore.leases_released_at)
      else assert.equal(terminalBefore.leases_released_at, null)
      if (['after-ack', 'after-idle'].includes(scenario))
        assert.ok(
          existsSync(
            join(options.target_state_root, 'product-runtime', `settled-${candidateId}.json`)
          )
        )
      if (scenario === 'after-idle') assert.equal(markerBefore.execution_state, 'idle')
      if (scenario === 'after-ack') assert.equal(markerBefore.execution_state, 'unknown')
      if (scenario === 'expired-t1') {
        const expiry = coldDb
          .prepare('SELECT expires_at FROM product_app_lease WHERE lease_id=?')
          .get(snapshot.claim.app_lease_id).expires_at
        assert.ok(Date.parse(expiry) < Date.now())
        result.expiry = 'forced_past_in_scratch_db'
      }
      const recovered = await original.recoverProductRuntimeSession(
        cold,
        ssh,
        snapshot,
        faultOptions
      )
      assert.equal(recovered.state, scenario === 'after-t2' ? 'already_settled' : 'settled')
      assert.ok(cold.getTerminal(attempt).leases_released_at)
      assert.equal(
        (await original.recoverProductRuntimeSession(cold, ssh, snapshot, faultOptions)).state,
        'already_settled'
      )
      assert.equal(JSON.parse(readFileSync(markerPath, 'utf8')).execution_state, 'idle')
      assert.equal(
        coldDb.prepare('SELECT current_deployment_id AS id FROM app WHERE id=1').get().id,
        candidateId
      )
      result.outcome = recovered.state
    }
    const after = inspect(`${appName}-app`)
    assert.equal(after.Id, before.Id)
    assert.equal(after.Image, before.Image)
    assert.equal(after.State.StartedAt, before.State.StartedAt)
    assert.equal(after.RestartCount, before.RestartCount)
    const collectorAfter = inspect(`${appName}-collector`)
    assert.equal(collectorAfter.Id, collectorBefore.Id)
    assert.equal(collectorAfter.Image, collectorBefore.Image)
    assert.equal(collectorAfter.State.StartedAt, collectorBefore.State.StartedAt)
    assert.equal(
      after.Config.Labels['org.opencontainers.image.revision'],
      snapshot.metadata.commitSha
    )
    assert.equal(coldDb.prepare('SELECT COUNT(*) AS n FROM deployment').get().n, 2)
    assert.equal(
      coldDb
        .prepare('SELECT COUNT(*) AS n FROM product_deploy_attempt WHERE attempt_id=?')
        .get(attempt).n,
      1
    )
    assert.deepEqual(coldDb.prepare('PRAGMA foreign_key_check').all(), [])
    result.no_runtime_replay = true
    result.container_id = before.Id
    result.collector_container_id = collectorBefore.Id
    result.source_sha = snapshot.metadata.commitSha
    writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
  } finally {
    coldDb.close()
  }
  // R1's cleanup still runs. Its deliberately interrupted child report is not a failed R2 assertion.
  throw done()
}
