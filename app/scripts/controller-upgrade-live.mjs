/* eslint-disable @typescript-eslint/explicit-function-return-type -- Operational development-VPS gate, no production profile. */
import assert from 'node:assert/strict'
import { journalKey } from './controller-upgrade-live/journal-key.mjs'
import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync, existsSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'

if (process.argv[2] !== '--confirm-development-controller-upgrade' || process.argv.length !== 3) {
  console.log('{"status":"REJECTED","error_code":"EXPLICIT_DEVELOPMENT_UPGRADE_REQUIRED"}')
  process.exit(2)
}
const project = resolve(import.meta.dirname, '..'),
  require = createRequire(join(project, 'package.json')),
  nonce = randomBytes(8).toString('hex'),
  directory = join(project, '.out-scripts/controller-upgrade-live', nonce),
  local = join(directory, 'private-profile')
mkdirSync(local, { recursive: true })
const evidence = {
    status: 'RUNNING',
    checks: [],
    remote_mutation_attempted: false,
    private_db_removed: false,
    gui_tested: false,
    production_profile_used: false
  },
  expectedController = 'dc586bb7-cd83-484c-b036-e5ad40ec106d',
  expectedInstallation = '7573f0b1-4262-4305-8b7d-9a1edce49626',
  expectedPin = 'SHA256:0X8J5LfPr6iZqEspsD379FvFEWrLfYpN0wfNYjQ87+E'
let phase = 'input',
  db,
  ssh,
  service,
  binding,
  config
const save = () =>
  writeFileSync(
    join(directory, 'result.json'),
    JSON.stringify({ ...evidence, phase }, null, 2) + '\n'
  )
const progress = (next) => {
  phase = next
  save()
  console.log(JSON.stringify({ phase, record: nonce }))
}
const safeCode = (error) => {
  for (const candidate of [error?.context?.cause?.message, error?.code, error?.message])
    if (typeof candidate === 'string' && /^[A-Z][A-Z0-9_]{1,80}$/.test(candidate)) return candidate
  return error?.name === 'AssertionError' ? 'GATE_ASSERTION_FAILED' : 'LIVE_UPGRADE_FAILED'
}
const snapshotCommand = `python3 - <<'PY'
import os,json,sqlite3,hashlib,subprocess
def h(p):
 with open(p,'rb') as f:return hashlib.sha256(f.read()).hexdigest()
c=sqlite3.connect('file:/var/lib/opspilot-controller/opspilot.db?mode=ro',uri=True);c.row_factory=sqlite3.Row
def rows(s):return [dict(r) for r in c.execute(s)]
p='/var/lib/opspilot-controller-install/receipt.json'
with open(p) as f:r=json.load(f)
print(json.dumps({'receipt':r,'receipt_sha256':h(p),'database_inode':os.stat('/var/lib/opspilot-controller/opspilot.db').st_ino,
'schema':c.execute('SELECT max(version) FROM schema_version').fetchone()[0],
'active_experiments':c.execute("SELECT count(*) FROM experiment_run WHERE status='running'").fetchone()[0],
'active_jobs':c.execute("SELECT count(*) FROM product_deploy_job WHERE state NOT IN ('succeeded','failed','rolled_back','superseded','cancelled')").fetchone()[0],
'active_clients':c.execute('SELECT count(*) FROM product_desktop_client WHERE revoked_at IS NULL').fetchone()[0],
'apps':rows('SELECT id,name,current_deployment_id FROM app ORDER BY id'),
'deployment':dict(c.execute('SELECT id,status,git_commit_sha,exposure_status,exposure_evidence_json FROM deployment WHERE id=4').fetchone()),
'desired':rows('SELECT app_id,auto_paused,reconciliation_state FROM product_desired_branch ORDER BY app_id'),
'vps_digest':hashlib.sha256(json.dumps(rows('SELECT id,host,port,username,auth_type,host_fingerprint,ssh_security_revision,hex(encrypted_secret) AS ciphertext,hex(iv) AS iv,hex(auth_tag) AS tag FROM vps ORDER BY id'),sort_keys=True).encode()).hexdigest(),
'files':[{'path':p,'inode':os.stat('/var/lib/opspilot-controller/'+p).st_ino,'sha256':h('/var/lib/opspilot-controller/'+p)} for p in os.listdir('/var/lib/opspilot-controller') if p in ('.controller-runtime-key','.product-controller-initialized','.controller-installation')],
'service':subprocess.check_output(['systemctl','show','opspilot-controller-product.service','--property=ActiveState,MainPID,User']).decode()}))
c.close()
PY`
try {
  let text = ''
  for await (const chunk of process.stdin) {
    text += chunk
    if (text.length > 32768) throw Error('INPUT_TOO_LARGE')
  }
  config = JSON.parse(text)
  text = ''
  if (
    config.host !== '167.71.202.116' ||
    config.port !== 22 ||
    config.username !== 'root' ||
    config.host_fingerprint !== expectedPin ||
    typeof config.password !== 'string' ||
    !config.password
  )
    throw Error('EXPECTED_DEVELOPMENT_VPS_ONLY')
  const verifier = require(join(project, 'out/main/controllerResourceVerifier.js'))
  verifier.verifyPackagedControllerResources(join(project, 'resources/controller-releases'))
  const catalog = verifier.builtinControllerInstallerCatalog(),
    esbuild = createRequire(require.resolve('vite/package.json'))('esbuild')
  await esbuild.build({
    entryPoints: [join(project, 'scripts/controller-upgrade-live/entry.ts')],
    outfile: join(directory, 'entry.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    packages: 'external',
    plugins: [
      {
        name: 'raw',
        setup(b) {
          b.onResolve({ filter: /\?raw$/ }, (a) => ({
            path: resolve(a.resolveDir, a.path.slice(0, -4)),
            namespace: 'raw'
          }))
          b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({
            contents: readFileSync(a.path, 'utf8'),
            loader: 'text'
          }))
        }
      }
    ]
  })
  const code = require(join(directory, 'entry.cjs')),
    key = journalKey(local, true),
    cipher = new code.AesGcmCredentialCipher(key)
  key.fill(0)
  db = code.initializeDatabase(local)
  const repository = new code.VpsRepository(db),
    profile = repository.create({
      name: 'Development upgrade gate',
      host: config.host,
      port: 22,
      username: 'root',
      auth_type: 'password',
      host_fingerprint: expectedPin,
      credential: cipher.encrypt(config.password)
    })
  config.password = ''
  ssh = new code.SshManager((id) => {
    const v = repository.getById(id)
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
      catalog,
      join(project, 'resources/controller-releases')
    ),
    releases = resources.entries(),
    original = releases.find(
      (v) => v.release_sha256 === '96a6a5b46ebede6d8c2e6cb0141028748b98278777cdba8648a89d00d83d15cd'
    ),
    candidate = releases.find((v) => v.release_id === 'linux-x64-node22-20261112-upgrade')
  assert(original && candidate)
  service = new code.DesktopControllerService(db, cipher, ssh, undefined, releases, resources)
  const snapshot = async (id = profile.id) => {
    const response = await ssh.exec(id, snapshotCommand, {
      logCommand: false,
      retryOnReconnect: false,
      maxStdoutBytes: 65536,
      maxStderrBytes: 1024,
      timeoutMs: 20000
    })
    if (response.code !== 0) throw Error('READONLY_SNAPSHOT_FAILED')
    return JSON.parse(response.stdout)
  }
  const publicHealth = async () => {
    const response = await fetch('http://167.71.202.116:30000/health', {
      redirect: 'error',
      signal: AbortSignal.timeout(10000)
    })
    assert.equal(response.status, 200)
    return response.status
  }
  progress('fresh-readonly-preflight')
  const before = await snapshot()
  assert.equal(before.receipt.request_key, expectedInstallation)
  assert.equal(before.receipt.controller_id, expectedController)
  assert.equal(before.receipt.uid, 997)
  assert.equal(before.receipt.release_sha256, original.release_sha256)
  assert.equal(before.active_experiments, 0)
  assert.equal(before.active_jobs, 0)
  assert.equal(before.active_clients, 0)
  assert.equal(before.schema, 29)
  assert.equal(before.apps.length, 1)
  assert.equal(before.apps[0].current_deployment_id, 4)
  assert(before.desired.every((v) => v.auto_paused === 1))
  assert(before.service.includes('ActiveState=active'))
  await publicHealth()
  evidence.before = before
  evidence.checks.push(
    'fresh_pinned_ssh_original_controller_no_active_experiment_or_job_paused_policy_public_http200'
  )
  progress('adopt-original-installation')
  const plan = await service.planInstallation(profile.id, original.release_id)
  assert.equal(plan.remote_existing, true)
  assert.equal(plan.request_key, expectedInstallation)
  await service.prepareInstallation(plan.plan_id)
  const installed = await service.inspectInstallation(plan.request_key)
  assert.equal(installed.controller_id, expectedController)
  assert.equal(installed.last_result.runtime_uid, 997)
  const intent = {
    installation_request_key: plan.request_key,
    display_name: 'Development upgrade verification',
    allow_write: true
  }
  binding = (await service.prepareInstalledRegistration(intent)).binding_id
  evidence.remote_mutation_attempted = true
  await service.registerInstalled({ ...intent, binding_id: binding })
  const vault = new code.DesktopControllerVault(db, cipher),
    tokenBefore = vault.resolve(binding).accessToken,
    clientBefore = vault.get(binding).remote_client_id
  const legacyExposure = await service.exposure({ binding_id: binding, app_id: 1 })
  assert.equal(legacyExposure.state, 'unavailable')
  assert.equal(legacyExposure.reason_code, 'UNSUPPORTED')
  evidence.checks.push(
    'original_trusted_inspection_and_explicit_temporary_scoped_binding_old_exposure_unsupported'
  )
  progress('review-prepare-upgrade')
  const review = await service.reviewUpgrade({
    installation_request_key: expectedInstallation,
    release_id: candidate.release_id
  })
  const prepared = await service.prepareUpgrade({ plan_id: review.plan_id })
  evidence.upgrade = prepared
  save()
  progress('transfer-upgrade-resource')
  await service.sendUpgrade({
    request_key: prepared.request_key,
    operation: 'transfer',
    consent: true
  })
  evidence.checks.push('protected_upgrade_transfer_distinct_uuid_namespace_original_pins_retained')
  progress('root-upgrade')
  let upgraded
  try {
    upgraded = await service.sendUpgrade({
      request_key: prepared.request_key,
      operation: 'upgrade',
      consent: true
    })
  } catch (error) {
    evidence.upgrade_send_error = safeCode(error)
    // One readonly same-key inspect; never automatically repeat a write.
    upgraded = await service.inspectUpgrade(prepared.request_key)
  }
  evidence.upgrade = upgraded
  assert.equal(upgraded.state, 'active')
  assert.equal(upgraded.last_result.service_state, 'running')
  assert.equal(upgraded.last_result.runtime_uid, 997)
  assert.equal(upgraded.is_current, true)
  assert.throws(() => vault.resolve(binding))
  const bindingReview = await service.reviewUpgradeBinding({
    binding_id: binding,
    request_key: prepared.request_key
  })
  await service.refreshUpgradeBinding({ plan_id: bindingReview.plan_id, consent: true })
  assert.equal(vault.resolve(binding).accessToken, tokenBefore)
  assert.equal(vault.get(binding).remote_client_id, clientBefore)
  await publicHealth()
  const after = await snapshot()
  for (const key of ['receipt_sha256', 'database_inode', 'schema', 'vps_digest'])
    assert.deepEqual(after[key], before[key])
  assert.deepEqual(after.files, before.files)
  assert.deepEqual(after.apps, before.apps)
  assert.deepEqual(after.desired, before.desired)
  assert.equal(after.deployment.git_commit_sha, before.deployment.git_commit_sha)
  assert.equal(after.deployment.status, 'running')
  evidence.after_upgrade = after
  evidence.checks.push(
    'settled_current_upgrade_keeps_original_receipt_identity_uid_key_db_inode_target_and_healthy_demo'
  )
  evidence.checks.push('separate_runtime_binding_confirmation_reuses_original_token_client_scopes')
  progress('actual-product-exposure')
  const observation = await service.exposure({ binding_id: binding, app_id: 1 }, true)
  evidence.exposure = observation
  assert.equal(observation.state, 'recorded')
  assert.equal(observation.view.status, 'reachable')
  assert.equal(observation.view.observation.observer, 'desktop_external')
  const observed = await snapshot()
  assert.equal(observed.deployment.exposure_status, 'reachable')
  const storedEvidence = JSON.parse(observed.deployment.exposure_evidence_json)
  assert(JSON.stringify(storedEvidence).includes(observation.view.observation.observation_id))
  evidence.checks.push(
    'actual_independent_windows_public_probe_persists_reachable_via_authenticated_installed_api'
  )
  progress('same-machine-reconnect')
  const secret = code.loadSecret(db, cipher, profile.id)
  repository.delete(profile.id)
  const readded = repository.create({
    name: 'Readded development gate',
    host: config.host,
    port: 22,
    username: 'root',
    auth_type: 'password',
    host_fingerprint: expectedPin,
    credential: cipher.encrypt(secret)
  })
  assert.throws(() => vault.resolve(binding))
  const authority = await service.reviewControllerAuthority({
    installation_request_key: expectedInstallation,
    vps_id: readded.id
  })
  await service.confirmControllerAuthority({ plan_id: authority.plan_id, consent: true })
  assert.throws(() => vault.resolve(binding))
  const reconnect = await service.reviewUpgradeBinding({
    binding_id: binding,
    request_key: prepared.request_key
  })
  await service.refreshUpgradeBinding({ plan_id: reconnect.plan_id, consent: true })
  assert.equal(vault.resolve(binding).accessToken, tokenBefore)
  assert.equal(vault.get(binding).remote_client_id, clientBefore)
  assert.equal(vault.resolve(binding).principal.vpsId, readded.id)
  const current = await service.exposure({ binding_id: binding, app_id: 1 })
  assert.equal(current.view.observation.observation_id, observation.view.observation.observation_id)
  const targets = await service.projectTargets({ binding_id: binding })
  assert.equal(targets.controller_id, expectedController)
  assert.equal(targets.items.length, 1)
  const reconnected = await snapshot(readded.id)
  assert.equal(reconnected.service, observed.service)
  await publicHealth()
  evidence.checks.push(
    'actual_local_vps_readd_fresh_pinned_ssh_then_separate_api_refresh_keeps_token_client_pid_and_persisted_observation'
  )
  progress('revoke-and-cleanup')
  await service.revoke(binding)
  assert.equal((await snapshot(readded.id)).active_clients, 0)
  evidence.after = await snapshot(readded.id)
  evidence.temporary_client_revoked = true
  evidence.checks.push(
    'temporary_client_revoked_and_controller_healthy_demo_paused_policy_retained'
  )
  evidence.status = 'PASS'
} catch (error) {
  evidence.status = 'FAIL'
  evidence.error_code = safeCode(error)
  evidence.failure_location =
    /controller-upgrade-live\.mjs:\d+:\d+/.exec(error?.stack ?? '')?.[0] ?? 'unknown'
} finally {
  if (config) config.password = ''
  await ssh?.disconnectAll()
  if (db?.open) db.close()
  if (evidence.status === 'PASS') {
    assert.equal(dirname(local), directory)
    assert.equal(realpathSync(local), resolve(local))
    rmSync(local, { recursive: true })
    evidence.private_db_removed = !existsSync(local)
  } else
    evidence.private_journal_retained_for_explicit_same_key_recovery = existsSync(
      join(local, 'opspilot.db')
    )
  save()
  console.log(
    JSON.stringify({
      status: evidence.status,
      checks: evidence.checks.length,
      error_code: evidence.error_code,
      phase,
      record: nonce,
      private_db_removed: evidence.private_db_removed
    })
  )
  process.exit(evidence.status === 'PASS' ? 0 : 1)
}
