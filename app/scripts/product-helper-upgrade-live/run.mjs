/* eslint-disable @typescript-eslint/explicit-function-return-type -- Dedicated private operator acceptance. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { journalKey } from '../controller-upgrade-live/journal-key.mjs'
import { privateInput } from '../product-environment-live/input.mjs'
import { helperSnapshotCommand } from './snapshot.mjs'
import { helperRelay } from './relay.mjs'

const args = process.argv.slice(2),
  fresh = args.join(' ') === '--start'
assert(fresh || (args[0] === '--resume' && /^[a-f0-9]{12}$/.test(args[1])))
const appOperation = args[2],
  appOperationId = Number(args[3])
assert(
  fresh ||
    args.length === 2 ||
    (args.length === 3 &&
      ['--transfer-controller', '--recover-controller'].includes(appOperation)) ||
    (args.length === 4 &&
      ['--recover-app', '--cancel-app'].includes(appOperation) &&
      appOperationId >= 1 &&
      appOperationId <= 4)
)
const project = resolve(import.meta.dirname, '../..'),
  require = createRequire(join(project, 'package.json')),
  nonce = fresh ? randomBytes(6).toString('hex') : args[1],
  directory = join(project, '.out-scripts/product-helper-upgrade-live', nonce),
  local = join(directory, 'private-profile'),
  controller = 'dc586bb7-cd83-484c-b036-e5ad40ec106d',
  installation = '7573f0b1-4262-4305-8b7d-9a1edce49626',
  parent = 'eb08d06756bd635ae332e8afd6cd6791e89dff94aef0ae763223d274848db7cf',
  candidateId = 'linux-x64-node22-20261116-helper-upgrade',
  candidatePin = '3782655ddd14e5b88e6fff592cf7415e5652b4c0562af68866b4fd0eae2fadf0',
  payloadPin = '5b876a1a55c776722e0f440b4d67bedb45d7ef6118eb203245f5a943c174c029',
  pin = 'SHA256:0X8J5LfPr6iZqEspsD379FvFEWrLfYpN0wfNYjQ87+E',
  runtimePin = 'f591e2f4bd8b1a770204af8645c499ba05955090a32464c1ae5c32dd37443cb5',
  sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
let evidence,
  config,
  database,
  ssh,
  phase = 'input'
const save = () =>
  writeFileSync(
    join(directory, 'result.json'),
    JSON.stringify({ ...evidence, phase }, null, 2) + '\n',
    { flush: true }
  )
const progress = (value) => {
  phase = value
  save()
  console.log(JSON.stringify({ record: nonce, phase }))
}
const check = (name) => {
  if (!evidence.checks.includes(name)) evidence.checks.push(name)
  save()
}
const codeOf = (error) => {
  for (const value of [error?.context?.cause?.message, error?.code, error?.message])
    if (typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,90}$/.test(value)) return value
  return error?.name === 'AssertionError' ? 'ASSERTION_FAILED' : 'HELPER_ROLLOUT_FAILED'
}
const quiescent = (value, allowClient = false) => {
  for (const name of [
    'active_jobs',
    'active_experiments',
    'app_leases',
    'worker_leases',
    'unsettled_terminals',
    'prepared_activations'
  ])
    assert.equal(value[name], 0)
  if (!allowClient) assert.equal(value.active_clients, 0)
  assert(
    value.owners.every((row) => row.controller_id === controller && row.auto_deploy_paused === 1)
  )
  assert(value.desired.every((row) => row.auto_paused === 1))
  assert(value.service.includes('ActiveState=active'))
}
const preserved = (after) => {
  const before = evidence.before
  for (const name of [
    'receipt_sha256',
    'database_inode',
    'vps_digest',
    'files',
    'content_digest',
    'apps',
    'containers',
    'owners',
    'desired'
  ])
    assert.deepEqual(after[name], before[name])
  assert.equal(after.schema, 35)
  assert.equal(after.receipt.controller_id, controller)
  assert.equal(after.receipt.request_key, installation)
  assert.equal(after.receipt.uid, 997)
  assert.equal(after.helpers.length, 6)
  for (const original of before.helpers) {
    const current = after.helpers.find(
      (item) => item.enrollment.app_id === original.enrollment.app_id
    )
    assert(current)
    const withoutPin = (row) => {
      const stable = { ...row }
      delete stable.manifest_sha256
      return stable
    }
    assert.deepEqual(withoutPin(current.enrollment), withoutPin(original.enrollment))
    assert.deepEqual(current.directories, original.directories)
    const protectedFiles = (files) =>
      files.filter(
        (file) =>
          file.path.startsWith('state/') ||
          file.path.startsWith('../.enroll-') ||
          ['helpers/target_execution_guard.py', 'helpers/target_guarded_ssh_helper.py'].includes(
            file.path
          )
      )
    assert.deepEqual(protectedFiles(current.files), protectedFiles(original.files))
  }
}
try {
  if (fresh) {
    config = await privateInput()
    assert(
      config.host === '167.71.202.116' &&
        config.username === 'root' &&
        config.port === 22 &&
        config.host_fingerprint === pin &&
        typeof config.password === 'string' &&
        config.password
    )
    mkdirSync(local, { recursive: true })
    writeFileSync(join(directory, '.owner'), nonce, { flag: 'wx' })
    evidence = {
      status: 'RUNNING',
      record: nonce,
      checks: [],
      apps: {},
      remote_mutation_attempted: false,
      production_profile_used: false,
      gui_tested: false
    }
  } else {
    assert.equal(realpathSync(directory), resolve(directory))
    assert.equal(readFileSync(join(directory, '.owner'), 'utf8'), nonce)
    assert(existsSync(join(local, 'opspilot.db')))
    evidence = JSON.parse(readFileSync(join(directory, 'result.json'), 'utf8'))
    assert.notEqual(evidence.status, 'PASS')
    evidence.history ??= []
    evidence.history.push({
      phase: evidence.phase,
      status: evidence.status,
      error_code: evidence.error_code ?? null
    })
    evidence.status = 'RUNNING'
    delete evidence.error_code
  }
  save()
  const proof = JSON.parse(
    readFileSync(join(project, '../docs/ui-redesign/r7h3e3b-verification.json'), 'utf8')
  )
  assert.equal(proof.status, 'PASS')
  assert.equal(proof.private_candidate.release_sha256, candidatePin)
  assert.equal(proof.private_candidate.payload_sha256, payloadPin)
  assert.equal(proof.root_systemd.checks.length, 19)
  assert.equal(proof.desktop_main_upgrade.checks.length, 19)
  assert.equal(proof.runtime_attempts, 35)
  const verifier = require(join(project, 'out/main/controllerResourceVerifier.js'))
  verifier.verifyPackagedControllerResources(join(project, 'resources/controller-releases'))
  assert.equal(verifier.builtinControllerInstallerCatalog().releases.length, 8)
  const artifact = join(directory, 'entry.cjs'),
    esbuild = createRequire(require.resolve('vite/package.json'))('esbuild')
  await esbuild.build({
    entryPoints: [join(import.meta.dirname, 'entry.ts')],
    outfile: artifact,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    packages: 'external',
    plugins: [
      {
        name: 'raw',
        setup(build) {
          build.onResolve({ filter: /\?raw$/ }, (a) => ({
            path: resolve(a.resolveDir, a.path.slice(0, -4)),
            namespace: 'raw'
          }))
          build.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({
            contents: readFileSync(a.path, 'utf8'),
            loader: 'text'
          }))
        }
      }
    ]
  })
  evidence.main_artifact_sha256 = sha(readFileSync(artifact))
  const code = require(artifact),
    key = journalKey(local, fresh),
    cipher = new code.AesGcmCredentialCipher(key)
  key.fill(0)
  database = code.initializeDatabase(local)
  const profiles = new code.VpsRepository(database)
  if (fresh) {
    profiles.create({
      name: 'Helper upgrade acceptance ' + nonce,
      host: config.host,
      port: 22,
      username: 'root',
      auth_type: 'password',
      host_fingerprint: pin,
      credential: cipher.encrypt(config.password)
    })
    config.password = ''
  }
  ssh = new code.SshManager((id) => {
    const v = profiles.getById(id)
    return {
      host: v.host,
      port: v.port,
      username: v.username,
      authType: v.auth_type,
      hostFingerprint: v.host_fingerprint,
      secret: code.loadSecret(database, cipher, id)
    }
  })
  const resources = new code.ControllerInstallerResources(
      verifier.builtinControllerInstallerCatalog(),
      join(project, 'resources/controller-releases')
    ),
    releases = resources.entries(),
    candidate = resources.verify(candidateId)
  assert.equal(candidate.entry.release_sha256, candidatePin)
  const service = new code.DesktopControllerService(
      database,
      cipher,
      ssh,
      undefined,
      releases,
      resources
    ),
    vault = new code.DesktopControllerVault(database, cipher)
  const snapshot = async () => {
    const result = await ssh.exec(1, helperSnapshotCommand, {
      logCommand: false,
      retryOnReconnect: false,
      timeoutMs: 30000,
      maxStdoutBytes: 131072,
      maxStderrBytes: 1024
    })
    assert.equal(result.code, 0)
    return JSON.parse(result.stdout)
  }
  progress('fresh-readonly-attestation')
  let observed = await snapshot()
  if (!evidence.before) {
    assert.equal(observed.schema, 35)
    assert.equal(observed.upgrade.phase, 'active')
    assert.equal(observed.upgrade.request_key, 'd7afa8d4-91a7-4399-895b-471f6a6bc01c')
    assert.equal(observed.upgrade.release_sha256, parent)
    assert.equal(observed.apps.length, 6)
    assert.equal(observed.containers.length, 12)
    assert.equal(new Set(observed.containers.map((row) => row.id)).size, 12)
    assert(observed.containers.every((row) => row.status === 'running'))
    assert(
      observed.helpers.every(
        (item) => item.enrollment.state === 'enrolled' && item.enrollment.last_error_code === null
      )
    )
    quiescent(observed)
    evidence.before = observed
    save()
  } else preserved(observed)
  check('fresh_pinned_SSH_schema035_six_apps_twelve_running_CIDs_quiescent')
  if (!(await service.listInstallations()).length) {
    const review = await service.reviewControllerAdoption({ vps_id: 1 })
    assert.equal(review.controller_id, controller)
    await service.confirmControllerAdoption({ plan_id: review.plan_id, consent: true })
  }
  const intent = {
    installation_request_key: installation,
    display_name: 'Helper upgrade ' + nonce,
    allow_write: true
  }
  if (!evidence.binding_id) {
    evidence.binding_id = (await service.prepareInstalledRegistration(intent)).binding_id
    save()
  }
  const binding = evidence.binding_id
  if (!evidence.registration_attempted) {
    evidence.registration_attempted = true
    evidence.remote_mutation_attempted = true
    save()
    await service.registerInstalled({ ...intent, binding_id: binding })
    evidence.registered = true
    save()
  }
  assert(evidence.registered, 'REGISTRATION_INSPECT_REQUIRED')
  if (!evidence.client_token_sha256) {
    evidence.client_token_sha256 = sha(vault.resolve(binding).accessToken)
    evidence.client_id = vault.get(binding).remote_client_id
    save()
  }
  progress('Main-controller-upgrade')
  let upgraded
  if (!evidence.upgrade_key) {
    const review = await service.reviewUpgrade({
      installation_request_key: installation,
      release_id: candidateId
    })
    upgraded = await service.prepareUpgrade({ plan_id: review.plan_id })
    evidence.upgrade_key = upgraded.request_key
    save()
  } else upgraded = await service.inspectUpgrade(evidence.upgrade_key)
  if (
    (upgraded.state === 'prepared' && !evidence.transfer_attempted) ||
    (appOperation === '--transfer-controller' && !evidence.upgrade_attempted)
  ) {
    evidence.transfer_attempted = true
    save()
    await service.sendUpgrade({
      request_key: evidence.upgrade_key,
      operation: 'transfer',
      consent: true
    })
  }
  upgraded = await service.inspectUpgrade(evidence.upgrade_key)
  evidence.upgrade = upgraded
  save()
  if (!evidence.upgrade_attempted) {
    assert.equal(upgraded.state, 'transferred')
    evidence.upgrade_attempted = true
    save()
    try {
      await service.sendUpgrade({
        request_key: evidence.upgrade_key,
        operation: 'upgrade',
        consent: true
      })
    } catch (error) {
      evidence.upgrade_send_error = codeOf(error)
      save()
    }
  }
  upgraded = await service.inspectUpgrade(evidence.upgrade_key)
  if (
    appOperation === '--recover-controller' &&
    evidence.upgrade_attempted &&
    upgraded.state === 'outcome_unknown'
  ) {
    await service.sendUpgrade({
      request_key: evidence.upgrade_key,
      operation: 'recover',
      consent: true
    })
    upgraded = await service.inspectUpgrade(evidence.upgrade_key)
  }
  evidence.upgrade = upgraded
  save()
  assert.equal(upgraded.state, 'active')
  assert.equal(upgraded.is_current, true)
  assert.equal(upgraded.release_sha256, candidatePin)
  assert.equal(upgraded.last_result.service_state, 'running')
  if (!evidence.binding_refreshed) {
    const review = await service.reviewUpgradeBinding({
      binding_id: binding,
      request_key: evidence.upgrade_key
    })
    await service.refreshUpgradeBinding({ plan_id: review.plan_id, consent: true })
    assert.equal(sha(vault.resolve(binding).accessToken), evidence.client_token_sha256)
    assert.equal(vault.get(binding).remote_client_id, evidence.client_id)
    evidence.binding_refreshed = true
    save()
  }
  observed = await snapshot()
  preserved(observed)
  quiescent(observed, true)
  evidence.after_controller_upgrade ??= observed
  save()
  check('Main_upgrade035_binding_refresh_preserves_six_apps_CIDs_DB_key_source_env')
  const identity = {
    vpsId: 1,
    host: '167.71.202.116',
    port: 22,
    username: 'root',
    authType: 'password',
    hostFingerprint: pin
  }
  const relay = async (command, input) => {
    const opened = await ssh.openProductBootstrapChannel(
      1,
      { text: helperRelay, sha256: sha(helperRelay) },
      { expectedIdentity: identity, timeoutMs: 120000 }
    )
    try {
      assert.deepEqual(opened.identity, identity)
      const value = await code.exchangeProductBootstrapJson(
        opened.channel,
        JSON.stringify({ command, input, upgrade_key: evidence.upgrade_key })
      )
      if (value.relay_error) throw Error(value.relay_error)
      return value
    } finally {
      opened.channel.destroy()
    }
  }
  const manifests = new Map()
  for (const release of releases) {
    const bytes = readFileSync(join(release.release_directory, 'payload/bundle-manifest.json'))
    manifests.set(sha(bytes), bytes.toString('utf8'))
  }
  for (const original of evidence.before.helpers) {
    const row = original.enrollment,
      appId = row.app_id
    const wasCapable =
      original.files.find((file) => file.path === 'helpers/target_product_runtime.py').sha256 ===
      runtimePin
    if (wasCapable) {
      check('already_capable_target_' + appId + '_pin_retained')
      continue
    }
    progress('target-helper-app-' + appId)
    const record = (evidence.apps[appId] ??= { request_key: randomUUID() })
    save()
    const lookup = {
      format: 1,
      controller_id: controller,
      app_id: appId,
      ownership_generation: row.ownership_generation,
      request_key: record.request_key
    }
    const installedArtifact =
      '/opt/opspilot-controller/revisions/' +
      evidence.upgrade_key +
      '/runtime/payload/control-plane.cjs'
    if (!record.prepare_input) {
      const retained = manifests.get(row.manifest_sha256)
      assert(retained, 'RETAINED_MANIFEST_REQUIRED')
      const input = {
        format: 1,
        controller_id: controller,
        app_id: appId,
        ownership_generation: row.ownership_generation,
        artifact: installedArtifact,
        manifest_sha256: payloadPin,
        retained_manifest: retained
      }
      const review = await relay('review-target-helper-upgrade', input)
      assert.equal(review.from_manifest_sha256, row.manifest_sha256)
      assert.equal(review.to_manifest_sha256, payloadPin)
      record.review = review
      record.prepare_input = {
        ...input,
        request_key: record.request_key,
        expected_review_sha256: review.review_sha256,
        confirm: true
      }
      save()
    }
    let result
    if (!record.prepare_attempted) {
      record.prepare_attempted = true
      save()
      result = await relay('prepare-target-helper-upgrade', record.prepare_input)
      record.prepared = result.state === 'pending'
      save()
    } else result = await relay('helper-upgrade-state', lookup)
    if (result.state !== 'applied') {
      if (appOperationId === appId && appOperation) {
        result = await relay(
          appOperation === '--recover-app'
            ? 'recover-target-helper-upgrade'
            : 'cancel-target-helper-upgrade',
          { ...lookup, confirm: true }
        )
      } else if (!record.apply_attempted && result.state === 'pending') {
        record.apply_attempted = true
        save()
        result = await relay('apply-target-helper-upgrade', { ...lookup, confirm: true })
      } else result = await relay('inspect-target-helper-upgrade', lookup)
    }
    record.outcome = result
    save()
    if (result.state !== 'applied') throw Error('HELPER_EXPLICIT_RECOVERY_REQUIRED')
    const repeat = await relay('helper-upgrade-state', lookup)
    assert.deepEqual(repeat, result)
    observed = await snapshot()
    preserved(observed)
    quiescent(observed, true)
    const upgradedTarget = observed.helpers.find((item) => item.enrollment.app_id === appId)
    assert.equal(upgradedTarget.enrollment.manifest_sha256, payloadPin)
    assert.equal(
      upgradedTarget.files.find((file) => file.path === 'helpers/target_product_runtime.py').sha256,
      runtimePin
    )
    record.verified = true
    record.snapshot = observed.helpers.find((item) => item.enrollment.app_id === appId)
    save()
    check('target_' + appId + '_reviewed_upgrade_cold_lookup_preserves_CIDs_key_marker_guards')
  }
  progress('revoke-and-final-attestation')
  if (!evidence.client_revoked) {
    await service.revoke(binding)
    evidence.client_revoked = true
    save()
  }
  observed = await snapshot()
  preserved(observed)
  quiescent(observed)
  assert(
    observed.helpers.every(
      (item) =>
        item.enrollment.state === 'enrolled' &&
        item.enrollment.last_error_code === null &&
        item.files.find((file) => file.path === 'helpers/target_product_runtime.py').sha256 ===
          runtimePin
    )
  )
  for (const original of evidence.before.helpers.filter((item) => item.enrollment.app_id >= 5))
    assert.equal(
      observed.helpers.find((item) => item.enrollment.app_id === original.enrollment.app_id)
        .enrollment.manifest_sha256,
      original.enrollment.manifest_sha256
    )
  const http = await Promise.all(
    Array.from({ length: 6 }, (_, i) => 30000 + i).map(async (port) => {
      const response = await fetch('http://167.71.202.116:' + port, {
        signal: AbortSignal.timeout(8000),
        redirect: 'manual'
      })
      await response.body?.cancel()
      return { port, status: response.status }
    })
  )
  assert(http.every((item) => item.status === 200))
  evidence.public_HTTP = http
  evidence.after = observed
  check('all_six_public_HTTP200_no_deploy_or_container_restart_clients_revoked_no_pending')
  evidence.status = 'PASS'
  save()
} catch (error) {
  evidence ??= { record: nonce, checks: [] }
  evidence.status = 'FAIL'
  evidence.error_code = codeOf(error)
  evidence.failure_location = /run\.mjs:\d+:\d+/.exec(error?.stack ?? '')?.[0] ?? null
  if (existsSync(directory)) save()
} finally {
  if (config) config.password = ''
  await ssh?.disconnectAll()
  if (database?.open) database.close()
  if (evidence) {
    if (evidence.status === 'PASS') {
      assert.equal(realpathSync(local), resolve(local))
      assert.equal(resolve(local, '..'), directory)
      rmSync(local, { recursive: true })
      evidence.private_db_removed = !existsSync(local)
    }
    evidence.private_journal_retained = existsSync(join(local, 'opspilot.db'))
    save()
    console.log(
      JSON.stringify({
        status: evidence.status,
        record: nonce,
        phase,
        checks: evidence.checks.length,
        error_code: evidence.error_code ?? null,
        private_journal_retained: evidence.private_journal_retained
      })
    )
    if (evidence.status === 'FAIL') process.exitCode = 1
  }
}
