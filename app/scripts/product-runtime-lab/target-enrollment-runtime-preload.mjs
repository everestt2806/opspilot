/* eslint-disable @typescript-eslint/explicit-function-return-type -- Standalone JavaScript integration lab. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const artifact = process.env.OPSPILOT_R1_ARTIFACT
const cli = process.env.OPSPILOT_CONTROLLER_ARTIFACT
const output = process.env.OPSPILOT_TARGET_ENROLL_RUNTIME_RESULT
const readinessCli = process.env.OPSPILOT_CONTROLLER_READINESS_ARTIFACT
if (!artifact || !cli || !output) throw new Error('TARGET_ENROLL_LAB_ENV_REQUIRED')
const require = createRequire(artifact)
const original = require(artifact)
const api = { ...original }
require.cache[require.resolve(artifact)].exports = api
const manifestSha = createHash('sha256')
  .update(readFileSync(join(dirname(cli), 'bundle-manifest.json')))
  .digest('hex')
let initialized = false
let dataDirectory
let controllerId
const enrollments = []
const runtimes = []
let lossRecovered = false
let readinessCalls = 0
let coldRecovered = false
let unknownBlocked = false
let resourceProbes = 0
const readinessInput = readinessCli
  ? {
      format: 1,
      artifact: readinessCli,
      manifest_sha256: createHash('sha256')
        .update(readFileSync(join(dirname(readinessCli), 'bundle-manifest.json')))
        .digest('hex')
    }
  : null
const recoverCold = () =>
  JSON.parse(
    execFileSync(process.execPath, [readinessCli, 'recover-runtime', '--data-dir', dataDirectory], {
      input: JSON.stringify(readinessInput),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 60000
    })
  )
const containerIdentity = (name) => {
  const value = JSON.parse(
    execFileSync('docker', ['container', 'inspect', name], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
  )[0]
  return [value.Id, value.Image, value.State.StartedAt, value.RestartCount]
}

api.ProductDeployRepository = class extends original.ProductDeployRepository {
  constructor(database) {
    super(database)
    if (initialized) return
    initialized = true
    dataDirectory = dirname(database.name)
    chmodSync(dataDirectory, 0o700)
    chmodSync(database.name, 0o600)
    controllerId = database
      .prepare('SELECT controller_id FROM product_controller')
      .get().controller_id
    writeFileSync(
      join(dataDirectory, '.product-controller-initialized'),
      JSON.stringify({ format: 1, controller_id: controllerId }),
      { mode: 0o600 }
    )
    original.initializeControllerSecretKey(dataDirectory)
    const target = database
      .prepare(
        `SELECT id AS vps_id,host,port,username,auth_type,host_fingerprint,
      ssh_security_revision FROM vps WHERE id=1`
      )
      .get()
    // Chỉ bootstrap fixture credential đã sinh trong private scratch, không đọc Desktop/user DB.
    const encrypted = original.encryptControllerCredential(
      original.loadControllerCredentialCipher(dataDirectory),
      { controller_id: controllerId, target },
      readFileSync(join(dirname(dataDirectory), 'client'), 'utf8')
    )
    database
      .prepare('UPDATE vps SET crypto_scheme=?,encrypted_secret=?,iv=?,auth_tag=? WHERE id=1')
      .run(encrypted.crypto_scheme, encrypted.encrypted_secret, encrypted.iv, encrypted.auth_tag)
    database
      .prepare(
        "UPDATE product_app_control SET auto_deploy_paused=1,pause_reason='operator',pause_policy_provenance='explicit'"
      )
      .run()
    for (const { app_id, ownership_generation } of database
      .prepare('SELECT app_id,ownership_generation FROM product_app_control ORDER BY app_id')
      .all()) {
      const input = {
        format: 1,
        controller_id: controllerId,
        app_id,
        ownership_generation,
        artifact: cli,
        manifest_sha256: manifestSha,
        target_root: join(dirname(dataDirectory), 'production-targets')
      }
      const final = join(
        input.target_root,
        `controller-${createHash('sha256').update(controllerId).digest('hex')}-app-${app_id}`
      )
      const appHash = createHash('sha256').update(String(app_id)).digest('hex')
      const files = [
        'enrollment.json',
        'release-manifest.json',
        'helpers/target_execution_guard.py',
        'helpers/target_guarded_ssh_helper.py',
        'helpers/target_product_runtime.py',
        `state/${appHash}.json`,
        `state/h2-${appHash}-g${ownership_generation}.key`
      ]
      let before
      if (app_id === 1) {
        let exited = false
        try {
          execFileSync(
            process.execPath,
            [join(import.meta.dirname, 'target-enrollment-loss.mjs'), dataDirectory],
            {
              input: JSON.stringify(input),
              encoding: 'utf8',
              stdio: ['pipe', 'pipe', 'pipe'],
              timeout: 30000
            }
          )
        } catch (error) {
          assert.equal(error.status, 73)
          assert.equal(error.stdout.trim(), 'INJECTED_EXIT_AFTER_TARGET_RESPONSE')
          exited = true
        }
        assert.equal(exited, true)
        assert.equal(
          database.prepare('SELECT state FROM product_target_enrollment WHERE app_id=1').get()
            .state,
          'unknown'
        )
        before = files.map((name) => {
          const path = join(final, name)
          const info = statSync(path)
          return [
            name,
            info.ino,
            info.mtimeMs,
            createHash('sha256').update(readFileSync(path)).digest('hex')
          ]
        })
      }
      const result = JSON.parse(
        execFileSync(process.execPath, [cli, 'enroll-target', '--data-dir', dataDirectory], {
          input: JSON.stringify(input),
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 30000
        })
      )
      writeFileSync(output, JSON.stringify({ stage: 'bootstrap', app_id, state: result.state }))
      assert.equal(result.state, 'enrolled')
      if (before) {
        assert.deepEqual(
          files.map((name) => {
            const path = join(final, name)
            const info = statSync(path)
            return [
              name,
              info.ino,
              info.mtimeMs,
              createHash('sha256').update(readFileSync(path)).digest('hex')
            ]
          }),
          before
        )
        lossRecovered = true
      }
      const installed = original.readEnrolledProductTarget(
        database,
        dataDirectory,
        controllerId,
        app_id,
        ownership_generation,
        manifestSha
      )
      assert.equal(installed.helper_path, result.helper_path)
      enrollments.push({ app_id, state: result.state, manifest_verified: true })
    }
    database
      .prepare(
        "UPDATE product_app_control SET auto_deploy_paused=0,pause_reason=NULL,pause_policy_provenance='explicit'"
      )
      .run()
  }
}

api.executeProductDeployPipeline = async (
  database,
  legacyVerifier,
  repository,
  _legacySsh,
  snapshot,
  options
) => {
  const claim = snapshot.claim
  if (readinessCli && ++readinessCalls === 1) {
    assert.notEqual(
      readinessInput.manifest_sha256,
      manifestSha,
      'historical target pin must differ from current management release'
    )
    const recovery = recoverCold()
    assert.equal(recovery.state, 'ready')
    assert.equal(recovery.inspected_enrollments, 2)
    assert.equal(recovery.recovered_terminals, 0)
    const admission = new original.ControllerResourceAdmission(
      dataDirectory,
      () => recovery.state === 'ready'
    )
    assert.equal(admission.check(new AbortController().signal).state, 'ready')
  }
  const installed = original.readEnrolledProductTarget(
    database,
    dataDirectory,
    controllerId,
    claim.app_id,
    claim.ownership_generation,
    manifestSha
  )
  const key = original.loadControllerRuntimeKey(dataDirectory, claim)
  legacyVerifier.secret.fill(0)
  legacyVerifier.secret = Buffer.from(key)
  key.fill(0)
  process.env.OPSPILOT_TEMPLATES_DIR = join(dirname(cli), 'templates')
  const ssh = new original.SshManager(
    original.createControllerSshResolver(database, controllerId, dataDirectory)
  )
  let cleanupCalls = 0
  const admission = readinessCli
    ? new original.ControllerTargetAdmission(database, dataDirectory, controllerId, ssh)
    : null
  let interrupted = false
  const realFinalize = original.ProductRuntimeRepository.prototype.finalize
  const realOpen = ssh.openGuardedExecutionChannelWithIdentity.bind(ssh)
  if (readinessCli && readinessCalls === 2) {
    original.ProductRuntimeRepository.prototype.finalize = function (...args) {
      realFinalize.apply(this, args)
      interrupted = true
      throw Object.assign(new Error('SIMULATED_LOSS_AFTER_T1'), { code: 'SIMULATED_LOSS_AFTER_T1' })
    }
    ssh.openGuardedExecutionChannelWithIdentity = async (...args) => {
      if (interrupted) throw new Error('SIMULATED_CONTROLLER_OFFLINE')
      return realOpen(...args)
    }
  }
  const router = new original.ControllerRuntimeExecutorRouter({
    database,
    repository,
    ssh,
    secretDirectory: dataDirectory,
    ...(admission
      ? {
          admitTarget: async (claim, signal) => {
            const decision = await admission.check(claim, signal)
            assert.equal(
              decision.state,
              'ready',
              `resource admission for runtime ${readinessCalls}`
            )
            resourceProbes++
            return decision
          }
        }
      : {}),
    targetOptions: () => ({
      ...options,
      target_helper_path: installed.helper_path,
      target_state_root: installed.state_root,
      // Ca lỗi cuối cố ý dùng Dockerfile hỏng của fixture; sáu ca thường dùng packaged collector.
      collector_directory:
        options.collector_directory === join(dirname(dataDirectory), 'broken-collector')
          ? options.collector_directory
          : join(dirname(cli), 'collector')
    }),
    prepareSnapshot: async () => ({
      ...snapshot,
      cleanup() {
        cleanupCalls += 1
      }
    })
  })
  let result
  try {
    result = await router.execute(claim, new AbortController().signal)
  } finally {
    original.ProductRuntimeRepository.prototype.finalize = realFinalize
    ssh.openGuardedExecutionChannelWithIdentity = realOpen
    await ssh.disconnectAll()
  }
  if (interrupted) {
    assert.equal(result.state, 'dispatch_marker_committed')
    const name = database.prepare('SELECT name FROM app WHERE id=?').get(claim.app_id).name
    const before = [containerIdentity(name + '-app'), containerIdentity(name + '-collector')]
    const terminal = original
      .openControllerRuntimeRepository(database, dataDirectory, claim)
      .getTerminal(claim.attempt_id)
    assert.equal(terminal.leases_released_at, null)
    const response = recoverCold()
    assert.equal(response.state, 'ready')
    assert.equal(response.recovered_terminals, 1)
    assert.deepEqual(
      [containerIdentity(name + '-app'), containerIdentity(name + '-collector')],
      before
    )
    assert.equal(recoverCold().recovered_terminals, 0)
    const settled = original
      .openControllerRuntimeRepository(database, dataDirectory, claim)
      .getTerminal(claim.attempt_id)
    assert.ok(settled.leases_released_at)
    result = {
      state: 'runtime_settled',
      attempt_id: claim.attempt_id,
      commit_id: settled.commit_id,
      outcome: settled.envelope.receipt.outcome
    }
    coldRecovered = true
  } else if (readinessCli && result.state === 'dispatch_marker_committed') {
    const before = database
      .prepare('SELECT released_at FROM product_app_lease WHERE lease_id=?')
      .get(claim.app_lease_id)
    const response = recoverCold()
    assert.equal(response.state, 'reconciliation_required')
    assert.ok(
      response.blockers.some(
        (b) => b.reason === 'preterminal_unknown' && b.attempt_id === claim.attempt_id
      )
    )
    assert.deepEqual(
      database
        .prepare('SELECT released_at FROM product_app_lease WHERE lease_id=?')
        .get(claim.app_lease_id),
      before
    )
    unknownBlocked = true
  }
  runtimes.push({ state: result.state, outcome: result.outcome })
  assert.equal(cleanupCalls, 1)
  writeFileSync(
    output,
    JSON.stringify({
      stage: 'runtime',
      enrollments,
      runtimes,
      installed_helpers: true,
      controller_process_loss_recovered: lossRecovered,
      cold_startup_terminal_recovered: coldRecovered,
      historical_release_preserved: !!readinessCli,
      preterminal_unknown_blocked: unknownBlocked,
      resource_probes: resourceProbes,
      packaged_templates_collector: true,
      no_fixture_initializer_in_subject: true
    })
  )
  if (result.state === 'dispatch_marker_committed')
    throw Object.assign(new Error('SSH_RUNTIME_UNKNOWN'), { code: 'SSH_RUNTIME_UNKNOWN' })
  assert.equal(result.state, 'runtime_settled')
  assert.equal(router.verifyCompletion(claim, result), true)
  const terminal = original
    .openControllerRuntimeRepository(database, dataDirectory, claim)
    .getTerminal(claim.attempt_id)
  return {
    state: terminal.envelope.receipt.outcome,
    terminal,
    context: terminal.envelope.receipt.context,
    deployment_id: terminal.envelope.receipt.context.deployment_id,
    ...(terminal.envelope.receipt.failed_step
      ? { failed_step: terminal.envelope.receipt.failed_step }
      : {})
  }
}
