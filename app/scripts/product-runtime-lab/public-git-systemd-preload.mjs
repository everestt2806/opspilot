/* eslint-disable @typescript-eslint/explicit-function-return-type -- Standalone Linux integration lab. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

await import('./target-enrollment-runtime-preload.mjs')
const api = createRequire(process.env.OPSPILOT_R1_ARTIFACT)(process.env.OPSPILOT_R1_ARTIFACT)
const cli = process.env.OPSPILOT_PUBLIC_SERVICE_ARTIFACT
const output = process.env.OPSPILOT_PUBLIC_SERVICE_RESULT
if (!cli || !output) throw new Error('PUBLIC_SYSTEMD_LAB_ENV_REQUIRED')
const url = 'https://github.com/everestt2806/opspilot.git'
const ref = 'feat/release-audit-20261204'
const gitRoot = 'demo-apps/san-nha-booking'
const manualHttp = process.env.OPSPILOT_MANUAL_HTTP === '1'
const nodeModules = resolve(dirname(cli), '../node_modules')
const command = (program, args, timeout = 30000) =>
  execFileSync(program, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
    maxBuffer: 32768
  }).trim()
const waitFor = async (check, timeout) => {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await check()
    if (value) return value
    await delay(250)
  }
  throw new Error('PUBLIC_SYSTEMD_LAB_TIMEOUT')
}
const container = (name) => {
  const c = JSON.parse(command('docker', ['container', 'inspect', name]))[0]
  return [
    c.Id,
    c.Image,
    c.State.StartedAt,
    c.RestartCount,
    c.Config.Labels['org.opencontainers.image.revision']
  ]
}
const removeOwnedDirectory = (path) => {
  if (resolve(path) !== path || !/^\/(?:opt|var\/lib)\/opspilot-lab-[a-f0-9]{12}$/.test(path))
    throw new Error('CLEANUP_SCOPE_REJECTED')
  if (existsSync(path)) {
    assert.equal(lstatSync(path).isSymbolicLink(), false)
    rmSync(path, { recursive: true })
  }
}
api.executeProductDeployPipeline = async (database, _runtime, repository, _ssh, snapshot) => {
  const nonce = randomBytes(6).toString('hex'),
    unit = `opspilot-lab-${nonce}.service`
  const install = `/opt/opspilot-lab-${nonce}`,
    data = `/var/lib/opspilot-lab-${nonce}`
  const unitPath = `/run/systemd/system/${unit}`
  const app = database.prepare('SELECT name,host_port FROM app WHERE id=1').get()
  let phase = 'prepare',
    started = false
  const results = {
    status: 'RUNNING',
    nonce,
    unit,
    phase,
    public_git: true,
    git_transport_adapter: false,
    desktop_required: false,
    systemd: true,
    service_user: 'root (isolated lab)',
    nonroot_installer_verified: false,
    source_root: gitRoot
  }
  const record = (patch) => {
    Object.assign(results, patch, { phase })
    writeFileSync(output, JSON.stringify(results, null, 2) + '\n')
  }
  const control = (action) => command('systemctl', [action, unit], 60000)
  const health = async () => {
    try {
      return (await (await fetch('http://127.0.0.1:8768/healthz')).json()).service_state
    } catch {
      return null
    }
  }
  let db
  try {
    assert.equal(
      repository.finishPrewriteAttempt({
        claim: snapshot.claim,
        disposition: 'permanent_failure',
        safeErrorCode: 'INVALID_SOURCE_CONFIG'
      }).state,
      'failed'
    )
    for (const path of [install, data, unitPath]) assert.equal(existsSync(path), false)
    mkdirSync(install, { mode: 0o700 })
    mkdirSync(data, { mode: 0o700 })
    cpSync(dirname(cli), join(install, 'payload'), { recursive: true })
    cpSync(nodeModules, join(install, 'node_modules'), { recursive: true, dereference: false })
    copyFileSync(process.execPath, join(install, 'node'))
    chmodSync(join(install, 'node'), 0o755)
    const originalData = dirname(database.name)
    for (const name of readdirSync(originalData)) {
      if (/^opspilot\.db(?:-(?:wal|shm))?$/.test(name)) continue
      const source = join(originalData, name)
      assert.equal(lstatSync(source).isSymbolicLink(), false)
      cpSync(source, join(data, name), { recursive: true })
    }
    await database.backup(join(data, 'opspilot.db'))
    chmodSync(join(data, 'opspilot.db'), 0o600)
    const Database = createRequire(process.env.OPSPILOT_R1_ARTIFACT)('better-sqlite3')
    db = new Database(join(data, 'opspilot.db'))
    db.pragma('foreign_keys=ON')
    const hash = createHash('sha256').update('{}').digest('hex'),
      now = new Date().toISOString()
    for (const id of [1, 2]) {
      db.prepare(`INSERT INTO product_source_config VALUES(?,2,?,?,?,'{}',?,?)`).run(
        id,
        url,
        ref,
        gitRoot,
        hash,
        now
      )
      db.prepare(
        `UPDATE product_app_control SET source_generation=2,source_config_sha256=?,auto_deploy_paused=?,pause_reason=?,pause_policy_provenance='explicit' WHERE app_id=?`
      ).run(hash, id === 2 ? 1 : 0, id === 2 ? 'operator' : null, id)
      db.prepare('UPDATE app SET git_repo_url=?,git_ref=?,git_root=? WHERE id=?').run(
        url,
        ref,
        gitRoot,
        id
      )
    }
    const artifact = join(install, 'payload/control-plane.cjs')
    const pin = createHash('sha256')
      .update(readFileSync(join(install, 'payload/bundle-manifest.json')))
      .digest('hex')
    const input = join(install, 'execution.json')
    let desktopClient
    if (process.env.OPSPILOT_PUBLIC_READ_API === '1' || manualHttp) {
      desktopClient = JSON.parse(
        execFileSync(
          join(install, 'node'),
          [artifact, 'enroll-desktop-client', '--data-dir', data],
          {
            input: JSON.stringify({
              request_key: randomUUID(),
              display_name: manualHttp ? 'Systemd command API lab' : 'Systemd read API lab',
              requested_scopes: manualHttp ? ['read', 'deploy:manual', 'policy:write'] : ['read']
            }),
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 30000
          }
        )
      )
      assert.equal(desktopClient.state, 'issued_once')
    }
    const apiBase = `http://127.0.0.1:8768/v1/controllers/${snapshot.claim.controller_id}`
    const readApi = async (path) => {
      const response = await fetch(apiBase + path, {
        headers: { authorization: `Bearer ${desktopClient.credential.access_token}` }
      })
      assert.equal(response.status, 200)
      const dto = await response.json()
      assert.equal(JSON.stringify(dto).includes(desktopClient.credential.access_token), false)
      return dto
    }
    const verifyReadApi = async (sha) => {
      if (!desktopClient) return
      const detail = await readApi('/apps/1')
      assert.equal(detail.current_deployment_sha, sha)
      assert.equal(detail.current_deployment_state, 'running')
      const jobs = await readApi('/apps/1/jobs'),
        deployments = await readApi('/apps/1/deployments'),
        history = await readApi('/apps/1/history')
      assert.ok(jobs.items.some((job) => job.target_sha === sha && job.state === 'succeeded'))
      assert.ok(
        deployments.items.some(
          (deployment) => deployment.commit_sha === sha && deployment.status === 'running'
        )
      )
      assert.ok(history.items.some((event) => event.kind === 'runtime_leases_released'))
      assert.equal('env_json' in detail, false)
      const first = await readApi('/apps?limit=1')
      assert.equal(first.has_more, true)
      assert.deepEqual(
        first.items.map((app) => app.app_id),
        [1]
      )
      const second = await readApi('/apps?limit=1&cursor=' + first.next_cursor)
      assert.deepEqual(
        second.items.map((app) => app.app_id),
        [2]
      )
      assert.equal(second.has_more, false)
    }
    writeFileSync(input, JSON.stringify({ format: 1, artifact, manifest_sha256: pin }), {
      mode: 0o600
    })
    const contents = `[Unit]
Description=OpsPilot isolated public Git lab ${nonce}
After=network-online.target
[Service]
Type=simple
User=root
Group=root
WorkingDirectory=${install}
UMask=0077
Environment=NODE_ENV=production
Environment=OPSPILOT_TEMPLATES_DIR=/invalid-untrusted-environment
StandardInput=file:${input}
ExecStart=${install}/node ${artifact} run-product --data-dir ${data}
Restart=no
TimeoutStopSec=45s
KillMode=control-group
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${data}
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
`
    writeFileSync(unitPath, contents, { mode: 0o600 })
    command('systemctl', ['daemon-reload'])
    phase = 'first_public_deploy'
    record({ manifest_sha256: pin, installed: true })
    control('start')
    started = true
    const terminal = () =>
      db
        .prepare(
          `SELECT j.job_id,j.target_sha,j.state,t.leases_released_at FROM product_deploy_job j
      LEFT JOIN product_deploy_attempt a ON a.job_id=j.job_id LEFT JOIN product_runtime_terminal t ON t.attempt_id=a.attempt_id
      WHERE j.app_id=1 AND j.source_generation=2 ORDER BY j.created_at DESC,a.attempt_number DESC LIMIT 1`
        )
        .get()
    const first = await waitFor(() => {
      const row = terminal()
      return row?.state === 'succeeded' && row.leases_released_at ? row : null
    }, 240000)
    await waitFor(async () => (await health()) === 'ready', 10000)
    assert.equal(container(app.name + '-app')[4], first.target_sha)
    await verifyReadApi(first.target_sha)
    const firstHealth = await fetch(`http://127.0.0.1:${app.host_port}/health`)
    assert.equal(firstHealth.status, 200)
    assert.match(
      await (await fetch(`http://127.0.0.1:${app.host_port}/`)).text(),
      /<!doctype html>/i
    )
    const pid1 = Number(command('systemctl', ['show', unit, '--property=MainPID', '--value']))
    const before = [container(app.name + '-app'), container(app.name + '-collector')]
    phase = 'same_sha_restart'
    control('restart')
    await waitFor(async () => (await health()) === 'ready', 60000)
    const pid2 = Number(command('systemctl', ['show', unit, '--property=MainPID', '--value']))
    assert.ok(pid1 > 0 && pid2 > 0 && pid1 !== pid2)
    await delay(35000)
    assert.deepEqual([container(app.name + '-app'), container(app.name + '-collector')], before)
    assert.equal(
      db.prepare('SELECT count(*) AS n FROM product_deploy_job WHERE source_generation=2').get().n,
      1
    )
    phase = manualHttp ? 'manual_same_sha_request' : 'waiting_checkpoint_push'
    record({
      first_sha: first.target_sha,
      first_job: first.job_id,
      first_deployment_settled: true,
      restart_no_duplicate: true,
      service_restarted: true,
      health: await health(),
      main_pids: [pid1, pid2],
      ...(desktopClient ? { authenticated_read_api_first_snapshot: true } : {})
    })
    let manualJob, manualKey
    const postApi = async (path, key, value, discardResponse = false) => {
      const response = await fetch(apiBase + path, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${desktopClient.credential.access_token}`,
          'content-type': 'application/json',
          'idempotency-key': key
        },
        body: JSON.stringify(value)
      })
      const expectedStatus = path.endsWith('/redeploy') ? 202 : 200
      if (response.status !== expectedStatus) {
        const rejected = await response.json()
        record({
          rejected_http_status: response.status,
          rejected_error_code: /^[A-Z_]{1,80}$/.test(rejected.error?.code)
            ? rejected.error.code
            : 'INVALID_ERROR_DTO',
          rejected_service_health: await health(),
          rejected_worker_status: await readApi('/status'),
          attempt_states: db
            .prepare('SELECT state,remote_outcome FROM product_deploy_attempt')
            .all()
        })
      }
      assert.equal(response.status, expectedStatus)
      if (discardResponse) {
        await response.body.cancel()
        return null
      }
      const dto = await response.json()
      assert.equal(JSON.stringify(dto).includes(desktopClient.credential.access_token), false)
      return dto
    }
    const precondition = { expected_ownership_generation: 1, expected_source_generation: 2 }
    if (manualHttp) {
      const capabilities = await readApi('/capabilities')
      assert.equal(capabilities.manual_redeploy.state, 'available')
      manualKey = randomUUID()
      const request = { ...precondition, target: { kind: 'current_desired' } }
      // Mô phỏng caller bỏ response sau headers; chỉ lookup/replay cùng key, không tạo intent khác.
      await postApi('/apps/1/redeploy', manualKey, request, true)
      const lookup = await readApi('/requests/' + manualKey)
      assert.equal(lookup.found, true)
      manualJob = lookup.status.job_id
      const replay = await postApi('/apps/1/redeploy', manualKey, request)
      assert.equal(replay.job_id, manualJob)
      assert.equal(replay.target_sha, first.target_sha)
      assert.equal(
        db
          .prepare(
            "SELECT count(*) AS n FROM product_deploy_job WHERE app_id=1 AND source_generation=2 AND trigger='manual_redeploy'"
          )
          .get().n,
        1
      )
      assert.equal(
        db.prepare('SELECT auto_deploy_paused FROM product_app_control WHERE app_id=1').get()
          .auto_deploy_paused,
        1
      )
      record({
        manual_request_accepted: true,
        manual_duplicate_one_job: true,
        discarded_response_lookup: true
      })
    }
    // Public-push mode waits for the next published checkpoint; manual mode redeploys the same public SHA.
    const second = await waitFor(
      () => {
        const row = terminal()
        return (manualHttp ? row?.job_id === manualJob : row?.target_sha !== first.target_sha) &&
          row?.state === 'succeeded' &&
          row.leases_released_at
          ? row
          : null
      },
      manualHttp ? 240000 : 15 * 60000
    )
    phase = manualHttp ? 'manual_same_sha_settled' : 'second_public_deploy'
    await waitFor(async () => (await health()) === 'ready', 10000)
    assert.equal(container(app.name + '-app')[4], second.target_sha)
    await verifyReadApi(second.target_sha)
    if (manualHttp) record({ manual_authenticated_second_snapshot: true })
    assert.notEqual(second.job_id, first.job_id)
    assert.equal((await fetch(`http://127.0.0.1:${app.host_port}/health`)).status, 200)
    assert.equal(
      db.prepare('SELECT count(*) AS n FROM product_deploy_job WHERE source_generation=2').get().n,
      2
    )
    assert.equal(
      db.prepare('SELECT count(*) AS n FROM product_app_lease WHERE released_at IS NULL').get().n,
      0
    )
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
    if (manualHttp) {
      assert.equal(second.target_sha, first.target_sha)
      const lookup = await readApi('/requests/' + manualKey)
      assert.equal(lookup.status.state, 'completed')
      assert.equal(lookup.status.job_id, manualJob)
      phase = 'manual_pause_policy'
      record({ manual_terminal_lookup: true })
      const pauseKey = randomUUID(),
        pauseBody = { ...precondition, action: 'pause' }
      const paused = await postApi('/apps/1/auto-deploy-policy', pauseKey, pauseBody)
      const pauseReplay = await postApi('/apps/1/auto-deploy-policy', pauseKey, pauseBody)
      for (const key of [
        'app_id',
        'result',
        'auto_deploy_paused',
        'pause_policy_provenance',
        'reconciliation_state',
        'updated_at'
      ])
        assert.deepEqual(pauseReplay[key], paused[key])
      assert.equal(paused.auto_deploy_paused, true)
      phase = 'manual_resume_policy'
      record({ manual_pause_idempotent: true })
      const resumed = await postApi('/apps/1/auto-deploy-policy', randomUUID(), {
        ...precondition,
        action: 'resume'
      })
      assert.equal(resumed.auto_deploy_paused, false)
      assert.equal(resumed.reconciliation_state, 'satisfied')
      phase = 'post_manual_restart'
      record({ manual_resume_satisfied: true })
      const afterManual = [container(app.name + '-app'), container(app.name + '-collector')]
      control('restart')
      await waitFor(async () => (await health()) === 'ready', 60000)
      await delay(35000)
      assert.deepEqual(
        [container(app.name + '-app'), container(app.name + '-collector')],
        afterManual
      )
      assert.equal(
        db.prepare('SELECT count(*) AS n FROM product_deploy_job WHERE source_generation=2').get()
          .n,
        2
      )
      assert.equal((await readApi('/requests/' + manualKey)).status.state, 'completed')
      record({
        manual_same_sha_runtime: true,
        manual_terminal_lookup: true,
        pause_resume_idempotent: true,
        post_manual_restart_no_duplicate: true
      })
    }
    if (desktopClient) {
      execFileSync(join(install, 'node'), [artifact, 'revoke-desktop-client', '--data-dir', data], {
        input: JSON.stringify({
          request_key: randomUUID(),
          client_id: desktopClient.client.client_id
        }),
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30000
      })
      const revoked = await fetch(apiBase + '/apps', {
        headers: { authorization: `Bearer ${desktopClient.credential.access_token}` }
      })
      assert.equal(revoked.status, 401)
    }
    phase = 'stop'
    control('stop')
    started = false
    assert.equal(command('systemctl', ['show', unit, '--property=MainPID', '--value']), '0')
    assert.equal(await health(), null)
    record({
      status: 'PASS',
      second_sha: second.target_sha,
      second_job: second.job_id,
      settled_deployments: 2,
      actual_github_push_observed: !manualHttp,
      manual_http: manualHttp,
      ...(desktopClient
        ? { authenticated_read_api_verified: true, live_revocation: true, read_snapshots: 2 }
        : {}),
      graceful_stop: true
    })
  } catch (error) {
    const code =
      typeof error.code === 'string' && /^[A-Z_]+$/.test(error.code) ? error.code : error.name
    let serviceState
    try {
      serviceState = command('systemctl', ['show', unit, '--property=Result', '--value'])
    } catch {
      serviceState = 'unknown'
    }
    record({
      status: 'FAIL',
      error_code: code,
      assertion_location:
        error.stack?.match(/public-git-systemd-preload\.mjs:\d+:\d+/)?.[0] ?? null,
      service_result: serviceState,
      job_states: db?.prepare('SELECT state,safe_error_code FROM product_deploy_job').all()
    })
    throw error
  } finally {
    if (started) {
      try {
        control('stop')
      } catch {
        results.cleanup_error = 'SERVICE_STOP_FAILED'
      }
    }
    db?.close()
    if (existsSync(unitPath)) {
      rmSync(unitPath)
      command('systemctl', ['daemon-reload'])
    }
    for (const path of [install, data]) {
      removeOwnedDirectory(path)
    }
    record({ cleanup: !existsSync(unitPath) && !existsSync(install) && !existsSync(data) })
  }
  throw Object.assign(new Error('PUBLIC_SYSTEMD_LAB_FINISHED'), {
    code: 'PUBLIC_SYSTEMD_LAB_FINISHED'
  })
}
