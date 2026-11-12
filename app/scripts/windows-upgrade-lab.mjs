/* eslint-disable @typescript-eslint/explicit-function-return-type -- Hai payload source/version riêng, NSIS namespace riêng. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { openUpgradeApp } from './windows-release-lab/upgrade-app.mjs'
import { until, pause } from './windows-release-lab/cdp.mjs'

if (
  process.platform !== 'win32' ||
  !process.version.startsWith('v22.') ||
  !(
    (process.argv.length === 7 &&
      process.argv[2] === '--build' &&
      process.argv[3] === '--old' &&
      process.argv[5] === '--new') ||
    (process.argv.length === 5 &&
      ['--run', '--resume'].includes(process.argv[2]) &&
      process.argv[3] === '--record')
  )
) {
  console.log('{"status":"REJECTED","error":"EXPLICIT_WINDOWS_UPGRADE_LAB_REQUIRED"}')
  process.exit(2)
}
const project = resolve(import.meta.dirname, '..'),
  require = createRequire(import.meta.url)
const base = join(project, '.out-scripts/windows-upgrade-lab'),
  system = process.env.SystemRoot ?? 'C:\\Windows'
const ps = join(system, 'System32/WindowsPowerShell/v1.0/powershell.exe')
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
function copy(source, target) {
  const stat = lstatSync(source)
  assert(!stat.isSymbolicLink())
  if (stat.isDirectory()) {
    mkdirSync(target, { recursive: true })
    for (const n of readdirSync(source)) copy(join(source, n), join(target, n))
  } else {
    assert(stat.isFile())
    copyFileSync(source, target)
  }
}
function registry(guid) {
  assert(/^[a-f0-9-]{36}$/.test(guid))
  const result = spawnSync(
    ps,
    [
      '-NoProfile',
      '-Command',
      `$paths=@('HKCU:\\Software\\${guid}','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${guid}'); @($paths | Where-Object { Test-Path -LiteralPath $_ }) | ConvertTo-Json -Compress`
    ],
    { windowsHide: true, encoding: 'utf8', timeout: 15000 }
  )
  assert.equal(result.status, 0)
  return result.stdout.trim() ? JSON.parse(result.stdout) : []
}
function record(nonce) {
  assert(/^[a-f0-9]{12}$/.test(nonce))
  const directory = join(base, nonce)
  assert.equal(realpathSync(directory), resolve(directory))
  assert.equal(dirname(directory), base)
  assert.equal(readFileSync(join(directory, '.owner'), 'utf8'), nonce)
  return directory
}

if (process.argv[2] === '--build') {
  const artifacts = [realpathSync(resolve(process.argv[4])), realpathSync(resolve(process.argv[6]))]
  for (const p of artifacts) assert(p.startsWith(join(project, '.out-scripts') + sep))
  const baseline = JSON.parse(readFileSync(resolve(artifacts[0], '../../result.json'), 'utf8'))
  const policy = JSON.parse(readFileSync(join(project, 'resources/legacy-ml-policy.json'), 'utf8'))
  assert.equal(baseline.status, 'PASS')
  assert.equal(baseline.source_commit, policy.source_commit)
  const nonce = randomBytes(6).toString('hex'),
    directory = join(base, nonce),
    guid = randomUUID(),
    exeName = 'OpsPilotUpgradeLab' + nonce
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, '.owner'), nonce, { flag: 'wx' })
  assert.deepEqual(registry(guid), [])
  const profile = join(directory, 'Dữ liệu người dùng'),
    installation = join(directory, 'install/OpsPilot')
  mkdirSync(profile, { recursive: true })
  mkdirSync(join(directory, 'home'))
  const include = join(directory, 'upgrade.nsh')
  writeFileSync(
    include,
    `!define OPSPILOT_UPGRADE_PROFILE "${profile}"\n!include "${join(project, 'resources/installer.nsh')}"\n`
  )
  const emptyInclude = join(directory, 'old.nsh')
  writeFileSync(emptyInclude, '; Historical installer had no model migration hook.\n')
  const plan = {
    nonce,
    guid,
    profile,
    installation,
    executable_name: exeName + '.exe',
    source_commit: baseline.source_commit,
    policy_sha256: hash(join(project, 'resources/legacy-ml-policy.json')),
    helper_sha256: hash(join(project, 'scripts/legacy-ml-upgrade.ps1')),
    include_sha256: hash(join(project, 'resources/installer.nsh')),
    payloads: []
  }
  for (const [index, artifact] of artifacts.entries()) {
    const version = index === 0 ? '0.1.0' : '0.2.0',
      label = index === 0 ? 'old' : 'new',
      staged = join(directory, label + '-prepackaged')
    copy(artifact, staged)
    renameSync(join(staged, 'OpsPilot.exe'), join(staged, exeName + '.exe'))
    const builder = createRequire(require.resolve('electron-builder/package.json')),
      lib = createRequire(builder.resolve('app-builder-lib/package.json')),
      asar = lib('@electron/asar')
    const pkg = JSON.parse(
      asar.extractFile(join(staged, 'resources/app.asar'), 'package.json').toString('utf8')
    )
    assert.equal(pkg.version, version)
    const config = {
      extends: join(project, 'electron-builder.yml'),
      appId: 'vn.opspilot.upgrade-lab.' + nonce,
      productName: 'OpsPilot Upgrade Lab ' + nonce,
      extraMetadata: { version },
      directories: { output: directory },
      win: { executableName: exeName },
      nsis: {
        guid,
        artifactName: label + '-setup.exe',
        include: index === 0 ? emptyInclude : include,
        runAfterFinish: false,
        perMachine: false,
        allowElevation: false,
        createDesktopShortcut: false,
        createStartMenuShortcut: false,
        deleteAppDataOnUninstall: false
      }
    }
    const configuration = join(directory, label + '.json')
    writeFileSync(configuration, JSON.stringify(config, null, 2) + '\n')
    const cli = join(dirname(require.resolve('electron-builder/package.json')), 'cli.js')
    const build = spawnSync(
      process.execPath,
      [
        cli,
        '--win',
        'nsis',
        '--x64',
        '--publish',
        'never',
        '--prepackaged',
        staged,
        '--config',
        configuration
      ],
      { cwd: project, windowsHide: true, stdio: 'inherit', timeout: 600000 }
    )
    assert.equal(build.status, 0, 'NSIS_BUILD_FAILED')
    plan.payloads.push({
      version,
      artifact,
      exe: hash(join(artifact, 'OpsPilot.exe')),
      asar: hash(join(artifact, 'resources/app.asar')),
      installer: join(directory, label + '-setup.exe'),
      installer_sha256: hash(join(directory, label + '-setup.exe')),
      config_sha256: hash(configuration)
    })
    writeFileSync(join(directory, 'plan.json'), JSON.stringify(plan, null, 2) + '\n')
  }
  assert.notEqual(plan.payloads[0].asar, plan.payloads[1].asar)
  record(nonce)
  console.log(
    JSON.stringify({
      status: 'PASS',
      mode: 'BUILD',
      record: nonce,
      versions: plan.payloads.map((p) => p.version)
    })
  )
} else {
  const nonce = process.argv[4],
    directory = record(nonce),
    plan = JSON.parse(readFileSync(join(directory, 'plan.json'), 'utf8'))
  assert.equal(plan.nonce, nonce)
  assert.equal(plan.profile, join(directory, 'Dữ liệu người dùng'))
  assert.equal(plan.installation, join(directory, 'install/OpsPilot'))
  assert.equal(plan.executable_name, 'OpsPilotUpgradeLab' + nonce + '.exe')
  for (const [i, item] of plan.payloads.entries()) {
    assert.equal(item.installer, join(directory, (i === 0 ? 'old' : 'new') + '-setup.exe'))
    assert.equal(hash(item.installer), item.installer_sha256)
  }
  assert.equal(plan.helper_sha256, hash(join(project, 'scripts/legacy-ml-upgrade.ps1')))
  assert.equal(plan.policy_sha256, hash(join(project, 'resources/legacy-ml-policy.json')))
  assert.equal(plan.include_sha256, hash(join(project, 'resources/installer.nsh')))
  const resuming = process.argv[2] === '--resume'
  if (resuming) {
    const previous = JSON.parse(readFileSync(join(directory, 'result.json'), 'utf8'))
    assert.equal(previous.status, 'FAIL')
    assert.equal(previous.error, 'FULL_APP_ML_NOT_READY')
    assert.equal(previous.checks.length, 0)
    assert.equal(hash(join(plan.installation, 'resources/app.asar')), plan.payloads[0].asar)
    assert(!existsSync(join(plan.profile, 'ml-state')))
    assert(!existsSync(join(plan.installation, 'resources/ml-service/state/900004')))
    assert(registry(plan.guid).length > 0)
    assert(!existsSync(join(directory, 'failed-first-launch.json')))
    copyFileSync(join(directory, 'result.json'), join(directory, 'failed-first-launch.json'))
  } else {
    assert(!existsSync(join(directory, 'result.json')), 'UPGRADE_RECORD_ALREADY_EXECUTED')
    assert.deepEqual(registry(plan.guid), [])
    assert(!existsSync(plan.installation))
  }
  const proof = {
    status: 'FAIL',
    checks: [],
    versions: plan.payloads.map((p) => p.version),
    source_commit: plan.source_commit,
    clean_windows: false,
    actual_full_applications: true,
    production_database_used: false,
    production_installer_identity_used: false,
    same_approved_dependencies: true
  }
  let application
  try {
    const install = (item) => {
      const result = spawnSync(item.installer, ['/S', '/D=' + plan.installation], {
        cwd: directory,
        windowsHide: true,
        timeout: 180000
      })
      return result.status
    }
    if (!resuming) assert.equal(install(plan.payloads[0]), 0, 'OLD_INSTALL_FAILED')
    const exe = join(plan.installation, plan.executable_name),
      legacy = join(plan.installation, 'resources/ml-service/state/900004')
    assert.equal(hash(join(plan.installation, 'resources/app.asar')), plan.payloads[0].asar)
    application = await openUpgradeApp(exe, plan.profile, directory, system)
    assert.deepEqual(await application.cdp.evaluate('window.api.invoke("vps:list")'), {
      ok: true,
      data: []
    })
    const samples = Array.from({ length: 180 }, (_, i) => ({
      ts: new Date(Date.UTC(2026, 10, 12) + i * 10000).toISOString(),
      seq: i,
      cpu_pct: 25 + 3 * Math.sin(i / 7),
      mem_mb: 150 + 5 * Math.cos(i / 9),
      latency_ms: 35 + 2 * Math.sin(i / 5),
      http_error_rate: 0.001 + (i % 3) * 0.0001,
      db_response_ms: 5 + Math.cos(i / 4),
      container_up: 1
    }))
    proof.training = await application.api('/train', { deployment_id: 900004, samples })
    assert(proof.training.trained)
    await application.cdp.evaluate(`localStorage.setItem('upgrade-fixture','R11C_KEEP_THIS_VALUE')`)
    await application.close()
    application = null
    assert(existsSync(join(legacy, 'state.pkl')))
    assert(!existsSync(join(plan.profile, 'ml-state')))
    const seed = spawnSync(
      join(plan.payloads[1].artifact, 'resources/ml-runtime/python.exe'),
      [
        '-I',
        '-B',
        '-c',
        'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute("INSERT INTO action_log(action,status,message) VALUES (?,?,?)", ("config_change","success","R11C_UPGRADE_NOTE")); c.commit(); c.close()',
        join(plan.profile, 'opspilot.db')
      ],
      { cwd: directory, windowsHide: true, encoding: 'utf8', timeout: 15000 }
    )
    assert.equal(seed.status, 0, 'PRIVATE_HISTORY_FIXTURE_FAILED')
    const model = hash(join(legacy, 'state.pkl')),
      meta = hash(join(legacy, 'meta.json')),
      database = hash(join(plan.profile, 'opspilot.db')),
      key = hash(join(plan.profile, 'credential-master-key.protected'))
    proof.checks.push(
      'trusted_git_predecessor_full_0_1_app_real_train180_writes_legacy_resource_state_and_profile'
    )
    const originalMeta = readFileSync(join(legacy, 'meta.json'))
    renameSync(join(legacy, 'meta.json'), join(legacy, 'meta.absent'))
    assert.equal(install(plan.payloads[1]), 2, 'INCOMPLETE_LEGACY_STATE_DID_NOT_BLOCK_INSTALLER')
    assert.equal(hash(join(plan.installation, 'resources/app.asar')), plan.payloads[0].asar)
    assert.equal(hash(join(legacy, 'state.pkl')), model)
    assert(!existsSync(join(plan.profile, 'ml-state')))
    renameSync(join(legacy, 'meta.absent'), join(legacy, 'meta.json'))
    assert.equal(hash(join(legacy, 'meta.json')), meta)
    assert.deepEqual(readFileSync(join(legacy, 'meta.json')), originalMeta)
    proof.checks.push('actual_new_nsis_aborts_before_old_uninstall_when_legacy_state_is_incomplete')
    assert.equal(install(plan.payloads[1]), 0, 'NEW_UPGRADE_FAILED')
    assert.equal(hash(join(plan.installation, 'resources/app.asar')), plan.payloads[1].asar)
    assert.equal(hash(join(plan.installation, plan.executable_name)), plan.payloads[1].exe)
    const migrated = join(plan.profile, 'ml-state/900004')
    assert.equal(hash(join(migrated, 'state.pkl')), model)
    assert.equal(hash(join(migrated, 'meta.json')), meta)
    assert.equal(hash(join(plan.profile, 'opspilot.db')), database)
    assert.equal(hash(join(plan.profile, 'credential-master-key.protected')), key)
    proof.checks.push(
      'actual_nsis_0_1_to_0_2_preserves_model_bytes_before_old_uninstall_and_replaces_payload'
    )
    application = await openUpgradeApp(exe, plan.profile, directory, system)
    const restored = await application.api('/status?deployment_id=900004')
    assert(restored.trained && restored.trained_at === proof.training.trained_at)
    assert.equal(hash(join(migrated, 'state.pkl')), model)
    assert.equal(
      await application.cdp.evaluate('localStorage.getItem("upgrade-fixture")'),
      'R11C_KEEP_THIS_VALUE'
    )
    await application.cdp.evaluate("document.querySelectorAll('.app-sidebar-item')[3].click()")
    await until(
      () =>
        application.cdp.evaluate(
          "document.querySelector('main').innerText.includes('R11C_UPGRADE_NOTE')"
        ),
      'PRESERVED_HISTORY_NOT_VISIBLE'
    )
    const prediction = await application.api('/ingest', {
      deployment_id: 900004,
      sample: {
        ...samples[179],
        seq: 180,
        ts: new Date(Date.UTC(2026, 10, 12) + 1800000).toISOString(),
        cpu_pct: 95,
        latency_ms: 1800
      }
    })
    for (const method of ['zscore_ewma', 'iforest', 'ocsvm', 'ensemble'])
      assert(Number.isFinite(prediction.scores[method]))
    const screen = await application.cdp.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(directory, 'upgraded.png'), Buffer.from(screen.data, 'base64'))
    await application.close()
    application = null
    assert.equal(hash(join(plan.profile, 'opspilot.db')), database)
    assert.equal(hash(join(plan.profile, 'credential-master-key.protected')), key)
    proof.checks.push(
      'actual_new_full_application_restores_same_trained_at_and_models_then_returns_four_real_scores'
    )
    const uninstaller = readdirSync(plan.installation).find((n) => /^Uninstall .+\.exe$/i.test(n))
    assert(uninstaller)
    const uninstall = spawnSync(join(plan.installation, uninstaller), ['/S'], {
      cwd: directory,
      windowsHide: true,
      timeout: 60000
    })
    assert.equal(uninstall.status, 0, 'UNINSTALL_LAUNCH_FAILED')
    await until(
      () => !existsSync(plan.installation) && registry(plan.guid).length === 0,
      'ORDINARY_UNINSTALL_NOT_FINISHED',
      60000
    )
    assert.equal(hash(join(plan.profile, 'opspilot.db')), database)
    assert.equal(hash(join(plan.profile, 'credential-master-key.protected')), key)
    assert(existsSync(join(migrated, 'state.pkl')))
    proof.checks.push(
      'ordinary_async_nsis_uninstall_self_removes_whole_fixture_folder_and_registry_preserving_profile'
    )
    for (const p of [plan.profile, join(directory, 'home')]) {
      assert.equal(dirname(p), directory)
      assert(!lstatSync(p).isSymbolicLink())
      rmSync(p, { recursive: true, maxRetries: 10, retryDelay: 100 })
    }
    proof.private_fixture_removed = true
    proof.status = 'PASS'
  } catch (error) {
    proof.error = String(error.message).slice(0, 300)
    if (application) {
      try {
        await application.close()
      } catch {
        proof.application_cleanup_failed = true
      }
    }
    proof.private_fixture_retained = true
  }
  await pause(200)
  writeFileSync(join(directory, 'result.json'), JSON.stringify(proof, null, 2) + '\n')
  console.log(
    JSON.stringify({
      status: proof.status,
      record: nonce,
      checks: proof.checks.length,
      error: proof.error
    })
  )
  process.exitCode = proof.status === 'PASS' ? 0 : 1
}
