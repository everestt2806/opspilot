/* eslint-disable @typescript-eslint/explicit-function-return-type -- Standalone Linux integration lab. */
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

// Reuse only fixture provisioning through the real production enrollment CLI.
await import('./target-enrollment-runtime-preload.mjs')
const api = createRequire(process.env.OPSPILOT_R1_ARTIFACT)(process.env.OPSPILOT_R1_ARTIFACT)
const cli = process.env.OPSPILOT_EXECUTION_SERVICE_ARTIFACT
const output = process.env.OPSPILOT_EXECUTION_SERVICE_RESULT
if (!cli || !output) throw new Error('SERVICE_LAB_ENV_REQUIRED')
const manifest = createHash('sha256')
  .update(readFileSync(join(dirname(cli), 'bundle-manifest.json')))
  .digest('hex')
const url = 'https://github.com/opspilot-lab/controller-service.git'
const docker = (name) => {
  const value = JSON.parse(
    execFileSync('docker', ['container', 'inspect', name], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
  )[0]
  return [value.Id, value.Image, value.State.StartedAt, value.RestartCount]
}
const waitFor = async (check, timeout = 180000) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const result = await check()
    if (result) return result
    await delay(150)
  }
  throw new Error('SERVICE_LAB_TIMEOUT')
}

api.executeProductDeployPipeline = async (database, _runtime, repository, _ssh, snapshot) => {
  const directory = dirname(database.name)
  const app = database.prepare('SELECT name,host_port FROM app WHERE id=1').get()
  const source = snapshot.rootDirectory
  let child
  let phase = 'configuration'
  const safeErrors = []
  const processes = []
  const stop = async () => {
    if (!child) return
    const active = child
    child = null
    active.process.kill('SIGTERM')
    const code = await Promise.race([active.closed, delay(15000).then(() => 'timeout')])
    if (code === 'timeout') {
      active.process.kill('SIGKILL')
      await active.closed
      throw new Error('SERVICE_STOP_TIMEOUT')
    }
    assert.equal(code, 0)
    assert.equal(active.overflow, false)
    assert.ok(active.localGitCalls > 0, 'real Git transport must run')
    processes.push(active.process.pid)
  }
  const start = () => {
    assert.equal(child, undefined)
    const processChild = spawn(
      process.execPath,
      [
        '--import',
        join(import.meta.dirname, 'execution-service-git-fixture.mjs'),
        cli,
        'run-product',
        '--data-dir',
        directory
      ],
      {
        cwd: '/',
        env: {
          ...process.env,
          OPSPILOT_SERVICE_GIT_FIXTURE: source,
          OPSPILOT_TEMPLATES_DIR: '/does-not-exist-untrusted-environment'
        },
        stdio: ['pipe', 'pipe', 'pipe']
      }
    )
    const active = {
      process: processChild,
      overflow: false,
      localGitCalls: 0,
      bytes: 0,
      closed: null
    }
    active.closed = new Promise((resolve) => {
      processChild.once('error', () => resolve('spawn-error'))
      processChild.once('close', resolve)
    })
    processChild.stdout.on('data', (bytes) => {
      active.bytes += bytes.length
      if (active.bytes > 32768) active.overflow = true
      active.localGitCalls += bytes.toString().split('LAB_LOCAL_GIT_TRANSPORT').length - 1
    })
    processChild.stderr.on('data', (bytes) => {
      for (const match of bytes.toString().matchAll(/CONTROL_PLANE_ERROR ([A-Z][A-Z0-9_]{1,80})/g))
        safeErrors.push(match[1])
      active.bytes += bytes.length
      if (active.bytes > 32768) active.overflow = true
    })
    processChild.stdin.end(JSON.stringify({ format: 1, artifact: cli, manifest_sha256: manifest }))
    child = active
  }
  const health = async () => {
    try {
      return (await (await fetch('http://127.0.0.1:8768/healthz')).json()).service_state
    } catch {
      return null
    }
  }
  try {
    // End the R1 driver's prewrite claim before giving exclusive ownership to the service worker.
    assert.equal(
      repository.finishPrewriteAttempt({
        claim: snapshot.claim,
        disposition: 'permanent_failure',
        safeErrorCode: 'INVALID_SOURCE_CONFIG'
      }).state,
      'failed'
    )
    const hash = createHash('sha256').update('{}').digest('hex'),
      now = new Date().toISOString()
    for (const id of [1, 2]) {
      database
        .prepare(`INSERT INTO product_source_config VALUES(?,2,?,'main','.','{}',?,?)`)
        .run(id, url, hash, now)
      database
        .prepare(
          `UPDATE product_app_control SET source_generation=2,source_config_sha256=?,auto_deploy_paused=?,
        pause_reason=?,pause_policy_provenance='explicit' WHERE app_id=?`
        )
        .run(hash, id === 2 ? 1 : 0, id === 2 ? 'operator' : null, id)
      database.prepare("UPDATE app SET git_repo_url=?,git_ref='main' WHERE id=?").run(url, id)
    }
    execFileSync('git', ['-C', source, 'branch', '-M', 'main'], { stdio: 'ignore' })
    phase = 'first_start'
    start()
    await waitFor(async () => (await health()) === 'ready', 60000)
    const terminal = () =>
      database
        .prepare(
          `SELECT j.job_id,j.target_sha,j.state,t.leases_released_at FROM product_deploy_job j
      LEFT JOIN product_deploy_attempt a ON a.job_id=j.job_id LEFT JOIN product_runtime_terminal t ON t.attempt_id=a.attempt_id
      WHERE j.app_id=1 AND j.source_generation=2 ORDER BY j.created_at DESC,a.attempt_number DESC LIMIT 1`
        )
        .get()
    phase = 'first_deploy'
    const first = await waitFor(() => {
      const row = terminal()
      return row?.state === 'succeeded' && row.leases_released_at ? row : null
    })
    assert.equal(first.target_sha, snapshot.metadata.commitSha)
    assert.equal(await (await fetch(`http://127.0.0.1:${app.host_port}/`)).text(), 'first_healthy')
    const firstIdentity = [docker(app.name + '-app'), docker(app.name + '-collector')]
    await stop()
    child = undefined
    assert.deepEqual([docker(app.name + '-app'), docker(app.name + '-collector')], firstIdentity)
    // A second real Git commit is observed and deployed by a fresh controller process.
    const server = join(source, 'server.js')
    writeFileSync(
      server,
      readFileSync(server, 'utf8').replaceAll('first_healthy', 'service_update')
    )
    execFileSync('git', ['-C', source, 'add', '--', 'server.js'], { stdio: 'ignore' })
    execFileSync(
      'git',
      [
        '-C',
        source,
        '-c',
        'user.name=OpsPilot Lab',
        '-c',
        'user.email=lab@example.invalid',
        'commit',
        '-qm',
        'service-update'
      ],
      { stdio: 'ignore' }
    )
    const sha = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], {
      encoding: 'utf8'
    }).trim()
    phase = 'updated_start'
    start()
    const second = await waitFor(() => {
      const row = terminal()
      return row?.target_sha === sha && row.state === 'succeeded' && row.leases_released_at
        ? row
        : null
    })
    assert.notEqual(first.job_id, second.job_id)
    assert.equal(await (await fetch(`http://127.0.0.1:${app.host_port}/`)).text(), 'service_update')
    const secondIdentity = [docker(app.name + '-app'), docker(app.name + '-collector')]
    assert.notEqual(secondIdentity[0][0], firstIdentity[0][0])
    const count = database
      .prepare('SELECT count(*) AS n FROM product_deploy_job WHERE source_generation=2')
      .get().n
    assert.equal(count, 2)
    await stop()
    child = undefined
    phase = 'same_sha_restart'
    start()
    await waitFor(async () => child.localGitCalls > 0 && (await health()) === 'ready', 60000)
    await delay(1500)
    assert.equal(
      database
        .prepare('SELECT count(*) AS n FROM product_deploy_job WHERE source_generation=2')
        .get().n,
      count
    )
    assert.deepEqual([docker(app.name + '-app'), docker(app.name + '-collector')], secondIdentity)
    await stop()
    child = undefined
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [])
    assert.equal(new Set(processes).size, 3)
    writeFileSync(
      output,
      JSON.stringify({
        status: 'PASS',
        processes: 3,
        deployments: 2,
        git_transport: 'local-file-fixture',
        public_git: false,
        default_production_composition: true,
        desktop_required: false,
        packaged_paths_ignore_environment: true,
        restart_without_duplicate: true,
        settled_terminals: 2,
        source_sha: sha
      }) + '\n'
    )
  } catch (error) {
    writeFileSync(
      output,
      JSON.stringify({
        status: 'FAIL',
        phase,
        safe_errors: safeErrors,
        error_code:
          typeof error.code === 'string' && /^[A-Z_]+$/.test(error.code) ? error.code : error.name,
        child_exit: child?.process.exitCode ?? null
      }) + '\n'
    )
    throw error
  } finally {
    await stop()
  }
  throw Object.assign(new Error('SERVICE_LAB_FINISHED'), { code: 'SERVICE_LAB_FINISHED' })
}
