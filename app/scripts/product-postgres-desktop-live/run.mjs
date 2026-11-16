/* eslint-disable @typescript-eslint/explicit-function-return-type -- Dedicated private operator acceptance. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { journalKey } from '../controller-upgrade-live/journal-key.mjs'
import { privateInput } from '../product-environment-live/input.mjs'
import { desktopPostgresSnapshotCommand as helperSnapshotCommand } from './snapshot.mjs'

const args = process.argv.slice(2),
  fresh = args.join(' ') === '--start'
assert(fresh || (args[0] === '--resume' && /^[a-f0-9]{12}$/.test(args[1])))
const appOperation = args[2]
assert(
  fresh ||
    args.length === 2 ||
    (args.length === 3 && ['--transfer-controller', '--recover-controller'].includes(appOperation))
)
const project = resolve(import.meta.dirname, '../..'),
  require = createRequire(join(project, 'package.json')),
  nonce = fresh ? randomBytes(6).toString('hex') : args[1],
  directory = join(project, '.out-scripts/product-postgres-desktop-controller-live', nonce),
  local = join(directory, 'private-profile'),
  controller = 'dc586bb7-cd83-484c-b036-e5ad40ec106d',
  installation = '7573f0b1-4262-4305-8b7d-9a1edce49626',
  parent = 'cc8f33f57ab518c20c75118925522dcc03bb2d2cef04ba94c9bfef101cdb0ddd',
  candidateId = 'linux-x64-node22-20261116-project-postgres',
  candidatePin = '4bc45902888d7e3442e6cd44694c4abbe1685101c5eac94415cb677461e245a5',
  payloadPin = '0ce3a5cab4e95947ca0852cdfdab71ae5ce7ab45eb5b384b017094805845be8e',
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
    'content_digest',
    'apps',
    'containers',
    'owners',
    'desired'
  ])
    assert.deepEqual(after[name], before[name])
  assert.deepEqual(after.helpers, before.helpers)
  assert.deepEqual(after.postgres, before.postgres)
  assert.equal(after.schema, 37)
  assert.equal(after.receipt.controller_id, controller)
  assert.equal(after.receipt.request_key, installation)
  assert.equal(after.receipt.uid, 997)
  const candidateCurrent =
    after.upgrade.request_key === evidence.upgrade_key &&
    after.upgrade.release_sha256 === candidatePin
  const parentCurrent =
    after.upgrade.request_key === before.upgrade.request_key &&
    after.upgrade.release_sha256 === parent
  assert(candidateCurrent || parentCurrent)
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
      name: 'PostgreSQL controller acceptance ' + nonce,
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
      maxStdoutBytes: 256 * 1024,
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
    assert.equal(observed.upgrade.request_key, 'aaf2d779-70f8-42f0-8055-d333bd0b6774')
    assert.equal(observed.upgrade.release_sha256, parent)
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
  assert.equal(observed.postgres.resource_count, 1)
  assert.equal(observed.postgres.data_count, 1000)
  check('fresh_pinned_SSH_schema037_seven_apps_fourteen_app_CIDs_and_retained_PG_quiescent')
  if (!(await service.listInstallations()).length) {
    const review = await service.reviewControllerAdoption({ vps_id: 1 })
    assert.equal(review.controller_id, controller)
    await service.confirmControllerAdoption({ plan_id: review.plan_id, consent: true })
  }
  const intent = {
    installation_request_key: installation,
    display_name: 'PostgreSQL controller ' + nonce,
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
  check('Main_upgrade037_to037_binding_refresh_preserves_seven_apps_PG_data_CIDs_key_source_env')
  assert.equal(observed.schema, 37)
  assert.equal(observed.upgrade.release_sha256, candidatePin)
  assert.deepEqual(observed.helpers, evidence.before.helpers)
  progress('verify-root-sealed-postgres-backup')
  const upgradeKey = evidence.before.upgrade.request_key
  assert(/^[a-f0-9-]{36}$/.test(upgradeKey))
  const backupCommand = `python3 - <<'PY'
import os,stat,hashlib,json,sqlite3,urllib.request
p='/opt/opspilot-controller/revisions/${upgradeKey}/postgres-schema-backup/backup.sqlite'
s=os.lstat(p);d=os.lstat(os.path.dirname(p))
if not stat.S_ISREG(s.st_mode) or s.st_nlink!=1 or os.path.realpath(p)!=p or not 512<=s.st_size<=512*1024*1024:raise ValueError('UNSAFE_BACKUP')
with open(p,'rb') as f:digest=hashlib.sha256(f.read()).hexdigest()
c=sqlite3.connect('file:'+p+'?mode=ro',uri=True)
live=sqlite3.connect('file:/var/lib/opspilot-controller/opspilot.db?mode=ro',uri=True)
with urllib.request.urlopen('http://127.0.0.1:8768/healthz',timeout=5) as response:health=json.load(response)
print(json.dumps({'uid':s.st_uid,'mode':stat.S_IMODE(s.st_mode),'directory_uid':d.st_uid,'directory_mode':stat.S_IMODE(d.st_mode),'sha256':digest,'schema':c.execute('SELECT max(version) FROM schema_version').fetchone()[0],'managed_resources':live.execute('SELECT count(*) FROM product_managed_postgres').fetchone()[0],'database_selections':live.execute('SELECT count(*) FROM product_postgres_selection_request').fetchone()[0],'service_state':health['service_state']}))
c.close()
live.close()
PY`
  const backupResult = await ssh.exec(1, backupCommand, {
    logCommand: false,
    retryOnReconnect: false,
    timeoutMs: 15000,
    maxStdoutBytes: 4096,
    maxStderrBytes: 1024
  })
  assert.equal(backupResult.code, 0)
  evidence.backup = JSON.parse(backupResult.stdout)
  assert.equal(evidence.backup.uid, 0)
  assert.equal(evidence.backup.mode, 0o440)
  assert.equal(evidence.backup.directory_uid, 0)
  assert.equal(evidence.backup.directory_mode, 0o550)
  assert.equal(evidence.backup.schema, 35)
  assert.equal(evidence.backup.managed_resources, 1)
  assert.equal(evidence.backup.database_selections, 1)
  assert.equal(evidence.backup.service_state, 'ready')
  assert.equal(
    evidence.backup.sha256,
    evidence.before.upgrade.postgres_schema_transition.backup.backup_sha256
  )
  check('original_Root_sealed035_backup_retained_while_current_live_PG_resource_unchanged')
  progress('revoke-and-final-attestation')
  if (!evidence.client_revoked) {
    await service.revoke(binding)
    evidence.client_revoked = true
    save()
  }
  observed = await snapshot()
  preserved(observed)
  quiescent(observed)
  assert.deepEqual(observed.helpers, evidence.before.helpers)
  assert.equal(observed.schema, 37)
  const http = await Promise.all(
    Array.from({ length: 7 }, (_, i) => 30000 + i).map(async (port) => {
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
  check('seven_public_HTTP200_existing_helpers_PG_data_unchanged_and_scoped_client_revoked')
  evidence.new_PG_application_deployed = false
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
