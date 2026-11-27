/* eslint-disable @typescript-eslint/explicit-function-return-type -- Harness Linux JavaScript độc lập. */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import {
  chmodSync,
  closeSync,
  constants,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  symlinkSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { join, resolve } from 'node:path'

if (process.platform !== 'linux' || process.getuid() !== 0 || !process.version.startsWith('v22.'))
  throw Error('ROOT_LINUX_NODE22_LAB_REQUIRED')
const modules = process.env.OPSPILOT_CONTROL_PLANE_MODULES
const source = process.env.OPSPILOT_CONTROLLER_RELEASE_OUTPUT
const pin = process.env.OPSPILOT_CONTROLLER_RELEASE_PIN
if (!modules || !source || !pin) throw Error('LAB_INPUT_REQUIRED')
const require = createRequire(import.meta.url)
const esbuild = require(resolve(modules, 'esbuild'))
const Database = require(resolve(modules, 'better-sqlite3'))
const nonce = randomBytes(6).toString('hex')
const root = '/opt/opspilot-controller-service-lab-' + nonce
const unitName = 'opspilot-lab-' + nonce + '.service'
const account = 'opslab' + nonce
const key = randomUUID()
const paths = {
  state: join(root, 'state'),
  installation: join(root, 'installation'),
  data: join(root, 'data'),
  unit: '/etc/systemd/system/' + unitName,
  account
}
const evidence = resolve(import.meta.dirname, '../../.out-scripts/controller-service', nonce)
mkdirSync(evidence, { recursive: true })
mkdirSync(root, { mode: 0o755 })
writeFileSync(join(root, '.lab-owner'), nonce, { mode: 0o600, flag: 'wx' })
const tool = join(root, 'trusted-lab.cjs')
await esbuild.build({
  entryPoints: [resolve(import.meta.dirname, 'entry.ts')],
  outfile: tool,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  packages: 'external'
})
chmodSync(tool, 0o600)
const { renderControllerUnit, verifyControllerRelease } = require(tool)
const results = []
const check = (name, action) => {
  action()
  results.push({ name, state: 'PASS' })
}
const cmd = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 65536 })
  assert.equal(result.status, 0, 'fixed lab command must succeed')
  return result.stdout
}
const candidate = join(root, 'candidate')
cpSync(source, candidate, { recursive: true, force: false, errorOnExist: true })
const manifest = verifyControllerRelease(candidate, pin)
const install = {
  format: 1,
  operation: 'install',
  request_key: key,
  consent: true,
  release_directory: candidate,
  release_sha256: pin
}
const call = (request, crash) => {
  const result = spawnSync(process.execPath, [tool], {
    input: JSON.stringify(request),
    encoding: 'utf8',
    timeout: 90000,
    maxBuffer: 65536,
    env: {
      PATH: '/usr/sbin:/usr/bin:/sbin:/bin',
      OPSPILOT_SERVICE_LAB_NONCE: nonce,
      ...(crash ? { OPSPILOT_SERVICE_LAB_CRASH: crash } : {})
    }
  })
  let body
  try {
    body = JSON.parse(result.stdout)
  } catch {
    body = null
  }
  return { status: result.status, signal: result.signal, body }
}
let installed = false
try {
  check('consent_rejected_before_state_or_account', () => {
    const denied = call({ ...install, consent: false })
    assert.equal(denied.body.error, 'CONTROLLER_INSTALL_INPUT_INVALID')
    assert(!existsSync(paths.state))
  })
  check('bad_pin_never_executes_candidate_or_creates_state', () => {
    assert.equal(call({ ...install, release_sha256: '0'.repeat(64) }).status, 1)
    assert(!existsSync(paths.state))
  })
  check('dangling_symlink_or_foreign_unit_are_never_replaced', () => {
    symlinkSync(join(root, 'does-not-exist'), paths.data)
    try {
      assert.equal(call(install).status, 1)
      assert(lstatSync(paths.data).isSymbolicLink())
    } finally {
      unlinkSync(paths.data)
    }
    const foreign = '# FOREIGN FIXTURE UNIT\n'
    writeFileSync(paths.unit, foreign, { mode: 0o644, flag: 'wx' })
    try {
      assert.equal(call(install).body.error, 'CONTROLLER_INSTALL_CONFLICT')
      assert.equal(readFileSync(paths.unit, 'utf8'), foreign)
    } finally {
      unlinkSync(paths.unit)
    }
  })
  const crashed = call(install, 'database_pending')
  check('real_process_death_after_database_init_keeps_pending_receipt', () => {
    assert.equal(crashed.signal, 'SIGKILL')
    assert.equal(
      JSON.parse(readFileSync(join(paths.state, 'receipt.json'))).phase,
      'database_pending'
    )
    assert(existsSync(join(paths.data, 'opspilot.db')))
    assert(existsSync(join(paths.data, '.product-controller-initialized')))
  })
  const dbBefore = lstatSync(join(paths.data, 'opspilot.db')).ino
  const identityBefore = readFileSync(join(paths.data, '.product-controller-initialized'))
  const inspection = call({ format: 1, operation: 'inspect', request_key: key })
  check('cold_inspect_and_duplicate_install_do_not_resume_or_reinitialize', () => {
    assert.equal(inspection.status, 0)
    assert.equal(inspection.body.phase, 'database_pending')
    assert.equal(call(install).body.phase, 'database_pending')
    assert.equal(lstatSync(join(paths.data, 'opspilot.db')).ino, dbBefore)
    assert(!existsSync(join(paths.data, '.controller-runtime-key')))
  })
  const recover = {
    format: 1,
    operation: 'recover',
    request_key: key,
    consent: true,
    release_sha256: pin
  }
  const crashKey = call(recover, 'key_pending')
  check('explicit_same_key_recovery_preserves_database_then_survives_key_reply_loss', () => {
    assert.equal(crashKey.signal, 'SIGKILL')
    assert.equal(lstatSync(join(paths.data, 'opspilot.db')).ino, dbBefore)
    assert(readFileSync(join(paths.data, '.product-controller-initialized')).equals(identityBefore))
    assert.equal(JSON.parse(readFileSync(join(paths.state, 'receipt.json'))).phase, 'key_pending')
  })
  const keyBefore = readFileSync(join(paths.data, '.controller-runtime-key'))
  const keyInode = lstatSync(join(paths.data, '.controller-runtime-key')).ino
  const crashUnit = call(recover, 'unit_pending')
  check('restrictive_umask_and_lost_unit_reply_keep_exact_mode_and_same_key', () => {
    assert.equal(crashUnit.signal, 'SIGKILL')
    assert.equal(lstatSync(paths.unit).mode & 0o777, 0o644)
    assert.equal(lstatSync(join(paths.installation, 'execution.json')).mode & 0o777, 0o600)
    assert.equal(lstatSync(join(paths.data, '.controller-runtime-key')).ino, keyInode)
  })
  const crashStart = call(recover, 'start_pending')
  check('process_death_after_systemd_start_retains_same_private_key', () => {
    assert.equal(crashStart.signal, 'SIGKILL')
    assert.equal(lstatSync(join(paths.data, '.controller-runtime-key')).ino, keyInode)
    assert(readFileSync(join(paths.data, '.controller-runtime-key')).equals(keyBefore))
  })
  const final = call(recover)
  check('same_key_recovery_attests_real_systemd_pid_and_owned_loopback_health', () => {
    assert.equal(final.status, 0, JSON.stringify(final.body))
    assert.equal(final.body.phase, 'installed')
    assert.equal(final.body.service_state, 'running')
    assert.equal(final.body.service_enabled, true)
    assert(final.body.runtime_uid > 0)
  })
  installed = true
  check('unit_runs_as_fresh_nonroot_account_with_private_data_and_sandbox', () => {
    const info = cmd('/usr/bin/systemctl', [
      'show',
      unitName,
      '--property=User,Group,MainPID,ProtectHome,ProtectSystem,NoNewPrivileges'
    ])
    assert(info.includes('User=' + account))
    assert(info.includes('NoNewPrivileges=yes'))
    assert(info.includes('ProtectSystem=strict'))
    assert(info.includes('ProtectHome=yes'))
    assert.equal(lstatSync(paths.data).uid, final.body.runtime_uid)
    assert.equal(lstatSync(join(paths.data, '.controller-runtime-key')).mode & 0o777, 0o600)
    assert.equal(lstatSync(join(paths.state, 'receipt.json')).uid, 0)
    assert.equal(lstatSync(join(paths.state, 'receipt.json')).mode & 0o777, 0o600)
  })
  check('default_verifier_still_rejects_foreign_uid_but_root_receipt_owner_verifies', () => {
    assert.throws(() => verifyControllerRelease(join(paths.installation, 'runtime'), pin))
    verifyControllerRelease(join(paths.installation, 'runtime'), pin, final.body.runtime_uid)
  })
  check('fresh_product_database_has_no_target_project_deployment_or_job', () => {
    const db = new Database(join(paths.data, 'opspilot.db'), {
      readonly: true,
      fileMustExist: true
    })
    try {
      for (const name of ['vps', 'app', 'deployment', 'product_deploy_job'])
        assert.equal(db.prepare('SELECT count(*) n FROM ' + name).get().n, 0)
      assert.equal(db.prepare('SELECT max(version) n FROM schema_version').get().n, 28)
    } finally {
      db.close()
    }
  })
  const oldPid = Number(
    cmd('/usr/bin/systemctl', ['show', unitName, '--property=MainPID', '--value']).trim()
  )
  cmd('/usr/bin/systemctl', ['restart', unitName])
  let restarted
  for (let i = 0; i < 40; i++) {
    restarted = call({ format: 1, operation: 'inspect', request_key: key })
    if (restarted.body?.service_state === 'running') break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  check('real_restart_preserves_identity_key_and_database', () => {
    assert.equal(restarted.body.service_state, 'running')
    assert.equal(restarted.body.controller_id, final.body.controller_id)
    const newPid = Number(
      cmd('/usr/bin/systemctl', ['show', unitName, '--property=MainPID', '--value']).trim()
    )
    assert.notEqual(oldPid, newPid)
    assert(readFileSync(join(paths.data, '.controller-runtime-key')).equals(keyBefore))
    assert.equal(lstatSync(join(paths.data, 'opspilot.db')).ino, dbBefore)
  })
  check('wrong_uuid_or_pin_cannot_adopt_existing_installation', () => {
    assert.equal(
      call({ ...recover, request_key: randomUUID() }).body.error,
      'CONTROLLER_INSTALL_CONFLICT'
    )
    assert.equal(
      call({ ...recover, release_sha256: 'f'.repeat(64) }).body.error,
      'CONTROLLER_INSTALL_CONFLICT'
    )
  })
  check('concurrent_operation_is_blocked_by_the_same_kernel_lock', () => {
    const fd = openSync(
      join(paths.state, 'operation.lock'),
      constants.O_RDWR | constants.O_NOFOLLOW
    )
    try {
      assert.equal(
        spawnSync('/usr/bin/flock', ['-n', '3'], { stdio: ['ignore', 'ignore', 'ignore', fd] })
          .status,
        0
      )
      assert.equal(
        call({ format: 1, operation: 'inspect', request_key: key }).body.error,
        'CONTROLLER_INSTALL_BUSY'
      )
    } finally {
      closeSync(fd)
    }
  })
  renameSync(candidate, join(root, 'retired-candidate'))
  check('installed_inspect_does_not_depend_on_original_release_directory', () => {
    assert.equal(
      call({ format: 1, operation: 'inspect', request_key: key }).body.service_state,
      'running'
    )
  })
  cmd('/usr/bin/systemctl', ['stop', unitName])
  check('inspect_reports_stopped_and_never_restarts_implicitly', () => {
    assert.equal(
      call({ format: 1, operation: 'inspect', request_key: key }).body.service_state,
      'stopped'
    )
    assert.equal(call(install).body.service_state, 'stopped')
    assert.equal(call(recover).body.service_state, 'stopped')
  })
  check('missing_key_is_reported_and_never_regenerated_on_inspect_or_recover', () => {
    const file = join(paths.data, '.controller-runtime-key')
    const held = join(paths.data, '.retained-key-fixture')
    renameSync(file, held)
    try {
      assert.equal(
        call({ format: 1, operation: 'inspect', request_key: key }).body.error,
        'CONTROLLER_INSTALL_DATA_RECOVERY_REQUIRED'
      )
      assert.equal(call(recover).body.error, 'CONTROLLER_INSTALL_DATA_RECOVERY_REQUIRED')
      assert(!existsSync(file))
      assert(readFileSync(held).equals(keyBefore))
    } finally {
      renameSync(held, file)
    }
  })
  check('partial_database_identity_is_not_wiped_or_reinitialized', () => {
    const journal = join(paths.state, 'receipt.json')
    const before = readFileSync(journal)
    const identity = join(paths.data, '.product-controller-initialized')
    const held = join(paths.data, '.retained-identity-fixture')
    renameSync(identity, held)
    writeFileSync(journal, JSON.stringify({ ...JSON.parse(before), phase: 'database_pending' }))
    try {
      assert.equal(call(recover).body.error, 'CONTROLLER_INSTALL_DATA_RECOVERY_REQUIRED')
      assert.equal(lstatSync(join(paths.data, 'opspilot.db')).ino, dbBefore)
      assert(!existsSync(identity))
      assert(readFileSync(join(paths.data, '.controller-runtime-key')).equals(keyBefore))
    } finally {
      renameSync(held, identity)
      writeFileSync(journal, before)
    }
  })
  check('missing_lock_path_cannot_bypass_a_still_owned_kernel_lock', () => {
    const file = join(paths.state, 'operation.lock')
    const held = join(paths.state, 'retained-lock-fixture')
    const fd = openSync(file, constants.O_RDWR | constants.O_NOFOLLOW)
    assert.equal(
      spawnSync('/usr/bin/flock', ['-n', '3'], { stdio: ['ignore', 'ignore', 'ignore', fd] })
        .status,
      0
    )
    renameSync(file, held)
    try {
      assert.equal(
        call({ format: 1, operation: 'inspect', request_key: key }).body.error,
        'CONTROLLER_INSTALL_LOCK_UNAVAILABLE'
      )
      assert(!existsSync(file))
      assert.equal(lstatSync(join(paths.data, 'opspilot.db')).ino, dbBefore)
    } finally {
      renameSync(held, file)
      closeSync(fd)
    }
  })
  // flock open-file-description inheritance: parent closes while child retains descriptor.
  const lockPath = join(root, 'inheritance.lock')
  writeFileSync(lockPath, '', { mode: 0o600, flag: 'wx' })
  const fd = openSync(lockPath, constants.O_RDWR | constants.O_NOFOLLOW)
  assert.equal(
    spawnSync('/usr/bin/flock', ['-n', '3'], { stdio: ['ignore', 'ignore', 'ignore', fd] }).status,
    0
  )
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},1500)'], {
    stdio: ['ignore', 'ignore', 'ignore', fd]
  })
  closeSync(fd)
  check('inherited_flock_blocks_new_parent_until_initialization_child_exits', () => {
    assert.notEqual(spawnSync('/usr/bin/flock', ['-n', lockPath, '/bin/true']).status, 0)
  })
  await new Promise((resolve) => child.on('exit', resolve))
  check('kernel_releases_flock_after_last_child_without_stale_pid_override', () => {
    assert.equal(spawnSync('/usr/bin/flock', ['-n', lockPath, '/bin/true']).status, 0)
  })
  keyBefore.fill(0)
} finally {
  // Chỉ dọn fixture nonce vừa tạo; không chứa production paths hoặc app do người dùng tạo.
  if (
    root !== resolve('/opt', 'opspilot-controller-service-lab-' + nonce) ||
    readFileSync(join(root, '.lab-owner'), 'utf8') !== nonce
  )
    assert.fail('LAB_CLEANUP_SCOPE')
  if (existsSync(paths.unit)) {
    assert.equal(readFileSync(paths.unit, 'utf8'), renderControllerUnit(paths, key))
    spawnSync('/usr/bin/systemctl', ['stop', unitName], { timeout: 50000 })
    spawnSync('/usr/bin/systemctl', ['disable', unitName], { timeout: 30000 })
    unlinkSync(paths.unit)
    cmd('/usr/bin/systemctl', ['daemon-reload'])
    spawnSync('/usr/bin/systemctl', ['reset-failed', unitName], { timeout: 10000 })
  }
  const user = spawnSync('/usr/bin/getent', ['passwd', account], { encoding: 'utf8' })
  if (user.status === 0) {
    assert(user.stdout.includes('opspilot-install-' + key))
    cmd('/usr/sbin/userdel', [account])
  }
  assert.equal(
    spawnSync('/usr/bin/getent', ['group', account]).status,
    2,
    'fixture private group must be removed'
  )
  rmSync(root, { recursive: true })
}
const receipt = {
  state: 'PASS',
  checks: results.length,
  results,
  release_sha256: pin,
  payload_sha256: manifest.payload_sha256,
  installed_then_removed: installed,
  fixture_account_removed: spawnSync('/usr/bin/getent', ['passwd', account]).status === 2,
  fixture_unit_removed: !existsSync(paths.unit),
  fixture_group_removed: spawnSync('/usr/bin/getent', ['group', account]).status === 2,
  fixture_root_removed: !existsSync(root),
  production_vps_used: false,
  production_database_used: false
}
assert(receipt.fixture_account_removed && receipt.fixture_unit_removed)
writeFileSync(join(evidence, 'result.json'), JSON.stringify(receipt, null, 2) + '\n')
console.log(JSON.stringify({ state: 'PASS', checks: results.length, evidence }))
