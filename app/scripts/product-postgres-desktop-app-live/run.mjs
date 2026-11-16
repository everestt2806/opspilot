/* eslint-disable @typescript-eslint/explicit-function-return-type -- Dedicated private operator acceptance. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { journalKey } from '../controller-upgrade-live/journal-key.mjs'
import { privateInput } from '../product-environment-live/input.mjs'
import { retainedPostgresAppSnapshotCommand as helperSnapshotCommand } from '../product-postgres-desktop-live/snapshot.mjs'

const args = process.argv.slice(2),
  fresh = args.join(' ') === '--start'
assert(fresh || (args[0] === '--resume' && /^[a-f0-9]{12}$/.test(args[1])))
assert(fresh || args.length === 2)
const project = resolve(import.meta.dirname, '../..'),
  require = createRequire(join(project, 'package.json')),
  nonce = fresh ? randomBytes(6).toString('hex') : args[1],
  directory = join(project, '.out-scripts/product-postgres-desktop-app-live', nonce),
  local = join(directory, 'private-profile'),
  controller = 'dc586bb7-cd83-484c-b036-e5ad40ec106d',
  installation = '7573f0b1-4262-4305-8b7d-9a1edce49626',
  controllerRecord = JSON.parse(
    readFileSync(
      join(project, '.out-scripts/product-postgres-desktop-controller-live/current.json'),
      'utf8'
    )
  ),
  upgradeKey = controllerRecord.upgrade_key,
  candidateId = 'linux-x64-node22-20261116-project-postgres',
  candidatePin = '4bc45902888d7e3442e6cd44694c4abbe1685101c5eac94415cb677461e245a5',
  payloadPin = '0ce3a5cab4e95947ca0852cdfdab71ae5ce7ab45eb5b384b017094805845be8e',
  pin = 'SHA256:0X8J5LfPr6iZqEspsD379FvFEWrLfYpN0wfNYjQ87+E',
  runtimePin = 'f591e2f4bd8b1a770204af8645c499ba05955090a32464c1ae5c32dd37443cb5',
  sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
assert.equal(controllerRecord.status, 'PASS')
assert.equal(controllerRecord.release_sha256, candidatePin)
assert(/^[a-f0-9-]{36}$/.test(upgradeKey))
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
  return error?.name === 'AssertionError'
    ? 'ASSERTION_FAILED'
    : 'POSTGRES_CONTROLLER_ROLLOUT_FAILED'
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
    'retained_material_digest'
  ])
    assert.deepEqual(after[name], before[name])
  assert.deepEqual(
    after.apps.filter((row) => row.id <= 7),
    before.apps
  )
  assert.deepEqual(
    after.owners.filter((row) => row.app_id <= 7),
    before.owners
  )
  assert.deepEqual(
    after.desired.filter((row) => row.app_id <= 7),
    before.desired
  )
  assert.deepEqual(
    after.containers.filter((row) => before.containers.some((old) => old.name === row.name)),
    before.containers
  )
  assert.deepEqual(
    after.helpers.filter((row) => row.enrollment.app_id <= 6),
    before.helpers
  )
  assert.deepEqual(after.postgres, before.postgres)
  assert.equal(after.schema, 37)
  assert.equal(after.upgrade.request_key, upgradeKey)
  assert.equal(after.upgrade.release_sha256, candidatePin)
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
    readFileSync(join(project, '../docs/ui-redesign/r7h4c5-candidate-verification.json'), 'utf8')
  )
  assert.equal(proof.status, 'PASS_CANDIDATE_BEFORE_SERVING')
  assert.equal(proof.release.release_sha256, candidatePin)
  assert.equal(proof.release.payload_sha256, payloadPin)
  assert.equal(proof.native_Root.checks, 19)
  assert.equal(proof.native_Main.checks, 19)
  assert.equal(proof.native_public_source.checks, 12)
  assert.equal(proof.runtime_attempts, 49)
  const verifier = require(join(project, 'out/main/controllerResourceVerifier.js'))
  verifier.verifyPackagedControllerResources(join(project, 'resources/controller-releases'))
  assert.equal(verifier.builtinControllerInstallerCatalog().releases.length, 10)
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
      name: 'PostgreSQL app acceptance ' + nonce,
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
    const result = await ssh.exec(1, helperSnapshotCommand.replaceAll('app_id<=5', 'app_id<=6'), {
      logCommand: false,
      retryOnReconnect: false,
      timeoutMs: 30000,
      maxStdoutBytes: 512 * 1024,
      maxStderrBytes: 1024
    })
    assert.equal(result.code, 0)
    return JSON.parse(result.stdout)
  }
  progress('fresh-readonly-attestation')
  let observed = await snapshot()
  if (!evidence.before) {
    assert.equal(observed.schema, 37)
    assert.equal(observed.upgrade.phase, 'active')
    assert.equal(observed.upgrade.request_key, upgradeKey)
    assert.equal(observed.upgrade.release_sha256, candidatePin)
    assert.equal(observed.apps.length, 7)
    assert.equal(observed.containers.length, 14)
    assert.equal(new Set(observed.containers.map((row) => row.id)).size, 14)
    assert(observed.containers.every((row) => row.status === 'running'))
    assert(
      observed.helpers.every(
        (item) =>
          item.enrollment.state === 'enrolled' &&
          item.enrollment.last_error_code === null &&
          item.files.find((file) => file.path === 'helpers/target_product_runtime.py')?.sha256 ===
            (item.enrollment.app_id === 7
              ? '95cc98a0fe3692193e66f034ac8bdb8a0e7541e9ee4c5c75b472e18ed37fc343'
              : runtimePin)
      )
    )
    quiescent(observed)
    evidence.before = observed
    save()
  } else preserved(observed)
  check('fresh_pinned_SSH_schema037_seven_apps_fourteen_running_CIDs_quiescent')
  if (!(await service.listInstallations()).length) {
    const review = await service.reviewControllerAdoption({ vps_id: 1 })
    assert.equal(review.controller_id, controller)
    await service.confirmControllerAdoption({ plan_id: review.plan_id, consent: true })
  }
  const intent = {
    installation_request_key: installation,
    display_name: 'PostgreSQL app ' + nonce,
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

  const exec = async (command) => {
    const result = await ssh.exec(1, command, {
      logCommand: false,
      retryOnReconnect: false,
      timeoutMs: 30000,
      maxStdoutBytes: 65536,
      maxStderrBytes: 1024
    })
    assert.equal(result.code, 0)
    return JSON.parse(result.stdout)
  }
  const fixture = (mode) => {
    const record = join(project, '.out-scripts/product-postgres-git', nonce, mode + '.json')
    if (existsSync(record)) return JSON.parse(readFileSync(record, 'utf8'))
    return JSON.parse(
      execFileSync(
        process.execPath,
        [join(import.meta.dirname, '../product-postgres-lab/git-fixture.mjs'), nonce, mode],
        {
          encoding: 'utf8',
          timeout: 120000,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
        }
      )
    )
  }
  progress('new-public-Git-project')
  const initial = fixture('initial')
  if (!evidence.project_key) {
    const targets = await service.projectTargets({ binding_id: binding })
    const target = targets.items.find(
      (row) => row.host === '167.71.202.116' && row.host_fingerprint === pin
    )
    assert(target)
    const setup = await service.prepareProject({
      binding_id: binding,
      target_vps_id: target.id,
      app_name: 'pg-main-' + nonce,
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
  let setup = (await service.listProjects(binding)).find(
    (row) => row.request_key === evidence.project_key
  )
  assert(setup)
  if (setup.state === 'prepared') setup = await service.sendProject(setup.request_key)
  assert.equal(setup.state, 'registered')
  assert(setup.app_id > 7 && /^[a-z0-9-]+$/.test(setup.app_name))
  evidence.project = setup
  save()
  let target = await service.projectTargetState(setup.request_key)
  if (target.state === 'not_prepared')
    target = await service.enrollProjectTarget({
      request_key: setup.request_key,
      target_root: '/var/lib/opspilot-product'
    })
  assert.equal(target.state, 'enrolled')
  progress('Main-prepare-and-select-PostgreSQL')
  const runIntent = async (operation, databaseId) => {
    const field = operation === 'prepare' ? 'pg_prepare_key' : 'pg_selection_key'
    let row
    if (!evidence[field]) {
      const context = await service.postgresContext(setup.request_key)
      const basis = {
        project_request_key: setup.request_key,
        expected_binding_revision: context.binding_revision,
        expected_source_generation: context.source_generation,
        expected_source_config_sha256: context.source_config_sha256
      }
      row = await service.preparePostgresIntent(
        operation === 'prepare'
          ? { ...basis, operation }
          : { ...basis, operation, database_id: databaseId }
      )
      evidence[field] = row.request_key
      save()
    } else
      row = (await service.listPostgresIntents(setup.request_key)).find(
        (r) => r.request_key === evidence[field]
      )
    assert(row && row.operation === operation)
    if (row.state === 'prepared') {
      evidence[field + '_send_attempted'] = true
      save()
      try {
        row = await service.sendPostgresIntent(row.request_key)
      } catch {
        row = await service.checkPostgresIntent(row.request_key)
      }
    } else if (['in_flight', 'outcome_unknown'].includes(row.state))
      row = await service.checkPostgresIntent(row.request_key)
    assert.equal(row.state, operation === 'prepare' ? 'resource_prepared' : 'selected')
    return row
  }
  const prepared = await runIntent('prepare')
  const pg = { metadata: prepared.result.metadata }
  evidence.database = pg.metadata
  save()
  const selected = await runIntent('select', pg.metadata.database_id)
  evidence.database_selection = selected.result
  evidence.Main_receipts = (await service.listPostgresIntents(setup.request_key)).map((r) => ({
    request_key: r.request_key,
    operation: r.operation,
    state: r.state
  }))
  save()
  check('actual_Main_PostgreSQL_038_prepare_select_receipts_without_operator_relay_or_fake_ENV')
  const runtimeProof = async (jobId) => {
    assert(/^pjob_[a-f0-9-]{36}$/.test(jobId))
    return exec(`python3 - <<'PY'
import sqlite3,json
c=sqlite3.connect('file:/var/lib/opspilot-controller/opspilot.db?mode=ro',uri=True);c.row_factory=sqlite3.Row
r=c.execute('SELECT t.envelope_json,t.settled_at,t.leases_released_at FROM product_runtime_terminal t JOIN product_deploy_attempt a ON a.attempt_id=t.attempt_id WHERE a.job_id=? ORDER BY a.attempt_number DESC LIMIT 1',('${jobId}',)).fetchone()
if not r:raise ValueError('TERMINAL_NOT_AVAILABLE')
e=json.loads(r['envelope_json'])
print(json.dumps({'database_runtime':e['receipt'].get('database_runtime'),'settled':r['settled_at'] is not None,'leases_released':r['leases_released_at'] is not None}));c.close()
PY`)
  }
  const verifyHttp = async (mode) => {
    const result = await fetch('http://167.71.202.116:' + setup.host_port + '/health', {
      redirect: 'error',
      signal: AbortSignal.timeout(10000)
    })
    assert.equal(result.status, 200)
    const value = await result.json()
    assert.equal(value.rows, 1000)
    assert.equal(value.release, nonce + '-' + mode)
    const root = await fetch('http://167.71.202.116:' + setup.host_port, {
      signal: AbortSignal.timeout(10000)
    })
    assert.equal(root.status, 200)
    await root.body?.cancel()
    return { public_health: 200, public_root: 200, rows: value.rows, release: value.release }
  }
  const deploy = async (mode) => {
    evidence.deployments ??= {}
    if (evidence.deployments[mode]) return evidence.deployments[mode]
    progress('PostgreSQL-' + mode)
    const git = fixture(mode)
    let command
    if (evidence.pending_deploy) {
      assert.equal(evidence.pending_deploy.mode, mode)
      command = (await service.listCommands(binding)).find(
        (row) => row.request_key === evidence.pending_deploy.key
      )
      assert(command)
      if (command.state !== 'prepared') command = await service.checkCommand(command.request_key)
    } else {
      const verified = await service.verifyProjectSource(setup.request_key)
      assert.equal(verified.commit_sha, git.sha)
      if (mode === 'initial') {
        const ready = await service.projectReadiness(setup.request_key)
        evidence.first_readiness = ready
        save()
        assert.equal(ready.state, 'ready')
        assert(ready.readiness_id)
        const plan = await service.prepareFirstDeployment({
          request_key: setup.request_key,
          readiness_id: ready.readiness_id
        })
        assert.equal(plan.source_sha, git.sha)
        command = plan.command
        evidence.first_send = {
          request_key: setup.request_key,
          readiness_id: ready.readiness_id,
          command_key: command.request_key
        }
      } else {
        const status = await service.appStatus({ binding_id: binding, app_id: setup.app_id })
        command = await service.prepareCommand({
          binding_id: binding,
          app_id: setup.app_id,
          expected_ownership_generation: status.ownership_generation,
          expected_source_generation: status.source_generation,
          operation: 'redeploy',
          target: { kind: 'specific_sha', sha: git.sha }
        })
      }
      evidence.pending_deploy = { mode, key: command.request_key }
      save()
    }
    if (command.state === 'prepared' && mode === 'initial') {
      const ready = await service.projectReadiness(setup.request_key)
      assert.equal(ready.state, 'ready')
      assert(ready.readiness_id)
      const plan = await service.prepareFirstDeployment({
        request_key: setup.request_key,
        readiness_id: ready.readiness_id
      })
      assert.equal(plan.command.request_key, command.request_key)
      assert.equal(plan.source_sha, git.sha)
      evidence.first_send = {
        request_key: setup.request_key,
        readiness_id: ready.readiness_id,
        command_key: command.request_key
      }
      save()
    }
    if (command.state === 'prepared') {
      try {
        command =
          mode === 'initial'
            ? await service.sendFirstDeployment(evidence.first_send)
            : await service.sendCommand(command.request_key)
      } catch {
        command = await service.checkCommand(command.request_key)
      }
    }
    assert.equal(command.state, 'accepted')
    assert.equal(command.target_sha, git.sha)
    const end = Date.now() + 8 * 60000
    let status
    while (Date.now() < end) {
      status = await service.appStatus({ binding_id: binding, app_id: setup.app_id })
      if (
        status.latest_job_id === command.job_id &&
        ['succeeded', 'failed', 'rolled_back', 'uncertain'].includes(status.latest_job_state)
      )
        break
      await new Promise((done) => setTimeout(done, 2500))
    }
    evidence.last_job = status
    save()
    assert.equal(status.latest_job_id, command.job_id)
    assert.equal(status.latest_job_state, mode === 'health-fault' ? 'rolled_back' : 'succeeded')
    const runtime = await runtimeProof(command.job_id)
    assert(runtime.settled && runtime.leases_released)
    assert.equal(runtime.database_runtime.database_id, pg.metadata.database_id)
    assert.equal(runtime.database_runtime.public_port, null)
    if (evidence.initial_database_runtime)
      assert.deepEqual(runtime.database_runtime, evidence.initial_database_runtime)
    else evidence.initial_database_runtime = runtime.database_runtime
    const publicState = await verifyHttp(mode === 'health-fault' ? 'update' : mode)
    const value = { job_id: command.job_id, git, status, ...publicState, ...runtime }
    evidence.deployments[mode] = value
    delete evidence.pending_deploy
    save()
    preserved(await snapshot())
    check(
      'actual_PG_' + mode + '_1000rows_stable_CID_volume_systemID_signed_H2_old_seven_unchanged'
    )
    return value
  }
  await deploy('initial')
  await deploy('update')
  await deploy('health-fault')
  await deploy('final')
  progress('revoke-and-final-attestation')
  if (!evidence.client_revoked) {
    await service.revoke(binding)
    evidence.client_revoked = true
    save()
  }
  observed = await snapshot()
  preserved(observed)
  quiescent(observed)
  evidence.after = observed
  evidence.public_HTTP = await Promise.all(
    Array.from({ length: 7 }, (_, i) => 30000 + i).map(async (port) => {
      const response = await fetch('http://167.71.202.116:' + port, {
        signal: AbortSignal.timeout(8000)
      })
      await response.body?.cancel()
      return { port, status: response.status }
    })
  )
  assert(evidence.public_HTTP.every((row) => row.status === 200))
  check('scoped_client_revoked_private_profile_closed_eight_apps_paused_old_seven_HTTP200')
  evidence.PG_application_deployed = true
  evidence.GUI_first_deployment_PG_supported = false
  evidence.logical_backup_verified = false
  evidence.whole_database_feature_ready = false
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
