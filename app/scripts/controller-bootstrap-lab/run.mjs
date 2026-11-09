/* eslint-disable @typescript-eslint/explicit-function-return-type -- Standalone JavaScript SSH/systemd lab. */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto'
import { createRequire, Module } from 'node:module'
import {
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  writeSync
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
const root = '/opt/opspilot-controller-service-lab-' + nonce
const account = 'opslab' + nonce,
  unitName = 'opspilot-lab-' + nonce + '.service'
const paths = {
  state: join(root, 'state'),
  installation: join(root, 'installation'),
  data: join(root, 'data'),
  unit: '/etc/systemd/system/' + unitName,
  account
}
const evidence = resolve(import.meta.dirname, '../../.out-scripts/controller-bootstrap', nonce)
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
await esbuild.build({
  entryPoints: [resolve(import.meta.dirname, '../controller-service-lab/entry.ts')],
  outfile: artifacts.installer_path,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  packages: 'external',
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
  SshManager,
  transferControllerRelease,
  callControllerBootstrap,
  controllerBootstrapScript,
  renderControllerUnit,
  discoverControllerBootstrap,
  DesktopControllerInstallations,
  initializeDatabase,
  closeDatabase,
  VpsRepository,
  AesGcmCredentialCipher,
  loadSecret
} = require(tool)
const baseScript = controllerBootstrapScript()
const text = baseScript.text
  .replace(
    'TRANSFER_ROOT = "/var/lib/opspilot-controller-transfer"',
    'TRANSFER_ROOT = ' + JSON.stringify(join(root, 'transfer'))
  )
  .replace(
    /INSTALLATION_PATHS = \([\s\S]*?\n\)/,
    'INSTALLATION_PATHS = ' +
      JSON.stringify([paths.state, paths.installation, paths.data, paths.unit])
  )
assert.notEqual(text, baseScript.text)
const bootstrapScript = { text, sha256: createHash('sha256').update(text).digest('hex') }
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
  pythonOnlyExecutions = 0
const server = new Server({ hostKeys: [hostKey] }, (client) => {
  clients.add(client)
  client.on('error', () => {})
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
        if (!dropReply) {
          stream.write(chunk)
          return
        }
        stdout = Buffer.concat([stdout, chunk])
        if (stdout.length >= 4 && stdout.length >= stdout.readUInt32BE(0) + 4) {
          const value = JSON.parse(stdout.subarray(4, stdout.readUInt32BE(0) + 4))
          if (value.state === 'installation_result') {
            dropReply = false
            client.end()
            return
          }
          stream.write(stdout)
          stdout = Buffer.alloc(0)
        }
      })
      child.stderr.on('data', (chunk) => stream.stderr.write(chunk))
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
const results = []
const check = (name, action) => {
  action()
  results.push({ name, state: 'PASS' })
}
const fixed = (command, args) => {
  const r = spawnSync(command, args, { encoding: 'utf8', timeout: 50000, maxBuffer: 65536 })
  assert.equal(r.status, 0, 'fixed fixture command must exit0')
  return r.stdout
}
const raw = (code, header, body = Buffer.alloc(0), nonroot = false) => {
  const bytes = Buffer.from(JSON.stringify(header)),
    length = Buffer.alloc(4)
  length.writeUInt32BE(bytes.length)
  const command = nonroot ? '/usr/bin/setpriv' : '/usr/bin/python3'
  const args = [
    ...(nonroot
      ? ['--reuid', '1000', '--regid', '1000', '--clear-groups', '--', '/usr/bin/python3']
      : []),
    '-B',
    '-u',
    '-c',
    code
  ]
  const result = spawnSync(command, args, {
    input: Buffer.concat([length, bytes, body]),
    env: { PATH: bin, LANG: 'C.UTF-8' },
    timeout: 10000,
    maxBuffer: 65536
  })
  let output = result.stdout ?? Buffer.alloc(0)
  const frames = []
  while (output.length >= 4) {
    const size = output.readUInt32BE(0)
    assert(size <= 4096 && output.length >= 4 + size)
    frames.push(JSON.parse(output.subarray(4, 4 + size)))
    output = output.subarray(4 + size)
  }
  return { ...result, frames }
}
try {
  const discoveredAbsent = await discoverControllerBootstrap(input())
  check('discovery_absent_is_readonly_and_does_not_create_lock_or_state', () => {
    assert.deepEqual(discoveredAbsent, { state: 'absent' })
    assert(!existsSync(join(root, 'transfer')))
  })
  writeFileSync(paths.state, 'SYNTHETIC_UNKNOWN_MANUAL_STATE', { mode: 0o600, flag: 'wx' })
  try {
    await assert.rejects(() => discoverControllerBootstrap(input()), { code: 'BOOTSTRAP_CONFLICT' })
    check('unknown_manual_installation_is_conflict_instead_of_new_empty_plan', () =>
      assert(!existsSync(join(root, 'transfer')))
    )
  } finally {
    unlinkSync(paths.state)
  }
  const absent = await callControllerBootstrap({ ...input(), operation: 'status' })
  check('readonly_status_does_not_create_remote_namespace', () => {
    assert.equal(absent.state, 'absent')
    assert(!existsSync(join(root, 'transfer')))
  })
  const beforeAuth = authentications,
    beforeExec = executions
  await assert.rejects(
    () =>
      transferControllerRelease({
        ...input(),
        consent: true,
        artifacts,
        locator: { ...locator, installer_sha256: '0'.repeat(64) }
      }),
    { code: 'BOOTSTRAP_ARTIFACT_CHANGED' }
  )
  check('wrong_local_installer_pin_zero_auth_or_remote_exec', () => {
    assert.equal(authentications, beforeAuth)
    assert.equal(executions, beforeExec)
  })
  const wrong = 'SHA256:' + 'A'.repeat(43)
  await assert.rejects(() =>
    callControllerBootstrap({
      ...input(),
      ssh: manager(wrong),
      expectedIdentity: { ...identity, hostFingerprint: wrong },
      operation: 'status'
    })
  )
  check('wrong_ssh_pin_rejected_before_authentication', () =>
    assert.equal(authentications, beforeAuth)
  )
  let fences = 0
  await assert.rejects(
    () =>
      callControllerBootstrap({
        ...input(),
        operation: 'status',
        assertCurrent: () => {
          if (++fences === 2) throw Error('SYNTHETIC_PROFILE_CHANGED')
        }
      }),
    { code: 'BOOTSTRAP_AUTHORITY_CHANGED' }
  )
  check('authority_change_after_channel_open_sends_no_header_or_files', () =>
    assert(!existsSync(join(root, 'transfer')))
  )
  const manifestBytes = readFileSync(join(artifacts.release_directory, 'release-manifest.json'))
  const transferHeader = {
    format: 1,
    operation: 'transfer',
    ...locator,
    consent: true,
    manifest_size: manifestBytes.length,
    installer_size: readFileSync(artifacts.installer_path).length
  }
  check('nonroot_helper_refuses_before_any_namespace_write', () => {
    const result = raw(text, { format: 1, operation: 'status', ...locator }, Buffer.alloc(0), true)
    assert.equal(result.frames.at(-1).code, 'BOOTSTRAP_ROOT_REQUIRED')
    assert(!existsSync(join(root, 'transfer')))
  })
  for (const kind of ['traversal', 'quota', 'dev-package']) {
    const value = JSON.parse(manifestBytes)
    if (kind === 'traversal') value.files[0].path = '../escape'
    if (kind === 'quota') value.files[0].size = 1024 ** 3
    if (kind === 'dev-package')
      value.packages.push({ path: 'node_modules/esbuild', name: 'esbuild', version: '0.28.1' })
    const bytes = Buffer.from(JSON.stringify(value))
    const result = raw(
      text,
      {
        ...transferHeader,
        manifest_size: bytes.length,
        release_sha256: createHash('sha256').update(bytes).digest('hex')
      },
      bytes
    )
    check('python_rejects_' + kind + '_even_with_matching_manifest_pin', () => {
      assert.equal(result.frames.at(-1).state, 'error')
      assert(!existsSync(join(root, 'transfer')))
    })
  }
  const crashCode = text.replace(
    '        libc = ctypes.CDLL(None, use_errno=True)',
    '        os.kill(os.getpid(), signal.SIGKILL)\n        libc = ctypes.CDLL(None, use_errno=True)'
  )
  assert.notEqual(crashCode, text)
  const firstCrash = raw(crashCode, transferHeader, manifestBytes)
  check('process_death_before_namespace_rename_keeps_immutable_preparation_intent', () => {
    assert.equal(firstCrash.signal, 'SIGKILL')
    assert(existsSync(join(root, 'transfer.preparing-' + key, 'intent.json')))
    assert(!existsSync(join(root, 'transfer')))
  })
  await assert.rejects(() => discoverControllerBootstrap(input()), { code: 'BOOTSTRAP_CONFLICT' })
  check('discovery_does_not_hide_pre_rename_crash_with_a_new_request_uuid', () =>
    assert(!existsSync(join(root, 'transfer')))
  )
  const abort = new AbortController()
  await assert.rejects(
    () =>
      transferControllerRelease({
        ...input(),
        consent: true,
        artifacts,
        signal: abort.signal,
        onProgress: (p) => {
          if (p.completed_files === 3) abort.abort()
        }
      }),
    { code: 'BOOTSTRAP_OUTCOME_UNKNOWN' }
  )
  // SSH stdin EOF releases remote transfer lock after the interrupted write.
  let partial
  for (let i = 0; i < 50; i++) {
    try {
      partial = await callControllerBootstrap({ ...input(), operation: 'status' })
      break
    } catch (error) {
      if (error.code !== 'BOOTSTRAP_BUSY') throw error
      await new Promise((ok) => setTimeout(ok, 50))
    }
  }
  const remoteNode = join(root, 'transfer/release/node')
  const nodeInode = lstatSync(remoteNode).ino
  check('interrupted_145mb_transfer_is_durable_and_never_installs', () => {
    assert.equal(partial.state, 'uploading')
    assert(partial.completed_files > 0)
    assert(partial.completed_files < partial.total_files)
    assert(!existsSync(paths.unit))
    assert(!existsSync(paths.data))
  })
  let sent = 0
  const transferred = await transferControllerRelease({
    ...input(),
    consent: true,
    artifacts,
    onProgress: (p) => {
      sent = p.sent_bytes
    }
  })
  check('same_key_resume_reuses_committed_node_inode_and_streams_only_missing_files', () => {
    assert.equal(transferred.state, 'verified')
    assert.equal(lstatSync(remoteNode).ino, nodeInode)
    assert(sent < 20 * 1024 * 1024)
    assert.equal(transferred.completed_files, transferred.total_files)
  })
  let duplicateBytes = 0
  await transferControllerRelease({
    ...input(),
    consent: true,
    artifacts,
    onProgress: (p) => {
      duplicateBytes = p.sent_bytes
    }
  })
  check('complete_repeat_transfer_sends_no_committed_file_bodies', () => {
    assert.equal(duplicateBytes, manifestBytes.length)
    assert.equal(lstatSync(remoteNode).ino, nodeInode)
  })
  const intentPath = join(root, 'transfer/intent.json'),
    intentBefore = readFileSync(intentPath)
  const remoteHint = await discoverControllerBootstrap(input())
  check('readonly_discovery_returns_existing_uuid_and_both_pins_without_node_execution', () =>
    assert.deepEqual(remoteHint, { state: 'discovered', ...locator })
  )
  writeFileSync(intentPath, JSON.stringify({ ...JSON.parse(intentBefore), format: true }))
  try {
    await assert.rejects(() => callControllerBootstrap({ ...input(), operation: 'status' }), {
      code: 'BOOTSTRAP_CONFLICT'
    })
    check('corrupt_boolean_intent_version_is_not_coerced_to_format_one', () =>
      assert(!existsSync(paths.data))
    )
  } finally {
    writeFileSync(intentPath, intentBefore)
  }
  await assert.rejects(() => callControllerBootstrap({ ...input(), operation: 'inspect' }), {
    code: 'BOOTSTRAP_NOT_FOUND',
    remote_effects_possible: false
  })
  check('inspect_before_install_reports_definite_absence_without_creating_state', () => {
    assert(!existsSync(paths.state))
    assert(!existsSync(paths.data))
  })
  const lockPath = join(root, 'transfer/operation.lock')
  const lock = openSync(lockPath, 'r+')
  try {
    assert.equal(
      spawnSync('/usr/bin/flock', ['-n', '3'], { stdio: ['ignore', 'ignore', 'ignore', lock] })
        .status,
      0
    )
    await assert.rejects(() => callControllerBootstrap({ ...input(), operation: 'status' }), {
      code: 'BOOTSTRAP_BUSY'
    })
    check('kernel_lock_rejects_concurrent_transfer_inspection', () =>
      assert.equal(lstatSync(remoteNode).ino, nodeInode)
    )
  } finally {
    closeSync(lock)
  }
  const heldLock = join(root, 'retained-bootstrap-lock')
  const heldFd = openSync(lockPath, 'r+')
  assert.equal(
    spawnSync('/usr/bin/flock', ['-n', '3'], { stdio: ['ignore', 'ignore', 'ignore', heldFd] })
      .status,
    0
  )
  // Rename only a fixture-owned file; receiver must not create a new lock inode.
  const { renameSync } = await import('node:fs')
  renameSync(lockPath, heldLock)
  try {
    await assert.rejects(() => callControllerBootstrap({ ...input(), operation: 'status' }), {
      code: 'BOOTSTRAP_UNAVAILABLE'
    })
    check('missing_lock_path_never_bypasses_old_owned_inode', () => assert(!existsSync(lockPath)))
  } finally {
    renameSync(heldLock, lockPath)
    closeSync(heldFd)
  }
  const extra = join(root, 'transfer/unexpected')
  writeFileSync(extra, 'SYNTHETIC_FIXTURE', { mode: 0o600 })
  try {
    await assert.rejects(() => callControllerBootstrap({ ...input(), operation: 'status' }), {
      code: 'BOOTSTRAP_CONFLICT'
    })
    check('unknown_staging_file_is_never_deleted_or_adopted', () => assert(existsSync(extra)))
  } finally {
    unlinkSync(extra)
  }
  await assert.rejects(
    () =>
      callControllerBootstrap({
        ...input(),
        operation: 'status',
        locator: { ...locator, request_key: randomUUID() }
      }),
    { code: 'BOOTSTRAP_CONFLICT' }
  )
  check('foreign_request_key_cannot_adopt_existing_staging', () =>
    assert.equal(lstatSync(remoteNode).ino, nodeInode)
  )
  const fd = openSync(remoteNode, 'r+'),
    original = Buffer.alloc(1)
  readSync(fd, original, 0, 1, 0)
  try {
    writeSync(fd, Buffer.from('M'), 0, 1, 0)
    await assert.rejects(
      () => callControllerBootstrap({ ...input(), operation: 'install', consent: true }),
      { code: 'BOOTSTRAP_PIN_MISMATCH' }
    )
    check('python_checks_node_hash_before_any_packaged_node_execution', () => {
      assert(!existsSync(paths.data))
      assert(!existsSync(paths.unit))
    })
  } finally {
    writeSync(fd, original, 0, 1, 0)
    closeSync(fd)
  }
  const remoteTool = join(root, 'transfer/installer.cjs'),
    originalTool = readFileSync(remoteTool)
  try {
    writeFileSync(remoteTool, 'throw Error("SYNTHETIC_UNTRUSTED_INSTALLER");')
    await assert.rejects(
      () => callControllerBootstrap({ ...input(), operation: 'install', consent: true }),
      { code: 'BOOTSTRAP_PIN_MISMATCH' }
    )
    check('python_checks_independent_installer_hash_before_execution', () =>
      assert(!existsSync(paths.data))
    )
  } finally {
    writeFileSync(remoteTool, originalTool)
  }
  const desktopDirectory = join(root, 'desktop')
  mkdirSync(desktopDirectory, { mode: 0o700 })
  const desktopDb = initializeDatabase(desktopDirectory)
  const cipherKey = randomBytes(32),
    cipher = new AesGcmCredentialCipher(cipherKey)
  const repository = new VpsRepository(desktopDb)
  const addVps = () =>
    repository.create({
      name: 'fixture-controller',
      host: identity.host,
      port: identity.port,
      username: identity.username,
      auth_type: 'key',
      host_fingerprint: hostFingerprint,
      credential: cipher.encrypt(clientKey.toString())
    })
  assert.equal(addVps().id, 1)
  const journalSsh = new SshManager((id) => {
    const v = repository.getById(id)
    return {
      host: v.host,
      port: v.port,
      username: v.username,
      authType: v.auth_type,
      hostFingerprint: v.host_fingerprint,
      secret: loadSecret(desktopDb, cipher, id)
    }
  })
  managers.push(journalSsh)
  const release = {
    release_id: 'native-approved-linux22',
    ...artifacts,
    release_sha256: locator.release_sha256,
    installer_sha256: locator.installer_sha256
  }
  const journal = new DesktopControllerInstallations(desktopDb, journalSsh, [release], {
    bootstrapScript
  })
  const plan = await journal.plan(1, release.release_id)
  check('main_journal_discovers_remote_key_and_commits_same_uuid_before_any_install', () => {
    assert.equal(plan.request_key, key)
    assert.equal(plan.remote_existing, true)
    assert.equal(journal.prepare(plan.plan_id).state, 'outcome_unknown')
    assert.equal(desktopDb.prepare('SELECT max(version) n FROM schema_version').get().n, 29)
  })
  assert.equal((await journal.inspect(key)).state, 'transferred')
  dropReply = true
  const beforeInstallExec = executions
  await assert.rejects(() => journal.send(key, 'install', true), {
    code: 'BOOTSTRAP_OUTCOME_UNKNOWN',
    remote_effects_possible: true
  })
  check('lost_install_reply_never_automatically_reopens_or_replays', () => {
    assert.equal(executions, beforeInstallExec + 1)
    assert(existsSync(paths.unit))
    assert.equal(journal.list()[0].state, 'outcome_unknown')
  })
  await assert.rejects(() => journal.send(key, 'install', true), {
    code: 'INSTALL_INSPECT_REQUIRED'
  })
  // AES key only crosses a private stdin pipe; no plaintext SSH key, secret argv or env.
  const cold = await new Promise((ok, fail) => {
    const child = spawn(process.execPath, [resolve(import.meta.dirname, 'cold-inspect.mjs')], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }
    })
    const output = [],
      error = []
    child.stdout.on('data', (v) => output.push(v))
    child.stderr.on('data', (v) => error.push(v))
    child.on('error', fail)
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      fail(Error('COLD_INSPECT_TIMEOUT'))
    }, 120000)
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) return fail(Error('COLD_INSPECT_FAILED'))
      try {
        ok(JSON.parse(Buffer.concat(output).toString()))
      } catch {
        fail(Error('COLD_INSPECT_PROTOCOL'))
      }
    })
    child.stdin.end(
      JSON.stringify({
        modules,
        tool,
        directory: desktopDirectory,
        key: cipherKey.toString('base64'),
        release,
        bootstrapScript,
        request_key: key
      })
    )
  })
  check(
    'cold_main_process_reads_sqlite029_and_inspects_same_installed_controller_after_lost_reply',
    () => {
      assert.equal(cold.schema, 29)
      assert.equal(cold.before[0].state, 'outcome_unknown')
      assert.equal(cold.result.state, 'installed')
      assert.equal(cold.result.request_key, key)
      assert.equal(cold.result.last_result.service_state, 'running')
      assert.equal(executions, beforeInstallExec + 3) // one install, readonly status and inspect
    }
  )
  repository.delete(1)
  assert.equal(journal.list()[0].controller_id, cold.result.controller_id)
  await assert.rejects(() => journal.inspect(key), { code: 'INSTALL_AUTHORITY_CHANGED' })
  assert.equal(addVps().id, 1)
  const rebindPlan = await journal.plan(1, release.release_id)
  assert.equal(rebindPlan.rebind_required, true)
  assert.throws(() => journal.prepare(rebindPlan.plan_id), { code: 'INSTALL_REBIND_REQUIRED' })
  const rebound = journal.rebind(rebindPlan.plan_id, key, true)
  const afterRebind = await journal.inspect(key)
  check(
    'archive_readd_explicit_fresh_pinned_rebind_preserves_root_uuid_controller_db_and_service',
    () => {
      assert.equal(rebound.authority_revision, 2)
      assert.equal(afterRebind.controller_id, cold.result.controller_id)
      assert.equal(afterRebind.state, 'installed')
      assert.equal(afterRebind.request_key, key)
      assert.equal(afterRebind.last_result.service_state, 'running')
    }
  )
  ssh = manager()
  const recovered = await callControllerBootstrap({ ...input(), operation: 'inspect' })
  check('cold_ssh_inspect_finds_real_installed_systemd_service_without_replay', () => {
    assert.equal(recovered.state, 'installation_result')
    assert.equal(recovered.installation.phase, 'installed')
    assert.equal(recovered.installation.service_state, 'running')
    assert(recovered.installation.runtime_uid > 0)
    assert.equal(recovered.installation.service_enabled, true)
  })
  check('ssh_context_contains_python_only_and_helper_never_uses_host_node', () => {
    assert(!existsSync(join(bin, 'node')))
    assert.equal(pythonOnlyExecutions, executions)
    assert(text.includes('node = os.path.join(TRANSFER_ROOT, "release/node")'))
  })
  check('canonical_database_and_private_key_created_only_by_fixed_installer', () => {
    const db = new Database(join(paths.data, 'opspilot.db'), {
      readonly: true,
      fileMustExist: true
    })
    try {
      assert.equal(db.prepare('SELECT max(version) n FROM schema_version').get().n, 28)
      for (const t of ['vps', 'app', 'deployment', 'product_deploy_job'])
        assert.equal(db.prepare('SELECT count(*) n FROM ' + t).get().n, 0)
    } finally {
      db.close()
    }
    assert.equal(lstatSync(join(paths.data, '.controller-runtime-key')).mode & 0o777, 0o600)
  })
  fixed('/usr/bin/systemctl', ['stop', unitName])
  const stopped = await callControllerBootstrap({ ...input(), operation: 'inspect' })
  check('read_only_ssh_inspect_never_restarts_a_stopped_service', () => {
    assert.equal(stopped.installation.service_state, 'stopped')
    assert.equal(stopped.installation.controller_id, recovered.installation.controller_id)
  })
} finally {
  for (const m of managers) await m.disconnectAll()
  for (const child of children) child.kill()
  for (const client of clients) client.end()
  await new Promise((ok) => server.close(ok))
  closeDatabase()
  assert.equal(root, resolve('/opt', 'opspilot-controller-service-lab-' + nonce))
  assert.equal(readFileSync(join(root, '.lab-owner'), 'utf8'), nonce)
  if (existsSync(paths.unit)) {
    assert.equal(readFileSync(paths.unit, 'utf8'), renderControllerUnit(paths, key))
    fixed('/usr/bin/systemctl', ['stop', unitName])
    fixed('/usr/bin/systemctl', ['disable', unitName])
    unlinkSync(paths.unit)
    fixed('/usr/bin/systemctl', ['daemon-reload'])
    spawnSync('/usr/bin/systemctl', ['reset-failed', unitName], { timeout: 10000 })
  }
  const user = spawnSync('/usr/bin/getent', ['passwd', account], { encoding: 'utf8' })
  if (user.status === 0) {
    assert(user.stdout.includes('opspilot-install-' + key))
    fixed('/usr/sbin/userdel', [account])
  }
  assert.equal(spawnSync('/usr/bin/getent', ['group', account]).status, 2)
  rmSync(root, { recursive: true })
}
const receipt = {
  state: 'PASS',
  checks: results.length,
  results,
  release_sha256: releasePin,
  python_only_path: true,
  fixture_account_removed: spawnSync('/usr/bin/getent', ['passwd', account]).status === 2,
  fixture_unit_removed: !existsSync(paths.unit),
  fixture_root_removed: !existsSync(root),
  production_vps_used: false,
  production_database_used: false
}
writeFileSync(join(evidence, 'result.json'), JSON.stringify(receipt, null, 2) + '\n')
console.log(JSON.stringify({ state: 'PASS', checks: results.length, evidence }))
