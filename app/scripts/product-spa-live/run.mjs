/* eslint-disable @typescript-eslint/explicit-function-return-type -- Nghiệm thu development VPS qua Main thật. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomBytes, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync, realpathSync, rmSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { journalKey } from '../controller-upgrade-live/journal-key.mjs'
import { snapshotCommand } from '../controller-desktop-live/snapshot.mjs'
const next = process.argv.includes('--nextjs')
const args = process.argv.slice(2).filter((a) => a !== '--nextjs'),
  fresh =
    args.length === 1 &&
    args[0] === (next ? '--confirm-development-next-rollout' : '--confirm-development-spa-rollout'),
  resume = args.length === 2 && args[0] === '--resume' && /^[a-f0-9]{12}$/.test(args[1])
if (!fresh && !resume) {
  console.log('{"status":"REJECTED","code":"EXPLICIT_DEVELOPMENT_SPA_ROLLOUT_REQUIRED"}')
  process.exit(2)
}
const project = resolve(import.meta.dirname, '../..'),
  require = createRequire(join(project, 'package.json')),
  nonce = fresh ? randomBytes(6).toString('hex') : args[1],
  directory = join(
    project,
    next ? '.out-scripts/product-next-live' : '.out-scripts/product-spa-live',
    nonce
  ),
  local = join(directory, 'private-profile')
const framework = next ? 'nextjs' : 'static-spa',
  appPrefix = next ? 'next-live-' : 'spa-live-'
const pin = 'SHA256:0X8J5LfPr6iZqEspsD379FvFEWrLfYpN0wfNYjQ87+E',
  installation = '7573f0b1-4262-4305-8b7d-9a1edce49626',
  controller = 'dc586bb7-cd83-484c-b036-e5ad40ec106d'
let evidence,
  db,
  ssh,
  config,
  service,
  vault,
  binding,
  phase = 'input'
const save = () =>
  writeFileSync(
    join(directory, 'result.json'),
    JSON.stringify({ ...evidence, phase }, null, 2) + '\n'
  )
const progress = (next) => {
  phase = next
  save()
  console.log(JSON.stringify({ phase, record: nonce }))
}
const check = (name) => {
  if (!evidence.checks.includes(name)) evidence.checks.push(name)
  save()
}
const stable = (error) => {
  for (const value of [error?.context?.cause?.message, error?.code, error?.message])
    if (typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,90}$/.test(value)) return value
  return error?.name === 'AssertionError' ? 'ASSERTION_FAILED' : 'SPA_ROLLOUT_FAILED'
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms))
const fixture = (mode) =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [join(import.meta.dirname, 'git-fixture.mjs'), mode, nonce, ...(next ? ['--nextjs'] : [])],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 120000,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
  )
try {
  if (fresh) {
    let text = ''
    for await (const chunk of process.stdin) {
      text += chunk
      if (text.length > 32768) throw Error('INPUT_LIMIT')
    }
    config = JSON.parse(text)
    text = ''
    assert(
      config.host === '167.71.202.116' &&
        config.port === 22 &&
        config.username === 'root' &&
        config.host_fingerprint === pin &&
        typeof config.password === 'string' &&
        config.password
    )
    mkdirSync(local, { recursive: true })
    writeFileSync(join(directory, '.owner'), nonce, { flag: 'wx' })
    evidence = {
      status: 'RUNNING',
      framework,
      record: nonce,
      checks: [],
      production_profile_used: false,
      gui_tested: false,
      remote_mutation_attempted: false
    }
  } else {
    assert.equal(realpathSync(directory), resolve(directory))
    assert.equal(readFileSync(join(directory, '.owner'), 'utf8'), nonce)
    evidence = JSON.parse(readFileSync(join(directory, 'result.json'), 'utf8'))
    if (evidence.status === 'FAIL') {
      evidence.attempt_history ??= []
      evidence.attempt_history.push({
        status: evidence.status,
        phase: evidence.phase,
        error_code: evidence.error_code,
        upgrade_key: evidence.upgrade_key ?? null
      })
      delete evidence.error_code
      delete evidence.failure_location
    }
    evidence.status = 'RUNNING'
  }
  const native = JSON.parse(
    readFileSync(
      join(
        project,
        `.out-scripts/controller-upgrade-desktop/${next ? '2de81b4d2f97' : '3ed7123a6a6a'}/result.json`
      ),
      'utf8'
    )
  )
  assert.equal(native.status, 'PASS')
  assert(
    native.checks.includes(
      'historical_release_keeps_real_inspection_and_token_refresh_but_cannot_be_selected_for_new_upgrade'
    )
  )
  assert.equal(
    native.release_inputs.candidate,
    next
      ? 'b6803bc794cb39987936395d8d1f12cd06720a08f2e0ba2c3307ec619368ab45'
      : 'a81ed72cfe56e8ecbe09508711eabe8f8e8dd82e505d2fef2d681032e0d909da'
  )
  assert(
    native.fixture_root_removed && native.fixture_unit_removed && native.fixture_account_removed
  )
  if (next) {
    const retained = JSON.parse(
      readFileSync(
        join(project, '.out-scripts/controller-enrollment/ebca6d0b5be8/result.json'),
        'utf8'
      )
    )
    assert.equal(retained.status, 'PASS')
    assert.equal(retained.cleanup, true)
    assert.equal(
      retained.bundle_sha256,
      '2a444abc24115985f920d48bc7cf049bf376cc37ab386d1b7aa4e2d5b620ac95'
    )
  }
  const verifier = require(join(project, 'out/main/controllerResourceVerifier.js'))
  verifier.verifyPackagedControllerResources(join(project, 'resources/controller-releases'))
  const esbuild = createRequire(require.resolve('vite/package.json'))('esbuild')
  const mainArtifact = join(directory, fresh ? 'entry.cjs' : 'entry-resumed.cjs')
  await esbuild.build({
    entryPoints: [join(import.meta.dirname, 'entry.ts')],
    outfile: mainArtifact,
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
  evidence.main_artifact_sha256 = createHash('sha256')
    .update(readFileSync(mainArtifact))
    .digest('hex')
  const code = require(mainArtifact),
    key = journalKey(local, fresh),
    cipher = new code.AesGcmCredentialCipher(key)
  key.fill(0)
  db = code.initializeDatabase(local)
  const profiles = new code.VpsRepository(db)
  if (fresh) {
    profiles.create({
      name: (next ? 'Next rollout ' : 'SPA rollout ') + nonce,
      host: config.host,
      port: 22,
      username: 'root',
      auth_type: 'password',
      host_fingerprint: pin,
      credential: cipher.encrypt(config.password)
    })
    config.password = ''
  }
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
    ),
    releases = resources.entries(),
    candidate = releases.find(
      (r) =>
        r.release_id ===
        (next ? 'linux-x64-node22-20261113-next' : 'linux-x64-node22-20261113-spa-retained')
    )
  assert(candidate)
  service = new code.DesktopControllerService(db, cipher, ssh, undefined, releases, resources)
  vault = new code.DesktopControllerVault(db, cipher)
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
  const oldCids = async () => {
    const lines = (
      await exec(
        "docker inspect --format '{{.Id}}' san-nha-live-app san-nha-live-collector desktop-live-69eeeb78-app desktop-live-69eeeb78-collector" +
          (next ? ' spa-live-6ab247675f19-app spa-live-6ab247675f19-collector' : '')
      )
    )
      .trim()
      .split('\n')
    assert.equal(lines.length, next ? 6 : 4)
    assert(lines.every((line) => /^[a-f0-9]{64}$/.test(line)))
    return lines
  }
  progress('readonly-preflight')
  const before = await snapshot()
  assert.equal(before.receipt.controller_id, controller)
  assert.equal(before.receipt.request_key, installation)
  assert.equal(before.schema, 29)
  assert.equal(before.active_jobs, 0)
  assert.equal(before.active_experiments, 0)
  if (next) assert.equal(before.active_clients, 0)
  assert(before.desired.every((r) => r.auto_paused === 1))
  evidence.before ??= before
  evidence.old_container_ids ??= await oldCids()
  save()
  assert.deepEqual(await oldCids(), evidence.old_container_ids)
  check('fresh_pinned_ssh_quiescent_controller_and_existing_healthy_containers')
  progress('adopt-current')
  if (!(await service.listInstallations()).length) {
    const review = await service.reviewControllerAdoption({ vps_id: 1 })
    assert.equal(review.controller_id, controller)
    await service.confirmControllerAdoption({ plan_id: review.plan_id, consent: true })
  }
  const intent = {
    installation_request_key: installation,
    display_name: (next ? 'Next rollout ' : 'SPA rollout ') + nonce,
    allow_write: true
  }
  let connection = (await service.list()).find((v) => v.state === 'active')
  if (!connection) {
    const prepared = await service.prepareInstalledRegistration(intent)
    evidence.remote_mutation_attempted = true
    save()
    connection = await service.registerInstalled({ ...intent, binding_id: prepared.binding_id })
  }
  binding = connection.binding_id
  const tokenBefore = vault.resolve(binding).accessToken,
    clientBefore = vault.get(binding).remote_client_id
  progress('prepare-upgrade')
  let upgraded
  if (!evidence.upgrade_key) {
    const review = await service.reviewUpgrade({
      installation_request_key: installation,
      release_id: candidate.release_id
    })
    upgraded = await service.prepareUpgrade({ plan_id: review.plan_id })
    evidence.upgrade_key = upgraded.request_key
    save()
  } else upgraded = await service.inspectUpgrade(evidence.upgrade_key)
  if (upgraded.state === 'prepared')
    await service.sendUpgrade({
      request_key: upgraded.request_key,
      operation: 'transfer',
      consent: true
    })
  upgraded = await service.inspectUpgrade(evidence.upgrade_key)
  if (!evidence.upgrade_attempted) {
    evidence.upgrade_attempted = true
    save()
    progress('upgrade')
    await service.sendUpgrade({
      request_key: evidence.upgrade_key,
      operation: 'upgrade',
      consent: true
    })
  }
  upgraded = await service.inspectUpgrade(evidence.upgrade_key)
  evidence.upgrade = upgraded
  save()
  assert.equal(upgraded.state, 'active')
  assert.equal(upgraded.is_current, true)
  assert.equal(upgraded.last_result.service_state, 'running')
  assert.equal(upgraded.release_sha256, candidate.release_sha256)
  evidence.upgrade = upgraded
  const refresh = await service.reviewUpgradeBinding({
    binding_id: binding,
    request_key: evidence.upgrade_key
  })
  await service.refreshUpgradeBinding({ plan_id: refresh.plan_id, consent: true })
  assert.equal(vault.resolve(binding).accessToken, tokenBefore)
  assert.equal(vault.get(binding).remote_client_id, clientBefore)
  const after = await snapshot()
  for (const field of ['receipt_sha256', 'database_inode', 'schema', 'vps_digest'])
    assert.deepEqual(after[field], evidence.before[field])
  assert.deepEqual(after.files, evidence.before.files)
  assert.deepEqual(await oldCids(), evidence.old_container_ids)
  evidence.after_upgrade = after
  check('trusted_asset_upgrade_preserves_uuid_uid_key_db_old_apps_and_scoped_client')
  progress('public-git-initial')
  const gitRoot = join(
    project,
    next ? '.out-scripts/product-next-git' : '.out-scripts/product-spa-git',
    nonce
  )
  const gitRecord = (mode) => JSON.parse(readFileSync(join(gitRoot, mode + '.json'), 'utf8'))
  const initial = existsSync(join(gitRoot, 'initial.json'))
    ? gitRecord('initial')
    : fixture('initial')
  evidence.git ??= {}
  evidence.git.initial = initial
  save()
  let projectSetup = (await service.listProjects(binding)).find(
    (p) => p.app_name === appPrefix + nonce
  )
  if (!projectSetup) {
    const targets = await service.projectTargets({ binding_id: binding })
    const target = targets.items.find(
      (t) => t.host === '167.71.202.116' && t.host_fingerprint === pin
    )
    assert(target)
    projectSetup = await service.prepareProject({
      binding_id: binding,
      target_vps_id: target.id,
      app_name: appPrefix + nonce,
      framework,
      repository_url: initial.repository_url,
      production_ref: initial.branch,
      repository_root: '.',
      host_port: null,
      container_port: next ? 3000 : 80,
      healthcheck_path: '/'
    })
    projectSetup = await service.sendProject(projectSetup.request_key)
  }
  assert.equal(projectSetup.state, 'registered')
  assert.equal(projectSetup.framework, framework)
  evidence.project = projectSetup
  save()
  const source = await service.verifyProjectSource(projectSetup.request_key)
  assert.equal(source.framework, framework)
  const currentPublished = ['final', 'fault', 'update', 'initial'].find((mode) =>
    existsSync(join(gitRoot, mode + '.json'))
  )
  assert.equal(source.commit_sha, gitRecord(currentPublished).sha)
  let target = await service.projectTargetState(projectSetup.request_key)
  if (target.state !== 'enrolled')
    target = await service.enrollProjectTarget({
      request_key: projectSetup.request_key,
      target_root: '/var/lib/opspilot-product'
    })
  assert.equal(target.state, 'enrolled')
  const waitJob = async (id, wanted) => {
    const until = Date.now() + 8 * 60000
    for (;;) {
      const status = await service.appStatus({ binding_id: binding, app_id: projectSetup.app_id })
      if (
        status.latest_job_id === id &&
        ['succeeded', 'failed', 'rolled_back', 'uncertain'].includes(status.latest_job_state)
      ) {
        assert.equal(status.latest_job_state, wanted)
        return status
      }
      if (Date.now() > until) throw Error('SPA_JOB_TIMEOUT')
      await delay(2500)
    }
  }
  const verifyWeb = async (mode) => {
    const origin = `http://167.71.202.116:${projectSetup.host_port}`,
      get = (path) =>
        fetch(origin + path, { redirect: 'error', signal: AbortSignal.timeout(10000) }),
      home = await get('/')
    assert.equal(home.status, 200)
    const html = await home.text(),
      deep = await get('/books/current/reading')
    assert.equal(deep.status, 200)
    if (next) {
      const expected = `r7f-${nonce}-${mode}`
      assert(html.includes(expected))
      assert((await deep.text()).includes(expected))
      const asset = html.match(/src="([^"]+\.js)"/)?.[1]
      assert(asset?.startsWith('/_next/'))
      assert.equal((await get(asset)).status, 200)
      assert.equal((await get('/_next/static/not-present.js')).status, 404)
    } else {
      assert.equal(await deep.text(), html)
      assert.equal((await get('/assets/not-present.js')).status, 404)
    }
    const marker = await get('/release.txt')
    assert.equal(marker.status, 200)
    assert.equal((await marker.text()).trim(), `${next ? 'r7f' : 'r7c'}-${nonce}-${mode}`)
    return { url: origin, deep_route: true, missing_asset_404: true, marker: mode }
  }
  const dispatch = async (sha, first = false, mode) => {
    if (first) {
      const readiness = await service.projectReadiness(projectSetup.request_key)
      assert.equal(readiness.state, 'ready')
      const plan = await service.prepareFirstDeployment({
        request_key: projectSetup.request_key,
        readiness_id: readiness.readiness_id
      })
      assert.equal(plan.source_sha, sha)
      evidence.pending_deploy = { mode, key: plan.command.request_key }
      save()
      return service.sendFirstDeployment({
        request_key: projectSetup.request_key,
        readiness_id: readiness.readiness_id,
        command_key: plan.command.request_key
      })
    }
    const status = await service.appStatus({ binding_id: binding, app_id: projectSetup.app_id }),
      prepared = await service.prepareCommand({
        binding_id: binding,
        app_id: projectSetup.app_id,
        expected_ownership_generation: status.ownership_generation,
        expected_source_generation: status.source_generation,
        operation: 'redeploy',
        target: { kind: 'current_desired' }
      })
    evidence.pending_deploy = { mode, key: prepared.request_key }
    save()
    return service.sendCommand(prepared.request_key)
  }
  const doDeploy = async (mode, first = false) => {
    if (evidence.deployments?.[mode]) return evidence.deployments[mode]
    const record = existsSync(join(gitRoot, mode + '.json')) ? gitRecord(mode) : fixture(mode)
    evidence.git[mode] = record
    save()
    if (!first) {
      const verified = await service.verifyProjectSource(projectSetup.request_key)
      assert.equal(verified.commit_sha, record.sha)
    }
    const pending = evidence.pending_deploy
    let command
    if (pending) {
      assert.equal(pending.mode, mode)
      command = await service.checkCommand(pending.key)
    } else {
      command = await dispatch(record.sha, first, mode)
      evidence.pending_deploy = { mode, key: command.request_key }
      save()
    }
    assert.equal(command.state, 'accepted')
    assert.equal(command.target_sha, record.sha)
    const status = await waitJob(command.job_id, mode === 'fault' ? 'rolled_back' : 'succeeded')
    if (mode !== 'fault') assert.equal(status.current_deployment_sha, record.sha)
    const web = await verifyWeb(mode === 'fault' ? 'update' : mode)
    const exposure = await service.exposure(
      { binding_id: binding, app_id: projectSetup.app_id },
      true
    )
    assert.equal(exposure.state, 'recorded')
    assert.equal(exposure.view.status, 'reachable')
    evidence.deployments ??= {}
    evidence.deployments[mode] = { status, web, exposure, command_key: command.request_key }
    delete evidence.pending_deploy
    save()
    return evidence.deployments[mode]
  }
  progress((next ? 'next-' : 'spa-') + 'first-deployment')
  await doDeploy('initial', true)
  check(
    next
      ? 'public_git_next_source_enrollment_preflight_full_pipeline_ssr_assets_and_404'
      : 'public_git_spa_source_enrollment_preflight_full_pipeline_http_deep_route_and_404'
  )
  progress((next ? 'next-' : 'spa-') + 'source-update')
  const update = await doDeploy('update')
  const cidBefore = (
    await exec(
      `docker inspect --format '{{.Id}}' ${projectSetup.app_name}-app ${projectSetup.app_name}-collector`
    )
  ).trim()
  evidence.spa_previous_cids = cidBefore
  save()
  check(
    next
      ? 'new_public_git_commit_updates_next_and_collector'
      : 'new_public_git_commit_updates_spa_and_collector'
  )
  progress((next ? 'next-' : 'spa-') + 'unhealthy-update')
  const failed = await doDeploy('fault')
  assert.equal(failed.status.current_deployment_id, update.status.current_deployment_id)
  assert.equal(
    (
      await exec(
        `docker inspect --format '{{.Id}}' ${projectSetup.app_name}-app ${projectSetup.app_name}-collector`
      )
    ).trim(),
    evidence.spa_previous_cids
  )
  check(
    next
      ? 'public_git_ssr503_rolls_back_exact_app_and_collector_cids'
      : 'unreadable_public_git_artifact_rolls_back_exact_app_and_collector_cids'
  )
  progress((next ? 'next-' : 'spa-') + 'final-healthy')
  await doDeploy('final')
  check('public_branch_restored_healthy_final_deployment')
  assert.deepEqual(await oldCids(), evidence.old_container_ids)
  progress('revoke-and-final-check')
  await service.revoke(binding)
  evidence.temporary_client_revoked = true
  const final = await snapshot()
  assert.equal(final.active_clients, evidence.before.active_clients)
  assert.equal(final.active_jobs, 0)
  assert.equal(final.active_experiments, 0)
  assert(final.desired.every((row) => row.auto_paused === 1))
  if (next) {
    assert.deepEqual(
      final.apps.filter((a) => a.id <= 3),
      evidence.before.apps
    )
    for (const field of [
      'receipt_sha256',
      'database_inode',
      'schema',
      'vps_digest',
      'files',
      'service'
    ])
      assert.deepEqual(final[field], evidence.after_upgrade[field])
  }
  evidence.after = final
  check('temporary_client_revoked_old_apps_unchanged_all_jobs_settled_policies_paused')
  evidence.status = 'PASS'
} catch (error) {
  evidence ??= { status: 'FAIL', record: nonce, checks: [] }
  evidence.status = 'FAIL'
  evidence.error_code = stable(error)
  evidence.failure_location = /run\.mjs:\d+:\d+/.exec(error?.stack ?? '')?.[0] ?? null
} finally {
  if (config) config.password = ''
  await ssh?.disconnectAll()
  if (db?.open) db.close()
  if (evidence.status === 'PASS') {
    assert.equal(dirname(local), directory)
    assert.equal(realpathSync(local), resolve(local))
    rmSync(local, { recursive: true })
    evidence.private_db_removed = true
  } else evidence.private_journal_retained = existsSync(join(local, 'opspilot.db'))
  if (existsSync(directory)) save()
  console.log(
    JSON.stringify({
      status: evidence.status,
      phase,
      record: nonce,
      checks: evidence.checks.length,
      error_code: evidence.error_code
    })
  )
  process.exit(evidence.status === 'PASS' ? 0 : 1)
}
