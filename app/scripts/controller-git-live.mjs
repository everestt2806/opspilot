/* eslint-disable @typescript-eslint/explicit-function-return-type -- Standalone operational live-gate CLI. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import {
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'

// This intentionally uses a private disposable Desktop DB, never the user's profile.
// Controller and healthy demo remain; auto policy is paused and temporary access revoked.
if (
  !process.version.startsWith('v22.') ||
  process.argv[2] !== '--confirm-development-git-deploy' ||
  ![3, 5].includes(process.argv.length) ||
  (process.argv.length === 5 && process.argv[3] !== '--continue-record')
)
  throw Error('NODE22_AND_EXPLICIT_DEVELOPMENT_INSTALL_CONFIRMATION_REQUIRED')
const require = createRequire(import.meta.url)
const esbuild = createRequire(require.resolve('vite/package.json'))('esbuild')
const project = resolve(import.meta.dirname, '..')
const parent = join(project, '.out-scripts/controller-git-live')
const nonce = randomBytes(8).toString('hex'),
  directory = join(parent, nonce)
const resumeNonce = process.argv[3] === '--continue-record' ? process.argv[4] : null
if (resumeNonce && !/^[a-f0-9]{16}$/.test(resumeNonce)) throw Error('LIVE_RESUME_INPUT_INVALID')
const previous = resumeNonce
  ? JSON.parse(readFileSync(join(parent, resumeNonce, 'result.json'), 'utf8'))
  : null
mkdirSync(directory, { recursive: true })
const evidence = {
  status: 'RUNNING',
  checks: [],
  remote_mutation_attempted: false,
  controller_retained: true,
  demo_application_retained: false,
  auto_gate: [],
  local_db_removed: false
}
const checks = evidence.checks
const verifier = require(join(project, 'out/main/controllerResourceVerifier.js'))
verifier.verifyPackagedControllerResources(join(project, 'resources/controller-releases'))
const catalog = verifier.builtinControllerInstallerCatalog()
const bundle = join(directory, 'entry.cjs')
await esbuild.build({
  entryPoints: [join(project, 'scripts/controller-bootstrap-lab/entry.ts')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  packages: 'external',
  define: { __OPSPILOT_CONTROLLER_INSTALLER_CATALOG__: JSON.stringify(catalog) },
  plugins: [
    {
      name: 'raw',
      setup(build) {
        build.onResolve({ filter: /\?raw$/ }, (args) => ({
          path: resolve(args.resolveDir, args.path.slice(0, -4)),
          namespace: 'raw'
        }))
        build.onLoad({ filter: /.*/, namespace: 'raw' }, (args) => ({
          contents: readFileSync(args.path, 'utf8'),
          loader: 'text'
        }))
      }
    }
  ]
})
let inputText = ''
process.stdin.setEncoding('utf8')
for await (const chunk of process.stdin) {
  inputText += chunk
  if (Buffer.byteLength(inputText) > 32768) throw Error('INPUT_TOO_LARGE')
}
let input
try {
  input = JSON.parse(inputText)
} catch {
  throw Error('LIVE_INPUT_INVALID')
}
inputText = ''
const { z } = require('zod')
const parsed = z
  .strictObject({
    host: z.string().min(1).max(253),
    port: z.number().int().min(1).max(65535).default(22),
    username: z.literal('root'),
    host_fingerprint: z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/),
    password: z.string().min(1).max(8192),
    expected_controller_id: z.uuid(),
    expected_source_sha: z.string().regex(/^[a-f0-9]{40}$/)
  })
  .safeParse(input)
if (!parsed.success) throw Error('LIVE_INPUT_INVALID')
const config = parsed.data
input.password = ''
const {
  initializeDatabase,
  closeDatabase,
  VpsRepository,
  AesGcmCredentialCipher,
  SshManager,
  loadSecret,
  DesktopControllerService,
  ControllerInstallerResources,
  installDockerOnVps,
  readDockerVersion
} = require(bundle)
const local = join(directory, 'private-profile')
mkdirSync(local, { mode: 0o700 })
const db = initializeDatabase(local)
const key = randomBytes(32),
  cipher = new AesGcmCredentialCipher(key)
key.fill(0)
const repository = new VpsRepository(db)
const vps = repository.create({
  name: 'Development controller',
  host: config.host,
  port: config.port,
  username: config.username,
  auth_type: 'password',
  host_fingerprint: config.host_fingerprint,
  credential: cipher.encrypt(config.password)
})
config.password = ''
const ssh = new SshManager((id) => {
  const profile = repository.getById(id)
  return {
    host: profile.host,
    port: profile.port,
    username: profile.username,
    authType: profile.auth_type,
    hostFingerprint: profile.host_fingerprint ?? null,
    secret: loadSecret(db, cipher, id)
  }
})
const resources = new ControllerInstallerResources(
  catalog,
  join(project, 'resources/controller-releases')
)
let binding,
  service,
  setup,
  autoEnabled = false
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const progress = (phase) => {
  writeFileSync(
    join(directory, 'progress.json'),
    JSON.stringify({ phase, checks, app_id: setup?.app_id ?? null })
  )
  console.log(JSON.stringify({ phase, evidence_directory: directory }))
}
const snapshot = async () => {
  const appId = setup?.app_id ?? 0
  assert.ok(Number.isSafeInteger(appId) && appId >= 0)
  const command = `python3 - <<'PY'
import json,sqlite3
db=sqlite3.connect('file:/var/lib/opspilot-controller/opspilot.db?mode=ro',uri=True)
db.row_factory=sqlite3.Row
def rows(sql):return [dict(row) for row in db.execute(sql)]
print(json.dumps({'active_experiments':db.execute("SELECT count(*) FROM experiment_run WHERE status='running'").fetchone()[0],
'app_count':db.execute('SELECT count(*) FROM app').fetchone()[0],
'apps':rows('SELECT id,name,current_deployment_id FROM app ORDER BY id'),
'deployments':rows('SELECT id,version,status,git_commit_sha,exposure_status FROM deployment WHERE app_id=${appId} ORDER BY id'),
'jobs':rows('SELECT job_id,state,target_sha,trigger,safe_error_code FROM product_deploy_job WHERE app_id=${appId} ORDER BY created_at'),
'desired':rows('SELECT desired_sha,reconciliation_state,auto_paused FROM product_desired_branch WHERE app_id=${appId}')}))
db.close()
PY`
  const result = await ssh.exec(vps.id, command, {
    logCommand: false,
    retryOnReconnect: false,
    maxStdoutBytes: 65536,
    maxStderrBytes: 1024,
    timeoutMs: 15000
  })
  if (result.code !== 0) throw Error('READONLY_CONTROLLER_SNAPSHOT_FAILED')
  return JSON.parse(result.stdout)
}
const external = async (path) => {
  const response = await fetch(`http://${config.host}:30000${path}`, {
    redirect: 'error',
    signal: AbortSignal.timeout(10000)
  })
  return { status: response.status, body: (await response.text()).slice(0, 1024) }
}
const policy = async (action) => {
  const apps = await service.apps({ binding_id: binding })
  const app = apps.items.find((v) => v.app_id === setup.app_id)
  assert.ok(app)
  const prepared = await service.prepareCommand({
    binding_id: binding,
    app_id: app.app_id,
    expected_ownership_generation: app.ownership_generation,
    expected_source_generation: app.source_generation,
    operation: 'policy',
    action
  })
  const sent = await service.sendCommand(prepared.request_key)
  assert.equal(sent.state, 'accepted')
  return sent
}
try {
  service = new DesktopControllerService(db, cipher, ssh, undefined, resources.entries(), resources)
  const release = (await service.installerOverview()).releases.find((v) => v.state === 'available')
  assert.ok(release)
  const review = await service.reviewInstaller({ vps_id: vps.id, release_id: release.release_id })
  assert.equal(review.next, 'inspect_existing')
  assert.equal(review.plan.remote_existing, true)
  const adoption = await service.prepareInstaller({ plan_id: review.plan.plan_id })
  const installed = await service.inspectInstallation(adoption.request_key)
  assert.equal(installed.last_result.controller_id, config.expected_controller_id)
  assert.equal(installed.last_result.service_state, 'running')
  evidence.installation = {
    request_key: installed.request_key,
    controller_id: installed.controller_id,
    runtime_uid: installed.last_result.runtime_uid
  }
  checks.push('existing_controller_adopted_without_reinstall')
  const initial = await snapshot()
  assert.equal(initial.active_experiments, 0)
  if (previous) {
    assert.equal(previous.installation.controller_id, config.expected_controller_id)
    assert.equal(previous.project.app_id, 1)
    assert.equal(initial.app_count, 1)
    assert.deepEqual(initial.apps, [{ id: 1, name: 'san-nha-live', current_deployment_id: null }])
  } else assert.equal(initial.app_count, 0)
  evidence.before = initial
  checks.push(
    previous
      ? 'no_active_experiment_and_only_known_unstarted_demo'
      : 'no_active_experiment_and_no_existing_app'
  )
  progress('docker-preparation')
  let docker = await readDockerVersion(ssh, vps.id)
  if (!docker) {
    evidence.remote_mutation_attempted = true
    docker = await installDockerOnVps(ssh, vps.id)
  }
  const compose = await ssh.exec(vps.id, 'docker compose version --short', {
    logCommand: false,
    maxStdoutBytes: 4096,
    maxStderrBytes: 1024
  })
  assert.equal(compose.code, 0)
  evidence.docker = { version: docker, compose: compose.stdout.trim() }
  checks.push('docker_and_compose_prepared')
  const intent = {
    installation_request_key: installed.request_key,
    display_name: 'Live Git gate',
    allow_write: true
  }
  const preparedBinding = await service.prepareInstalledRegistration(intent)
  binding = preparedBinding.binding_id
  assert.equal(
    (await service.registerInstalled({ ...intent, binding_id: binding })).state,
    'active'
  )
  checks.push('installed_write_binding_with_explicit_consent')
  progress('target-registration')
  let authority, admin, commands
  if (previous) {
    const {
      DesktopControllerVault,
      DesktopControllerEnrollment,
      DesktopControllerCommands
    } = require(bundle)
    const vault = new DesktopControllerVault(db, cipher)
    admin = new DesktopControllerEnrollment(vault, ssh)
    commands = new DesktopControllerCommands(db, vault, ssh)
    setup = previous.project
    const targets = await service.projectTargets({ binding_id: binding })
    assert.equal(targets.items.length, 1)
    assert.equal(targets.items[0].host, config.host)
    assert.equal(targets.items[0].host_fingerprint, config.host_fingerprint)
    const read = await ssh.exec(
      vps.id,
      `python3 - <<'PY'
import sqlite3,json
c=sqlite3.connect('file:/var/lib/opspilot-controller/opspilot.db?mode=ro',uri=True);c.row_factory=sqlite3.Row
print(json.dumps(dict(c.execute('SELECT app_id,ownership_generation,source_generation,source_config_sha256 FROM product_app_control WHERE app_id=1').fetchone())))
PY`,
      { logCommand: false, maxStdoutBytes: 4096, maxStderrBytes: 1024 }
    )
    assert.equal(read.code, 0)
    const row = JSON.parse(read.stdout)
    authority = {
      format: 1,
      controller_id: config.expected_controller_id,
      app_id: row.app_id,
      expected_ownership_generation: row.ownership_generation,
      expected_source_generation: row.source_generation,
      expected_source_config_sha256: row.source_config_sha256,
      expected_target_security_revision: targets.items[0].ssh_security_revision
    }
    evidence.resumed_from = resumeNonce
    checks.push('explicit_recovery_of_known_unstarted_demo_without_new_project')
  } else {
    const targetIntent = await service.prepareTarget({ binding_id: binding, local_vps_id: vps.id })
    const target = await service.sendTarget({
      request_key: targetIntent.request_key,
      confirm_transfer: true
    })
    assert.equal(target.state, 'registered')
    evidence.target_registration = {
      request_key: target.request_key,
      remote_vps_id: target.remote_vps_id,
      state: target.state
    }
    checks.push('encrypted_pinned_target_credential_registration')
    const projectIntent = await service.prepareProject({
      binding_id: binding,
      target_vps_id: target.remote_vps_id,
      app_name: 'san-nha-live',
      framework: 'express',
      repository_url: 'https://github.com/everestt2806/opspilot.git',
      production_ref: 'demo/r3c6h3-20261110',
      repository_root: 'demo-apps/san-nha-booking',
      host_port: 30000,
      container_port: 3000,
      healthcheck_path: '/health'
    })
    setup = await service.sendProject(projectIntent.request_key)
    assert.equal(setup.state, 'registered')
  }
  evidence.demo_application_retained = true
  evidence.project = {
    app_id: setup.app_id,
    request_key: setup.request_key,
    repository_url: setup.repository_url,
    production_ref: setup.production_ref,
    repository_root: setup.repository_root,
    host_port: setup.host_port
  }
  checks.push('product_git_project_registered_paused')
  progress('source-and-target-verification')
  const source = previous
    ? await admin.verifyProjectSource(binding, authority)
    : await service.verifyProjectSource(setup.request_key)
  assert.equal(source.commit_sha, config.expected_source_sha)
  assert.equal(source.auto_deploy_paused, true)
  evidence.source = source
  const enrollment = previous
    ? await admin.enrollProjectTarget(binding, {
        ...authority,
        target_root: '/var/lib/opspilot-product'
      })
    : await service.enrollProjectTarget({
        request_key: setup.request_key,
        target_root: '/var/lib/opspilot-product'
      })
  assert.equal(enrollment.state, 'enrolled')
  checks.push('full_sha_source_and_target_hmac_enrollment')
  const readiness = previous
    ? await admin.projectReadiness(binding, authority)
    : await service.projectReadiness(setup.request_key)
  evidence.readiness = readiness
  assert.equal(readiness.state, 'ready')
  let accepted
  if (previous) {
    // Operational continuation of a disposable CLI profile. Keep the server's
    // atomic first-deployment precondition; never forge a Desktop UI receipt.
    assert.equal(readiness.commit_sha, config.expected_source_sha)
    assert.ok(Date.now() - Date.parse(readiness.checked_at) < 30000)
    const command = await commands.prepare({
      binding_id: binding,
      app_id: setup.app_id,
      expected_ownership_generation: authority.expected_ownership_generation,
      expected_source_generation: authority.expected_source_generation,
      operation: 'redeploy',
      require_first_deployment: true,
      target: { kind: 'specific_sha', sha: readiness.commit_sha }
    })
    accepted = await commands.send(command.request_key)
    evidence.first_deploy_entry = 'TRUSTED_CLI_WITH_SERVER_ATOMIC_PRECONDITION'
  } else {
    const first = await service.prepareFirstDeployment({
      request_key: setup.request_key,
      readiness_id: readiness.readiness_id
    })
    assert.equal(first.source_sha, config.expected_source_sha)
    accepted = await service.sendFirstDeployment({
      request_key: setup.request_key,
      readiness_id: readiness.readiness_id,
      command_key: first.command.request_key
    })
    evidence.first_deploy_entry = 'DESKTOP_MAIN_READINESS_RECEIPT'
  }
  assert.equal(accepted.state, 'accepted')
  checks.push('reviewed_first_deployment_queued_by_product_api')
  progress('first-deployment-running')
  const deadline = Date.now() + 12 * 60000
  let firstState
  while (Date.now() < deadline) {
    const state = await snapshot()
    if (state.jobs.some((v) => ['failed', 'rolled_back', 'uncertain'].includes(v.state))) {
      evidence.first_deployment_failure = state
      throw Error('FIRST_DEPLOYMENT_TERMINAL_FAILURE')
    }
    if (
      state.deployments.some(
        (v) => v.status === 'running' && v.git_commit_sha === config.expected_source_sha
      ) &&
      state.jobs.some((v) => v.state === 'succeeded')
    ) {
      firstState = state
      break
    }
    await sleep(5000)
  }
  assert.ok(firstState, 'FIRST_DEPLOYMENT_TIMEOUT')
  evidence.first_deployment = firstState
  const health = await external('/health'),
    marker = await external('/release.txt')
  assert.equal(health.status, 200)
  assert.equal(marker.status, 200)
  assert.equal(marker.body.trim(), 'demo-v1')
  evidence.public_http = { health, marker }
  checks.push('systemd_product_pipeline_first_deploy_and_external_http')
  await policy('resume')
  autoEnabled = true
  await ssh.disconnectAll()
  evidence.desktop_executor_used = false
  progress('ready-for-auto-push')
  writeFileSync(
    join(directory, 'ready-for-push.json'),
    JSON.stringify({
      controller_id: config.expected_controller_id,
      app_id: setup.app_id,
      control_file: join(directory, 'expected-push.json'),
      current_sha: config.expected_source_sha
    })
  )
  const watchDeadline = Date.now() + 25 * 60000
  const seen = new Set()
  while (Date.now() < watchDeadline) {
    let expected
    try {
      expected = JSON.parse(readFileSync(join(directory, 'expected-push.json'), 'utf8'))
    } catch {
      await sleep(2000)
      continue
    }
    const parsed = z
      .strictObject({
        sha: z.string().regex(/^[a-f0-9]{40}$/),
        marker: z.string().regex(/^demo-v[1-9][0-9]*$/),
        outcome: z.enum(['running', 'rolled_back']),
        final: z.boolean()
      })
      .safeParse(expected)
    if (!parsed.success) throw Error('AUTO_GATE_CONTROL_INVALID')
    expected = parsed.data
    if (seen.has(expected.sha)) {
      await sleep(2000)
      continue
    }
    const state = await snapshot()
    const jobs = state.jobs.filter(
      (v) => v.target_sha === expected.sha && v.trigger === 'branch_poll'
    )
    if (jobs.length > 1) throw Error('AUTO_GATE_DUPLICATE_JOB')
    const terminal =
      jobs[0] && ['succeeded', 'failed', 'rolled_back', 'uncertain'].includes(jobs[0].state)
    if (!terminal) {
      await sleep(5000)
      continue
    }
    const live = state.apps.find((v) => v.id === setup.app_id)
    const currentDeployment = state.deployments.find((v) => v.id === live.current_deployment_id)
    const health = await external('/health'),
      marker = await external('/release.txt')
    assert.equal(health.status, 200)
    assert.equal(marker.body.trim(), expected.marker)
    assert.equal(jobs[0].state, expected.outcome === 'running' ? 'succeeded' : 'rolled_back')
    if (expected.outcome === 'running') assert.equal(currentDeployment.git_commit_sha, expected.sha)
    else assert.notEqual(currentDeployment.git_commit_sha, expected.sha)
    evidence.auto_gate.push({ expected, state, public_http: { health, marker } })
    seen.add(expected.sha)
    progress(expected.final ? 'auto-gate-complete' : 'auto-push-verified')
    if (expected.final) {
      checks.push('desktop_disconnected_auto_push_success_and_failure_preservation')
      evidence.status = 'PASS'
      break
    }
  }
  if (evidence.status !== 'PASS') throw Error('AUTO_GATE_TIMEOUT')
} catch (error) {
  const code =
    error?.context?.cause?.message ?? error?.cause?.message ?? error?.code ?? error?.message ?? ''
  evidence.status = 'FAIL'
  evidence.error = /^[A-Z][A-Z0-9_]{1,100}$/.test(code) ? code : 'LIVE_GIT_CHECK_FAILED'
  try {
    evidence.failure_snapshot = await snapshot()
  } catch {
    /* Keep previously verified observations. */
  }
  process.exitCode = 1
} finally {
  if (autoEnabled) {
    try {
      await policy('pause')
      checks.push('demo_auto_deploy_paused_after_gate')
    } catch {
      evidence.status = 'FAIL'
      evidence.cleanup_error = 'AUTO_POLICY_PAUSE_UNCONFIRMED'
      process.exitCode = 1
    }
  }
  if (binding) {
    try {
      assert.equal((await service.revoke(binding)).state, 'disabled')
      checks.push('temporary_write_client_revoked')
    } catch {
      evidence.status = 'FAIL'
      evidence.cleanup_error = 'CLIENT_REVOCATION_UNCONFIRMED'
      process.exitCode = 1
    }
  }
  await ssh.disconnectAll()
  closeDatabase()
  assert.equal(dirname(local), directory)
  assert.ok(directory.startsWith(parent + sep))
  assert.equal(lstatSync(local).isSymbolicLink(), false)
  rmSync(local, { recursive: true })
  evidence.local_db_removed = true
  const fd = openSync(join(directory, 'result.json'), 'wx', 0o600)
  try {
    writeFileSync(fd, JSON.stringify(evidence, null, 2))
  } finally {
    closeSync(fd)
  }
  console.log(
    JSON.stringify({
      status: evidence.status,
      checks,
      error: evidence.error,
      evidence_directory: directory
    })
  )
}
