import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const artifact = process.env.OPSPILOT_R1_ARTIFACT
const output = process.env.OPSPILOT_R3_RESULT
if (!artifact || !output) throw new Error('R3_LAB_ENV_REQUIRED')
const require = createRequire(artifact)
const original = require(artifact)
const api = { ...original }
require.cache[require.resolve(artifact)].exports = api
const results = []
api.executeProductDeployPipeline = async (db, runtime, repository, ssh, snapshot, options) => {
  let cleanupCalls = 0
  const adapter = new original.ProductRuntimeExecutor({
    database: db,
    runtimeRepository: runtime,
    repository,
    ssh,
    targetOptions: () => options,
    prepareSnapshot: async (_repository, claim) => {
      assert.equal(claim.attempt_id, snapshot.claim.attempt_id)
      return {
        ...snapshot,
        cleanup() {
          cleanupCalls += 1
        }
      }
    }
  })
  const result = await adapter.execute(snapshot.claim, new AbortController().signal)
  assert.equal(cleanupCalls, 1)
  if (result.state === 'dispatch_marker_committed') {
    results.push({ state: result.state, cleanup_calls: cleanupCalls, no_retry: true })
    writeFileSync(
      output,
      JSON.stringify({ scope: 'REAL_RUNTIME_EXECUTOR_ADAPTER', results }, null, 2)
    )
    throw Object.assign(new Error('SSH_RUNTIME_UNKNOWN'), { code: 'SSH_RUNTIME_UNKNOWN' })
  }
  assert.equal(result.state, 'runtime_settled')
  assert.equal(adapter.verifyCompletion(snapshot.claim, result), true)
  assert.equal(
    adapter.verifyCompletion(snapshot.claim, { ...result, commit_id: 'wrong-commit' }),
    false
  )
  assert.equal(
    adapter.verifyCompletion(snapshot.claim, { ...result, attempt_id: 'wrong-attempt' }),
    false
  )
  const terminal = runtime.getTerminal(snapshot.claim.attempt_id)
  const receipt = terminal.envelope.receipt
  results.push({
    state: result.state,
    outcome: result.outcome,
    commit_id: result.commit_id,
    cleanup_calls: cleanupCalls,
    persisted_proof_verified: true,
    forged_reference_rejected: true
  })
  writeFileSync(
    output,
    JSON.stringify({ scope: 'REAL_RUNTIME_EXECUTOR_ADAPTER', results }, null, 2)
  )
  return {
    state: receipt.outcome,
    terminal,
    context: receipt.context,
    deployment_id: receipt.context.deployment_id,
    ...(receipt.failed_step ? { failed_step: receipt.failed_step } : {})
  }
}
