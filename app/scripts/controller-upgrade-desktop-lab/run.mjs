/* eslint-disable @typescript-eslint/explicit-function-return-type -- Standalone JavaScript SSH/systemd lab. */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto'
import { createRequire, Module } from 'node:module'
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { join, resolve } from 'node:path'

if (process.platform !== 'linux' || process.getuid() !== 0 || !process.version.startsWith('v22.'))
  throw Error('ROOT_LINUX_NODE22_LAB_REQUIRED')
const modules = process.env.OPSPILOT_CONTROL_PLANE_MODULES
const source = process.env.OPSPILOT_CONTROLLER_RELEASE_OUTPUT
const releasePin = process.env.OPSPILOT_CONTROLLER_RELEASE_PIN
if (!modules || !source || !releasePin) throw Error('LAB_INPUT_REQUIRED')
process.env.NODE_PATH = modules
Module._initPaths()
const require = createRequire(import.meta.url)
const esbuild = require(resolve(modules, 'esbuild'))
const { Server, utils } = require(resolve(modules, 'ssh2'))
const Database = require(resolve(modules, 'better-sqlite3'))
const nonce = randomBytes(6).toString('hex'),
  key = randomUUID()
const root = '/opt/opspilot-controller-upgrade-desktop-lab-' + nonce
const account = 'opsud' + nonce,
  unitName = 'opspilot-upgrade-desktop-' + nonce + '.service'
const paths = {
  state: join(root, 'state'),
  installation: join(root, 'installation'),
  data: join(root, 'data'),
  unit: '/etc/systemd/system/' + unitName,
  account
}
const evidence = resolve(
  import.meta.dirname,
  '../../.out-scripts/controller-upgrade-desktop',
  nonce
)
mkdirSync(evidence, { recursive: true })
mkdirSync(root, { mode: 0o755 })
writeFileSync(join(root, '.lab-owner'), nonce, { mode: 0o600, flag: 'wx' })
const local = join(root, 'local')
mkdirSync(local, { mode: 0o700 })
const artifacts = {
  release_directory: join(local, 'release'),
  installer_path: join(local, 'trusted-installer.cjs')
}
cpSync(source, artifacts.release_directory, { recursive: true, errorOnExist: true, force: false })
const normalizeRelease = (directory) => {
  const m = JSON.parse(readFileSync(join(directory, 'release-manifest.json'), 'utf8'))
  for (const f of m.files) chmodSync(join(directory, f.path), f.mode)
  chmodSync(join(directory, 'release-manifest.json'), 0o600)
}
normalizeRelease(artifacts.release_directory)
await esbuild.build({
  entryPoints: [resolve(import.meta.dirname, 'installer-entry.ts')],
  outfile: artifacts.installer_path,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  packages: 'bundle',
  nodePaths: [modules],
  plugins: [
    {
      name: 'raw-admin-python',
      setup(build) {
        build.onResolve({ filter: /\.py\?raw$/ }, (args) => ({
          path: resolve(args.resolveDir, args.path.slice(0, -4)),
          namespace: 'raw-admin-python'
        }))
        build.onLoad({ filter: /.*/, namespace: 'raw-admin-python' }, (args) => ({
          contents: readFileSync(args.path, 'utf8'),
          loader: 'text'
        }))
      }
    }
  ],
  define: {
    'process.env.OPSPILOT_SERVICE_LAB_NONCE': JSON.stringify(nonce),
    'process.env.OPSPILOT_SERVICE_LAB_CRASH': 'undefined'
  }
})
chmodSync(artifacts.installer_path, 0o600)
const tool = join(local, 'client.cjs')
await esbuild.build({
  entryPoints: [resolve(import.meta.dirname, 'entry.ts')],
  outfile: tool,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  packages: 'external',
  plugins: [
    {
      name: 'raw-python',
      setup(build) {
        build.onResolve({ filter: /\.(py|sql)\?raw$/ }, (args) => ({
          path: resolve(args.resolveDir, args.path.slice(0, -4)),
          namespace: 'raw-python'
        }))
        build.onLoad({ filter: /.*/, namespace: 'raw-python' }, (args) => ({
          contents: readFileSync(args.path, 'utf8'),
          loader: 'text'
        }))
      }
    }
  ]
})
const {
  DesktopControllerUpgrades,
  renderUpgradedControllerUnit,
  labScript,
  SshManager,
  transferControllerRelease,
  callControllerBootstrap,
  callControllerUpgrade,
  administerInstalledController,
  renderControllerUnit,
  DesktopControllerInstallations,
  initializeDatabase,
  VpsRepository,
  AesGcmCredentialCipher
} = require(tool)
const bootstrapScript = labScript(nonce)
const locator = {
  request_key: key,
  release_sha256: releasePin,
  installer_sha256: createHash('sha256')
    .update(readFileSync(artifacts.installer_path))
    .digest('hex')
}
const bin = join(root, 'python-only')
mkdirSync(bin, { mode: 0o755 })
symlinkSync('/usr/bin/python3', join(bin, 'python3'))
const hostKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
  format: 'pem',
  type: 'pkcs1'
})
const clientKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
  format: 'pem',
  type: 'pkcs1'
})
const hostFingerprint =
  'SHA256:' +
  createHash('sha256')
    .update(utils.parseKey(hostKey).getPublicSSH())
    .digest('base64')
    .replace(/=+$/, '')
const clients = new Set(),
  children = new Set(),
  managers = []
let authentications = 0,
  executions = 0,
  dropReply = false,
  dropAdminReply = false,
  pythonOnlyExecutions = 0,
  compressedExecutions = 0,
  maxCommandBytes = 0,
  dropUpgradeReply = false
let dropBeforeUpgrade = false
const server = new Server({ hostKeys: [hostKey] }, (client) => {
  clients.add(client)
  client.on('error', (error) => {
    writeFileSync(
      join(evidence, 'ssh-diagnostic.json'),
      JSON.stringify({
        name: error.name,
        code: error.code,
        level: error.level,
        packet_error: /packet|length|size/i.test(error.message)
          ? error.message.slice(0, 160)
          : undefined
      }) + '\n'
    )
  })
  client.on('close', () => clients.delete(client))
  client.on('authentication', (ctx) => {
    authentications++
    if (ctx.username === 'fixture' && ctx.method === 'publickey') ctx.accept()
    else ctx.reject()
  })
  client.on('session', (accept) =>
    accept().on('exec', (acceptExec, reject, info) => {
      if (!info.command.startsWith("python3 -B -u -c '")) return reject()
      executions++
      pythonOnlyExecutions++
      maxCommandBytes = Math.max(maxCommandBytes, Buffer.byteLength(info.command))
      if (info.command.includes('base64,zlib')) compressedExecutions++
      if (dropBeforeUpgrade) {
        dropBeforeUpgrade = false
        const stream = acceptExec()
        stream.on('data', () => client.end())
        return
      }
      const stream = acceptExec()
      const child = spawn('/bin/sh', ['-c', info.command], {
        env: { PATH: bin, LANG: 'C.UTF-8' },
        stdio: ['pipe', 'pipe', 'pipe']
      })
      children.add(child)
      stream.pipe(child.stdin)
      stream.on('close', () => child.stdin.end())
      child.stdin.on('error', () => {})
      let stdout = Buffer.alloc(0)
      child.stdout.on('data', (chunk) => {
        if (!dropReply && !dropAdminReply && !dropUpgradeReply) {
          stream.write(chunk)
          return
        }
        stdout = Buffer.concat([stdout, chunk])
        if (stdout.length >= 4 && stdout.length >= stdout.readUInt32BE(0) + 4) {
          const value = JSON.parse(stdout.subarray(4, stdout.readUInt32BE(0) + 4))
          if (dropUpgradeReply && value.state === 'upgrade_result') {
            dropUpgradeReply = false
            client.end()
            return
          }
          if (value.state === 'installation_result') {
            dropReply = false
            client.end()
            return
          }
          if (dropAdminReply && value.state === 'admin_result') {
            dropAdminReply = false
            client.end()
            return
          }
          stream.write(stdout)
          stdout = Buffer.alloc(0)
        }
      })
      child.stderr.on('data', (chunk) => {
        const text = chunk.toString()
        for (const line of text.split('\n')) {
          try {
            const value = JSON.parse(line)
            if (value.fixture_error)
              writeFileSync(join(evidence, 'python-diagnostic.json'), JSON.stringify(value) + '\n')
          } catch {
            /* Không lưu stderr thô. */
          }
        }
        stream.stderr.write(chunk)
      })
      child.on('close', (code) => {
        children.delete(child)
        if (!stream.destroyed) {
          stream.exit(code ?? 1)
          stream.end()
        }
      })
    })
  )
})
await new Promise((ok, fail) => {
  server.once('error', fail)
  server.listen(0, '127.0.0.1', ok)
})
const identity = {
  vpsId: 1,
  host: '127.0.0.1',
  port: server.address().port,
  hostFingerprint,
  username: 'fixture',
  authType: 'key'
}
const manager = (pin = hostFingerprint) => {
  const ssh = new SshManager(() => ({
    ...identity,
    hostFingerprint: pin,
    secret: clientKey.toString()
  }))
  managers.push(ssh)
  return ssh
}
let ssh = manager()
const input = () => ({
  ssh,
  vpsId: 1,
  expectedIdentity: identity,
  locator,
  assertCurrent: () => {},
  bootstrapScript
})
const checks = []
const receipt = {
  status: 'FAIL',
  scope: 'PRIVATE_ROOT_SYSTEMD_PINNED_SSH_MAIN_SQLITE_UPGRADE',
  checks,
  production_vps_used: false,
  production_database_used: false
}
const check = (name) => {
  checks.push(name)
  writeFileSync(
    join(evidence, 'progress.json'),
    JSON.stringify({ stage, checks: checks.length }) + '\n'
  )
}
const fixed = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 60000, maxBuffer: 65536 })
  assert.equal(r.status, 0, 'FIXTURE_COMMAND_FAILED')
  return r.stdout.trim()
}
const cold = async (payload) => {
  const child = spawn(process.execPath, [tool], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { NODE_PATH: modules, PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }
  })
  let output = '',
    stderr = 0
  const timer = setTimeout(() => child.kill('SIGKILL'), 180000)
  child.stdout.on('data', (chunk) => {
    output += chunk
    if (output.length > 32768) child.kill('SIGKILL')
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk.length
    if (stderr > 65536) child.kill('SIGKILL')
  })
  child.stdin.end(JSON.stringify(payload))
  const code = await new Promise((resolve) => child.once('close', resolve))
  clearTimeout(timer)
  assert.equal(code, 0, 'COLD_MAIN_INSPECT_FAILED')
  return JSON.parse(output)
}
let stage = 'setup',
  desktopDb,
  upgradeKey,
  keyBytes
const unitAllow = [renderControllerUnit(paths, key)]
try {
  stage = 'install'
  await transferControllerRelease({ ...input(), consent: true, artifacts })
  const installed = await callControllerBootstrap({
    ...input(),
    operation: 'install',
    consent: true
  })
  assert.equal(installed.state, 'installation_result')
  assert.equal(installed.installation.service_state, 'running')
  const originalReceipt = readFileSync(join(paths.state, 'receipt.json'))
  const originalTransfer = readFileSync(join(root, 'transfer/intent.json'))
  const databaseInode = lstatSync(join(paths.data, 'opspilot.db')).ino
  keyBytes = readFileSync(join(paths.data, '.controller-runtime-key'))
  desktopDb = initializeDatabase(join(root, 'desktop'))
  assert.equal(desktopDb.prepare('SELECT MAX(version) n FROM schema_version').get().n, 30)
  const controllerDb = new Database(join(paths.data, 'opspilot.db'), { readonly: true })
  assert.equal(controllerDb.prepare('SELECT MAX(version) n FROM schema_version').get().n, 29)
  controllerDb.close()
  check('fresh_desktop030_and_native_controller029_have_separate_migration_roles')
  const cipher = new AesGcmCredentialCipher(randomBytes(32))
  const vps = new VpsRepository(desktopDb)
  vps.create({
    name: 'private SSH lab',
    host: identity.host,
    port: identity.port,
    username: identity.username,
    host_fingerprint: hostFingerprint,
    auth_type: 'key',
    credential: cipher.encrypt(clientKey.toString())
  })
  const original = { release_id: 'original', ...artifacts, ...locator }
  delete original.request_key
  let installations = new DesktopControllerInstallations(desktopDb, ssh, [original], {
    bootstrapScript
  })
  const installPlan = await installations.plan(1, original.release_id)
  assert.equal(installPlan.request_key, key)
  installations.prepare(installPlan.plan_id)
  await installations.inspect(key)
  const newSource = process.env.OPSPILOT_UPGRADE_RELEASE,
    newPin = process.env.OPSPILOT_UPGRADE_RELEASE_PIN
  assert(newSource && /^[a-f0-9]{64}$/.test(newPin))
  const target = {
    release_id: 'upgrade',
    release_directory: join(local, 'upgrade-release'),
    installer_path: artifacts.installer_path,
    release_sha256: newPin,
    installer_sha256: locator.installer_sha256
  }
  cpSync(newSource, target.release_directory, { recursive: true, errorOnExist: true, force: false })
  normalizeRelease(target.release_directory)
  let upgrades = new DesktopControllerUpgrades(desktopDb, installations, ssh, [target], {
    bootstrapScript
  })
  stage = 'plan'
  const plan = await upgrades.plan(key, target.release_id)
  const prepared = upgrades.prepare(plan.plan_id)
  upgradeKey = prepared.request_key
  unitAllow.push(renderUpgradedControllerUnit(paths, key, upgradeKey))
  assert.equal(upgrades.prepare(plan.plan_id).request_key, upgradeKey)
  assert(!existsSync(join(root, 'upgrade-transfers')))
  const upgradeInput = {
    ...input(),
    locator: {
      request_key: upgradeKey,
      release_sha256: newPin,
      installer_sha256: locator.installer_sha256
    },
    purpose: 'upgrade'
  }
  const absent = await callControllerBootstrap({ ...upgradeInput, operation: 'status' })
  assert.equal(absent.state, 'absent')
  assert(!existsSync(join(root, 'upgrade-transfers')))
  check('plan_prepare_and_absent_inspect_preserve_uuid_and_never_create_remote_upgrade_namespace')
  stage = 'transfer'
  assert.equal((await upgrades.send(upgradeKey, 'transfer', true)).state, 'transferred')
  assert(readFileSync(join(root, 'transfer/intent.json')).equals(originalTransfer))
  assert(existsSync(join(root, 'upgrade-transfers', upgradeKey, 'release/release-manifest.json')))
  check(
    'independently_pinned_upgrade_transfer_uses_distinct_uuid_namespace_preserving_original_install_staging'
  )
  const beforeWrongPin = executions
  await assert.rejects(
    () =>
      callControllerBootstrap({
        ...upgradeInput,
        locator: { ...upgradeInput.locator, installer_sha256: '0'.repeat(64) },
        operation: 'status'
      }),
    { code: 'BOOTSTRAP_CONFLICT' }
  )
  assert(executions > beforeWrongPin)
  assert(readFileSync(join(paths.state, 'receipt.json')).equals(originalReceipt))
  check('wrong_tool_pin_rejected_by_receiver_before_upgrader_execution')
  stage = 'lost-upgrade-reply'
  dropBeforeUpgrade = true
  await assert.rejects(() => upgrades.send(upgradeKey, 'upgrade', true), {
    code: 'BOOTSTRAP_OUTCOME_UNKNOWN'
  })
  assert(!existsSync(join(paths.state, 'upgrade.json')))
  assert.equal(upgrades.list(key)[0].state, 'outcome_unknown')
  await assert.rejects(() => upgrades.send(upgradeKey, 'upgrade', true), {
    code: 'UPGRADE_INSPECT_REQUIRED'
  })
  const request = {
    format: 1,
    operation: 'recover-upgrade',
    consent: true,
    request_key: upgradeKey,
    installation_request_key: key,
    controller_id: installed.installation.controller_id,
    parent_upgrade_key: null,
    parent_release_sha256: releasePin,
    release_sha256: newPin
  }
  await assert.rejects(
    () =>
      callControllerUpgrade({
        ...upgradeInput,
        request: { ...request, parent_release_sha256: '0'.repeat(64) }
      }),
    { code: 'BOOTSTRAP_CONFLICT' }
  )
  assert(!existsSync(join(paths.state, 'upgrade.json')))
  check(
    'disconnect_before_root_journal_keeps_attempted_and_wrong_parent_recovery_never_creates_journal'
  )
  dropUpgradeReply = true
  await assert.rejects(() => upgrades.send(upgradeKey, 'recover', true), {
    code: 'BOOTSTRAP_OUTCOME_UNKNOWN'
  })
  assert.equal(upgrades.list(key)[0].state, 'outcome_unknown')
  const activePid = fixed('/usr/bin/systemctl', ['show', unitName, '--property=MainPID', '--value'])
  assert.notEqual(activePid, '0')
  desktopDb.close()
  desktopDb = undefined
  stage = 'cold-process-inspect'
  const recovered = await cold({
    nonce,
    installation_key: key,
    upgrade_key: upgradeKey,
    principal: identity,
    private_key: clientKey.toString(),
    original,
    target
  })
  assert.equal(recovered.before[0].state, 'outcome_unknown')
  assert.equal(recovered.result.state, 'active')
  assert.equal(recovered.result.last_result.controller_id, installed.installation.controller_id)
  assert.equal(recovered.schema.n, 30)
  assert.equal(
    fixed('/usr/bin/systemctl', ['show', unitName, '--property=MainPID', '--value']),
    activePid
  )
  check(
    'lost_upgrade_reply_recovers_in_separate_cold_main_process_without_replaying_or_restarting_service'
  )
  desktopDb = initializeDatabase(join(root, 'desktop'))
  installations = new DesktopControllerInstallations(desktopDb, ssh, [original], {
    bootstrapScript
  })
  upgrades = new DesktopControllerUpgrades(desktopDb, installations, ssh, [target], {
    bootstrapScript
  })
  await assert.rejects(() => upgrades.send(upgradeKey, 'upgrade', true), {
    code: 'UPGRADE_INSPECT_REQUIRED'
  })
  assert.equal(desktopDb.prepare('SELECT count(*) n FROM desktop_controller_binding').get().n, 0)
  check('attempt_monotonicity_prevents_second_upgrade_and_does_not_rebind_api_credentials')
  stage = 'revision-admin'
  const current = upgrades.list(key)[0].last_result
  const authority = {
    request_key: upgradeKey,
    release_sha256: newPin,
    installer_sha256: locator.installer_sha256,
    controller_id: current.controller_id,
    runtime_uid: current.runtime_uid,
    payload_sha256: current.runtime_payload_sha256,
    revision: {
      installation_request_key: key,
      parent_upgrade_key: null,
      parent_release_sha256: releasePin
    }
  }
  const adminRequest = {
    format: 1,
    operation: 'admin',
    authority,
    command: { operation: 'status', payload: {} }
  }
  const admin = await administerInstalledController({ ...upgradeInput, request: adminRequest })
  assert.equal(admin.ok, true)
  assert.equal(admin.data.controller_id, current.controller_id)
  await assert.rejects(
    () =>
      administerInstalledController({
        ...upgradeInput,
        request: { ...adminRequest, authority: { ...authority, payload_sha256: '0'.repeat(64) } }
      }),
    { code: 'BOOTSTRAP_INSTALLER_FAILED' }
  )
  await assert.rejects(
    () =>
      administerInstalledController({
        ...upgradeInput,
        request: {
          ...adminRequest,
          authority: { ...authority, runtime_uid: current.runtime_uid + 1 }
        }
      }),
    { code: 'BOOTSTRAP_INSTALLER_FAILED' }
  )
  assert.equal(
    fixed('/usr/bin/systemctl', ['show', unitName, '--property=MainPID', '--value']),
    activePid
  )
  check(
    'revision_admin_derives_current_runtime_after_root_attestation_and_rejects_wrong_uid_payload_without_restart'
  )
  stage = 'stopped-admin-guard'
  fixed('/usr/bin/systemctl', ['stop', unitName])
  await assert.rejects(
    () => administerInstalledController({ ...upgradeInput, request: adminRequest }),
    { code: 'BOOTSTRAP_INSTALLER_FAILED' }
  )
  assert.equal(
    fixed('/usr/bin/systemctl', ['show', unitName, '--property=MainPID', '--value']),
    '0'
  )
  fixed('/usr/bin/systemctl', ['start', unitName])
  const until = Date.now() + 30000
  for (;;) {
    const inspected = await callControllerUpgrade({
      ...upgradeInput,
      request: {
        format: 1,
        operation: 'inspect-upgrade',
        request_key: upgradeKey,
        installation_request_key: key,
        controller_id: installed.installation.controller_id,
        parent_upgrade_key: null,
        parent_release_sha256: releasePin,
        release_sha256: newPin
      }
    })
    if (inspected.service_state === 'running') break
    assert(Date.now() < until, 'REVISION_RESTART_NOT_READY')
    await new Promise((done) => setTimeout(done, 200))
  }
  check('revision_admin_rejects_stopped_controller_without_implicitly_starting_or_adopting_it')
  stage = 'rollback'
  const reverted = await upgrades.send(upgradeKey, 'rollback', true)
  assert.equal(reverted.state, 'rolled_back')
  assert.equal(reverted.last_result.runtime_upgrade_key, null)
  const originalAgain = await callControllerBootstrap({ ...input(), operation: 'inspect' })
  assert.equal(originalAgain.installation.service_state, 'running')
  assert.equal(originalAgain.installation.controller_id, installed.installation.controller_id)
  assert(readFileSync(join(paths.state, 'receipt.json')).equals(originalReceipt))
  assert(readFileSync(join(paths.data, '.controller-runtime-key')).equals(keyBytes))
  assert.equal(lstatSync(join(paths.data, 'opspilot.db')).ino, databaseInode)
  const rollbackAdmin = await administerInstalledController({
    ...upgradeInput,
    request: {
      ...adminRequest,
      authority: { ...authority, payload_sha256: installed.installation.payload_sha256 }
    }
  })
  assert.equal(rollbackAdmin.ok, true)
  assert.equal(rollbackAdmin.data.controller_id, current.controller_id)
  check(
    'rolled_back_current_operation_admin_uses_restored_parent_payload_and_preserves_original_authority'
  )
  check(
    'explicit_main_rollback_restores_original_unit_and_preserves_root_receipt_identity_key_database_inode'
  )
  stage = 'authority-change'
  const beforeChange = executions
  new VpsRepository(desktopDb).delete(1)
  await assert.rejects(() => upgrades.inspect(upgradeKey), { code: 'UPGRADE_AUTHORITY_CHANGED' })
  assert.equal(executions, beforeChange)
  check('archived_vps_authority_rejected_before_any_ssh_execution')
  receipt.status = 'PASS'
} catch (error) {
  receipt.error =
    error?.code && /^[A-Z_]+$/.test(error.code) ? error.code : 'UPGRADE_DESKTOP_LAB_FAILED'
  receipt.stage = stage
  receipt.failure_kind = error?.name
  receipt.failure_location = /run\.mjs:\d+:\d+/.exec(error?.stack ?? '')?.[0] ?? 'unknown'
} finally {
  if (desktopDb?.open) desktopDb.close()
  for (const manager of managers) await manager.disconnectAll()
  for (const child of children) child.kill()
  for (const client of clients) client.end()
  await new Promise((done) => server.close(done))
  keyBytes?.fill(0)
  assert.equal(root, resolve('/opt', 'opspilot-controller-upgrade-desktop-lab-' + nonce))
  assert.equal(readFileSync(join(root, '.lab-owner'), 'utf8'), nonce)
  if (existsSync(paths.unit)) {
    assert(unitAllow.includes(readFileSync(paths.unit, 'utf8')))
    fixed('/usr/bin/systemctl', ['stop', unitName])
    fixed('/usr/bin/systemctl', ['disable', unitName])
    unlinkSync(paths.unit)
    fixed('/usr/bin/systemctl', ['daemon-reload'])
    spawnSync('/usr/bin/systemctl', ['reset-failed', unitName])
  }
  const user = spawnSync('/usr/bin/getent', ['passwd', account], { encoding: 'utf8' })
  if (user.status === 0) {
    assert(user.stdout.includes('opspilot-install-' + key))
    fixed('/usr/sbin/userdel', [account])
  }
  rmSync(root, { recursive: true })
  receipt.fixture_root_removed = !existsSync(root)
  receipt.fixture_unit_removed = !existsSync(paths.unit)
  receipt.fixture_account_removed = spawnSync('/usr/bin/getent', ['passwd', account]).status === 2
  receipt.python_only_path = pythonOnlyExecutions === executions
  receipt.ssh_authentications = authentications
  receipt.ssh_executions = executions
  receipt.script_bytes = Buffer.byteLength(bootstrapScript.text)
  receipt.compressed_executions = compressedExecutions
  receipt.max_command_bytes = maxCommandBytes
  writeFileSync(join(evidence, 'result.json'), JSON.stringify(receipt, null, 2) + '\n')
  console.log(
    JSON.stringify({
      status: receipt.status,
      checks: checks.length,
      evidence,
      stage: receipt.stage
    })
  )
  if (receipt.status !== 'PASS') process.exitCode = 1
}
