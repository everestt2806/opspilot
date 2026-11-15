/* eslint-disable @typescript-eslint/explicit-function-return-type -- Gate vận hành Main/SSH có private journal. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomBytes, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { journalKey } from '../controller-upgrade-live/journal-key.mjs'
import { privateInput } from './input.mjs'
import { snapshotCommand } from './snapshot.mjs'
const args = process.argv.slice(2),
  fresh = args.join(' ') === '--start'
assert(fresh || (args.length === 2 && args[0] === '--resume' && /^[a-f0-9]{12}$/.test(args[1])))
const project = resolve(import.meta.dirname, '../..'),
  require = createRequire(join(project, 'package.json')),
  nonce = fresh ? randomBytes(6).toString('hex') : args[1],
  directory = join(project, '.out-scripts/product-environment-live', nonce),
  local = join(directory, 'private-profile'),
  pin = 'SHA256:0X8J5LfPr6iZqEspsD379FvFEWrLfYpN0wfNYjQ87+E',
  controller = 'dc586bb7-cd83-484c-b036-e5ad40ec106d',
  installation = '7573f0b1-4262-4305-8b7d-9a1edce49626',
  parent = 'b6803bc794cb39987936395d8d1f12cd06720a08f2e0ba2c3307ec619368ab45',
  candidateId = 'linux-x64-node22-20261115-environment-v2',
  candidatePin = 'db1e58c83badef0c7efca42b78fff483d71cc38bdd711a635924d0849b41bdb8'
if (
  !fresh &&
  (!existsSync(join(local, 'opspilot.db')) ||
    JSON.parse(readFileSync(join(directory, 'result.json'), 'utf8')).status === 'PASS')
) {
  console.log(
    JSON.stringify({
      status: 'REJECTED',
      code: 'PENDING_PRIVATE_JOURNAL_REQUIRED',
      no_remote_access: true
    })
  )
  process.exit(2)
}
let evidence,
  config,
  db,
  ssh,
  service,
  cipher,
  vault,
  binding,
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
const stable = (error) => {
  for (const value of [error?.context?.cause?.message, error?.code, error?.message])
    if (typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,90}$/.test(value)) return value
  return error?.name === 'AssertionError' ? 'ASSERTION_FAILED' : 'ENVIRONMENT_ROLLOUT_FAILED'
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
      production_profile_used: false,
      gui_tested: false,
      remote_mutation_attempted: false
    }
  } else {
    assert.equal(realpathSync(directory), resolve(directory))
    assert.equal(readFileSync(join(directory, '.owner'), 'utf8'), nonce)
    evidence = JSON.parse(readFileSync(join(directory, 'result.json'), 'utf8'))
    evidence.attempt_history ??= []
    evidence.attempt_history.push({
      status: evidence.status,
      phase: evidence.phase,
      error_code: evidence.error_code ?? null
    })
    delete evidence.error_code
    evidence.status = 'RUNNING'
  }
  save()
  const proof = JSON.parse(
    readFileSync(join(project, '../docs/ui-redesign/r7h3d3a-verification.json'), 'utf8')
  )
  assert.equal(proof.status, 'PASS')
  assert.equal(proof.release.release_sha256, candidatePin)
  const verifier = require(join(project, 'out/main/controllerResourceVerifier.js'))
  verifier.verifyPackagedControllerResources(join(project, 'resources/controller-releases'))
  const esbuild = createRequire(require.resolve('vite/package.json'))('esbuild'),
    artifact = join(directory, 'entry.cjs')
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
  evidence.main_artifact_sha256 = createHash('sha256').update(readFileSync(artifact)).digest('hex')
  const code = require(artifact),
    key = journalKey(local, fresh)
  cipher = new code.AesGcmCredentialCipher(key)
  key.fill(0)
  const privateFile = join(local, 'sealed-acceptance.json')
  let privateState = {}
  if (existsSync(privateFile)) {
    const encoded = JSON.parse(readFileSync(privateFile, 'utf8'))
    const decoded = JSON.parse(
      cipher.decrypt({
        crypto_scheme: 'aes_256_gcm',
        encrypted_secret: Buffer.from(encoded.encrypted_secret, 'base64'),
        iv: Buffer.from(encoded.iv, 'base64'),
        auth_tag: Buffer.from(encoded.auth_tag, 'base64')
      })
    )
    assert.equal(decoded.purpose, 'opspilot-environment-live-v1')
    assert.equal(decoded.record, nonce)
    privateState = decoded.values
  }
  const savePrivate = () => {
    const encrypted = cipher.encrypt(
      JSON.stringify({
        purpose: 'opspilot-environment-live-v1',
        record: nonce,
        values: privateState
      })
    )
    writeFileSync(
      privateFile,
      JSON.stringify(
        Object.fromEntries(
          ['encrypted_secret', 'iv', 'auth_tag'].map((k) => [k, encrypted[k].toString('base64')])
        )
      ),
      { flush: true }
    )
  }
  db = code.initializeDatabase(local)
  const profiles = new code.VpsRepository(db)
  if (fresh) {
    profiles.create({
      name: 'Environment acceptance ' + nonce,
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
      secret: code.loadSecret(db, cipher, id)
    }
  })
  const resources = new code.ControllerInstallerResources(
      verifier.builtinControllerInstallerCatalog(),
      join(project, 'resources/controller-releases')
    ),
    releases = resources.entries(),
    candidate = releases.find((r) => r.release_id === candidateId)
  assert.equal(candidate?.release_sha256, candidatePin)
  service = new code.DesktopControllerService(db, cipher, ssh, undefined, releases, resources)
  vault = new code.DesktopControllerVault(db, cipher)
  const exec = async (command) => {
    const r = await ssh.exec(1, command, {
      logCommand: false,
      retryOnReconnect: false,
      timeoutMs: 30000,
      maxStdoutBytes: 65536,
      maxStderrBytes: 1024
    })
    assert.equal(r.code, 0)
    return r.stdout
  }
  const snapshot = async () => JSON.parse(await exec(snapshotCommand))
  const unchangedOld = (after) => {
    const before = evidence.before
    for (const key of ['receipt_sha256', 'database_inode', 'vps_digest', 'files'])
      assert.deepEqual(after[key], before[key])
    assert.deepEqual(
      after.apps.filter((a) => a.id <= 4),
      before.apps
    )
    assert.deepEqual(
      after.containers.filter((c) => before.containers.some((old) => old.name === c.name)),
      before.containers
    )
    assert.equal(after.active_experiments, 0)
  }
  progress('fresh-readonly-attestation')
  const before = await snapshot()
  if (!evidence.before) {
    assert.equal(before.receipt.controller_id, controller)
    assert.equal(before.receipt.request_key, installation)
    assert.equal(before.receipt.uid, 997)
    assert.equal(before.upgrade.request_key, '4c90a650-dbae-4694-9c2b-5eb2e8b9fdd4')
    assert.equal(before.upgrade.release_sha256, parent)
    assert.equal(before.schema, 29)
    assert.equal(before.apps.length, 4)
    assert.equal(before.containers.length, 8)
    assert(before.containers.every((c) => c.status === 'running'))
    for (const key of [
      'active_jobs',
      'active_experiments',
      'active_clients',
      'app_leases',
      'worker_leases',
      'unsettled_terminals',
      'prepared_activations'
    ])
      assert.equal(before[key], 0)
    assert(before.owners.every((r) => r.controller_id === controller && r.auto_deploy_paused === 1))
    assert(before.desired.every((r) => r.auto_paused === 1))
    assert(before.service.includes('ActiveState=active'))
    evidence.before = before
    check('fresh_pinned_SSH_expected_parent029_four_apps_eight_CIDs_quiescent')
  } else unchangedOld(before)
  progress('adopt-current-controller')
  if (!(await service.listInstallations()).length) {
    const review = await service.reviewControllerAdoption({ vps_id: 1 })
    assert.equal(review.controller_id, controller)
    await service.confirmControllerAdoption({ plan_id: review.plan_id, consent: true })
  }
  const intent = {
    installation_request_key: installation,
    display_name: 'Environment acceptance ' + nonce,
    allow_write: true
  }
  if (!evidence.binding_id) {
    const prepared = await service.prepareInstalledRegistration(intent)
    evidence.binding_id = prepared.binding_id
    save()
  }
  binding = evidence.binding_id
  let connection = (await service.list()).find((r) => r.binding_id === binding)
  if (connection?.state !== 'active' && !evidence.upgrade_attempted) {
    if (evidence.registration_attempted) throw Error('REGISTRATION_INSPECT_REQUIRED')
    evidence.registration_attempted = true
    evidence.remote_mutation_attempted = true
    save()
    connection = await service.registerInstalled({ ...intent, binding_id: binding })
  }
  // Token không đưa vào report. Vault giữ credential qua cold resume.
  let tokenBefore, clientBefore
  try {
    tokenBefore = vault.resolve(binding).accessToken
    clientBefore = vault.get(binding).remote_client_id
  } catch {
    if (!evidence.upgrade_attempted) throw Error('ACTIVE_SCOPED_BINDING_REQUIRED')
  }
  if (tokenBefore && !privateState.client_token) {
    privateState.client_token = tokenBefore
    privateState.client_id = clientBefore
    savePrivate()
  }
  progress('prepare-protected-upgrade')
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
  if (upgraded.state === 'prepared' && !evidence.transfer_attempted) {
    evidence.transfer_attempted = true
    save()
    progress('transfer-protected-release')
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
    progress('upgrade029-to035')
    try {
      await service.sendUpgrade({
        request_key: evidence.upgrade_key,
        operation: 'upgrade',
        consent: true
      })
    } catch (error) {
      evidence.upgrade_send_error = stable(error)
      save()
    }
  }
  upgraded = await service.inspectUpgrade(evidence.upgrade_key)
  evidence.upgrade = upgraded
  save()
  assert.equal(upgraded.state, 'active')
  assert.equal(upgraded.is_current, true)
  assert.equal(upgraded.release_sha256, candidatePin)
  assert.equal(upgraded.last_result.service_state, 'running')
  progress('refresh-runtime-binding')
  if (!evidence.binding_refreshed) {
    const review = await service.reviewUpgradeBinding({
      binding_id: binding,
      request_key: evidence.upgrade_key
    })
    await service.refreshUpgradeBinding({ plan_id: review.plan_id, consent: true })
    if (tokenBefore) assert.equal(vault.resolve(binding).accessToken, tokenBefore)
    if (clientBefore) assert.equal(vault.get(binding).remote_client_id, clientBefore)
    assert.equal(vault.resolve(binding).accessToken, privateState.client_token)
    assert.equal(vault.get(binding).remote_client_id, privateState.client_id)
    evidence.binding_refreshed = true
    save()
  }
  const after = await snapshot()
  unchangedOld(after)
  assert.equal(after.schema, 35)
  assert.equal(after.upgrade.schema_transition.phase, 'applied')
  assert.equal(after.upgrade.schema_transition.backup.before.schema_version, 29)
  assert.equal(after.upgrade.schema_transition.backup.request_key, evidence.upgrade_key)
  assert.equal(after.active_jobs, 0)
  evidence.after_upgrade ??= after
  assert.match(evidence.upgrade_key, /^[a-f0-9-]{36}$/)
  const backup = JSON.parse(
    await exec(`python3 - <<'PY'
import os,stat,json,hashlib,sqlite3
p='/opt/opspilot-controller/revisions/${evidence.upgrade_key}/schema-backup/backup.sqlite'
s=os.lstat(p);d=os.lstat(os.path.dirname(p));h=hashlib.sha256()
with open(p,'rb') as f:
 while True:
  block=f.read(1048576)
  if not block:break
  h.update(block)
c=sqlite3.connect('file:'+p+'?mode=ro',uri=True)
print(json.dumps({'uid':s.st_uid,'mode':stat.S_IMODE(s.st_mode),'links':s.st_nlink,'directory_uid':d.st_uid,'directory_mode':stat.S_IMODE(d.st_mode),'sha256':h.hexdigest(),'schema':c.execute('SELECT max(version) FROM schema_version').fetchone()[0]}))
c.close()
PY`)
  )
  assert.equal(backup.uid, 0)
  assert.equal(backup.directory_uid, 0)
  assert.equal(backup.mode, 0o440)
  assert.equal(backup.directory_mode, 0o550)
  assert.equal(backup.links, 1)
  assert.equal(backup.schema, 29)
  assert.equal(backup.sha256, after.upgrade.schema_transition.backup.backup_sha256)
  evidence.backup = backup
  check(
    'protected_Main_upgrade029_to035_Root_backup_binding_refresh_preserves_old_apps_key_DB_receipt'
  )
  const gitDirectory = join(project, '.out-scripts/product-environment-git', nonce)
  const fixture = (mode) => {
    const record = join(gitDirectory, mode + '.json')
    if (existsSync(record)) return JSON.parse(readFileSync(record, 'utf8'))
    return JSON.parse(
      execFileSync(process.execPath, [join(import.meta.dirname, 'git-fixture.mjs'), mode, nonce], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 120000,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
      })
    )
  }
  progress('register-new-env-project')
  const initial = fixture('initial')
  let setup
  if (!evidence.project_key) {
    const targets = await service.projectTargets({ binding_id: binding })
    const target = targets.items.find(
      (t) => t.host === '167.71.202.116' && t.host_fingerprint === pin
    )
    assert(target)
    setup = await service.prepareProject({
      binding_id: binding,
      target_vps_id: target.id,
      app_name: 'env-live-' + nonce,
      framework: 'express',
      repository_url: initial.repository_url,
      production_ref: initial.branch,
      repository_root: '.',
      host_port: null,
      container_port: 3000,
      healthcheck_path: '/health'
    })
    evidence.project_key = setup.request_key
    save()
  }
  setup = (await service.listProjects(binding)).find((p) => p.request_key === evidence.project_key)
  assert(setup)
  if (setup.state === 'prepared') setup = await service.sendProject(setup.request_key)
  assert.equal(setup.state, 'registered')
  evidence.project = setup
  save()
  let target = await service.projectTargetState(setup.request_key)
  if (target.state === 'not_prepared')
    target = await service.enrollProjectTarget({
      request_key: setup.request_key,
      target_root: '/var/lib/opspilot-product'
    })
  assert.equal(target.state, 'enrolled')
  // Required env chỉ được verify sau stage/select; enrollment không thực thi source.
  const selectRevision = async (revision) => {
    privateState.environments ??= {}
    if (!privateState.environments[revision]) {
      privateState.environments[revision] = {
        APP_TOKEN: ' literal-' + randomBytes(24).toString('hex') + ' $HOME ${HOME} "quote" # end ',
        APP_TITLE: 'Kiểm chứng env 日本語 ' + nonce + ' / ' + revision
      }
      savePrivate()
    }
    evidence.environment_intents ??= {}
    let row
    if (evidence.environment_intents[revision]) {
      row = (await service.listEnvironmentIntents(setup.request_key)).find(
        (r) => r.request_key === evidence.environment_intents[revision]
      )
      if (row?.state === 'outcome_unknown' || row?.state === 'in_flight')
        row = await service.checkEnvironment(row.request_key)
    } else {
      const context = await service.environmentContext(setup.request_key)
      assert.equal(context.latest?.revision ?? 0, revision - 1)
      row = await service.prepareEnvironment({
        project_request_key: setup.request_key,
        expected_binding_revision: context.binding_revision,
        expected_latest_revision: context.latest?.revision ?? null,
        runtime_env: privateState.environments[revision],
        public_build_args: {}
      })
      evidence.environment_intents[revision] = row.request_key
      save()
    }
    assert(row)
    if (row.state === 'prepared') row = await service.sendEnvironment(row.request_key)
    assert.equal(row.state, 'staged')
    evidence.selection_intents ??= {}
    let selected
    if (evidence.selection_intents[revision]) {
      selected = (await service.listEnvironmentSelections(setup.request_key)).find(
        (r) => r.request_key === evidence.selection_intents[revision]
      )
      if (selected?.state === 'outcome_unknown' || selected?.state === 'in_flight')
        selected = await service.checkEnvironmentSelection(selected.request_key)
    } else {
      const context = await service.environmentContext(setup.request_key)
      selected = await service.prepareEnvironmentSelection({
        project_request_key: setup.request_key,
        expected_binding_revision: context.binding_revision,
        expected_source_generation: context.source_generation,
        expected_source_config_sha256: context.source_config_sha256,
        expected_latest_revision: context.latest.revision,
        environment_revision: revision
      })
      evidence.selection_intents[revision] = selected.request_key
      save()
    }
    assert(selected)
    if (selected.state === 'prepared')
      selected = await service.sendEnvironmentSelection(selected.request_key)
    assert.equal(selected.state, 'selected')
    check('environment_revision_' + revision + '_staged_selected_through_Main_durable_UUID')
  }
  const cids = async () =>
    (
      await exec(
        `docker inspect --format '{{.Id}}' ${setup.app_name}-app ${setup.app_name}-collector`
      )
    )
      .trim()
      .split('\n')
  const verifyRuntime = async (mode, revision) => {
    const origin = 'http://167.71.202.116:' + setup.host_port
    const response = await fetch(origin + '/health', {
      redirect: 'error',
      signal: AbortSignal.timeout(10000)
    })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.marker, nonce + '-' + mode)
    assert.equal(body.configured, true)
    assert.equal(body.title_configured, true)
    assert.equal(
      (await fetch(origin, { redirect: 'error', signal: AbortSignal.timeout(10000) })).status,
      200
    )
    const environment = JSON.parse(
      await exec(`docker inspect --format '{{json .Config.Env}}' ${setup.app_name}-app`)
    )
    for (const [name, value] of Object.entries(privateState.environments[revision]))
      assert(environment.includes(name + '=' + value))
    const image = (await exec(`docker inspect --format '{{.Image}}' ${setup.app_name}-app`)).trim()
    assert.match(image, /^sha256:[a-f0-9]{64}$/)
    const imageEnvironment =
      JSON.parse(await exec(`docker image inspect --format '{{json .Config.Env}}' ${image}`)) ?? []
    await exec(
      `docker run --rm --network none --memory 64m --pids-limit 32 --entrypoint /bin/sh ${image} -c 'test ! -f /app/.env && test ! -f /usr/src/app/.env'`
    )
    for (const values of Object.values(privateState.environments))
      for (const value of Object.values(values)) {
        assert(!JSON.stringify(imageEnvironment).includes(value))
        assert(!JSON.stringify(evidence).includes(value))
      }
    return {
      url: origin,
      public_health: 200,
      runtime_literals_exact: true,
      image_excludes_runtime: true,
      revision
    }
  }
  const waitJob = async (jobId, wanted) => {
    const end = Date.now() + 8 * 60000
    while (Date.now() < end) {
      const state = await service.appStatus({ binding_id: binding, app_id: setup.app_id })
      if (
        state.latest_job_id === jobId &&
        ['succeeded', 'failed', 'rolled_back', 'uncertain'].includes(state.latest_job_state)
      ) {
        assert.equal(state.latest_job_state, wanted)
        return state
      }
      await new Promise((done) => setTimeout(done, 2500))
    }
    throw Error('ENVIRONMENT_JOB_TIMEOUT')
  }
  const deploy = async (mode, revision, first = false) => {
    evidence.deployments ??= {}
    if (evidence.deployments[mode]) return evidence.deployments[mode]
    progress('environment-' + mode)
    const git = fixture(mode)
    if (revision !== null) await selectRevision(revision)
    const verified = await service.verifyProjectSource(setup.request_key)
    assert.equal(verified.commit_sha, git.sha)
    let command
    if (evidence.pending_deploy) {
      assert.equal(evidence.pending_deploy.mode, mode)
      command = await service.checkCommand(evidence.pending_deploy.key)
    } else if (first) {
      const readiness = await service.projectReadiness(setup.request_key)
      evidence.first_readiness = readiness
      save()
      assert.equal(readiness.state, 'ready')
      assert.equal(readiness.report.source_generation, 2)
      const prepared = await service.prepareFirstDeployment({
        request_key: setup.request_key,
        readiness_id: readiness.readiness_id
      })
      assert.equal(prepared.source_sha, git.sha)
      evidence.pending_deploy = { mode, key: prepared.command.request_key }
      save()
      try {
        command = await service.sendFirstDeployment({
          request_key: setup.request_key,
          readiness_id: readiness.readiness_id,
          command_key: prepared.command.request_key
        })
      } catch {
        command = await service.checkCommand(prepared.command.request_key)
      }
    } else {
      const status = await service.appStatus({ binding_id: binding, app_id: setup.app_id })
      const prepared = await service.prepareCommand({
        binding_id: binding,
        app_id: setup.app_id,
        expected_ownership_generation: status.ownership_generation,
        expected_source_generation: status.source_generation,
        operation: 'redeploy',
        target: { kind: 'current_desired' }
      })
      evidence.pending_deploy = { mode, key: prepared.request_key }
      save()
      try {
        command = await service.sendCommand(prepared.request_key)
      } catch {
        command = await service.checkCommand(prepared.request_key)
      }
    }
    assert.equal(command.state, 'accepted')
    assert.equal(command.target_sha, git.sha)
    const wanted =
        mode === 'health-fault' ? 'rolled_back' : mode === 'build-fault' ? 'failed' : 'succeeded',
      status = await waitJob(command.job_id, wanted),
      expectedRevision = wanted === 'succeeded' ? revision : 2,
      web = await verifyRuntime(wanted === 'succeeded' ? mode : 'update', expectedRevision)
    if (wanted !== 'succeeded') assert.deepEqual(await cids(), evidence.update_cids)
    const exposure = await service.exposure({ binding_id: binding, app_id: setup.app_id }, true)
    evidence.last_exposure = { mode, result: exposure }
    evidence.pending_verified = {
      mode,
      status,
      web,
      previous_cids_preserved: wanted === 'succeeded' ? null : true
    }
    save()
    if (mode === 'health-fault') {
      // Desired revision3 khác active revision2: contract giữ fence, không ghi xanh dưới authority mới.
      assert.equal(exposure.state, 'unavailable')
      assert.equal(exposure.reason_code, 'authority_changed')
      assert.equal(exposure.view.status, 'not_checked')
      check(
        'rollback_desired_active_source_mismatch_keeps_exposure_fence_despite_independent_HTTP200'
      )
    } else {
      assert.equal(exposure.state, 'recorded')
      assert.equal(exposure.view.status, 'reachable')
    }
    evidence.deployments[mode] = {
      command_key: command.request_key,
      job_id: command.job_id,
      expected_state: wanted,
      status,
      web,
      exposure,
      source_sha: git.sha
    }
    delete evidence.pending_deploy
    save()
    check('actual_Main_env_' + mode + '_HTTP_runtime_image_and_' + wanted)
    return evidence.deployments[mode]
  }
  await deploy('initial', 1, true)
  await deploy('update', 2)
  evidence.update_cids ??= await cids()
  save()
  await deploy('build-fault', null)
  await deploy('health-fault', 3)
  await deploy('final', 4)
  progress('revoke-and-final-attestation')
  await service.revoke(binding)
  evidence.temporary_client_revoked = true
  const final = await snapshot()
  unchangedOld(final)
  assert.equal(final.schema, 35)
  for (const field of [
    'active_jobs',
    'active_experiments',
    'active_clients',
    'app_leases',
    'worker_leases',
    'unsettled_terminals',
    'prepared_activations'
  ])
    assert.equal(final[field], 0)
  assert(final.owners.every((r) => r.auto_deploy_paused === 1))
  assert(final.desired.every((r) => r.auto_paused === 1))
  assert.equal(final.apps.length, 5)
  evidence.after = final
  check('old_four_apps_unchanged_new_env_app_healthy_all_settled_paused_temporary_client_revoked')
  evidence.status = 'PASS'
  save()
} catch (error) {
  evidence ??= { record: nonce, checks: [] }
  evidence.status = 'FAIL'
  evidence.error_code = stable(error)
  evidence.failure_location = /run\.mjs:\d+:\d+/.exec(error?.stack ?? '')?.[0] ?? null
  if (existsSync(directory)) save()
} finally {
  if (config) config.password = ''
  await ssh?.disconnectAll()
  if (db?.open) db.close()
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
