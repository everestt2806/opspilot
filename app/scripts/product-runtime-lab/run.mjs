/* eslint-disable @typescript-eslint/explicit-function-return-type -- Standalone JavaScript integration lab. */
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

if (process.platform !== 'linux') throw new Error('LINUX_REQUIRED')
process.env.PATH = `${dirname(process.execPath)}:${process.env.PATH}`
const artifact = process.env.OPSPILOT_R1_ARTIFACT
if (!artifact) throw new Error('R1_ARTIFACT_REQUIRED')
const {
  initializeDatabase,
  closeDatabase,
  ProductDeployRepository,
  ProductRuntimeRepository,
  SshManager,
  executeProductDeployPipeline,
  recoverProductRuntimeSession
} = createRequire(artifact)(artifact)
const repo = resolve(import.meta.dirname, '../../..')
process.env.OPSPILOT_TEMPLATES_DIR = join(repo, 'templates')
const nonce = randomBytes(6).toString('hex')
const controller = `r1-${nonce}`
const appName = `r1-${nonce}`
const appNames = new Map([
  [1, appName],
  [2, `${appName}-first`]
])
const restoreFailure = process.argv.includes('--restore-failure')
const spa = process.argv.includes('--spa')
const next = process.argv.includes('--nextjs')
if (spa && next) throw Error('FRAMEWORK_FLAGS_CONFLICT')
const framework = spa ? 'static-spa' : next ? 'nextjs' : 'express'
const traceEnabled = process.argv.includes('--trace')
const scratch = mkdtempSync(join(tmpdir(), 'opspilot-r1-'))
chmodSync(scratch, 0o700)
const output = resolve(repo, 'app/.out-scripts/product-runtime-lab', nonce)
mkdirSync(output, { recursive: true })
const helper = join(scratch, 'helper')
const state = join(scratch, 'target-state')
const source = join(scratch, 'source')
const secret = randomBytes(32)
const configJson = framework === 'express' ? '{}' : JSON.stringify({ framework })
const configHash = createHash('sha256').update(configJson).digest('hex')
const subjectFiles = [
  'target_execution_guard.py',
  'target_guarded_ssh_helper.py',
  'target_product_runtime.py'
]
const subjectHashes = Object.fromEntries(
  subjectFiles.map((file) => [
    file,
    createHash('sha256')
      .update(readFileSync(join(repo, 'app/src/main/controlPlane', file)))
      .digest('hex')
  ])
)
const driverHash = createHash('sha256')
  .update(readFileSync(import.meta.filename))
  .digest('hex')
const bundleHash = createHash('sha256').update(readFileSync(artifact)).digest('hex')
const cases = []
let stage = 'preflight'
let database, manager, sshd, heartbeat
let cleanup = true
let failure = null
let pin
let lastOperation = null
let lastRuntimeStep = null
const run = (program, args, options = {}) =>
  execFileSync(program, args, {
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 512 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  }).trim()
const docker = (...args) => run('docker', args)
const inspect = (kind, id) => JSON.parse(docker(kind, 'inspect', id))[0]
const record = (name, evidence) => {
  cases.push({ name, status: 'PASS', ...evidence })
  writeFileSync(join(output, 'progress.json'), JSON.stringify({ nonce, stage, cases }, null, 2))
  console.log(JSON.stringify({ case: name, status: 'PASS' }))
}
let deadlineExpired = false
const deadline = setTimeout(
  () => {
    deadlineExpired = true
    failure = { stage, code: 'LAB_DEADLINE' }
    manager?.disconnectAll().catch(() => {})
  },
  (process.argv.includes('--public-git-checkpoint-gate') ? 25 : 12) * 60000
)
const port = await reservePort()
const hostPort = await reservePort()
try {
  docker('info', '--format', '{{.ServerVersion}}')
  assert.equal(docker('ps', '-aq', '--filter', `name=^/${appName}-`), '')
  assert.equal(existsSync(`/opt/opspilot/${appName}`), false)
  mkdirSync(helper, { mode: 0o700 })
  for (const file of [
    'target_execution_guard.py',
    'target_guarded_ssh_helper.py',
    'target_product_runtime.py'
  ])
    cpSync(join(repo, 'app/src/main/controlPlane', file), join(helper, file))
  cpSync(join(import.meta.dirname, 'trace_helper.py'), join(helper, 'trace_helper.py'))
  for (const key of ['host', 'client']) {
    run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(scratch, key)])
    chmodSync(join(scratch, key), 0o600)
  }
  pin = run('ssh-keygen', ['-lf', join(scratch, 'host.pub'), '-E', 'sha256']).match(
    /SHA256:[A-Za-z0-9+/]{43}/
  )?.[0]
  assert.ok(pin)
  const username = run('id', ['-un'])
  assert.equal(username, 'root', 'lab requires root for isolated sshd/guard directory')
  mkdirSync('/run/sshd', { recursive: true })
  writeFileSync(
    join(scratch, 'sshd_config'),
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
      'AuthenticationMethods publickey',
      'Subsystem sftp internal-sftp'
    ].join('\n') + '\n',
    { mode: 0o600 }
  )
  const sshdPath = run('sh', ['-lc', 'command -v sshd'])
  sshd = spawn(sshdPath, ['-D', '-e', '-f', join(scratch, 'sshd_config')], { stdio: 'ignore' })
  await waitFor(async () => {
    if (sshd.exitCode !== null) throw new Error('SSHD_EXITED')
    return await new Promise((resolveCheck) => {
      const socket = net.connect(port, '127.0.0.1')
      socket.once('connect', () => {
        socket.destroy()
        resolveCheck(true)
      })
      socket.once('error', () => resolveCheck(false))
    })
  }, 8000)
  database = initializeDatabase(join(scratch, 'database'))
  const now = new Date().toISOString()
  database
    .prepare(
      `INSERT INTO vps
    (id,name,host,port,host_fingerprint,username,auth_type,encrypted_secret)
    VALUES (1,?,'127.0.0.1',?,?,'root','key',X'00')`
    )
    .run(appName, port, pin)
  database.prepare('INSERT INTO product_controller VALUES (?,?,?)').run(controller, now, 'active')
  for (const [appId, name] of appNames) {
    database
      .prepare(
        `INSERT INTO app
    (id,vps_id,name,framework,host_port,container_port,healthcheck_path,source_type,git_repo_url,git_ref,git_root)
    VALUES (?,1,?,?,?, ?,?,'git','https://example.test/r1.git','main','.')`
      )
      .run(
        appId,
        name,
        framework,
        appId === 1 ? hostPort : await reservePort(),
        spa ? 80 : 3000,
        framework === 'express' ? '/health' : '/'
      )
    database
      .prepare(
        `INSERT INTO product_source_config
    (app_id,source_generation,repository_url,production_ref,repository_root,deploy_config_json,config_sha256,created_at)
    VALUES (?,1,'https://example.test/r1.git','main','.',?,?,?)`
      )
      .run(appId, configJson, configHash, now)
    database
      .prepare(
        `INSERT INTO product_app_control
    (app_id,mode,controller_id,ownership_generation,source_generation,source_config_sha256,changed_at)
    VALUES (?,'product',?,1,1,?,?)`
      )
      .run(appId, controller, configHash, now)
    run(
      'python3',
      [
        '-c',
        [
          'from target_execution_guard import initialize_enrollment',
          'from target_product_runtime import initialize_runtime_enrollment',
          'import sys',
          'initialize_enrollment(sys.argv[1],sys.argv[2],sys.argv[3],1)',
          'initialize_runtime_enrollment(sys.argv[1],sys.argv[2],sys.argv[3],1,sys.stdin.buffer.read())'
        ].join(';'),
        join(state, `app-${appId}`),
        controller,
        String(appId)
      ],
      {
        input: secret,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONPATH: helper, PYTHONDONTWRITEBYTECODE: '1' }
      }
    )
  }
  manager = new SshManager(() => ({
    host: '127.0.0.1',
    port,
    hostFingerprint: pin,
    username: 'root',
    authType: 'key',
    secret: readFileSync(join(scratch, 'client'), 'utf8')
  }))
  await manager.connect(1)
  assert.ok(manager.getVerifiedHostKey(1))
  const openChannel = manager.openGuardedExecutionChannelWithIdentity.bind(manager)
  manager.openGuardedExecutionChannelWithIdentity = async (...args) => {
    const opened = await openChannel(...args)
    const write = opened.channel.write.bind(opened.channel)
    opened.channel.write = (chunk, ...writeArgs) => {
      // Observe only operation names; never retain payloads, source, env or secrets.
      if (
        Buffer.isBuffer(chunk) &&
        chunk.length >= 4 &&
        chunk.readUInt32BE(0) === chunk.length - 4
      ) {
        const frame = JSON.parse(chunk.subarray(4).toString('utf8'))
        lastOperation = frame.operation
        if (frame.operation === 'start_runtime_step') {
          lastRuntimeStep = frame.step
          console.log(JSON.stringify({ stage, step: lastRuntimeStep }))
          if (restoreFailure && frame.step === 'rollback') {
            const previous = inspect('container', `${appName}-app-previous-${frame.deployment_id}`)
            assert.equal(previous.Config.Labels['opspilot.controller_id'], controller)
            assert.equal(previous.Config.Labels['opspilot.app_id'], '1')
            docker('rm', '-f', previous.Id)
          }
        }
      }
      return write(chunk, ...writeArgs)
    }
    return opened
  }
  const deploys = new ProductDeployRepository(database)
  const runtime = new ProductRuntimeRepository(database, { secret })
  const options = {
    vps_id: 1,
    target_helper_path: join(
      helper,
      traceEnabled ? 'trace_helper.py' : 'target_guarded_ssh_helper.py'
    ),
    target_state_root: join(state, 'app-1'),
    collector_directory: join(repo, 'collector'),
    build_timeout_ms: 180000,
    build_poll_interval_ms: 500,
    runtime_poll_timeout_ms: 150000,
    runtime_poll_interval_ms: 500
  }
  mkdirSync(source)
  writeFileSync(
    join(source, 'package.json'),
    JSON.stringify(
      next
        ? {
            name: 'r7e-next-fixture',
            version: '1.0.0',
            scripts: { build: 'next build', start: 'next start' },
            dependencies: { next: '14.2.35', react: '18.3.1', 'react-dom': '18.3.1' }
          }
        : spa
          ? {
              name: 'r7b-vite-fixture',
              version: '1.0.0',
              scripts: { build: 'vite build' },
              devDependencies: { vite: '5.4.11' }
            }
          : {
              name: 'r1-express-fixture',
              version: '1.0.0',
              scripts: { start: 'node server.js' },
              dependencies: { express: '4.21.2' }
            }
    )
  )
  run('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: source
  })
  if (next) {
    mkdirSync(join(source, 'pages'))
    writeFileSync(join(source, 'next.config.js'), 'module.exports={experimental:{cpus:1}};\n')
  }
  run('git', ['init', '-q', source])
  const deploy = async (
    name,
    statusCode = 200,
    buildFails = false,
    collectorDirectory,
    appId = 1
  ) => {
    stage = name
    console.log(JSON.stringify({ stage }))
    const pkg = JSON.parse(readFileSync(join(source, 'package.json')))
    pkg.scripts.postinstall = buildFails
      ? 'node -e "process.exit(42)"'
      : 'node -e "process.exit(0)"'
    writeFileSync(join(source, 'package.json'), JSON.stringify(pkg))
    writeFileSync(
      join(source, 'server.js'),
      `const express = require('express');\nconst app = express();\napp.get('/health', (_, res) => res.status(${statusCode}).send('${name}'));\napp.get('/', (_, res) => res.send('${name}'));\napp.listen(3000, '0.0.0.0');\n`
    )
    if (next) {
      // SSR trả status thật để kiểm health/rollback, không giả response helper.
      writeFileSync(
        join(source, 'pages/index.js'),
        `export function getServerSideProps({res}) {res.statusCode=${statusCode};return {props:{}}};export default function Home(){return <main>${name}</main>};\n`
      )
    }
    if (spa) {
      // Artifact không đọc được: build thành công nhưng nginx403, buộc health/rollback thật.
      pkg.scripts.build = 'vite build' + (statusCode !== 200 ? ' && chmod 000 dist/index.html' : '')
      writeFileSync(join(source, 'package.json'), JSON.stringify(pkg))
      writeFileSync(
        join(source, 'index.html'),
        '<html><body><main id="app"></main><script type="module" src="/main.js"></script></body></html>'
      )
      writeFileSync(
        join(source, 'main.js'),
        `document.getElementById('app').textContent = ${JSON.stringify(name)};`
      )
    }
    run('git', ['-C', source, 'add', '--', 'package.json', 'package-lock.json', 'server.js'])
    if (spa) run('git', ['-C', source, 'add', '--', 'index.html', 'main.js'])
    if (next) run('git', ['-C', source, 'add', '--', 'pages/index.js', 'next.config.js'])
    run('git', [
      '-C',
      source,
      '-c',
      'user.name=OpsPilot Lab',
      '-c',
      'user.email=lab@example.invalid',
      'commit',
      '-qm',
      name
    ])
    const sha = run('git', ['-C', source, 'rev-parse', 'HEAD'])
    const job = `${controller}-${cases.length + 1}`
    const timestamp = new Date().toISOString()
    database
      .prepare(
        `INSERT INTO product_deploy_job
      (job_id,controller_id,app_id,ownership_generation,source_generation,source_config_sha256,trigger,
       idempotency_key,ref,target_sha,state,available_at,created_at,updated_at)
      VALUES (?,?,?,1,1,?,'manual_redeploy',?,'main',?,'queued',?,?,?)`
      )
      .run(
        job,
        controller,
        appId,
        configHash,
        `manual:${job}`,
        sha,
        timestamp,
        timestamp,
        timestamp
      )
    const claimed = deploys.claimNextJob(controller)
    assert.equal(claimed.state, 'claimed')
    const claim = claimed.claim
    const metadata = {
      repositoryUrl: 'https://example.test/r1.git',
      repositoryRoot: '.',
      commitSha: sha,
      sourceConfigSha256: configHash
    }
    assert.equal(deploys.markGitSnapshotVerified(claim, metadata).state, 'snapshot_verified')
    heartbeat = setInterval(() => {
      const result = deploys.heartbeatClaim(claim)
      if (result.state !== 'renewed') console.log(JSON.stringify({ heartbeat: result.state }))
    }, 5000)
    const snapshot = {
      claim,
      metadata,
      rootDirectory: source,
      snapshotDirectory: source,
      cleanup() {
        return undefined
      }
    }
    try {
      const result = await executeProductDeployPipeline(
        database,
        runtime,
        deploys,
        manager,
        snapshot,
        {
          ...options,
          target_state_root: join(state, `app-${appId}`),
          ...(collectorDirectory ? { collector_directory: collectorDirectory } : {})
        }
      )
      const terminal = runtime.getTerminal(claim.attempt_id)
      assert.ok(terminal.settled_at)
      assert.ok(terminal.leases_released_at)
      assert.equal(
        (
          await recoverProductRuntimeSession(runtime, manager, snapshot, {
            ...options,
            target_state_root: join(state, `app-${appId}`)
          })
        ).state,
        'already_settled'
      )
      assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [])
      return { result, sha, claim }
    } finally {
      clearInterval(heartbeat)
      heartbeat = null
    }
  }

  const first = await deploy('first_healthy')
  assert.equal(first.result.state, 'succeeded')
  let current = inspect('container', `${appName}-app`)
  assert.equal(current.Config.Labels['org.opencontainers.image.revision'], first.sha)
  const metricPath = `/opt/opspilot/${appName}/metrics/metrics.jsonl`
  await waitFor(
    () => existsSync(metricPath) && readFileSync(metricPath, 'utf8').trim().length > 0,
    30000
  )
  const rows = readFileSync(metricPath, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  assert.equal(rows.at(-1).container_up, 1)
  record('first_healthy', {
    deployment_id: first.result.deployment_id,
    sha: first.sha,
    container_id: current.Id,
    metric_rows: rows.length
  })
  if (spa) await verifySpaRoutes('first_healthy')
  if (next) await verifyNextPage('first_healthy')

  const second = await deploy('healthy_update')
  assert.equal(second.result.state, 'succeeded')
  current = inspect('container', `${appName}-app`)
  assert.equal(current.Config.Labels['org.opencontainers.image.revision'], second.sha)
  assert.equal(
    database.prepare('SELECT current_deployment_id AS id FROM app WHERE id=1').get().id,
    second.result.deployment_id
  )
  const collector = inspect('container', `${appName}-collector`)
  record('healthy_update', {
    deployment_id: second.result.deployment_id,
    sha: second.sha,
    container_id: current.Id,
    activation: database
      .prepare('SELECT state,stream_generation,start_offset FROM deployment_activation WHERE id=?')
      .get(second.result.context.activation_id)
  })
  if (spa) await verifySpaRoutes('healthy_update')
  if (next) await verifyNextPage('healthy_update')

  const failedBuild = await deploy('build_failure', 200, true)
  assert.equal(failedBuild.result.state, 'failed')
  assert.equal(failedBuild.result.failed_step, 'BUILD')
  assert.equal(inspect('container', `${appName}-app`).Id, current.Id)
  assert.equal(inspect('container', `${appName}-collector`).Id, collector.Id)
  assert.equal(inspect('container', collector.Id).State.Running, true)
  record('build_failure', {
    deployment_id: failedBuild.result.deployment_id,
    previous_container_preserved: true,
    previous_collector_preserved: true
  })

  if (restoreFailure) {
    await assert.rejects(
      deploy('restore_failure', 503),
      (error) => error.code === 'SSH_RUNTIME_UNKNOWN'
    )
    assert.equal(
      database.prepare('SELECT current_deployment_id AS id FROM app WHERE id=1').get().id,
      second.result.deployment_id
    )
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM product_runtime_terminal').get().n, 3)
    assert.equal(
      database
        .prepare("SELECT COUNT(*) AS n FROM deployment_activation WHERE state='prepared'")
        .get().n,
      1
    )
    assert.equal(docker('ps', '-aq', '--filter', `name=^/${appName}-app$`), '')
    assert.equal(
      database
        .prepare('SELECT COUNT(*) AS n FROM product_app_lease WHERE released_at IS NULL')
        .get().n,
      1
    )
    assert.equal(
      database
        .prepare('SELECT COUNT(*) AS n FROM product_worker_lease WHERE released_at IS NULL')
        .get().n,
      1
    )
    record('restore_failure_blocks_finalization', {
      runtime_missing: true,
      false_success_prevented: true,
      leases_retained: true
    })
  } else {
    const unhealthy = await deploy('unhealthy_rollback', 503)
    assert.equal(unhealthy.result.state, 'rolled_back')
    assert.equal(inspect('container', `${appName}-app`).Id, current.Id)
    assert.equal(inspect('container', `${appName}-collector`).Id, collector.Id)
    assert.equal(
      database.prepare('SELECT current_deployment_id AS id FROM app WHERE id=1').get().id,
      second.result.deployment_id
    )
    const candidateBoundary = database
      .prepare('SELECT state,stream_generation,start_offset FROM deployment_activation WHERE id=?')
      .get(unhealthy.result.context.activation_id)
    const rollbackBoundary = unhealthy.result.terminal.envelope.receipt.boundary
    assert.equal(candidateBoundary.state, 'aborted')
    assert.equal(candidateBoundary.stream_generation, rollbackBoundary.generation)
    assert.ok(rollbackBoundary.next_offset > candidateBoundary.start_offset)
    assert.ok(Buffer.byteLength(readFileSync(metricPath)) + 1 >= rollbackBoundary.next_offset)
    record('unhealthy_rollback', {
      deployment_id: unhealthy.result.deployment_id,
      previous_container_id: current.Id,
      rollback_boundary: unhealthy.result.terminal.envelope.receipt.boundary
    })
    if (spa) await verifySpaRoutes('healthy_update')
    if (next) await verifyNextPage('healthy_update')
    const firstBuildFailure = await deploy('first_build_failure', 200, true, undefined, 2)
    assert.equal(firstBuildFailure.result.state, 'failed')
    assert.equal(firstBuildFailure.result.failed_step, 'BUILD')
    assert.equal(
      database.prepare('SELECT current_deployment_id AS id FROM app WHERE id=2').get().id,
      null
    )
    record('first_build_failure', {
      deployment_id: firstBuildFailure.result.deployment_id,
      pointer: null
    })
    const firstHealthFailure = await deploy('first_health_failure', 503, false, undefined, 2)
    assert.equal(firstHealthFailure.result.state, 'failed')
    assert.equal(firstHealthFailure.result.failed_step, 'DEPLOY')
    assert.equal(firstHealthFailure.result.terminal.envelope.receipt.active_runtime, null)
    assert.equal(
      database.prepare('SELECT current_deployment_id AS id FROM app WHERE id=2').get().id,
      null
    )
    record('first_health_failure', {
      deployment_id: firstHealthFailure.result.deployment_id,
      rollback_forged: false
    })
    const brokenCollector = join(scratch, 'broken-collector')
    cpSync(join(repo, 'collector'), brokenCollector, { recursive: true })
    writeFileSync(join(brokenCollector, 'Dockerfile'), 'FROM python:3.12-alpine\nRUN exit 42\n')
    const terminalsBeforeFailure = database
      .prepare('SELECT COUNT(*) AS n FROM product_runtime_terminal')
      .get().n
    await assert.rejects(
      deploy('collector_build_failure', 200, false, brokenCollector),
      (error) => error.code === 'SSH_RUNTIME_UNKNOWN'
    )
    assert.equal(inspect('container', `${appName}-app`).Id, current.Id)
    assert.equal(inspect('container', collector.Id).State.Running, true)
    assert.equal(
      database.prepare('SELECT current_deployment_id AS id FROM app WHERE id=1').get().id,
      second.result.deployment_id
    )
    assert.equal(
      database.prepare('SELECT COUNT(*) AS n FROM product_runtime_terminal').get().n,
      terminalsBeforeFailure
    )
    assert.equal(
      database
        .prepare("SELECT COUNT(*) AS n FROM deployment_activation WHERE state='prepared'")
        .get().n,
      1
    )
    assert.equal(
      database
        .prepare('SELECT COUNT(*) AS n FROM product_app_lease WHERE released_at IS NULL')
        .get().n,
      1
    )
    record('collector_build_failure_blocks_finalization', {
      previous_runtime_preserved: true,
      collector_still_running: true,
      leases_retained: true
    })
  }
} catch (error) {
  // Logs/SSH output can contain arbitrary values. Report stable code and phase only.
  failure = {
    stage,
    code: typeof error?.code === 'string' ? error.code : (error?.name ?? 'LAB_FAILED'),
    operation: lastOperation,
    runtime_step: lastRuntimeStep,
    deployments: database?.prepare('SELECT id,status FROM deployment').all(),
    activations: database
      ?.prepare('SELECT id,deployment_id,state FROM deployment_activation')
      .all(),
    target_trace: existsSync(join(helper, 'trace.jsonl'))
      ? readFileSync(join(helper, 'trace.jsonl'), 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      : []
  }
  console.log(JSON.stringify({ status: 'FAIL', ...failure }))
} finally {
  clearInterval(heartbeat)
  clearTimeout(deadline)
  await manager?.disconnectAll()
  if (sshd) {
    sshd.kill('SIGTERM')
    await waitFor(() => sshd.exitCode !== null, 5000).catch(() => {
      sshd.kill('SIGKILL')
      cleanup = false
    })
  }
  if (database) {
    await database.backup(join(output, 'evidence.sqlite'))
    for (const [appId, name] of appNames) {
      const metricFile = `/opt/opspilot/${name}/metrics/metrics.jsonl`
      if (existsSync(metricFile)) cpSync(metricFile, join(output, `app-${appId}-metrics.jsonl`))
    }
  }
  closeDatabase()
  try {
    // Enumerate exact namespace, then validate Product identity before each removal.
    const ids = docker('ps', '-aq', '--no-trunc', '--filter', `name=^/${appName}-`)
      .split('\n')
      .filter(Boolean)
    for (const id of ids) {
      const item = inspect('container', id)
      assert.ok(item.Name.startsWith(`/${appName}-`))
      assert.ok(appNames.has(Number(item.Config.Labels['opspilot.app_id'])))
      assert.equal(item.Config.Labels['opspilot.controller_id'], controller)
      docker('rm', '-f', id)
    }
    for (const tag of docker('image', 'ls', '--format', '{{.Repository}}:{{.Tag}}')
      .split('\n')
      .filter((tag) =>
        [...appNames.values()].some(
          (name) => tag.startsWith(`${name}:`) || tag.startsWith(`${name}-collector:`)
        )
      )) {
      const image = inspect('image', tag)
      assert.ok(appNames.has(Number(image.Config.Labels['opspilot.app_id'])))
      docker('image', 'rm', tag)
    }
    for (const name of appNames.values()) {
      const network = `${name}-network`
      if (docker('network', 'ls', '--filter', `name=^${network}$`, '--format', '{{.Name}}')) {
        assert.equal(inspect('network', network).Labels['opspilot.controller_id'], controller)
        docker('network', 'rm', network)
      }
      const metrics = `/opt/opspilot/${name}`
      if (existsSync(metrics)) {
        assert.equal(realpathSync(metrics), metrics)
        assert.match(appName, /^r1-[a-f0-9]{12}$/)
        rmSync(metrics, { recursive: true })
      }
    }
    assert.equal(docker('ps', '-aq', '--filter', `name=^/${appName}-`), '')
  } catch {
    cleanup = false
  }
  secret.fill(0)
  assert.equal(dirname(realpathSync(scratch)), realpathSync(tmpdir()))
  rmSync(scratch, { recursive: true })
  // Checkpoint completion must never overwrite an earlier global lab deadline.
  if (deadlineExpired) failure = { ...failure, stage, code: 'LAB_DEADLINE' }
  const report = {
    status: failure ? 'FAIL' : cleanup ? 'PASS' : 'FAIL',
    scope: 'PINNED_SSH_SQLITE_DOCKER_RUNTIME',
    framework,
    nonce,
    source_sha: run('git', ['-c', `safe.directory=${repo}`, '-C', repo, 'rev-parse', 'HEAD']),
    subject_sha256: subjectHashes,
    bundle_sha256: bundleHash,
    driver_sha256: driverHash,
    deadline_expired: deadlineExpired,
    subject_unchanged: subjectFiles.every(
      (file) =>
        createHash('sha256')
          .update(readFileSync(join(repo, 'app/src/main/controlPlane', file)))
          .digest('hex') === subjectHashes[file]
    ),
    cases,
    failure,
    cleanup
  }
  writeFileSync(join(output, 'result.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
  process.exitCode = failure || !cleanup ? 1 : 0
}

async function waitFor(check, timeout) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    if (await check()) return
    await delay(100)
  }
  throw new Error('LAB_WAIT_TIMEOUT')
}

async function verifyNextPage(marker) {
  const origin = `http://127.0.0.1:${hostPort}`
  const home = await fetch(origin + '/')
  assert.equal(home.status, 200)
  const html = await home.text()
  assert(html.includes(marker))
  const asset = html.match(/src="([^"]+\.js)"/)?.[1]
  assert(asset?.startsWith('/_next/'))
  assert.equal((await fetch(origin + asset)).status, 200)
  assert.equal((await fetch(origin + '/_next/static/missing-r7e.js')).status, 404)
  record('next_ssr_' + stage, {
    ssr_marker: marker,
    html_sha256: createHash('sha256').update(html).digest('hex'),
    next_asset_200: true,
    missing_asset_404: true
  })
}

async function verifySpaRoutes(marker) {
  const origin = `http://127.0.0.1:${hostPort}`
  const home = await fetch(origin + '/')
  assert.equal(home.status, 200)
  const html = await home.text()
  const deep = await fetch(origin + '/projects/current/settings')
  assert.equal(deep.status, 200)
  assert.equal(await deep.text(), html)
  const asset = html.match(/src="([^"]+\.js)"/)?.[1]
  assert.ok(asset?.startsWith('/assets/'))
  const js = await fetch(origin + asset)
  assert.equal(js.status, 200)
  assert.ok((await js.text()).includes(marker))
  assert.equal((await fetch(origin + '/assets/not-present.js')).status, 404)
  assert.equal((await fetch(origin + '/not-present.css')).status, 404)
  record('spa_routes_' + stage, {
    html_sha256: createHash('sha256').update(html).digest('hex'),
    deep_link_matches_index: true,
    missing_assets_404: true
  })
}

function reservePort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close((error) => (error ? reject(error) : resolvePort(address.port)))
    })
  })
}
