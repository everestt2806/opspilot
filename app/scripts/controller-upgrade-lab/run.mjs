/* eslint-disable @typescript-eslint/explicit-function-return-type -- Private root Linux/systemd upgrade proof. */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
if (process.platform !== 'linux' || process.getuid() !== 0 || !process.version.startsWith('v22.'))
  throw Error('ROOT_LINUX_NODE22_REQUIRED')
const modules = process.env.OPSPILOT_CONTROL_PLANE_MODULES,
  newSource = process.env.OPSPILOT_UPGRADE_RELEASE,
  newPin = process.env.OPSPILOT_UPGRADE_RELEASE_PIN
if (!modules || !newSource || !newPin) throw Error('APPROVED_LAB_INPUT_REQUIRED')
const repo = resolve(import.meta.dirname, '../../..'),
  require = createRequire(import.meta.url),
  esbuild = require(join(modules, 'esbuild')),
  nonce = randomBytes(6).toString('hex'),
  root = '/opt/opspilot-controller-upgrade-lab-' + nonce,
  unitName = 'opspilot-upgrade-lab-' + nonce + '.service',
  account = 'opsup' + nonce,
  paths = {
    state: join(root, 'state'),
    installation: join(root, 'installation'),
    data: join(root, 'data'),
    unit: '/etc/systemd/system/' + unitName,
    account
  },
  evidence = join(repo, 'app/.out-scripts/controller-upgrade', nonce),
  checks = [],
  sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
mkdirSync(evidence, { recursive: true })
mkdirSync(root, { mode: 0o755 })
writeFileSync(join(root, '.lab-owner'), nonce, { mode: 0o600, flag: 'wx' })
const tool = join(root, 'trusted.cjs')
await esbuild.build({
  entryPoints: [join(import.meta.dirname, 'entry.ts')],
  outfile: tool,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  packages: 'bundle',
  nodePaths: [modules]
})
const code = require(tool),
  installKey = randomUUID(),
  keys = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()],
  unitAllow = [
    code.renderControllerUnit(paths, installKey),
    ...keys.map((key) => code.renderUpgradedControllerUnit(paths, installKey, key))
  ]
const oldSource = join(repo, 'app/resources/controller-releases/linux-x64-node22-20261110/release'),
  oldPin = '96a6a5b46ebede6d8c2e6cb0141028748b98278777cdba8648a89d00d83d15cd'
function fixtureCopy(source, destination, pin) {
  const bytes = readFileSync(join(source, 'release-manifest.json'))
  assert.equal(sha(bytes), pin)
  cpSync(source, destination, { recursive: true, force: false, errorOnExist: true })
  const manifest = JSON.parse(bytes)
  const folders = (directory) => {
    assert(!lstatSync(directory).isSymbolicLink())
    chmodSync(directory, 0o700)
    for (const name of readdirSync(directory)) {
      const file = join(directory, name),
        info = lstatSync(file)
      assert(!info.isSymbolicLink())
      if (info.isDirectory()) folders(file)
    }
  }
  folders(destination)
  for (const file of manifest.files) chmodSync(join(destination, file.path), file.mode)
  chmodSync(join(destination, 'release-manifest.json'), 0o600)
  return code.verifyControllerRelease(destination, pin)
}
const oldCandidate = join(root, 'old-release'),
  candidate = join(root, 'new-release')
fixtureCopy(oldSource, oldCandidate, oldPin)
fixtureCopy(newSource, candidate, newPin)
function variant(name, suffix) {
  const directory = join(root, name)
  fixtureCopy(candidate, directory, newPin)
  const artifact = join(directory, 'payload/control-plane.cjs')
  writeFileSync(artifact, Buffer.concat([readFileSync(artifact), Buffer.from(suffix)]))
  const bundlePath = join(directory, 'payload/bundle-manifest.json'),
    bundle = JSON.parse(readFileSync(bundlePath, 'utf8'))
  for (const file of bundle.files)
    if (file.path === 'control-plane.cjs') {
      file.sha256 = sha(readFileSync(artifact))
      file.size = lstatSync(artifact).size
    }
  const bundleBytes = Buffer.from(JSON.stringify(bundle) + '\n')
  writeFileSync(bundlePath, bundleBytes)
  const path = join(directory, 'release-manifest.json'),
    manifest = JSON.parse(readFileSync(path, 'utf8'))
  manifest.payload_sha256 = sha(bundleBytes)
  for (const file of manifest.files)
    if (['payload/control-plane.cjs', 'payload/bundle-manifest.json'].includes(file.path)) {
      file.sha256 = sha(readFileSync(join(directory, file.path)))
      file.size = lstatSync(join(directory, file.path)).size
    }
  const bytes = Buffer.from(JSON.stringify(manifest) + '\n')
  writeFileSync(path, bytes)
  const pin = sha(bytes)
  code.verifyControllerRelease(directory, pin)
  return { directory, pin }
}
const second = variant('second-release', '\n// Native fixture revision two.\n'),
  faulty = variant('faulty-release', "\nif(process.argv[2]==='run-product')process.exit(73)\n")
const interrupted = variant(
  'interrupted-migration-release',
  "\nif(process.argv[2]==='upgrade-schema-apply'){const D=require('better-sqlite3'),F=require('node:fs'),P=require('node:path'),old=D.prototype.exec;D.prototype.exec=function(sql){const result=old.call(this,sql);const file=P.join(process.argv.at(-1),'.lab-interrupted-migration');if(sql.includes('CREATE TABLE product_environment_request')&&!F.existsSync(file)){F.writeFileSync(file,'private-lab-only',{mode:384,flag:'wx'});process.kill(process.pid,'SIGKILL')}return result}}\n"
)
const result = {
  status: 'FAIL',
  scope: 'ROOT_LINUX_SYSTEMD_NATIVE_CONTROLLER_UPGRADE_PRIVATE_FIXTURE',
  checks,
  production_vps_used: false,
  production_database_used: false,
  fixture_root_removed: false
}
let stage = 'install',
  installed,
  appProcess,
  keyBefore,
  client
const call = (input, crash) => {
  const value = spawnSync(process.execPath, [tool], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 65536,
    env: {
      PATH: '/usr/sbin:/usr/bin:/sbin:/bin',
      OPSPILOT_UPGRADE_LAB_NONCE: nonce,
      ...(crash?.startsWith('schema:')
        ? { OPSPILOT_UPGRADE_LAB_CRASH_SCHEMA: crash.slice(7) }
        : crash
          ? { OPSPILOT_UPGRADE_LAB_CRASH: crash }
          : {})
    }
  })
  let body
  try {
    body = JSON.parse(value.stdout)
  } catch {
    body = null
  }
  result.last_operation = input.operation
  result.last_error_code =
    typeof body?.error === 'string' && /^CONTROLLER_INSTALL_[A-Z_]+$/.test(body.error)
      ? body.error
      : null
  return { status: value.status, signal: value.signal, body }
}
const command = (binary, args, input) => {
  const child = spawnSync(binary, args, {
    encoding: 'utf8',
    input,
    timeout: 60000,
    maxBuffer: 65536
  })
  assert.equal(child.status, 0, 'FIXED_LAB_COMMAND_FAILED')
  return child.stdout
}
const wait = async (predicate) => {
  for (let i = 0; i < 100; i++) {
    if (await predicate()) return
    await new Promise((done) => setTimeout(done, 100))
  }
  throw Error('LAB_WAIT_TIMEOUT')
}
const health = async (state) => {
  try {
    return (
      (
        await (
          await fetch('http://127.0.0.1:8768/healthz', { signal: AbortSignal.timeout(1000) })
        ).json()
      ).service_state === state
    )
  } catch {
    return false
  }
}
let request
const inspect = () =>
  call({
    ...request,
    operation: 'inspect-upgrade',
    consent: undefined,
    release_directory: undefined
  })
const recover = (crash) =>
  call({ ...request, operation: 'recover-upgrade', release_directory: undefined }, crash)
const rollback = (crash) =>
  call({ ...request, operation: 'rollback-upgrade', release_directory: undefined }, crash)
const check = (name) => {
  checks.push(name)
  writeFileSync(
    join(evidence, 'progress.json'),
    JSON.stringify({ stage, checks: checks.length, last_check: name })
  )
}
try {
  const setup = call({
    format: 1,
    operation: 'install',
    consent: true,
    request_key: installKey,
    release_directory: oldCandidate,
    release_sha256: oldPin
  })
  assert.equal(setup.status, 0)
  assert.equal(setup.body.service_state, 'running')
  installed = setup.body
  const receiptBefore = readFileSync(join(paths.state, 'receipt.json')),
    oldRuntimeHash = sha(readFileSync(join(paths.installation, 'runtime/release-manifest.json'))),
    identityBefore = readFileSync(join(paths.data, '.product-controller-initialized')),
    dbInode = lstatSync(join(paths.data, 'opspilot.db')).ino,
    keyInode = lstatSync(join(paths.data, '.controller-runtime-key')).ino
  keyBefore = readFileSync(join(paths.data, '.controller-runtime-key'))
  const asService = (artifact, args, input) =>
    JSON.parse(
      command(
        '/usr/bin/setpriv',
        [
          '--reuid',
          String(installed.runtime_uid),
          '--regid',
          String(lstatSync(paths.data).gid),
          '--clear-groups',
          '--',
          join(dirname(dirname(artifact)), 'node'),
          artifact,
          ...args,
          '--data-dir',
          paths.data
        ],
        input
      )
    )
  client = asService(
    join(paths.installation, 'runtime/payload/control-plane.cjs'),
    ['enroll-desktop-client'],
    JSON.stringify({
      request_key: randomUUID(),
      display_name: 'Private upgrade lab',
      requested_scopes: ['read', 'policy:write', 'deploy:manual']
    })
  )
  assert.equal(client.state, 'issued_once')
  appProcess = spawn(
    process.execPath,
    [
      '-e',
      "const s=require('node:http').createServer((q,r)=>{r.setHeader('connection','close');r.end('unrelated-app-ok')});s.listen(0,'127.0.0.1',()=>console.log(s.address().port))"
    ],
    { env: { PATH: '/usr/bin:/bin', NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'ignore'] }
  )
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('APP_FIXTURE_TIMEOUT')), 5000)
    appProcess.once('error', reject)
    appProcess.stdout.once('data', (bytes) => {
      clearTimeout(timer)
      resolve(Number(bytes.toString().trim()))
    })
  })
  assert(Number.isInteger(port) && port > 0)
  const external = `http://127.0.0.1:${port}`
  const preserved = async () => {
    assert(readFileSync(join(paths.state, 'receipt.json')).equals(receiptBefore))
    assert.equal(
      sha(readFileSync(join(paths.installation, 'runtime/release-manifest.json'))),
      oldRuntimeHash
    )
    assert(readFileSync(join(paths.data, '.product-controller-initialized')).equals(identityBefore))
    assert(readFileSync(join(paths.data, '.controller-runtime-key')).equals(keyBefore))
    assert.equal(lstatSync(join(paths.data, 'opspilot.db')).ino, dbInode)
    assert.equal(lstatSync(join(paths.data, '.controller-runtime-key')).ino, keyInode)
    assert.equal(appProcess.exitCode, null)
    assert.equal(
      await (
        await fetch(external, {
          headers: { connection: 'close' },
          signal: AbortSignal.timeout(5000)
        })
      ).text(),
      'unrelated-app-ok'
    )
  }
  request = {
    format: 1,
    operation: 'upgrade',
    consent: true,
    request_key: keys[0],
    installation_request_key: installKey,
    controller_id: installed.controller_id,
    parent_upgrade_key: null,
    parent_release_sha256: oldPin,
    release_sha256: newPin,
    release_directory: candidate
  }
  stage = 'negative-input'
  assert.equal(
    call({ ...request, consent: false }).body.error,
    'CONTROLLER_INSTALL_UPGRADE_INPUT_INVALID'
  )
  assert.equal(
    call({ ...request, parent_release_sha256: '0'.repeat(64) }).body.error,
    'CONTROLLER_INSTALL_UPGRADE_AUTHORITY_CHANGED'
  )
  assert(!existsSync(join(paths.state, 'upgrade.json')))
  check('consent_and_parent_pins_rejected_before_upgrade_mutation')
  stage = 'staging-crash'
  assert.equal(call(request, 'staging').signal, 'SIGKILL')
  await wait(() => inspect().body?.phase === 'staging')
  await preserved()
  assert.equal(call(request).body.phase, 'staging')
  assert.equal(
    call({ ...request, request_key: randomUUID() }).body.error,
    'CONTROLLER_INSTALL_UPGRADE_BUSY'
  )
  check('staging_death_same_uuid_inspect_only_and_no_other_intent_takeover')
  stage = 'stop-crash'
  assert.equal(recover('stop_pending').signal, 'SIGKILL')
  await wait(() => inspect().body?.phase === 'stop_pending')
  assert(['stopped', 'failed'].includes(inspect().body.service_state))
  // Both are terminal states accepted by the Root stop contract; never accept a pending restart.
  assert.equal(
    command('/usr/bin/systemctl', ['show', unitName, '--property=MainPID', '--value']).trim(),
    '0'
  )
  assert(
    ['inactive', 'failed'].includes(
      command('/usr/bin/systemctl', ['show', unitName, '--property=ActiveState', '--value']).trim()
    )
  )
  await preserved()
  check('death_after_guarded_stop_keeps_db_key_identity_and_unrelated_app')
  command('/usr/bin/systemctl', ['start', unitName])
  await wait(() => health('ready'))
  stage = 'schema-backup-crash'
  assert.equal(recover('schema:backup').signal, 'SIGKILL')
  const backupPath = join(paths.installation, 'revisions', keys[0], 'schema-backup/backup.sqlite')
  assert.equal(lstatSync(backupPath).uid, 0)
  assert.equal(lstatSync(backupPath).mode & 0o777, 0o440)
  assert.equal(lstatSync(dirname(backupPath)).mode & 0o777, 0o550)
  const candidateArtifact = join(
    paths.installation,
    'revisions',
    keys[0],
    'runtime/payload/control-plane.cjs'
  )
  assert.equal(asService(candidateArtifact, ['upgrade-check']).schema_version, 29)
  const forbidden = spawnSync('/usr/bin/setpriv', [
    '--reuid',
    String(installed.runtime_uid),
    '--regid',
    String(lstatSync(paths.data).gid),
    '--clear-groups',
    '--',
    process.execPath,
    '-e',
    "try{require('node:fs').openSync(process.argv[1],'w');process.exit(2)}catch(e){process.exit(e.code==='EACCES'?0:3)}",
    backupPath
  ])
  assert.equal(forbidden.status, 0)
  await preserved()
  check('consistent_backup_is_root_sealed_before_migration_and_service_cannot_overwrite_it')
  stage = 'schema-apply-crash'
  assert.equal(recover('schema:apply').signal, 'SIGKILL')
  assert.equal(inspect().body.phase, 'switch_pending')
  assert.equal(asService(candidateArtifact, ['upgrade-check']).schema_version, 35)
  command('/usr/bin/systemctl', ['start', unitName])
  await wait(() => health('maintenance'))
  await preserved()
  check(
    'lost_migration_reply_leaves_exact35_schema_and_candidate_maintenance_without_auto_migration'
  )
  stage = 'switch-crash'
  assert.equal(recover('switch_pending').signal, 'SIGKILL')
  assert.equal(inspect().body.phase, 'switch_pending')
  await preserved()
  check('death_after_atomic_unit_switch_is_cold_inspectable_without_replay')
  command('/usr/bin/systemctl', ['start', unitName])
  await wait(() => health('maintenance'))
  const resumedCandidatePid = command('/usr/bin/systemctl', [
    'show',
    unitName,
    '--property=MainPID',
    '--value'
  ]).trim()
  stage = 'start-crash'
  assert.equal(recover('start_pending').signal, 'SIGKILL')
  await wait(() => health('maintenance'))
  assert.equal(
    command('/usr/bin/systemctl', ['show', unitName, '--property=MainPID', '--value']).trim(),
    resumedCandidatePid
  )
  check('service_restart_during_stop_and_switch_recovers_without_restarting_maintenance_candidate')
  const denied = await fetch(
    `http://127.0.0.1:8768/v1/controllers/${installed.controller_id}/apps/1/auto-deploy-policy`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${client.credential.access_token}`,
        'content-type': 'application/json',
        'idempotency-key': randomUUID()
      },
      body: JSON.stringify({
        expected_ownership_generation: 1,
        expected_source_generation: 1,
        action: 'pause'
      })
    }
  )
  assert.equal(denied.status, 503)
  assert.equal((await denied.json()).error.code, 'CAPABILITY_BLOCKED')
  await preserved()
  check('candidate_maintenance_blocks_even_pause_writes_before_commit')
  stage = 'commit-crash'
  assert.equal(recover('commit_pending').signal, 'SIGKILL')
  await wait(() => health('ready'))
  const liveArtifact = inspect().body.artifact_path
  const secondGrant = asService(
    liveArtifact,
    ['enroll-desktop-client'],
    JSON.stringify({
      request_key: randomUUID(),
      display_name: 'Post commit legitimate change',
      requested_scopes: ['read']
    })
  )
  assert.equal(secondGrant.state, 'issued_once')
  stage = 'recover-commit'
  const active = recover()
  assert.equal(active.status, 0)
  assert.equal(active.body.phase, 'active')
  assert.equal(active.body.service_state, 'running')
  await preserved()
  check('lost_commit_reply_recovers_without_precommit_hash_comparison_or_credential_loss')
  const pid = command('/usr/bin/systemctl', [
    'show',
    unitName,
    '--property=MainPID',
    '--value'
  ]).trim()
  assert.equal(call(request).body.phase, 'active')
  assert.equal(
    command('/usr/bin/systemctl', ['show', unitName, '--property=MainPID', '--value']).trim(),
    pid
  )
  check('duplicate_upgrade_after_commit_never_restarts_the_service')
  stage = 'second-upgrade'
  const first = { ...request }
  request = {
    ...request,
    request_key: keys[1],
    parent_upgrade_key: keys[0],
    parent_release_sha256: newPin,
    release_sha256: second.pin,
    release_directory: second.directory
  }
  const active2 = call(request)
  assert.equal(active2.status, 0)
  assert.equal(active2.body.phase, 'active')
  assert.equal(active2.body.runtime_upgrade_key, keys[1])
  assert.equal(
    call({
      ...first,
      operation: 'inspect-upgrade',
      consent: undefined,
      release_directory: undefined
    }).body.is_current,
    false
  )
  await preserved()
  check('second_revision_preserves_parent_history_and_rejects_historical_adoption')
  stage = 'rollback-second'
  assert.equal(rollback('rollback_pending').signal, 'SIGKILL')
  command('/usr/bin/systemctl', ['start', unitName])
  await wait(() => health('ready'))
  const thirdGrant = asService(
    inspect().body.artifact_path,
    ['enroll-desktop-client'],
    JSON.stringify({
      request_key: randomUUID(),
      display_name: 'Restarted candidate change',
      requested_scopes: ['read']
    })
  )
  assert.equal(thirdGrant.state, 'issued_once')
  assert.equal(rollback('rollback_commit_pending').signal, 'SIGKILL')
  await wait(() => health('ready'))
  const restoredPid = command('/usr/bin/systemctl', [
    'show',
    unitName,
    '--property=MainPID',
    '--value'
  ]).trim()
  const fourthGrant = asService(
    inspect().body.artifact_path,
    ['enroll-desktop-client'],
    JSON.stringify({
      request_key: randomUUID(),
      display_name: 'Restored parent change',
      requested_scopes: ['read']
    })
  )
  assert.equal(fourthGrant.state, 'issued_once')
  const reverted = recover()
  assert.equal(reverted.status, 0)
  assert.equal(reverted.body.phase, 'rolled_back')
  assert.equal(reverted.body.runtime_upgrade_key, keys[0])
  assert.equal(
    command('/usr/bin/systemctl', ['show', unitName, '--property=MainPID', '--value']).trim(),
    restoredPid
  )
  check('rollback_crashes_preserve_legitimate_writes_and_never_restart_restored_parent')
  await preserved()
  stage = 'rollback-first'
  request = first
  assert.equal(rollback('schema:revert').signal, 'SIGKILL')
  assert.equal(asService(candidateArtifact, ['upgrade-check']).schema_version, 29)
  command('/usr/bin/systemctl', ['start', unitName])
  // The candidate must reject29 before opening its normal migrating initializer.
  await new Promise((done) => setTimeout(done, 1500))
  assert.equal(asService(candidateArtifact, ['upgrade-check']).schema_version, 29)
  assert(!(await health('ready')))
  check('reverse_commit_reply_loss_and_candidate_restart_never_auto_migrate29')
  const original = rollback()
  assert.equal(original.status, 0)
  assert.equal(original.body.runtime_upgrade_key, null)
  assert.equal(original.body.service_state, 'running')
  await preserved()
  check('explicit_two_level_rollback_preserves_new_credentials_and_original_installation')
  stage = 'faulty-upgrade'
  request = {
    ...first,
    request_key: keys[2],
    release_sha256: faulty.pin,
    release_directory: faulty.directory
  }
  const bad = call(request)
  assert.equal(bad.body.error, 'CONTROLLER_INSTALL_UPGRADE_CANDIDATE_NOT_READY')
  assert.equal(inspect().body.phase, 'start_pending')
  assert(!existsSync(join(paths.installation, 'revisions', keys[2], 'activation.json')))
  const safe = rollback()
  assert.equal(safe.status, 0)
  assert.equal(safe.body.service_state, 'running')
  await preserved()
  check('startup_failure_never_publishes_gate_and_explicit_rollback_restores_old_ready_runtime')
  const final = call({ format: 1, operation: 'inspect', request_key: installKey })
  assert.equal(final.body.controller_id, installed.controller_id)
  assert.equal(final.body.service_state, 'running')
  for (const grant of [client, secondGrant, thirdGrant, fourthGrant]) {
    const response = await fetch(
      `http://127.0.0.1:8768/v1/controllers/${installed.controller_id}/identity`,
      { headers: { authorization: `Bearer ${grant.credential.access_token}` } }
    )
    assert.equal(response.status, 200)
    assert.equal((await response.json()).controller_id, installed.controller_id)
  }
  check('old_installer_attestation_valid_again_after_rollback')
  stage = 'interrupted-migration-transaction'
  request = {
    ...first,
    request_key: keys[4],
    release_directory: interrupted.directory,
    release_sha256: interrupted.pin
  }
  assert.equal(call(request).body.error, 'CONTROLLER_INSTALL_UPGRADE_SCHEMA_COMMAND_FAILED')
  assert.equal(inspect().body.phase, 'switch_pending')
  const interruptedArtifact = join(
    paths.installation,
    'revisions',
    keys[4],
    'runtime/payload/control-plane.cjs'
  )
  assert.equal(asService(interruptedArtifact, ['upgrade-check']).schema_version, 29)
  assert.equal(recover().body.phase, 'active')
  assert.equal(rollback().body.phase, 'rolled_back')
  assert.equal(asService(interruptedArtifact, ['upgrade-check']).schema_version, 29)
  await preserved()
  check('SIGKILL_inside_migration033_rolls_back032_and033_atomically_and_same_uuid_recovers')
  stage = 'environment-data-blocks-rollback'
  request = { ...first, request_key: keys[3] }
  const finalUpgrade = call(request)
  assert.equal(finalUpgrade.status, 0)
  const candidatePid = command('/usr/bin/systemctl', [
    'show',
    unitName,
    '--property=MainPID',
    '--value'
  ]).trim()
  const sql =
    "const D=require(process.argv[1]);const d=new D(process.argv[2]);d.pragma('foreign_keys=ON');d.transaction(()=>{d.exec(\"INSERT INTO vps(id,name,host,username,auth_type,encrypted_secret) VALUES(1,'schema-lab','fixture.test','operator','key',X'00');INSERT INTO app(id,vps_id,name,framework,host_port,container_port) VALUES(1,1,'schema-fixture','express',30000,3000);INSERT INTO product_source_config VALUES(1,1,'https://github.com/example/app.git','main','.', '{}', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2026-11-14T00:00:00Z')\");d.prepare(\"INSERT INTO product_environment_revision VALUES(?,1,1,1,1,?,'{}','express','[]','[]','aes_256_gcm',?,?,?,?)\").run(process.argv[3],'a'.repeat(64),Buffer.from([1]),Buffer.alloc(12),Buffer.alloc(16),'2026-11-14T00:00:00Z')}).immediate();d.close()"
  command('/usr/bin/setpriv', [
    '--reuid',
    String(installed.runtime_uid),
    '--regid',
    String(lstatSync(paths.data).gid),
    '--clear-groups',
    '--',
    join(paths.installation, 'revisions', keys[3], 'runtime/node'),
    '-e',
    sql,
    join(paths.installation, 'revisions', keys[3], 'runtime/node_modules/better-sqlite3'),
    join(paths.data, 'opspilot.db'),
    installed.controller_id
  ])
  assert.equal(rollback().body.error, 'CONTROLLER_INSTALL_UPGRADE_SCHEMA_ROLLBACK_UNSAFE')
  assert.equal(
    command('/usr/bin/systemctl', ['show', unitName, '--property=MainPID', '--value']).trim(),
    candidatePid
  )
  assert.equal(inspect().body.phase, 'active')
  assert(await health('ready'))
  await preserved()
  check(
    'nonempty_encrypted_environment_table_blocks_schema_rollback_before_service_stop_or_unit_switch'
  )
  result.status = 'PASS'
} catch (error) {
  result.error =
    error instanceof Error && /^CONTROLLER_INSTALL_[A-Z_]+$/.test(error.message)
      ? error.message
      : 'UPGRADE_LAB_CHECK_FAILED'
  result.stage = stage
  result.systemd_state = spawnSync(
    '/usr/bin/systemctl',
    ['show', unitName, '--property=MainPID,ActiveState,SubState,Result'],
    { encoding: 'utf8' }
  ).stdout?.trim()
  result.failure_location =
    /run\.mjs:\d+:\d+/.exec(error instanceof Error ? (error.stack ?? '') : '')?.[0] ?? 'unknown'
  result.failure_kind = error instanceof Error ? error.name : 'unknown'
  if (
    error instanceof Error &&
    error.cause &&
    typeof error.cause === 'object' &&
    'code' in error.cause &&
    /^[A-Z_]+$/.test(String(error.cause.code))
  )
    result.failure_cause = error.cause.code
} finally {
  if (appProcess && appProcess.exitCode === null) {
    const closed = once(appProcess, 'close')
    appProcess.kill('SIGTERM')
    await closed
  }
  keyBefore?.fill(0)
  assert.equal(realpathSync(root), resolve('/opt', 'opspilot-controller-upgrade-lab-' + nonce))
  assert.equal(readFileSync(join(root, '.lab-owner'), 'utf8'), nonce)
  if (existsSync(paths.unit)) {
    assert(unitAllow.includes(readFileSync(paths.unit, 'utf8')))
    spawnSync('/usr/bin/systemctl', ['stop', unitName], { timeout: 60000 })
    spawnSync('/usr/bin/systemctl', ['disable', unitName], { timeout: 30000 })
    unlinkSync(paths.unit)
    command('/usr/bin/systemctl', ['daemon-reload'])
    spawnSync('/usr/bin/systemctl', ['reset-failed', unitName], { timeout: 10000 })
  }
  const user = spawnSync('/usr/bin/getent', ['passwd', account], { encoding: 'utf8' })
  if (user.status === 0) {
    assert(user.stdout.includes('opspilot-install-' + installKey))
    command('/usr/sbin/userdel', [account])
  }
  assert.equal(spawnSync('/usr/bin/getent', ['group', account]).status, 2)
  rmSync(root, { recursive: true })
  result.fixture_root_removed = !existsSync(root)
  result.fixture_unit_removed = !existsSync(paths.unit)
  result.fixture_account_removed = spawnSync('/usr/bin/getent', ['passwd', account]).status === 2
  writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(
    JSON.stringify({ status: result.status, checks: checks.length, evidence, stage: result.stage })
  )
  if (result.status !== 'PASS') process.exitCode = 1
}
