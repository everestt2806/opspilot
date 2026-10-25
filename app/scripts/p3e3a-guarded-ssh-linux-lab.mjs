/* eslint-disable @typescript-eslint/explicit-function-return-type -- standalone Linux lab harness. */
import assert from 'node:assert/strict'
import { spawn, spawnSync, execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import net from 'node:net'
import { Duplex, PassThrough } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'

if (process.platform !== 'linux') throw new Error('LINUX_REQUIRED')

const artifactPath = process.env.OPSPILOT_P3E3A_LAB_ARTIFACT
if (!artifactPath) throw new Error('OPSPILOT_P3E3A_LAB_ARTIFACT_REQUIRED')
const helperBundleDirectory = process.env.OPSPILOT_P3E3A_HELPER_DIR
if (!helperBundleDirectory) throw new Error('OPSPILOT_P3E3A_HELPER_DIR_REQUIRED')
const require = createRequire(artifactPath)
const {
  ProductDeployRepository,
  SshManager,
  closeDatabase,
  encodeGuardedSshFrame,
  initializeDatabase,
  openProductGuardedSshSession
} = require(artifactPath)
const sshdBinary = execFileSync('sh', ['-lc', 'command -v sshd'], { encoding: 'utf8' }).trim()
const scratch = mkdtempSync(join(tmpdir(), 'opspilot-p3e3a-'))
const targetHelper = join(scratch, 'target-helper')
const databaseDirectory = join(scratch, 'database')
const secondDatabaseDirectory = join(scratch, 'database-lost-response')
const targetState = join(scratch, 'target-state')
const secondTargetState = join(scratch, 'target-state-lost-response')
const protocolTargetState = join(scratch, 'target-state-protocol')
const sshDirectory = join(scratch, 'sshd')
for (const directory of [targetHelper, databaseDirectory, secondDatabaseDirectory, sshDirectory]) {
  mkdirSyncSafe(directory)
}
copyFileSync(
  join(helperBundleDirectory, 'target_guarded_ssh_helper.py'),
  join(targetHelper, 'target_guarded_ssh_helper.py')
)
copyFileSync(
  join(helperBundleDirectory, 'target_execution_guard.py'),
  join(targetHelper, 'target_execution_guard.py')
)
const sshdLog = join(scratch, 'sshd.log')
const sshdConfig = join(scratch, 'sshd_config')
const user = execFileSync('id', ['-un'], { encoding: 'utf8' }).trim()
const port = await reservePort()
let sshd = null
let timedOut = false
let database = null
let secondDatabase = null
let manager = null
let secondManager = null
let rootManager = null
let labStage = 'setup'
const watchdog = setTimeout(() => {
  timedOut = true
  try {
    if (sshd?.pid) process.kill(-sshd.pid, 'SIGKILL')
  } catch {
    process.exitCode = 1
  }
  process.exit(91)
}, 60_000)

try {
  generateKey('host')
  generateKey('client')
  generateKey('wrong-host')
  const authorizedKeys = join(sshDirectory, 'authorized_keys')
  writeFileSync(authorizedKeys, readFileSync(join(sshDirectory, 'client.pub')), { mode: 0o600 })
  const hostFingerprint = fingerprint('host.pub')
  const configLines = [
    `Port ${port}`,
    'ListenAddress 127.0.0.1',
    `HostKey ${join(sshDirectory, 'host')}`,
    `PidFile ${join(sshDirectory, 'sshd.pid')}`,
    `AuthorizedKeysFile ${authorizedKeys}`,
    `AllowUsers ${user}`,
    'StrictModes no',
    'UsePAM no',
    'PasswordAuthentication no',
    'KbdInteractiveAuthentication no',
    'PubkeyAuthentication yes',
    'AuthenticationMethods publickey',
    'LogLevel VERBOSE',
    'Subsystem sftp internal-sftp'
  ]
  if (user === 'root') configLines.push('PermitRootLogin yes')
  writeFileSync(sshdConfig, `${configLines.join('\n')}\n`, { mode: 0o600 })
  execFileSync(sshdBinary, ['-t', '-f', sshdConfig])
  sshd = spawn(sshdBinary, ['-D', '-e', '-f', sshdConfig, '-E', sshdLog], {
    detached: true,
    stdio: 'ignore',
    env: { PATH: process.env.PATH, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }
  })
  await waitForPort(port, sshd)

  database = initializeDatabase(databaseDirectory)
  database.pragma('foreign_keys = ON')
  seedProductApp(database, 1, 'ssh-session-app-1', 'session-job-1', hostFingerprint, port, 41)
  const repository = ProductDeployRepository.withClockForTest(database, () => Date.now())
  const claimOne = claim(repository)
  const snapshotOne = snapshot()
  repository.markGitSnapshotVerified(claimOne, snapshotOne)
  initializeTarget(String(claimOne.app_id), claimOne.ownership_generation)

  secondDatabase = initializeDatabase(secondDatabaseDirectory)
  secondDatabase.pragma('foreign_keys = ON')
  seedProductApp(secondDatabase, 1, 'ssh-session-app-lost-response', 'session-job-lost-response', hostFingerprint, port, 41)
  const secondRepository = ProductDeployRepository.withClockForTest(secondDatabase, () =>
    Date.now()
  )
  const claimTwo = claim(secondRepository)
  const snapshotTwo = snapshot()
  secondRepository.markGitSnapshotVerified(claimTwo, snapshotTwo)
  initializeTarget(String(claimTwo.app_id), claimTwo.ownership_generation, secondTargetState)

  const privateKey = readFileSync(join(sshDirectory, 'client'), 'utf8')
  const resolver = () => ({
    host: '127.0.0.1',
    port,
    hostFingerprint,
    username: user,
    authType: 'key',
    secret: privateKey
  })
  manager = new SshManager(resolver)
  await manager.connect(41)
  assert.equal(manager.getVerifiedHostKey(41)?.length > 0, true)

  rootManager = new SshManager(() => ({
    ...resolver(),
    hostFingerprint: `SHA256:${'A'.repeat(43)}`
  }))
  const acceptedBeforeWrongPin = await countPublicKeyAuths(sshdLog)
  await assert.rejects(rootManager.connect(42), (error) => error?.code === 'VALIDATION')
  assert.equal(rootManager.getVerifiedHostKey(42), null)
  await delay(100)
  assert.equal(await countPublicKeyAuths(sshdLog), acceptedBeforeWrongPin)

  const firstMarkerPath = markerPath(String(claimOne.app_id))
  const originalOpen = manager.openGuardedExecutionChannelWithIdentity.bind(manager)
  const order = []
  manager.openGuardedExecutionChannelWithIdentity = async (...args) => {
    const job = database
      .prepare('SELECT state FROM product_deploy_job WHERE job_id=?')
      .get(claimOne.job_id)
    const attempt = database
      .prepare('SELECT remote_outcome,deployment_id FROM product_deploy_attempt WHERE attempt_id=?')
      .get(claimOne.attempt_id)
    const deployments = database.prepare('SELECT COUNT(*) AS count FROM deployment').get().count
    assert.equal(job.state, 'deploying')
    assert.equal(attempt.remote_outcome, 'unknown')
    assert.equal(attempt.deployment_id, 1)
    assert.equal(deployments, 1)
    assert.equal(JSON.parse(readFileSync(firstMarkerPath, 'utf8')).execution_state, 'idle')
    order.push('sqlite_dispatch_committed')
    return originalOpen(...args)
  }

  const preparedOne = prepared(claimOne, snapshotOne)
  const session = await openProductGuardedSshSession(repository, manager, preparedOne, {
    vps_id: 41,
    target_helper_path: join(targetHelper, 'target_guarded_ssh_helper.py'),
    target_state_root: targetState
  })
  order.push('target_guard_entered')
  assert.deepEqual(order, ['sqlite_dispatch_committed', 'target_guard_entered'])
  manager.openGuardedExecutionChannelWithIdentity = originalOpen
  assert.deepEqual(JSON.parse(readFileSync(firstMarkerPath, 'utf8')), {
    format: 1,
    controller_id: claimOne.controller_id,
    app_id: String(claimOne.app_id),
    ownership_generation: claimOne.ownership_generation,
    highest_accepted_fence: claimOne.app_fence,
    last_claim_id: claimOne.job_id,
    last_attempt_id: claimOne.attempt_id,
    execution_state: 'unknown'
  })
  await session.authorizeWritePhase('prepare')
  await session.authorizeWritePhase('build')
  await assertLockHeld(String(claimOne.app_id))

  const contender = await manager.openGuardedExecutionChannel(
    41,
    join(targetHelper, 'target_guarded_ssh_helper.py')
  )
  const contention = await sendOpenRequest(
    contender,
    {
      controller_id: claimOne.controller_id,
      app_id: String(claimOne.app_id),
      ownership_generation: claimOne.ownership_generation,
      claim_id: 'contender-job',
      attempt_id: 'contender-attempt',
      app_fence: claimOne.app_fence + 1
    },
    targetState
  )
  assert.equal(contention.error_code, 'TARGET_LOCK_BUSY')
  contender.destroy()
  assert.equal(
    JSON.parse(readFileSync(firstMarkerPath, 'utf8')).highest_accepted_fence,
    claimOne.app_fence
  )

  await session.close()
  assert.equal(session.state, 'closed')
  assert.equal(JSON.parse(readFileSync(firstMarkerPath, 'utf8')).execution_state, 'unknown')

  const secondMarkerPath = markerPath(String(claimTwo.app_id), secondTargetState)
  secondManager = new SshManager(resolver)
  const originalSecondOpen = secondManager.openGuardedExecutionChannelWithIdentity.bind(secondManager)
  secondManager.openGuardedExecutionChannelWithIdentity = async (...args) => {
    const attempt = secondDatabase
      .prepare('SELECT remote_outcome,deployment_id FROM product_deploy_attempt WHERE attempt_id=?')
      .get(claimTwo.attempt_id)
    assert.equal(attempt.remote_outcome, 'unknown')
    assert.equal(attempt.deployment_id, 1)
    assert.equal(JSON.parse(readFileSync(secondMarkerPath, 'utf8')).execution_state, 'idle')
    return originalSecondOpen(...args)
  }
  const droppingManager = new Proxy(secondManager, {
    get(target, property, receiver) {
      if (property !== 'openGuardedExecutionChannelWithIdentity') return Reflect.get(target, property, receiver)
      return async (...args) => {
        const opened = await target.openGuardedExecutionChannelWithIdentity(...args)
        return { ...opened, channel: dropFirstResponse(opened.channel) }
      }
    }
  })
  await assert.rejects(
    openProductGuardedSshSession(
      secondRepository,
      droppingManager,
      prepared(claimTwo, snapshotTwo),
      {
        vps_id: 41,
        target_helper_path: join(targetHelper, 'target_guarded_ssh_helper.py'),
        target_state_root: secondTargetState
      }
    ),
    (error) => error?.code === 'SSH_SESSION_DISCONNECTED' || error?.code === 'SSH_OUTCOME_UNKNOWN'
  )
  const retry = secondRepository.beginGitDispatch(claimTwo, snapshotTwo)
  assert.deepEqual(retry, { state: 'reconciliation_required', reason: 'dispatch_marker_exists' })
  assert.equal(secondDatabase.prepare('SELECT COUNT(*) AS count FROM deployment').get().count, 1)
  assert.equal(JSON.parse(readFileSync(secondMarkerPath, 'utf8')).execution_state, 'unknown')
  labStage = 'duplicate-frame'
  initializeTarget('protocol-app', 1, protocolTargetState)
  const duplicateChannel = await manager.openGuardedExecutionChannel(
    41,
    join(targetHelper, 'target_guarded_ssh_helper.py')
  )
  const duplicateOpen = {
    version: 1,
    request_id: 'duplicate-request-id',
    sequence: 1,
    operation: 'open',
    identity: {
      controller_id: 'controller-guarded-ssh-lab',
      app_id: 'protocol-app',
      ownership_generation: 1,
      claim_id: 'protocol-job',
      attempt_id: 'protocol-attempt',
      app_fence: 1
    },
    state_root: protocolTargetState,
    deployment_id: 999
  }
  assert.equal((await exchangeFrame(duplicateChannel, duplicateOpen)).state, 'accepted')
  assert.equal(
    (
      await exchangeFrame(duplicateChannel, {
        version: 1,
        request_id: 'duplicate-request-id',
        sequence: 2,
        operation: 'authorize_phase',
        phase: 'prepare',
        deployment_id: 999
      })
    ).error_code,
    'SSH_PROTOCOL_DUPLICATE'
  )
  duplicateChannel.end()
  await delay(100)
  duplicateChannel.destroy()
  labStage = 'malformed-frame'
  const malformedChannel = await manager.openGuardedExecutionChannel(
    41,
    join(targetHelper, 'target_guarded_ssh_helper.py')
  )
  malformedChannel.write(Buffer.from([0, 0, 0, 1, 0xff]))
  malformedChannel.end()
  await delay(100)
  malformedChannel.destroy()
  labStage = 'truncated-frame'
  const truncatedChannel = await manager.openGuardedExecutionChannel(
    41,
    join(targetHelper, 'target_guarded_ssh_helper.py')
  )
  truncatedChannel.write(Buffer.from([0, 0, 0, 5, 0x7b]))
  truncatedChannel.end()
  await delay(100)
  truncatedChannel.destroy()
  labStage = 'helper-cleanup'
  await waitForHelperExit(join(targetHelper, 'target_guarded_ssh_helper.py'))
  console.log(
    JSON.stringify({
      result: 'P3E3A_LINUX_GUARDED_SSH_LAB_PASS',
      ssh_host_pin: 'correct accepted; wrong pin rejected before public-key auth',
      ssh_channel: 'one channel across open and prepare/build phases',
      sqlite_before_target: order,
      same_app_lock_contention: contention.error_code,
      malformed_truncated_duplicate_frames: 'rejected; helper processes exited',
      lost_open_response: 'canonical dispatch retained; retry requires reconciliation',
      deployment_rows_per_isolated_db: 1,
      production_vps: false,
      pipeline_execution: false
    })
  )
} catch (error) {
  console.error(
    `P3E3A_LAB_FAILED stage=${labStage} code=${error?.code ?? error?.name ?? 'UNKNOWN'}`
  )
  throw error
} finally {
  clearTimeout(watchdog)
  try {
    await manager?.disconnectAll()
  } catch {
    process.exitCode = 1
  }
  try {
    await rootManager?.disconnectAll()
  } catch {
    process.exitCode = 1
  }
  try {
    closeDatabase()
  } catch {
    process.exitCode = 1
  }
  try {
    if (database?.open) database.close()
  } catch {
    process.exitCode = 1
  }
  try {
    if (secondDatabase?.open) secondDatabase.close()
  } catch {
    process.exitCode = 1
  }
  if (sshd?.pid) await stopProcessGroup(sshd)
  if (existsSync(scratch)) rmSync(scratch, { recursive: true, force: true })
  if (timedOut) process.exitCode = 1
}

function mkdirSyncSafe(path) {
  const fs = require('node:fs')
  fs.mkdirSync(path, { recursive: true, mode: 0o700 })
  chmodSync(path, 0o700)
}

function generateKey(name) {
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(sshDirectory, name)])
  chmodSync(join(sshDirectory, name), 0o600)
  chmodSync(join(sshDirectory, `${name}.pub`), 0o600)
}

function fingerprint(publicKeyName) {
  const line = execFileSync(
    'ssh-keygen',
    ['-lf', join(sshDirectory, publicKeyName), '-E', 'sha256'],
    { encoding: 'utf8' }
  )
  return line.match(/SHA256:[A-Za-z0-9+/]{43}/)?.[0] ?? assert.fail('SSH_FINGERPRINT_PARSE_FAILED')
}

function reservePort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string')
        return reject(new Error('PORT_RESERVATION_FAILED'))
      server.close((error) => (error ? reject(error) : resolvePort(address.port)))
    })
  })
}

async function waitForPort(portNumber, processHandle) {
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) throw new Error('SSHD_EXITED_EARLY')
    const available = await new Promise((resolveCheck) => {
      const socket = net.connect(portNumber, '127.0.0.1')
      socket.once('connect', () => {
        socket.destroy()
        resolveCheck(true)
      })
      socket.once('error', () => resolveCheck(false))
    })
    if (available) return
    await delay(50)
  }
  throw new Error('SSHD_START_TIMEOUT')
}

function seedProductApp(db, appId, appName, jobId, hostFingerprint, port, vpsId) {
  const controllerId = 'controller-guarded-ssh-lab'
  const configHash = 'a'.repeat(64)
  const sha = '1'.repeat(40)
  db.prepare(
    `INSERT INTO vps (id,name,host,port,host_fingerprint,username,auth_type,encrypted_secret)
    VALUES (?, ?, '127.0.0.1', ?, ?, 'lab', 'key', X'00')`
  ).run(vpsId, `vps-${vpsId}`, port, hostFingerprint)
  db.prepare(
    `INSERT INTO app (id,vps_id,name,framework,host_port,container_port,source_type,git_repo_url,git_ref,git_root)
    VALUES (?, ?, ?, 'express', ?, 3000, 'git', ?, 'main', '.')`
  ).run(appId, vpsId, appName, 30000 + appId, `https://example.test/${appId}.git`)
  db.prepare('INSERT OR IGNORE INTO product_controller VALUES (?, ?, ?)').run(
    controllerId,
    new Date().toISOString(),
    'active'
  )
  db.prepare(
    `INSERT INTO product_source_config
    (app_id,source_generation,repository_url,production_ref,repository_root,deploy_config_json,config_sha256,created_at)
    VALUES (?,1,?,'main','.','{}',?,?)`
  ).run(appId, `https://example.test/${appId}.git`, configHash, new Date().toISOString())
  db.prepare(
    `INSERT INTO product_app_control
    (app_id,mode,controller_id,ownership_generation,source_generation,source_config_sha256,changed_at)
    VALUES (?,'product',?,1,1,?,?)`
  ).run(appId, controllerId, configHash, new Date().toISOString())
  db.prepare(
    `INSERT INTO product_deploy_job
    (job_id,controller_id,app_id,ownership_generation,source_generation,source_config_sha256,
     trigger,idempotency_key,ref,target_sha,state,attempt_count,max_attempts,available_at,created_at,updated_at)
    VALUES (?,?,?,1,1,?,'manual_redeploy',?,'main',?,'queued',0,3,?,?,?)`
  ).run(
    jobId,
    controllerId,
    appId,
    configHash,
    `manual:${jobId}`,
    sha,
    new Date(Date.now() - 1000).toISOString(),
    new Date().toISOString(),
    new Date().toISOString()
  )
}

function claim(repository, appId = 1) {
  const result = repository.claimNextJob('controller-guarded-ssh-lab')
  if (result.state !== 'claimed' || result.claim.app_id !== appId)
    throw new Error(`CLAIM_FAILED_${appId}`)
  return result.claim
}

function snapshot() {
  return {
    repositoryUrl: 'https://example.test/1.git',
    repositoryRoot: '.',
    commitSha: '1'.repeat(40),
    sourceConfigSha256: 'a'.repeat(64)
  }
}

function prepared(claimToken, metadata) {
  return {
    claim: claimToken,
    metadata,
    rootDirectory: join(scratch, `snapshot-${claimToken.app_id}`),
    snapshotDirectory: join(scratch, `snapshot-root-${claimToken.app_id}`),
    cleanup() {
      return undefined
    }
  }
}

function initializeTarget(appId, generation, stateRoot = targetState) {
  const code =
    'from target_execution_guard import initialize_enrollment; import sys; initialize_enrollment(sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]))'
  execFileSync(
    'python3',
    ['-c', code, stateRoot, 'controller-guarded-ssh-lab', appId, String(generation)],
    {
      env: {
        PATH: process.env.PATH,
        PYTHONPATH: targetHelper,
        PYTHONDONTWRITEBYTECODE: '1',
        LANG: 'C.UTF-8'
      }
    }
  )
}

function markerPath(appId, stateRoot = targetState) {
  const key = createHash('sha256').update(appId).digest('hex')
  return join(stateRoot, `${key}.json`)
}

async function assertLockHeld(appId) {
  const code =
    'import fcntl,os,sys; fd=os.open(sys.argv[1],os.O_RDWR);\ntry: fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB); sys.exit(10)\nexcept BlockingIOError: sys.exit(0)'
  const lockPath = join(
    targetState,
    'locks',
    `${createHash('sha256').update(appId).digest('hex')}.lock`
  )
  const result = spawnSync('python3', ['-c', code, lockPath], { encoding: 'utf8' })
  assert.equal(result.status, 0, 'target OS lock should remain held across phases')
}

function sendOpenRequest(channel, identity, stateRoot) {
  return exchangeFrame(channel, {
    version: 1,
    request_id: randomUUID(),
    sequence: 1,
    operation: 'open',
    identity,
    state_root: stateRoot,
    deployment_id: 999
  })
}

function exchangeFrame(channel, request) {
  return new Promise((resolveResponse, reject) => {
    let bytes = Buffer.alloc(0)
    const timer = setTimeout(() => reject(new Error('FRAME_RESPONSE_TIMEOUT')), 8_000)
    channel.on('data', (chunk) => {
      bytes = Buffer.concat([bytes, chunk])
      if (bytes.length < 4) return
      const length = bytes.readUInt32BE(0)
      if (bytes.length < length + 4) return
      clearTimeout(timer)
      resolveResponse(JSON.parse(bytes.subarray(4, length + 4).toString('utf8')))
    })
    channel.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    channel.write(encodeGuardedSshFrame(request))
  })
}

function dropFirstResponse(channel) {
  const stderr = new PassThrough()
  let responseDropped = false
  const proxy = new Duplex({
    read() {
      this.push(Buffer.alloc(0))
    },
    write(chunk, _encoding, callback) {
      channel.write(chunk)
      callback()
    },
    final(callback) {
      channel.end()
      callback()
    },
    destroy(error, callback) {
      channel.destroy(error ?? undefined)
      callback(error)
    }
  })
  Object.defineProperty(proxy, 'stderr', { value: stderr })
  channel.on('data', (chunk) => {
    if (!responseDropped) {
      responseDropped = true
      channel.destroy()
      proxy.destroy()
    } else proxy.push(chunk)
  })
  channel.stderr.on('data', (chunk) => stderr.write(chunk))
  channel.once('close', () => proxy.push(null))
  channel.once('error', (error) => proxy.destroy(error))
  return proxy
}

async function waitForHelperExit(helperPath) {
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    const result = spawnSync(
      'python3',
      [
        '-c',
        'import os,pathlib,sys; p=os.environ["OPSPILOT_HELPER_SCAN"]; found=False\nfor f in pathlib.Path("/proc").glob("[0-9]*/cmdline"):\n try: found |= p.encode() in f.read_bytes()\n except OSError: pass\nsys.exit(1 if found else 0)'
      ],
      {
        env: { ...process.env, OPSPILOT_HELPER_SCAN: helperPath }
      }
    )
    if (result.status === 0) return
    await delay(50)
  }
  throw new Error('TARGET_HELPER_STILL_RUNNING')
}

async function countPublicKeyAuths(logPath) {
  await delay(30)
  if (!existsSync(logPath)) return 0
  return (readFileSync(logPath, 'utf8').match(/Accepted publickey/g) ?? []).length
}

async function stopProcessGroup(child) {
  if (!child.pid) return
  const closed =
    child.exitCode !== null
      ? Promise.resolve(true)
      : new Promise((resolveClose) => child.once('close', () => resolveClose(true)))
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    // The owned process group can exit between the state check and signal.
  }
  const stopped = await Promise.race([closed, delay(1_000).then(() => false)])
  if (!stopped) {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      // The owned process group can exit during the grace interval.
    }
    await closed
  }
}

// The SSH2 client may retain a destroyed socket briefly after all owned
// channels/children have been closed; cleanup has completed before this point.
process.exit(process.exitCode ?? 0)
