import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const artifact = process.env.OPSPILOT_R1_ARTIFACT
const output = process.env.OPSPILOT_KEY_ROUTER_RESULT
if (!artifact || !output) throw new Error('KEY_ROUTER_LAB_ENV_REQUIRED')
const require = createRequire(artifact)
const original = require(artifact)
const api = { ...original }
require.cache[require.resolve(artifact)].exports = api
const enrolled = new Set()
const results = []
const useBoundSsh = process.env.OPSPILOT_KEY_ROUTER_BOUND_SSH === '1'
const boundProfiles = new Set()
let boundSshConnections = 0
let secretDirectory
let comparisonKey
let coldPendingVerified = false
let nextGenerationRetained = false

api.executeProductDeployPipeline = async (
  db,
  legacyVerifier,
  repository,
  ssh,
  snapshot,
  options
) => {
  const claim = snapshot.claim
  const scratch = dirname(dirname(options.target_helper_path))
  if (!secretDirectory) {
    secretDirectory = join(scratch, 'router-secrets')
    mkdirSync(secretDirectory, { mode: 0o700 })
    original.initializeControllerSecretKey(secretDirectory)
  }
  const identity = `${claim.controller_id}:${claim.app_id}:${claim.ownership_generation}`
  const stateRoot = join(
    scratch,
    'router-target',
    `app-${claim.app_id}-g${claim.ownership_generation}`
  )
  let material
  try {
    // Explicit lab provisioning before the first mutation for this app/generation.
    // Existing R1's target enrollment remains unused; normal target helpers are unchanged.
    if (!enrolled.has(identity)) {
      material = original.createControllerRuntimeKey(secretDirectory, claim)
      if (comparisonKey) assert.notDeepEqual(material, comparisonKey)
      else comparisonKey = Buffer.from(material)
      execFileSync(
        'python3',
        [
          '-c',
          [
            'from target_execution_guard import initialize_enrollment',
            'from target_product_runtime import initialize_runtime_enrollment',
            'import sys',
            'initialize_enrollment(sys.argv[1],sys.argv[2],sys.argv[3],int(sys.argv[4]))',
            'initialize_runtime_enrollment(sys.argv[1],sys.argv[2],sys.argv[3],int(sys.argv[4]),sys.stdin.buffer.read())'
          ].join(';'),
          stateRoot,
          claim.controller_id,
          String(claim.app_id),
          String(claim.ownership_generation)
        ],
        {
          input: material,
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 10000,
          env: {
            ...process.env,
            PYTHONPATH: dirname(options.target_helper_path),
            PYTHONDONTWRITEBYTECODE: '1'
          }
        }
      )
      enrolled.add(identity)
    } else material = original.loadControllerRuntimeKey(secretDirectory, claim)

    // Compatibility for R1's legacy assertion reader only. The execution router below
    // loads its own repository/key per claim; no receipt or response is synthesized.
    legacyVerifier.secret.fill(0)
    legacyVerifier.secret = Buffer.from(material)
  } finally {
    material?.fill(0)
  }

  let ownedSsh
  if (useBoundSsh) {
    const target = db
      .prepare(
        `SELECT id AS vps_id, host, port, username, auth_type, host_fingerprint,
                ssh_security_revision FROM vps WHERE id=?`
      )
      .get(options.vps_id)
    if (!boundProfiles.has(target.vps_id)) {
      // Lab-only enrollment of its generated client key; no Desktop or user profile is read.
      const fixture = await ssh.resolver(target.vps_id)
      const encrypted = original.encryptControllerCredential(
        original.loadControllerCredentialCipher(secretDirectory),
        { controller_id: claim.controller_id, target },
        fixture.secret
      )
      db.prepare(
        'UPDATE vps SET crypto_scheme=?, encrypted_secret=?, iv=?, auth_tag=? WHERE id=?'
      ).run(
        encrypted.crypto_scheme,
        encrypted.encrypted_secret,
        encrypted.iv,
        encrypted.auth_tag,
        target.vps_id
      )
      boundProfiles.add(target.vps_id)
    }
    ownedSsh = new original.SshManager(
      original.createControllerSshResolver(db, claim.controller_id, secretDirectory)
    )
    try {
      await ownedSsh.connect(target.vps_id)
      assert.ok(ownedSsh.getVerifiedHostKey(target.vps_id))
    } catch (error) {
      await ownedSsh.disconnectAll()
      throw error
    }
    boundSshConnections += 1
  }

  let cleanupCalls = 0
  const router = new original.ControllerRuntimeExecutorRouter({
    database: db,
    repository,
    ssh: ownedSsh ?? ssh,
    secretDirectory,
    targetOptions: () => ({ ...options, target_state_root: stateRoot }),
    prepareSnapshot: async (_repository, token) => {
      assert.equal(token.attempt_id, claim.attempt_id)
      return {
        ...snapshot,
        cleanup() {
          cleanupCalls += 1
        }
      }
    }
  })
  const realFinalize = original.ProductRuntimeRepository.prototype.finalize
  let runtimeAtCommit
  original.ProductRuntimeRepository.prototype.finalize = function (envelope) {
    const terminal = realFinalize.call(this, envelope)
    if (
      !coldPendingVerified &&
      claim.app_id === 1 &&
      envelope.receipt.context.deployment_id === 2
    ) {
      const futureKey = original.createControllerRuntimeKey(secretDirectory, {
        ...claim,
        ownership_generation: claim.ownership_generation + 1
      })
      try {
        assert.notDeepEqual(futureKey, comparisonKey)
      } finally {
        futureKey.fill(0)
      }
      const historical = original.openControllerRuntimeRepository(db, secretDirectory, claim)
      const pending = historical.getTerminal(claim.attempt_id)
      assert.equal(pending.leases_released_at, null)
      assert.equal(
        historical.commitAttestation(claim.attempt_id).payload.commit_id,
        terminal.commit_id
      )
      const oldKey = original.loadControllerRuntimeKey(secretDirectory, claim)
      try {
        assert.deepEqual(oldKey, comparisonKey)
      } finally {
        oldKey.fill(0)
      }
      const app = db.prepare('SELECT name FROM app WHERE id=?').get(claim.app_id)
      const container = JSON.parse(
        execFileSync('docker', ['container', 'inspect', `${app.name}-app`], {
          encoding: 'utf8',
          stdio: 'pipe',
          timeout: 15000
        })
      )[0]
      runtimeAtCommit = { id: container.Id, started: container.State.StartedAt }
      coldPendingVerified = true
      nextGenerationRetained = true
      // Real T1 is durable; interrupt before ACK, then the production adapter recovers.
      throw Object.assign(new Error('KEY_ROUTER_AFTER_T1'), { code: 'KEY_ROUTER_AFTER_T1' })
    }
    return terminal
  }
  let result
  try {
    result = await router.execute(claim, new AbortController().signal)
  } finally {
    original.ProductRuntimeRepository.prototype.finalize = realFinalize
    await ownedSsh?.disconnectAll()
  }
  if (runtimeAtCommit) {
    const app = db.prepare('SELECT name FROM app WHERE id=?').get(claim.app_id)
    const container = JSON.parse(
      execFileSync('docker', ['container', 'inspect', `${app.name}-app`], {
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 15000
      })
    )[0]
    assert.deepEqual({ id: container.Id, started: container.State.StartedAt }, runtimeAtCommit)
  }
  assert.equal(cleanupCalls, 1)
  if (result.state === 'dispatch_marker_committed') {
    results.push({ state: result.state, no_retry: true })
    writeFileSync(
      output,
      JSON.stringify({
        scope: 'REAL_PER_APP_KEY_ROUTER',
        results,
        enrolled_scopes: enrolled.size,
        bound_ssh_connections: boundSshConnections,
        cold_pending_t1_verified: coldPendingVerified,
        historical_generation_retained: nextGenerationRetained
      })
    )
    comparisonKey?.fill(0)
    throw Object.assign(new Error('SSH_RUNTIME_UNKNOWN'), { code: 'SSH_RUNTIME_UNKNOWN' })
  }
  assert.equal(result.state, 'runtime_settled')
  assert.equal(router.verifyCompletion(claim, result), true)
  assert.equal(
    router.verifyCompletion(
      { ...claim, ownership_generation: claim.ownership_generation + 1 },
      result
    ),
    false
  )
  assert.equal(router.verifyCompletion(claim, { ...result, commit_id: 'wrong' }), false)
  const cold = original.openControllerRuntimeRepository(db, secretDirectory, claim)
  const terminal = cold.getTerminal(claim.attempt_id)
  assert.ok(terminal.leases_released_at)
  assert.equal(
    terminal.envelope.receipt.context.claim.ownership_generation,
    claim.ownership_generation
  )
  results.push({
    state: result.state,
    outcome: result.outcome,
    exact_key_verified: true,
    generation_mismatch_rejected: true,
    cold_record_verified: true
  })
  writeFileSync(
    output,
    JSON.stringify({
      scope: 'REAL_PER_APP_KEY_ROUTER',
      results,
      enrolled_scopes: enrolled.size,
      bound_ssh_connections: boundSshConnections,
      cold_pending_t1_verified: coldPendingVerified,
      historical_generation_retained: nextGenerationRetained
    })
  )
  const receipt = terminal.envelope.receipt
  return {
    state: receipt.outcome,
    terminal,
    context: receipt.context,
    deployment_id: receipt.context.deployment_id,
    ...(receipt.failed_step ? { failed_step: receipt.failed_step } : {})
  }
}
