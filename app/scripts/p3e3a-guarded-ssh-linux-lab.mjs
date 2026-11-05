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
  openProductGuardedSshSession,
  stageProductSourceAndRender
} = require(artifactPath)
const sshdBinary = execFileSync('sh', ['-lc', 'command -v sshd'], { encoding: 'utf8' }).trim()
const scratch = mkdtempSync(join(tmpdir(), 'opspilot-p3e3a-'))
const targetHelper = join(scratch, 'target-helper')
const databaseDirectory = join(scratch, 'database')
const secondDatabaseDirectory = join(scratch, 'database-lost-response')
const adapterDatabaseDirectory = join(scratch, 'database-source-render')
const staleDatabaseDirectory = join(scratch, 'database-stale-authority')
const targetState = join(scratch, 'target-state')
const secondTargetState = join(scratch, 'target-state-lost-response')
const adapterTargetState = join(scratch, 'target-state-source-render')
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
copyFileSync(
  join(helperBundleDirectory, 'target_product_runtime.py'),
  join(targetHelper, 'target_product_runtime.py')
)
const sshdLog = join(scratch, 'sshd.log')
const sshdConfig = join(scratch, 'sshd_config')
const user = execFileSync('id', ['-un'], { encoding: 'utf8' }).trim()
const port = await reservePort()
let sshd = null
let timedOut = false
let database = null
let secondDatabase = null
let adapterDatabase = null
let staleDatabase = null
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
  seedProductApp(database, 1, 'ssh-session-app-1', 'session-job-1', hostFingerprint, port, 41, user)
  const repository = ProductDeployRepository.withClockForTest(database, () => Date.now())
  const claimOne = claim(repository)
  const snapshotOne = snapshot()
  repository.markGitSnapshotVerified(claimOne, snapshotOne)
  initializeTarget(String(claimOne.app_id), claimOne.ownership_generation)

  secondDatabase = initializeDatabase(secondDatabaseDirectory)
  secondDatabase.pragma('foreign_keys = ON')
  seedProductApp(
    secondDatabase,
    1,
    'ssh-session-app-lost-response',
    'session-job-lost-response',
    hostFingerprint,
    port,
    41,
    user
  )
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

  labStage = 'product-source-render-transfer'
  const sourceRoot = join(scratch, 'adapter-source')
  const collectorRoot = join(scratch, 'adapter-collector')
  mkdirSyncSafe(sourceRoot)
  mkdirSyncSafe(collectorRoot)
  writeFileSync(
    join(sourceRoot, 'package.json'),
    JSON.stringify({
      name: 'adapter-fixture',
      version: '1.0.0',
      main: 'server.js',
      scripts: { start: 'node server.js' },
      dependencies: { express: '^4.21.2' }
    })
  )
  writeFileSync(
    join(sourceRoot, 'server.js'),
    "require('express')().listen(process.env.PORT || 3000)\n"
  )
  writeFileSync(join(sourceRoot, '.env'), 'LAB_SECRET_SENTINEL=must-not-transfer\n')
  const chunkFixture = Buffer.alloc(70 * 1024, 0x61)
  writeFileSync(join(sourceRoot, 'large-fixture.txt'), chunkFixture)
  writeFileSync(join(collectorRoot, 'collect.py'), 'print("fixture")\n')
  writeFileSync(join(collectorRoot, 'Dockerfile'), 'FROM python:3-alpine\n')
  adapterDatabase = initializeDatabase(adapterDatabaseDirectory)
  adapterDatabase.pragma('foreign_keys = ON')
  seedProductApp(
    adapterDatabase,
    3,
    'ssh-session-app-3',
    'session-job-3',
    hostFingerprint,
    port,
    43,
    user
  )
  const adapterRepository = ProductDeployRepository.withClockForTest(adapterDatabase, () =>
    Date.now()
  )
  const claimThree = claim(adapterRepository, 3)
  const snapshotThree = { ...snapshot(), repositoryUrl: 'https://example.test/3.git' }
  adapterRepository.markGitSnapshotVerified(claimThree, snapshotThree)
  initializeTarget(String(claimThree.app_id), claimThree.ownership_generation, adapterTargetState)
  const preparedThree = prepared(claimThree, snapshotThree)
  Object.defineProperty(preparedThree, 'rootDirectory', { value: sourceRoot })
  Object.defineProperty(preparedThree, 'snapshotDirectory', { value: sourceRoot })
  const originalAdapterOpen = manager.openGuardedExecutionChannelWithIdentity.bind(manager)
  let lockChecksDuringTransfer = 0
  let transferResponseRejected = false
  manager.openGuardedExecutionChannelWithIdentity = async (...args) => {
    const opened = await originalAdapterOpen(...args)
    let responseBytes = Buffer.alloc(0)
    const sentOperations = new Map()
    const originalChannelWrite = opened.channel.write.bind(opened.channel)
    opened.channel.write = (chunk, ...writeArgs) => {
      const frame = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      if (frame.length >= 4) {
        const length = frame.readUInt32BE(0)
        if (frame.length === length + 4) {
          const request = JSON.parse(frame.subarray(4).toString('utf8'))
          sentOperations.set(request.sequence, request.operation)
        }
      }
      return originalChannelWrite(chunk, ...writeArgs)
    }
    opened.channel.on('data', (chunk) => {
      responseBytes = Buffer.concat([responseBytes, chunk])
      while (responseBytes.length >= 4) {
        const length = responseBytes.readUInt32BE(0)
        if (responseBytes.length < length + 4) return
        const response = JSON.parse(responseBytes.subarray(4, length + 4).toString('utf8'))
        responseBytes = responseBytes.subarray(length + 4)
        const operation = sentOperations.get(response.sequence)
        if (operation !== 'close') {
          try {
            assertLockHeldSync(String(claimThree.app_id), adapterTargetState)
          } catch {
            transferResponseRejected = true
          }
          lockChecksDuringTransfer += 1
        }
        if (response.state !== 'accepted') transferResponseRejected = true
      }
    })
    return opened
  }
  const staged = await stageProductSourceAndRender(
    adapterDatabase,
    adapterRepository,
    manager,
    preparedThree,
    {
      vps_id: 43,
      target_helper_path: join(targetHelper, 'target_guarded_ssh_helper.py'),
      target_state_root: adapterTargetState,
      collector_directory: collectorRoot
    }
  )
  assert.equal(staged.state, 'source_render_staged_dispatch_unknown')
  assert.equal(
    adapterDatabase.prepare('SELECT COUNT(*) AS count FROM deployment WHERE app_id=3').get().count,
    1
  )
  const stageRoot = join(adapterTargetState, 'product-staging', 'app-3', 'deployment-1')
  assert.equal(
    readFileSync(join(stageRoot, 'source', 'src', 'large-fixture.txt')).length,
    chunkFixture.length
  )
  assert.equal(
    readFileSync(join(stageRoot, 'source', 'src', 'large-fixture.txt')).equals(chunkFixture),
    true
  )
  assert.equal(existsSync(join(stageRoot, 'source', 'src', '.env')), false)
  assert.equal(
    readFileSync(join(stageRoot, 'render', '.env'), 'utf8').includes('LAB_SECRET_SENTINEL'),
    false
  )
  assert.equal(
    createHash('sha256')
      .update(readFileSync(join(stageRoot, 'source', 'src', 'large-fixture.txt')))
      .digest('hex'),
    createHash('sha256').update(chunkFixture).digest('hex')
  )
  assert.equal(
    readFileSync(join(stageRoot, 'render', 'Dockerfile'), 'utf8').includes('FROM node'),
    true
  )
  assert.equal(
    (await import('node:fs')).statSync(join(stageRoot, 'render', '.env')).mode & 0o777,
    0o600
  )
  assert.equal(existsSync(join(stageRoot, 'source', '.scope-complete')), true)
  assert.equal(existsSync(join(stageRoot, 'render', '.scope-complete')), true)
  manager.openGuardedExecutionChannelWithIdentity = originalAdapterOpen
  assert.ok(
    lockChecksDuringTransfer >= 10,
    'target lock must remain held for transfer/render acknowledgements'
  )
  assert.equal(transferResponseRejected, false)

  labStage = 'transfer-stale-authority'
  const staleSourceRoot = join(scratch, 'stale-authority-source')
  mkdirSyncSafe(staleSourceRoot)
  writeFileSync(
    join(staleSourceRoot, 'package.json'),
    JSON.stringify({
      name: 'stale-fixture',
      version: '1.0.0',
      main: 'server.js',
      scripts: { start: 'node server.js' },
      dependencies: { express: '^4.21.2' }
    })
  )
  writeFileSync(
    join(staleSourceRoot, 'server.js'),
    "require('express')().listen(process.env.PORT || 3000)\n"
  )
  staleDatabase = initializeDatabase(staleDatabaseDirectory)
  staleDatabase.pragma('foreign_keys = ON')
  seedProductApp(
    staleDatabase,
    4,
    'ssh-session-app-4',
    'session-job-4',
    hostFingerprint,
    port,
    44,
    user
  )
  const staleRepository = ProductDeployRepository.withClockForTest(staleDatabase, () => Date.now())
  const staleClaim = claim(staleRepository, 4)
  const staleSnapshot = { ...snapshot(), repositoryUrl: 'https://example.test/4.git' }
  staleRepository.markGitSnapshotVerified(staleClaim, staleSnapshot)
  const staleTargetState = join(scratch, 'target-state-stale-transfer')
  initializeTarget(String(staleClaim.app_id), staleClaim.ownership_generation, staleTargetState)
  const stalePrepared = prepared(staleClaim, staleSnapshot)
  Object.defineProperty(stalePrepared, 'rootDirectory', { value: staleSourceRoot })
  Object.defineProperty(stalePrepared, 'snapshotDirectory', { value: staleSourceRoot })
  manager.openGuardedExecutionChannelWithIdentity = async (...args) => {
    const opened = await originalAdapterOpen(...args)
    let bytes = Buffer.alloc(0)
    let ownershipChanged = false
    opened.channel.on('data', (chunk) => {
      bytes = Buffer.concat([bytes, chunk])
      if (bytes.length < 4) return
      const length = bytes.readUInt32BE(0)
      if (bytes.length < length + 4) return
      const response = JSON.parse(bytes.subarray(4, length + 4).toString('utf8'))
      if (!ownershipChanged && response.state === 'accepted') {
        ownershipChanged = true
        staleDatabase
          .prepare('UPDATE product_app_control SET ownership_generation=2 WHERE app_id=4')
          .run()
      }
    })
    return opened
  }
  await assert.rejects(
    stageProductSourceAndRender(staleDatabase, staleRepository, manager, stalePrepared, {
      vps_id: 44,
      target_helper_path: join(targetHelper, 'target_guarded_ssh_helper.py'),
      target_state_root: staleTargetState,
      collector_directory: collectorRoot
    }),
    (error) => error?.code === 'SSH_AUTHORITY_STALE'
  )
  manager.openGuardedExecutionChannelWithIdentity = originalAdapterOpen
  await waitForHelperExit(join(targetHelper, 'target_guarded_ssh_helper.py'))
  assert.equal(
    staleDatabase.prepare('SELECT COUNT(*) AS count FROM deployment WHERE app_id=4').get().count,
    1
  )
  assert.equal(
    existsSync(join(staleTargetState, 'product-staging', 'app-4', 'deployment-1')),
    false
  )

  const secondMarkerPath = markerPath(String(claimTwo.app_id), secondTargetState)
  secondManager = new SshManager(resolver)
  const originalSecondOpen =
    secondManager.openGuardedExecutionChannelWithIdentity.bind(secondManager)
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
      if (property !== 'openGuardedExecutionChannelWithIdentity')
        return Reflect.get(target, property, receiver)
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
  labStage = 'transfer-traversal-and-binding'
  const transferState = join(scratch, 'target-state-transfer-attacks')
  initializeTarget('transfer-attacks', 1, transferState)
  const attackChannel = await manager.openGuardedExecutionChannel(
    41,
    join(targetHelper, 'target_guarded_ssh_helper.py')
  )
  const attackIdentity = {
    controller_id: 'controller-guarded-ssh-lab',
    app_id: 'transfer-attacks',
    ownership_generation: 1,
    claim_id: 'transfer-job',
    attempt_id: 'transfer-attempt',
    app_fence: 1
  }
  assert.equal(
    (await sendOpenRequest(attackChannel, attackIdentity, transferState)).state,
    'accepted'
  )
  assert.equal(
    (
      await exchangeFrame(attackChannel, {
        version: 1,
        request_id: randomUUID(),
        sequence: 2,
        operation: 'begin_scope',
        deployment_id: 999,
        scope: 'source',
        file_count: 1,
        total_bytes: 1,
        manifest_sha256: 'a'.repeat(64)
      })
    ).state,
    'accepted'
  )
  const traversal = await exchangeFrame(attackChannel, {
    version: 1,
    request_id: randomUUID(),
    sequence: 3,
    operation: 'begin_file',
    deployment_id: 999,
    scope: 'source',
    path: 'src/../escaped.txt',
    size: 1,
    mode: 0o644,
    sha256: 'a'.repeat(64)
  })
  assert.equal(traversal.error_code, 'SSH_TRANSFER_REJECTED')
  attackChannel.destroy()
  await waitForHelperExit(join(targetHelper, 'target_guarded_ssh_helper.py'))
  assert.equal(
    existsSync(join(transferState, 'product-staging', 'app-transfer-attacks', 'escaped.txt')),
    false
  )
  assert.equal(
    existsSync(join(transferState, 'product-staging', 'app-transfer-attacks', 'deployment-999')),
    false
  )

  labStage = 'request-id-and-declared-quota-regressions'
  for (const scenario of ['request-id', 'zero-budget', 'cumulative-budget']) {
    const regressionState = join(scratch, `target-state-h0-${scenario}`)
    const regressionApp = `h0-${scenario}`
    initializeTarget(regressionApp, 1, regressionState)
    const regressionChannel = await manager.openGuardedExecutionChannel(
      41,
      join(targetHelper, 'target_guarded_ssh_helper.py')
    )
    assert.equal(
      (
        await sendOpenRequest(
          regressionChannel,
          { ...attackIdentity, app_id: regressionApp },
          regressionState
        )
      ).state,
      'accepted'
    )
    let sequence = 2
    const send = (operation, fields = {}) =>
      exchangeFrame(regressionChannel, {
        version: 1,
        request_id: randomUUID(),
        sequence: sequence++,
        operation,
        deployment_id: 999,
        ...fields
      })
    assert.equal(
      (
        await send('begin_scope', {
          scope: 'source',
          file_count: 2,
          total_bytes: scenario === 'zero-budget' ? 0 : 1,
          manifest_sha256: 'a'.repeat(64)
        })
      ).state,
      'accepted'
    )
    const file = {
      scope: 'source',
      path: 'victim',
      size: 1,
      mode: 0o644,
      sha256: createHash('sha256').update('A').digest('hex')
    }
    const sourceDirectory = join(
      regressionState,
      'product-staging',
      `app-${regressionApp}`,
      'deployment-999',
      'source'
    )
    if (scenario === 'request-id') {
      // Make the historical traversal path usable; only request_id is malicious.
      mkdirSyncSafe(join(sourceDirectory, '.victim.X'))
      const rejected = await send('begin_file', {
        ...file,
        request_id: 'X/../../../../../../escaped'
      })
      assert.equal(rejected.error_code, 'SSH_PROTOCOL_MALFORMED')
      assert.equal(existsSync(join(scratch, 'escaped.part')), false)
    } else {
      if (scenario === 'cumulative-budget') {
        assert.equal((await send('begin_file', file)).state, 'accepted')
        assert.equal(
          (await send('file_chunk', { chunk_index: 0, data_base64: 'QQ==' })).state,
          'accepted'
        )
        assert.equal((await send('finish_file')).state, 'accepted')
        file.path = 'nested/second.txt'
      }
      const rejected = await send('begin_file', file)
      assert.equal(rejected.error_code, 'SSH_TRANSFER_REJECTED')
      assert.equal(existsSync(join(sourceDirectory, 'nested')), false)
    }
    regressionChannel.destroy()
    await waitForHelperExit(join(targetHelper, 'target_guarded_ssh_helper.py'))
    assert.equal(existsSync(sourceDirectory), false)
  }

  labStage = 'transfer-symlink-quota-and-deployment-binding'
  const symlinkState = join(scratch, 'target-state-symlink-transfer')
  initializeTarget('symlink-transfer', 1, symlinkState)
  const symlinkChannel = await manager.openGuardedExecutionChannel(
    41,
    join(targetHelper, 'target_guarded_ssh_helper.py')
  )
  const symlinkIdentity = {
    ...attackIdentity,
    app_id: 'symlink-transfer',
    claim_id: 'symlink-job',
    attempt_id: 'symlink-attempt'
  }
  assert.equal(
    (await sendOpenRequest(symlinkChannel, symlinkIdentity, symlinkState)).state,
    'accepted'
  )
  assert.equal(
    (
      await exchangeFrame(symlinkChannel, {
        version: 1,
        request_id: randomUUID(),
        sequence: 2,
        operation: 'begin_scope',
        deployment_id: 999,
        scope: 'source',
        file_count: 1,
        total_bytes: 1,
        manifest_sha256: 'c'.repeat(64)
      })
    ).state,
    'accepted'
  )
  const symlinkParent = join(
    symlinkState,
    'product-staging',
    'app-symlink-transfer',
    'deployment-999',
    'source'
  )
  const outsideTarget = join(scratch, 'escape.txt')
  ;(await import('node:fs')).symlinkSync(scratch, join(symlinkParent, 'src'))
  const symlinkRejected = await exchangeFrame(symlinkChannel, {
    version: 1,
    request_id: randomUUID(),
    sequence: 3,
    operation: 'begin_file',
    deployment_id: 999,
    scope: 'source',
    path: 'src/escape.txt',
    size: 1,
    mode: 0o644,
    sha256: 'c'.repeat(64)
  })
  assert.equal(symlinkRejected.error_code, 'SSH_TRANSFER_REJECTED')
  symlinkChannel.destroy()
  await waitForHelperExit(join(targetHelper, 'target_guarded_ssh_helper.py'))
  assert.equal(existsSync(outsideTarget), false)

  const quotaState = join(scratch, 'target-state-quota-transfer')
  initializeTarget('quota-transfer', 1, quotaState)
  const quotaChannel = await manager.openGuardedExecutionChannel(
    41,
    join(targetHelper, 'target_guarded_ssh_helper.py')
  )
  assert.equal(
    (
      await sendOpenRequest(
        quotaChannel,
        {
          ...attackIdentity,
          app_id: 'quota-transfer',
          claim_id: 'quota-job',
          attempt_id: 'quota-attempt'
        },
        quotaState
      )
    ).state,
    'accepted'
  )
  const quotaRejected = await exchangeFrame(quotaChannel, {
    version: 1,
    request_id: randomUUID(),
    sequence: 2,
    operation: 'begin_scope',
    deployment_id: 999,
    scope: 'source',
    file_count: 1,
    total_bytes: 64 * 1024 * 1024 + 1,
    manifest_sha256: 'd'.repeat(64)
  })
  assert.equal(quotaRejected.error_code, 'SSH_TRANSFER_REJECTED')
  quotaChannel.destroy()
  await waitForHelperExit(join(targetHelper, 'target_guarded_ssh_helper.py'))
  assert.equal(
    existsSync(join(quotaState, 'product-staging', 'app-quota-transfer', 'deployment-999')),
    false
  )

  const bindingState = join(scratch, 'target-state-deployment-binding')
  initializeTarget('deployment-binding', 1, bindingState)
  const bindingChannel = await manager.openGuardedExecutionChannel(
    41,
    join(targetHelper, 'target_guarded_ssh_helper.py')
  )
  assert.equal(
    (
      await sendOpenRequest(
        bindingChannel,
        {
          ...attackIdentity,
          app_id: 'deployment-binding',
          claim_id: 'binding-job',
          attempt_id: 'binding-attempt'
        },
        bindingState
      )
    ).state,
    'accepted'
  )
  const wrongDeployment = await exchangeFrame(bindingChannel, {
    version: 1,
    request_id: randomUUID(),
    sequence: 2,
    operation: 'begin_scope',
    deployment_id: 1000,
    scope: 'source',
    file_count: 0,
    total_bytes: 0,
    manifest_sha256: 'e'.repeat(64)
  })
  assert.equal(wrongDeployment.error_code, 'SSH_TRANSFER_REJECTED')
  bindingChannel.destroy()
  await waitForHelperExit(join(targetHelper, 'target_guarded_ssh_helper.py'))
  assert.equal(
    existsSync(join(bindingState, 'product-staging', 'app-deployment-binding', 'deployment-999')),
    false
  )

  const incompleteState = join(scratch, 'target-state-incomplete-transfer')
  initializeTarget('incomplete-transfer', 1, incompleteState)
  const incompleteChannel = await manager.openGuardedExecutionChannel(
    41,
    join(targetHelper, 'target_guarded_ssh_helper.py')
  )
  assert.equal(
    (
      await sendOpenRequest(
        incompleteChannel,
        {
          ...attackIdentity,
          app_id: 'incomplete-transfer',
          claim_id: 'incomplete-job',
          attempt_id: 'incomplete-attempt'
        },
        incompleteState
      )
    ).state,
    'accepted'
  )
  assert.equal(
    (
      await exchangeFrame(incompleteChannel, {
        version: 1,
        request_id: randomUUID(),
        sequence: 2,
        operation: 'begin_scope',
        deployment_id: 999,
        scope: 'source',
        file_count: 1,
        total_bytes: 100,
        manifest_sha256: 'b'.repeat(64)
      })
    ).state,
    'accepted'
  )
  assert.equal(
    (
      await exchangeFrame(incompleteChannel, {
        version: 1,
        request_id: randomUUID(),
        sequence: 3,
        operation: 'begin_file',
        deployment_id: 999,
        scope: 'source',
        path: 'src/incomplete.js',
        size: 100,
        mode: 0o644,
        sha256: 'b'.repeat(64)
      })
    ).state,
    'accepted'
  )
  assert.equal(
    (
      await exchangeFrame(incompleteChannel, {
        version: 1,
        request_id: randomUUID(),
        sequence: 4,
        operation: 'file_chunk',
        deployment_id: 999,
        chunk_index: 0,
        data_base64: Buffer.alloc(20, 0x62).toString('base64')
      })
    ).state,
    'accepted'
  )
  incompleteChannel.destroy()
  await waitForHelperExit(join(targetHelper, 'target_guarded_ssh_helper.py'))
  assert.equal(
    existsSync(
      join(incompleteState, 'product-staging', 'app-incomplete-transfer', 'deployment-999')
    ),
    false
  )
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
      result: 'P3E3B_SOURCE_RENDER_SSH_LAB_PASS',
      ssh_host_pin: 'correct accepted; wrong pin rejected before public-key auth',
      ssh_channel: 'one channel across open and prepare/build phases',
      sqlite_before_target: order,
      same_app_lock_contention: contention.error_code,
      malformed_truncated_duplicate_frames: 'rejected; helper processes exited',
      lost_open_response: 'canonical dispatch retained; retry requires reconciliation',
      deployment_rows_per_isolated_db: 1,
      production_vps: false,
      source_transfer: `${staged.source_file_count} source files/${staged.source_bytes} bytes including multi-chunk file`,
      render_files: staged.render_file_count,
      source_render_under_guard:
        'same pinned SSH channel and target lock; one canonical deployment; outcome remains unknown',
      build_activate_health_rollback_publish_finalization: 'not implemented'
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
  try {
    if (adapterDatabase?.open) adapterDatabase.close()
  } catch {
    process.exitCode = 1
  }
  try {
    if (staleDatabase?.open) staleDatabase.close()
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

function seedProductApp(db, appId, appName, jobId, hostFingerprint, port, vpsId, username) {
  const controllerId = 'controller-guarded-ssh-lab'
  const configHash = 'a'.repeat(64)
  const sha = '1'.repeat(40)
  db.prepare(
    `INSERT INTO vps (id,name,host,port,host_fingerprint,username,auth_type,encrypted_secret)
    VALUES (?, ?, '127.0.0.1', ?, ?, ?, 'key', X'00')`
  ).run(vpsId, `vps-${vpsId}`, port, hostFingerprint, username)
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

async function assertLockHeld(appId, stateRoot = targetState) {
  assertLockHeldSync(appId, stateRoot)
}

function assertLockHeldSync(appId, stateRoot = targetState) {
  const code =
    'import fcntl,os,sys; fd=os.open(sys.argv[1],os.O_RDWR);\ntry: fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB); sys.exit(10)\nexcept BlockingIOError: sys.exit(0)'
  const lockPath = join(
    stateRoot,
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
