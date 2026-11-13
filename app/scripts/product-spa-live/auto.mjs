/* eslint-disable @typescript-eslint/explicit-function-return-type -- Nghiệm thu branch polling khi ngắt Main SSH. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomBytes, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, realpathSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { journalKey } from '../controller-upgrade-live/journal-key.mjs'
import { snapshotCommand } from '../controller-desktop-live/snapshot.mjs'
const args = process.argv.slice(2),
  sourceNonce = args[1]
if (
  args.length !== 2 ||
  args[0] !== '--confirm-development-auto' ||
  sourceNonce !== '6ab247675f19'
) {
  console.log('{"status":"REJECTED","code":"EXPLICIT_DEVELOPMENT_AUTO_GATE_REQUIRED"}')
  process.exit(2)
}
const project = resolve(import.meta.dirname, '../..'),
  require = createRequire(join(project, 'package.json')),
  nonce = randomBytes(6).toString('hex'),
  directory = join(project, '.out-scripts/product-spa-auto', nonce),
  local = join(directory, 'private-profile')
mkdirSync(local, { recursive: true })
writeFileSync(join(directory, '.owner'), nonce, { flag: 'wx' })
const proof = {
  status: 'RUNNING',
  record: nonce,
  source_record: sourceNonce,
  checks: [],
  production_profile_used: false,
  gui_tested: false,
  manual_redeploy_sent: false
}
let db,
  ssh,
  service,
  binding,
  phase = 'input',
  config,
  policyResumed = false
const save = () =>
  writeFileSync(join(directory, 'result.json'), JSON.stringify({ ...proof, phase }, null, 2) + '\n')
const progress = (next) => {
  phase = next
  save()
  console.log(JSON.stringify({ phase, record: nonce }))
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
const git = (source, ...values) =>
  execFileSync('git', ['-C', source, ...values], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 90000,
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()
const stable = (error) => {
  for (const value of [error?.context?.cause?.message, error?.code, error?.message])
    if (typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,90}$/.test(value)) return value
  return 'AUTO_GATE_FAILED'
}
try {
  let text = ''
  for await (const chunk of process.stdin) {
    text += chunk
    if (text.length > 32768) throw Error('INPUT_LIMIT')
  }
  config = JSON.parse(text)
  text = ''
  const pin = 'SHA256:0X8J5LfPr6iZqEspsD379FvFEWrLfYpN0wfNYjQ87+E'
  assert(
    config.host === '167.71.202.116' &&
      config.port === 22 &&
      config.username === 'root' &&
      config.host_fingerprint === pin &&
      typeof config.password === 'string' &&
      config.password
  )
  const first = JSON.parse(
    readFileSync(join(project, '.out-scripts/product-spa-live', sourceNonce, 'result.json'), 'utf8')
  )
  assert.equal(first.status, 'PASS')
  assert(first.private_db_removed && first.temporary_client_revoked)
  const app = first.project,
    branch = first.git.final.branch,
    previousSha = first.git.final.sha,
    source = join(project, '.out-scripts/product-spa-git', sourceNonce, 'source')
  assert(Number.isSafeInteger(app.app_id) && app.app_id === 3)
  assert.equal(app.host_port, 30002)
  assert.equal(git(source, 'branch', '--show-current'), branch)
  assert.equal(git(source, 'rev-parse', 'HEAD'), previousSha)
  assert.equal(git(source, 'ls-remote', '--heads', 'origin', branch).split(/\s/)[0], previousSha)
  const verifier = require(join(project, 'out/main/controllerResourceVerifier.js'))
  verifier.verifyPackagedControllerResources(join(project, 'resources/controller-releases'))
  const esbuild = createRequire(require.resolve('vite/package.json'))('esbuild')
  await esbuild.build({
    entryPoints: [join(import.meta.dirname, 'entry.ts')],
    outfile: join(directory, 'entry.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    packages: 'external',
    plugins: [
      {
        name: 'raw',
        setup(b) {
          b.onResolve({ filter: /\?raw$/ }, (a) => ({
            path: resolve(a.resolveDir, a.path.slice(0, -4)),
            namespace: 'raw'
          }))
          b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({
            contents: readFileSync(a.path, 'utf8'),
            loader: 'text'
          }))
        }
      }
    ]
  })
  proof.main_artifact_sha256 = createHash('sha256')
    .update(readFileSync(join(directory, 'entry.cjs')))
    .digest('hex')
  const code = require(join(directory, 'entry.cjs')),
    key = journalKey(local, true),
    cipher = new code.AesGcmCredentialCipher(key)
  key.fill(0)
  db = code.initializeDatabase(local)
  const profiles = new code.VpsRepository(db)
  profiles.create({
    name: 'Auto SPA ' + nonce,
    host: config.host,
    port: 22,
    username: 'root',
    auth_type: 'password',
    host_fingerprint: pin,
    credential: cipher.encrypt(config.password)
  })
  config.password = ''
  ssh = new code.SshManager((id) => {
    const v = profiles.getById(id)
    return {
      host: v.host,
      port: v.port,
      username: v.username,
      authType: v.auth_type,
      hostFingerprint: v.host_fingerprint,
      secret: code.loadSecret(db, cipher, id)
    }
  })
  const resources = new code.ControllerInstallerResources(
    verifier.builtinControllerInstallerCatalog(),
    join(project, 'resources/controller-releases')
  )
  service = new code.DesktopControllerService(
    db,
    cipher,
    ssh,
    undefined,
    resources.entries(),
    resources
  )
  const exec = async (command) => {
    const r = await ssh.exec(1, command, {
      logCommand: false,
      retryOnReconnect: false,
      timeoutMs: 25000,
      maxStdoutBytes: 65536,
      maxStderrBytes: 1024
    })
    assert.equal(r.code, 0)
    return r.stdout
  }
  const snapshot = async () => JSON.parse(await exec(snapshotCommand))
  const cids = async () =>
    (
      await exec(
        "docker inspect --format '{{.Id}}' san-nha-live-app san-nha-live-collector desktop-live-69eeeb78-app desktop-live-69eeeb78-collector"
      )
    ).trim()
  progress('readonly-preflight')
  proof.before = await snapshot()
  proof.old_cids = await cids()
  assert.equal(proof.before.active_clients, 0)
  assert.equal(proof.before.active_jobs, 0)
  assert.equal(proof.before.active_experiments, 0)
  assert(proof.before.desired.every((row) => row.auto_paused === 1))
  const review = await service.reviewControllerAdoption({ vps_id: 1 })
  await service.confirmControllerAdoption({ plan_id: review.plan_id, consent: true })
  const intent = {
      installation_request_key: review.installation_request_key,
      display_name: 'Auto SPA ' + nonce,
      allow_write: true
    },
    prepared = await service.prepareInstalledRegistration(intent)
  binding = prepared.binding_id
  await service.registerInstalled({ ...intent, binding_id: binding })
  const beforeStatus = await service.appStatus({ binding_id: binding, app_id: app.app_id })
  assert.equal(beforeStatus.current_deployment_sha, previousSha)
  const policy = async (action) => {
    const command = await service.prepareCommand({
      binding_id: binding,
      app_id: app.app_id,
      expected_ownership_generation: beforeStatus.ownership_generation,
      expected_source_generation: beforeStatus.source_generation,
      operation: 'policy',
      action
    })
    proof['policy_' + action] = { request_key: command.request_key, state: 'prepared' }
    save()
    if (action === 'resume') policyResumed = true
    const result = await service.sendCommand(command.request_key)
    assert.equal(result.state, 'accepted')
    assert.equal(result.auto_deploy_paused, action === 'pause')
    proof['policy_' + action] = result
    save()
    return result
  }
  progress('resume-policy')
  await policy('resume')
  policyResumed = true
  progress('disconnect-main-ssh')
  await ssh.disconnectAll()
  assert(!ssh.getVerifiedHostKey(1))
  proof.main_ssh_disconnected = true
  save()
  const marker = `r7d-${nonce}-auto`
  writeFileSync(join(source, 'public/release.txt'), marker + '\n')
  git(source, 'add', '--', 'public/release.txt')
  git(source, 'diff', '--cached', '--check')
  const message = join(directory, 'auto-commit.txt')
  writeFileSync(
    message,
    'test(demo): xác minh SPA tự deploy khi Main ngắt SSH (R7d)\n\nChỉ đổi marker của demo riêng; không gửi redeploy từ Desktop.\n\nCo-authored-by: Võ Thị Thiên Kim <Thienkim.dev@gmail.com>\n'
  )
  git(source, 'commit', '--file', message)
  const sha = git(source, 'rev-parse', 'HEAD')
  git(source, 'push', 'origin', `HEAD:refs/heads/${branch}`)
  assert.equal(git(source, 'ls-remote', '--heads', 'origin', branch).split(/\s/)[0], sha)
  proof.git = { branch, sha, parent_sha: previousSha, marker }
  progress('public-http-only-observer')
  const origin = `http://167.71.202.116:${app.host_port}`,
    until = Date.now() + 8 * 60000
  let polls = 0
  for (;;) {
    assert(!ssh.getVerifiedHostKey(1))
    polls++
    let actual
    try {
      const response = await fetch(origin + '/release.txt', {
        redirect: 'error',
        signal: AbortSignal.timeout(10000)
      })
      if (response.status === 200) actual = (await response.text()).trim()
    } catch {
      // HTTP có thể gián đoạn trong lúc activate; chỉ quan sát, không gửi redeploy.
    }
    if (actual === marker) break
    if (Date.now() > until) throw Error('AUTO_PUBLIC_MARKER_TIMEOUT')
    await delay(2000)
  }
  proof.http_only_polls = polls
  proof.ssh_was_closed_through_public_success = true
  proof.checks.push('public_git_commit_reaches_app_without_main_ssh_or_manual_redeploy')
  progress('verify-controller-job')
  let status
  const settledUntil = Date.now() + 120000
  for (;;) {
    status = await service.appStatus({ binding_id: binding, app_id: app.app_id })
    if (status.current_deployment_sha === sha && status.latest_job_state === 'succeeded') break
    if (Date.now() > settledUntil) throw Error('AUTO_JOB_NOT_SETTLED')
    await delay(1000)
  }
  proof.app_status = status
  const jobs = JSON.parse(
    await exec(
      `python3 - <<'PY'\nimport json,sqlite3\nc=sqlite3.connect('file:/var/lib/opspilot-controller/opspilot.db?mode=ro',uri=True);c.row_factory=sqlite3.Row\nprint(json.dumps([dict(r) for r in c.execute('SELECT job_id,trigger,target_sha,state FROM product_deploy_job WHERE app_id=? AND target_sha=?',(3,'${sha}'))]));c.close()\nPY`
    )
  )
  assert.equal(jobs.length, 1)
  assert.equal(jobs[0].trigger, 'branch_poll')
  assert.equal(jobs[0].state, 'succeeded')
  assert.equal(jobs[0].job_id, status.latest_job_id)
  proof.jobs = jobs
  const settlement = JSON.parse(
    await exec(
      `python3 - <<'PY'\nimport json,sqlite3\nc=sqlite3.connect('file:/var/lib/opspilot-controller/opspilot.db?mode=ro',uri=True);c.row_factory=sqlite3.Row\nj=c.execute('SELECT job_id FROM product_deploy_job WHERE app_id=? AND target_sha=?',(3,'${sha}')).fetchone()[0]\nterm=[dict(r) for r in c.execute('SELECT t.attempt_id,t.settled_at,t.leases_released_at FROM product_runtime_terminal t JOIN product_deploy_attempt a ON a.attempt_id=t.attempt_id WHERE a.job_id=?',(j,))]\nleases={t:c.execute('SELECT count(*) FROM '+t+' WHERE job_id=? AND released_at IS NULL',(j,)).fetchone()[0] for t in ('product_app_lease','product_worker_lease')}\nprint(json.dumps({'terminals':term,'unreleased_leases':leases}));c.close()\nPY`
    )
  )
  assert.equal(settlement.terminals.length, 1)
  assert(settlement.terminals[0].settled_at && settlement.terminals[0].leases_released_at)
  assert(Object.values(settlement.unreleased_leases).every((count) => count === 0))
  proof.settlement = settlement
  const home = await fetch(origin + '/', { signal: AbortSignal.timeout(10000) }),
    deep = await fetch(origin + '/books/current/reading', { signal: AbortSignal.timeout(10000) })
  assert.equal(home.status, 200)
  assert.equal(deep.status, 200)
  assert.equal(await home.text(), await deep.text())
  assert.equal(
    (await fetch(origin + '/assets/not-present.js', { signal: AbortSignal.timeout(10000) })).status,
    404
  )
  proof.exposure = await service.exposure({ binding_id: binding, app_id: 3 }, true)
  assert.equal(proof.exposure.state, 'recorded')
  assert.equal(proof.exposure.view.status, 'reachable')
  proof.checks.push(
    'exact_single_branch_poll_job_success_current_sha_deep_route_asset_404_and_recorded_exposure'
  )
  progress('pause-policy')
  await policy('pause')
  policyResumed = false
  assert.equal(await cids(), proof.old_cids)
  await service.revoke(binding)
  proof.temporary_client_revoked = true
  proof.after = await snapshot()
  assert.equal(proof.after.active_clients, 0)
  assert.equal(proof.after.active_jobs, 0)
  assert.equal(proof.after.active_experiments, 0)
  assert(proof.after.desired.every((row) => row.auto_paused === 1))
  for (const field of [
    'receipt_sha256',
    'upgrade_sha256',
    'database_inode',
    'schema',
    'vps_digest',
    'service'
  ])
    assert.deepEqual(proof.after[field], proof.before[field])
  assert.deepEqual(proof.after.files, proof.before.files)
  proof.checks.push(
    'pause_revoke_cleanup_preserve_old_apps_controller_pid_key_db_and_quiescent_state'
  )
  proof.status = 'PASS'
} catch (error) {
  proof.status = 'FAIL'
  proof.error_code = stable(error)
  proof.failure_location = /auto\.mjs:\d+:\d+/.exec(error?.stack ?? '')?.[0] ?? null
} finally {
  if (config) config.password = ''
  if (policyResumed) proof.policy_resume_requires_explicit_reconciliation = true
  await ssh?.disconnectAll()
  if (db?.open) db.close()
  if (proof.status === 'PASS') {
    assert.equal(dirname(local), directory)
    assert.equal(realpathSync(local), resolve(local))
    rmSync(local, { recursive: true })
    proof.private_db_removed = true
  } else proof.private_journal_retained = existsSync(join(local, 'opspilot.db'))
  save()
  console.log(
    JSON.stringify({
      status: proof.status,
      phase,
      record: nonce,
      checks: proof.checks.length,
      error_code: proof.error_code
    })
  )
  process.exit(proof.status === 'PASS' ? 0 : 1)
}
