/* eslint-disable @typescript-eslint/explicit-function-return-type -- CLI JavaScript chạy trực tiếp bằng Node, không có cú pháp kiểu TypeScript. */
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

if (process.platform !== 'linux' || process.getuid?.() !== 0)
  throw new Error('ROOT_LINUX_LAB_REQUIRED')
const artifact = process.env.OPSPILOT_CONTROLLER_ARTIFACT
if (!artifact) throw new Error('CONTROLLER_ARTIFACT_REQUIRED')
const Database = createRequire(artifact)('better-sqlite3')
const repo = resolve(import.meta.dirname, '../../..')
const nonce = randomBytes(6).toString('hex')
const retainedGate = process.argv.includes('--retained-target-gate')
const scratch = mkdtempSync(join(tmpdir(), 'opspilot-enrollment-'))
chmodSync(scratch, 0o700)
const output = resolve(repo, 'app/.out-scripts/controller-enrollment', nonce)
mkdirSync(output, { recursive: true })
const bundleHash = createHash('sha256').update(readFileSync(artifact)).digest('hex')
const driverHash = createHash('sha256')
  .update(readFileSync(import.meta.filename))
  .digest('hex')
const subjects = [
  'app/src/main/controlPlane/cli.ts',
  'app/src/main/controlPlane/controllerEnrollment.ts',
  'app/src/main/controlPlane/controllerBootstrapInput.ts',
  'app/src/main/controlPlane/controllerSecrets.ts',
  'app/src/main/controlPlane/controllerSshResolver.ts',
  'docs/contracts/product-controller-bootstrap.ts'
]
const hashes = () =>
  Object.fromEntries(
    subjects.map((file) => [
      file,
      createHash('sha256')
        .update(readFileSync(join(repo, file)))
        .digest('hex')
    ])
  )
const subjectHashes = hashes()
const cases = []
const run = (program, args) =>
  execFileSync(program, args, {
    encoding: 'utf8',
    timeout: 10000,
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
const directory = join(scratch, 'controller')
let sshd
let failure
let secret
const record = (name) => {
  cases.push({ name, status: 'PASS' })
}
const readRows = (dir = directory) => {
  const database = new Database(join(dir, 'opspilot.db'), { readonly: true, fileMustExist: true })
  try {
    return database.prepare('SELECT * FROM vps ORDER BY id').all()
  } finally {
    database.close()
  }
}
const writeLabSql = (sql) => {
  assert.equal(dirname(realpathSync(directory)), realpathSync(scratch))
  const database = new Database(join(directory, 'opspilot.db'), { fileMustExist: true })
  try {
    database.exec(sql)
  } finally {
    database.close()
  }
}
async function cli(command, input, dir = directory, expected = 0) {
  const result = await new Promise((resolveChild) => {
    const child = spawn(process.execPath, [artifact, command, '--data-dir', dir], {
      env: {
        ...process.env,
        NODE_ENV: 'production',
        OPSPILOT_SSH_SECRET: 'INHERITED_UNIT_SENTINEL'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = '',
      stderr = '',
      overflow = false
    const capture = (field, data) => {
      if ((field === 'out' ? stdout : stderr).length + data.length > 512 * 1024) overflow = true
      else if (field === 'out') stdout += data
      else stderr += data
    }
    child.stdout.on('data', (data) => capture('out', data))
    child.stderr.on('data', (data) => capture('err', data))
    child.stdin.on('error', () => {})
    child.stdin.end(
      input === undefined ? undefined : typeof input === 'string' ? input : JSON.stringify(input)
    )
    const timer = setTimeout(() => child.kill('SIGKILL'), 45000)
    child.once('error', () => {
      clearTimeout(timer)
      resolveChild({ code: null, overflow: true, stdout: '', stderr: '' })
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolveChild({ code, stdout, stderr, overflow })
    })
  })
  assert.equal(result.overflow, false)
  assert.equal(result.code, expected)
  assert.equal(result.stdout.includes('INHERITED_UNIT_SENTINEL'), false)
  assert.equal(result.stderr.includes('INHERITED_UNIT_SENTINEL'), false)
  if (secret) {
    assert.equal(result.stdout.includes(secret), false)
    assert.equal(result.stderr.includes(secret), false)
  }
  if (expected === 0) return JSON.parse(result.stdout.trim())
  assert.equal(result.stdout, '')
  assert.match(result.stderr.trim(), /^CONTROL_PLANE_ERROR [A-Z][A-Z0-9_]{1,80}$/)
  return result.stderr.trim().split(' ')[1]
}

try {
  for (const key of ['host', 'client', 'untrusted-client']) {
    run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(scratch, key)])
    chmodSync(join(scratch, key), 0o600)
  }
  secret = readFileSync(join(scratch, 'client'), 'utf8')
  const pin = run('ssh-keygen', ['-lf', join(scratch, 'host.pub'), '-E', 'sha256']).match(
    /SHA256:[A-Za-z0-9+/]{43}/
  )?.[0]
  assert.ok(pin)
  const port = await new Promise((resolvePort, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const selected = server.address().port
      server.close((error) => (error ? reject(error) : resolvePort(selected)))
    })
  })
  mkdirSync('/run/sshd', { recursive: true })
  const config = join(scratch, 'sshd_config')
  writeFileSync(
    config,
    [
      `Port ${port}`,
      'ListenAddress 127.0.0.1',
      `HostKey ${join(scratch, 'host')}`,
      `PidFile ${join(scratch, 'sshd.pid')}`,
      `AuthorizedKeysFile ${join(scratch, 'client.pub')}`,
      'AllowUsers root',
      'PermitRootLogin yes',
      'StrictModes no',
      'UsePAM no',
      'PasswordAuthentication no',
      'KbdInteractiveAuthentication no',
      'PubkeyAuthentication yes',
      'AuthenticationMethods publickey'
    ].join('\n') + '\n',
    { mode: 0o600 }
  )
  sshd = spawn(run('sh', ['-lc', 'command -v sshd']), ['-D', '-e', '-f', config], {
    stdio: 'ignore'
  })
  for (let attempt = 0; ; attempt += 1) {
    assert.equal(sshd.exitCode, null)
    if (
      await new Promise((resolveCheck) => {
        const socket = net.connect(port, '127.0.0.1')
        socket.once('connect', () => {
          socket.destroy()
          resolveCheck(true)
        })
        socket.once('error', () => resolveCheck(false))
      })
    )
      break
    assert.ok(attempt < 80)
    await delay(100)
  }
  const initialized = await cli('init')
  assert.equal(readRows().length, 0)
  assert.equal(existsSync(join(directory, '.controller-runtime-key')), false)
  record('init_does_not_create_key_or_vps')
  const input = {
    format: 1,
    controller_id: initialized.controller_id,
    profile: {
      name: `lab-${nonce}`,
      host: '127.0.0.1',
      port,
      username: 'root',
      auth_type: 'key',
      host_fingerprint: pin
    },
    secret
  }
  assert.equal(
    await cli('enroll-vps', input, directory, 1),
    'CONTROLLER_VPS_CREDENTIAL_STORE_UNAVAILABLE'
  )
  assert.equal(readRows().length, 0)
  record('missing_key_never_autocreates_or_enrolls')
  assert.equal((await cli('secrets-init')).state, 'secrets_initialized')
  const keyPath = join(directory, '.controller-runtime-key')
  const keyHash = createHash('sha256').update(readFileSync(keyPath)).digest('hex')
  assert.equal(statSync(keyPath).size, 32)
  assert.equal(statSync(keyPath).mode & 0o777, 0o600)
  assert.equal(
    await cli('secrets-init', undefined, directory, 1),
    'CONTROLLER_SECRET_INITIALIZATION_UNAVAILABLE'
  )
  assert.equal(createHash('sha256').update(readFileSync(keyPath)).digest('hex'), keyHash)
  record('explicit_private_create_once_key')
  assert.equal(
    await cli('enroll-vps', { ...input, controller_id: 'wrong-controller' }, directory, 1),
    'CONTROLLER_VPS_CONTROLLER_MISMATCH'
  )
  assert.equal(
    await cli(
      'enroll-vps',
      { ...input, profile: { ...input.profile, host_fingerprint: '' } },
      directory,
      1
    ),
    'CONTROLLER_VPS_INPUT_INVALID'
  )
  assert.equal(readRows().length, 0)
  record('controller_and_missing_pin_reject_without_write')
  assert.equal(
    await cli(
      'enroll-vps',
      { ...input, profile: { ...input.profile, host_fingerprint: `SHA256:${'A'.repeat(43)}` } },
      directory,
      1
    ),
    'CONTROLLER_VPS_SSH_VERIFICATION_FAILED'
  )
  assert.equal(
    await cli(
      'enroll-vps',
      { ...input, secret: readFileSync(join(scratch, 'untrusted-client'), 'utf8') },
      directory,
      1
    ),
    'CONTROLLER_VPS_SSH_VERIFICATION_FAILED'
  )
  assert.equal(readRows().length, 0)
  record('real_host_key_and_auth_failure_do_not_enroll')
  const enrolled = await cli('enroll-vps', input)
  assert.equal(enrolled.state, 'enrolled')
  const [row] = readRows()
  assert.equal(row.id, enrolled.vps_id)
  assert.equal(row.encrypted_secret.includes(Buffer.from(secret)), false)
  const key = readFileSync(keyPath)
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, row.iv)
    decipher.setAuthTag(row.auth_tag)
    const plaintext = Buffer.concat([decipher.update(row.encrypted_secret), decipher.final()])
    try {
      const payload = JSON.parse(plaintext.toString())
      assert.equal(payload.secret, secret)
      assert.equal(payload.binding.controller_id, initialized.controller_id)
      assert.equal(payload.binding.target.vps_id, row.id)
      assert.equal(payload.binding.target.host_fingerprint, pin)
      assert.equal(payload.binding.target.ssh_security_revision, 1)
    } finally {
      plaintext.fill(0)
    }
  } finally {
    key.fill(0)
  }
  record('pinned_authenticated_enrollment_saves_bound_ciphertext')
  assert.deepEqual(await cli('enroll-vps', input), { ...enrolled, state: 'already_enrolled' })
  assert.deepEqual(readRows(), [row])
  record('cold_cli_replay_preserves_id_ciphertext_and_metadata')
  if (retainedGate) {
    const legacyDirectory = process.env.OPSPILOT_LEGACY_PAYLOAD
    assert(legacyDirectory)
    const old = join(scratch, 'legacy'),
      current = join(scratch, 'current')
    cpSync(legacyDirectory, old, { recursive: true })
    cpSync(dirname(artifact), current, { recursive: true })
    const ownerModes = (dir) => {
      chmodSync(dir, 0o700)
      for (const item of readdirSync(dir, { withFileTypes: true })) {
        if (item.isDirectory()) ownerModes(join(dir, item.name))
        else {
          assert(!item.isSymbolicLink())
          chmodSync(join(dir, item.name), 0o600)
        }
      }
    }
    ownerModes(old)
    ownerModes(current)
    const oldPin = createHash('sha256')
      .update(readFileSync(join(old, 'bundle-manifest.json')))
      .digest('hex')
    assert.equal(oldPin, '4e3a163f077f69cd23b58ffcd26e40506489041804a9b01ea9ef006db3588510')
    const registered = await cli('register-project', {
      format: 1,
      controller_id: initialized.controller_id,
      request_key: randomUUID(),
      target_vps_id: row.id,
      expected_target_security_revision: row.ssh_security_revision,
      app_name: 'legacy-' + nonce,
      framework: 'express',
      repository_url: 'https://github.com/example/legacy.git',
      production_ref: 'main',
      repository_root: '.',
      host_port: null,
      container_port: 3000,
      healthcheck_path: '/health'
    })
    const target = await cli('enroll-target', {
      format: 1,
      controller_id: initialized.controller_id,
      app_id: registered.app_id,
      ownership_generation: 1,
      artifact: join(old, 'control-plane.cjs'),
      manifest_sha256: oldPin,
      target_root: join(scratch, 'targets')
    })
    assert.equal(target.state, 'enrolled')
    const helper = join(dirname(target.helper_path), 'target_product_runtime.py'),
      bytes = readFileSync(helper)
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      'eb5c697e0051f38e0633bc84e32377fbc91cf4b825c21734f5f611a49b85908d'
    )
    const recoveryInput = {
      format: 1,
      artifact: join(current, 'control-plane.cjs'),
      manifest_sha256: createHash('sha256')
        .update(readFileSync(join(current, 'bundle-manifest.json')))
        .digest('hex')
    }
    const recovered = await cli('recover-runtime', recoveryInput)
    assert.equal(recovered.state, 'ready')
    assert.equal(recovered.inspected_enrollments, 1)
    assert.deepEqual(readFileSync(helper), bytes)
    record(
      'actual_old_express_enrollment_recovers_under_new_bundle_without_reinstall_or_helper_write'
    )
    writeLabSql("UPDATE app SET framework='static-spa',container_port=80")
    const wrong = await cli('recover-runtime', recoveryInput)
    assert.equal(wrong.state, 'reconciliation_required')
    assert.equal(wrong.blockers[0].reason, 'enrollment_not_ready')
    record('spa_rejects_the_same_legacy_helper')
    writeLabSql("UPDATE app SET framework='express',container_port=3000")
    writeFileSync(helper, Buffer.concat([bytes, Buffer.from('\n# tampered fixture\n')]))
    const tampered = await cli('recover-runtime', recoveryInput)
    assert.equal(tampered.state, 'reconciliation_required')
    record('actual_remote_helper_drift_rejected_even_with_legacy_profile_compatibility')
    throw Object.assign(new Error('RETAINED_GATE_FINISHED'), { checkpoint: true })
  }
  assert.equal(
    await cli('enroll-vps', { ...input, secret: 'SYNTHETIC_DIFFERENT_MATERIAL' }, directory, 1),
    'CONTROLLER_VPS_ENROLLMENT_CONFLICT'
  )
  assert.equal(
    await cli(
      'enroll-vps',
      { ...input, profile: { ...input.profile, name: 'other-name' } },
      directory,
      1
    ),
    'CONTROLLER_VPS_ENROLLMENT_CONFLICT'
  )
  assert.deepEqual(readRows(), [row])
  record('credential_and_endpoint_conflicts_never_overwrite')
  const concurrentDir = join(scratch, 'concurrent')
  const concurrent = await cli('init', undefined, concurrentDir)
  await cli('secrets-init', undefined, concurrentDir)
  const concurrentInput = { ...input, controller_id: concurrent.controller_id }
  const pair = await Promise.all([
    cli('enroll-vps', concurrentInput, concurrentDir),
    cli('enroll-vps', concurrentInput, concurrentDir)
  ])
  assert.deepEqual(pair.map((item) => item.state).sort(), ['already_enrolled', 'enrolled'])
  assert.equal(pair[0].vps_id, pair[1].vps_id)
  assert.equal(readRows(concurrentDir).length, 1)
  record('two_real_cli_processes_converge_on_one_vps')
  renameSync(keyPath, keyPath + '.retained')
  assert.equal(
    await cli('secrets-init', undefined, directory, 1),
    'CONTROLLER_SECRET_MATERIAL_REQUIRES_RECOVERY'
  )
  assert.equal(existsSync(keyPath), false)
  assert.equal(
    await cli('enroll-vps', input, directory, 1),
    'CONTROLLER_VPS_CREDENTIAL_STORE_UNAVAILABLE'
  )
  assert.deepEqual(readRows(), [row])
  renameSync(keyPath + '.retained', keyPath)
  chmodSync(keyPath, 0o644)
  assert.equal(
    await cli('enroll-vps', input, directory, 1),
    'CONTROLLER_VPS_CREDENTIAL_STORE_UNAVAILABLE'
  )
  chmodSync(keyPath, 0o600)
  record('missing_or_unsafe_key_never_replaces_retained_material')
  assert.equal(
    await cli('enroll-vps', '{"secret":"SYNTHETIC_UNIT_MATERIAL"', directory, 1),
    'CONTROLLER_VPS_INPUT_INVALID'
  )
  assert.equal(
    await cli('enroll-vps', ' '.repeat(512 * 1024 + 1), directory, 1),
    'CONTROLLER_VPS_INPUT_INVALID'
  )
  assert.equal(await cli('enroll-vps', '{}', directory, 1), 'CONTROLLER_VPS_INPUT_INVALID')
  assert.deepEqual(readRows(), [row])
  record('bounded_invalid_stdin_has_no_env_fallback_or_secret_output')
  writeLabSql("UPDATE vps SET archived_at='2026-11-06T00:00:00Z'")
  assert.equal(await cli('enroll-vps', input, directory, 1), 'CONTROLLER_VPS_ENROLLMENT_CONFLICT')
  assert.equal(readRows()[0].archived_at, '2026-11-06T00:00:00Z')
  record('archived_vps_is_not_restored_by_replay')
  const retainedDir = join(scratch, 'retained')
  await cli('init', undefined, retainedDir)
  writeFileSync(join(retainedDir, 'h2-retained.json'), '{}', { mode: 0o600 })
  assert.equal(
    await cli('secrets-init', undefined, retainedDir, 1),
    'CONTROLLER_SECRET_MATERIAL_REQUIRES_RECOVERY'
  )
  assert.equal(existsSync(join(retainedDir, '.controller-runtime-key')), false)
  record('retained_runtime_key_blocks_new_master_even_without_vps')
  assert.equal((await cli('status')).controller_id, initialized.controller_id)
  record('existing_status_command_still_works')
} catch (error) {
  if (!error?.checkpoint) {
    failure = 'CONTROLLER_ENROLLMENT_LAB_FAILED'
    writeFileSync(
      join(output, 'failure.json'),
      JSON.stringify({
        name: error?.name,
        location: /controller-enrollment\.mjs:\d+:\d+/.exec(error?.stack ?? '')?.[0] ?? null
      }) + '\n'
    )
  }
} finally {
  sshd?.kill('SIGTERM')
  if (sshd) {
    for (
      let attempt = 0;
      sshd.exitCode === null && sshd.signalCode === null && attempt < 50;
      attempt += 1
    )
      await delay(100)
    if (sshd.exitCode === null && sshd.signalCode === null) {
      sshd.kill('SIGKILL')
      failure = 'SSHD_CLEANUP_FAILED'
    }
  }
  assert.equal(dirname(realpathSync(scratch)), realpathSync(tmpdir()))
  rmSync(scratch, { recursive: true })
  const unchanged = JSON.stringify(hashes()) === JSON.stringify(subjectHashes)
  const result = {
    status: failure || !unchanged ? 'FAIL' : 'PASS',
    nonce,
    scope: retainedGate
      ? 'RETAINED_HELPER_REAL_SSH_COLD_RECOVERY'
      : 'REAL_CONTROLLER_ENROLLMENT_CLI_SSH_SQLITE',
    cases,
    failure,
    bundle_sha256: bundleHash,
    driver_sha256: driverHash,
    subject_sha256: subjectHashes,
    subject_unchanged: unchanged,
    cleanup: !existsSync(scratch)
  }
  writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result))
  process.exitCode = result.status === 'PASS' ? 0 : 1
}
