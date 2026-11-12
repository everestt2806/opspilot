/* eslint-disable @typescript-eslint/explicit-function-return-type -- Lab full application Windows, không sửa product runtime. */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { connect, pause, until } from './windows-release-lab/cdp.mjs'

if (
  process.platform !== 'win32' ||
  !process.version.startsWith('v22.') ||
  ![5, 7].includes(process.argv.length) ||
  process.argv[2] !== '--run' ||
  process.argv[3] !== '--artifact' ||
  (process.argv.length === 7 && process.argv[5] !== '--reinstall')
) {
  console.log('{"status":"REJECTED","error":"EXPLICIT_WINDOWS_NODE22_ARTIFACT_REQUIRED"}')
  process.exit(2)
}
const project = resolve(import.meta.dirname, '..'),
  require = createRequire(import.meta.url)
const artifact = realpathSync(resolve(process.argv[4]))
assert(artifact.startsWith(join(project, '.out-scripts') + sep))
assert.equal(lstatSync(artifact).isSymbolicLink(), false)
const installer = process.argv.length === 7 ? realpathSync(process.argv[6]) : null
let filename = 'OpsPilot.exe'
if (installer) {
  const plan = JSON.parse(readFileSync(join(dirname(installer), 'plan.json'), 'utf8'))
  assert.equal(dirname(dirname(artifact)), dirname(installer))
  assert.equal(readFileSync(join(dirname(installer), '.owner'), 'utf8'), plan.nonce)
  assert.equal(plan.installation_directory, artifact)
  assert.equal(plan.executable_name, 'OpsPilotReleaseLab' + plan.nonce + '.exe')
  filename = plan.executable_name
}
const executable = join(artifact, filename),
  resources = join(artifact, 'resources')
assert(existsSync(executable) && existsSync(join(resources, 'app.asar')))
require(join(project, 'out/main/mlResourceVerifier.js')).verifyPackagedMlResources(resources)
const nonce = randomBytes(6).toString('hex')
const directory = join(project, '.out-scripts/windows-release-lab', nonce)
const profile = join(directory, 'Dữ liệu riêng'),
  home = join(directory, 'home')
for (const path of [directory, profile, home]) mkdirSync(path, { recursive: true })
writeFileSync(join(directory, '.owner'), nonce, { flag: 'wx' })
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
const system = process.env.SystemRoot ?? 'C:\\Windows'
const environment = {
  SystemRoot: system,
  WINDIR: system,
  PATH: join(system, 'System32'),
  TEMP: process.env.TEMP,
  TMP: process.env.TMP,
  APPDATA: process.env.APPDATA,
  LOCALAPPDATA: process.env.LOCALAPPDATA,
  USERPROFILE: home,
  PYTHONHOME: join(directory, 'forbidden-python'),
  PYTHONPATH: join(directory, 'forbidden-site')
}
const proof = {
  status: 'FAIL',
  checks: [],
  artifact_sha256: { exe: hash(executable), asar: hash(join(resources, 'app.asar')) },
  production_database_used: false,
  full_application: true,
  mocked_services: false,
  clean_windows: false,
  synthetic_ml_delivery_test: true
}
let child, cdp, mlPid, port
async function launch() {
  const server = createServer()
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const debugPort = server.address().port
  await new Promise((done) => server.close(done))
  child = spawn(
    executable,
    [
      '--user-data-dir=' + profile,
      '--remote-debugging-port=' + debugPort,
      '--remote-debugging-address=127.0.0.1'
    ],
    { cwd: directory, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  const log = []
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      if (log.reduce((n, b) => n + b.length, 0) < 65536) log.push(chunk)
    })
  const ownedChild = child
  child.once('close', () =>
    writeFileSync(join(directory, `process-${ownedChild.pid}.log`), Buffer.concat(log))
  )
  const page = await until(async () => {
    assert(child.exitCode === null, 'APP_EXITED_DURING_STARTUP')
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`)
      return (await response.json()).find((p) => p.type === 'page' && p.url.startsWith('file:'))
    } catch {
      return false
    }
  }, 'PACKAGED_WINDOW_NOT_READY')
  cdp = await connect(page.webSocketDebuggerUrl)
  await until(
    () => cdp.evaluate('!!window.api && !!document.querySelector(".app-shell")'),
    'FULL_APP_NOT_RENDERED'
  )
  await until(async () => {
    const status = await cdp.evaluate('window.api.invoke("system:ml-status")')
    return status?.ok && status.data.running
  }, 'PACKAGED_ML_NOT_READY')
  const ps = `$owned = @(Get-CimInstance Win32_Process -Filter 'ParentProcessId=${child.pid}' | Where-Object { $_.ExecutablePath -eq '${join(resources, 'ml-runtime/python.exe').replaceAll("'", "''")}' }); $owned | ForEach-Object { $ownedPid=$_.ProcessId; Get-NetTCPConnection -State Listen -OwningProcess $ownedPid -ErrorAction SilentlyContinue | Select-Object @{n='pid';e={$ownedPid}},LocalAddress,LocalPort } | ConvertTo-Json -Compress`
  const result = spawnSync(
    join(system, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-Command', ps],
    { windowsHide: true, encoding: 'utf8', timeout: 15000 }
  )
  assert.equal(result.status, 0, 'ML_PROCESS_INSPECTION_FAILED')
  const listener = JSON.parse(result.stdout)
  assert(
    !Array.isArray(listener) &&
      listener.LocalAddress === '127.0.0.1' &&
      [8765, 8766, 8767].includes(listener.LocalPort)
  )
  mlPid = listener.pid
  port = listener.LocalPort
}
async function stop() {
  const owned = child
  void cdp.evaluate('window.api.invoke("window:close"); true').catch(() => {})
  await until(() => owned.exitCode !== null, 'APP_SHUTDOWN_TIMEOUT', 30000)
  cdp.close()
  cdp = null
  await until(
    () => {
      try {
        process.kill(mlPid, 0)
        return false
      } catch {
        return true
      }
    },
    'ORPHAN_ML_PROCESS',
    10000
  )
  await assert.rejects(
    fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) })
  )
}
async function api(route, input) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: input ? 'POST' : 'GET',
    headers: input ? { 'content-type': 'application/json' } : undefined,
    body: input ? JSON.stringify(input) : undefined,
    signal: AbortSignal.timeout(30000)
  })
  assert.equal(response.status, 200)
  return response.json()
}
try {
  await launch()
  for (const channel of ['vps:list', 'app:list']) {
    const response = await cdp.evaluate(`window.api.invoke(${JSON.stringify(channel)})`)
    assert.deepEqual(response, { ok: true, data: [] })
  }
  assert(
    existsSync(join(profile, 'opspilot.db')) &&
      existsSync(join(profile, 'credential-master-key.protected'))
  )
  proof.checks.push('full_packaged_main_preload_app_sqlite_safeStorage_and_bundled_ml_first_launch')
  for (const [index, key] of ['dashboard', 'apps', 'vps', 'activity', 'settings'].entries()) {
    await cdp.evaluate(`document.querySelectorAll('.app-sidebar-item')[${index}].click()`)
    await until(
      () =>
        cdp.evaluate(
          `document.querySelector('.content')?.dataset.pageKey===${JSON.stringify(key)}`
        ),
      'NAVIGATION_NOT_READY'
    )
    assert(await cdp.evaluate('!!document.querySelector("main").innerText.trim()'))
  }
  await cdp.evaluate(
    `Array.from(document.querySelectorAll('.ant-segmented-item')).find(e=>e.textContent.trim()==='English').click()`
  )
  await until(
    () =>
      cdp.evaluate(
        `document.querySelector('#setting-locale-title')?.textContent==='Display Language'`
      ),
    'LOCALE_NOT_CHANGED'
  )
  await cdp.evaluate(
    `Array.from(document.querySelectorAll('.ant-segmented-item')).find(e=>e.textContent.trim()==='Light').click()`
  )
  const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(directory, 'settings.png'), Buffer.from(screenshot.data, 'base64'))
  proof.checks.push('all_five_full_application_pages_and_real_settings_language_theme_interactions')
  const deployment = 900002,
    samples = Array.from({ length: 180 }, (_, i) => ({
      ts: new Date(Date.UTC(2026, 10, 12) + i * 10000).toISOString(),
      seq: i,
      cpu_pct: 25 + 3 * Math.sin(i / 7),
      mem_mb: 150 + 5 * Math.cos(i / 9),
      latency_ms: 35 + 2 * Math.sin(i / 5),
      http_error_rate: 0.001 + (i % 3) * 0.0001,
      db_response_ms: 5 + Math.cos(i / 4),
      container_up: 1
    }))
  proof.training = await api('/train', { deployment_id: deployment, samples })
  assert(proof.training.trained && proof.training.train_sample_count === 180)
  const prediction = await api('/ingest', {
    deployment_id: deployment,
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
  const model = join(profile, `ml-state/${deployment}/state.pkl`),
    modelHash = hash(model)
  assert(!existsSync(join(resources, 'ml-runtime/service/state')))
  proof.checks.push('full_app_owned_bundled_python_real_train180_and_four_scores_outside_resources')
  await stop()
  const dbHash = hash(join(profile, 'opspilot.db')),
    keyHash = hash(join(profile, 'credential-master-key.protected'))
  if (installer) {
    const repair = spawnSync(installer, ['/S', '/D=' + artifact], {
      windowsHide: true,
      cwd: directory,
      timeout: 180000
    })
    assert.equal(repair.status, 0, 'NSIS_REINSTALL_FAILED')
    assert.equal(hash(join(profile, 'opspilot.db')), dbHash)
    assert.equal(hash(join(profile, 'credential-master-key.protected')), keyHash)
    assert.equal(hash(model), modelHash)
    proof.checks.push('same_version_nsis_reinstall_preserves_separate_sqlite_key_and_model_fixture')
  }
  const sql = spawnSync(
    join(resources, 'ml-runtime/python.exe'),
    [
      '-I',
      '-B',
      '-c',
      'import json,sqlite3,sys; c=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True); print(json.dumps({"version":c.execute("SELECT max(version) FROM schema_version").fetchone()[0],"integrity":c.execute("PRAGMA integrity_check").fetchone()[0]})); c.close()',
      join(profile, 'opspilot.db')
    ],
    { cwd: directory, env: environment, encoding: 'utf8', timeout: 15000 }
  )
  assert.equal(sql.status, 0, 'SQLITE_READONLY_INSPECTION_FAILED')
  proof.sqlite = JSON.parse(sql.stdout)
  assert.deepEqual(proof.sqlite, { version: 31, integrity: 'ok' })
  await launch()
  const restored = await api(`/status?deployment_id=${deployment}`)
  assert(restored.trained && restored.trained_at === proof.training.trained_at)
  assert.equal(hash(model), modelHash)
  const ui = await cdp.evaluate('JSON.parse(localStorage.getItem("opspilot-ui-session"))')
  assert.equal(ui.state.locale, 'en')
  assert.equal(ui.state.theme, 'light')
  assert(await cdp.evaluate('document.querySelector(".content").dataset.pageKey==="settings"'))
  await stop()
  assert.equal(hash(join(profile, 'opspilot.db')), dbHash)
  assert.equal(hash(join(profile, 'credential-master-key.protected')), keyHash)
  assert.equal(hash(model), modelHash)
  proof.checks.push(
    'cold_full_app_reopen_preserves_sqlite_key_models_ui_settings_and_both_exits_reap_ml'
  )
  require(join(project, 'out/main/mlResourceVerifier.js')).verifyPackagedMlResources(resources)
  assert.equal(hash(executable), proof.artifact_sha256.exe)
  assert.equal(hash(join(resources, 'app.asar')), proof.artifact_sha256.asar)
  proof.checks.push('full_application_and_ml_resource_hashes_unchanged_after_two_launches')
  if (installer) {
    const uninstallers = readdirSync(artifact).filter((name) => /^Uninstall .+\.exe$/i.test(name))
    assert.equal(uninstallers.length, 1)
    const uninstaller = join(artifact, uninstallers[0])
    assert(existsSync(uninstaller))
    const removal = spawnSync(uninstaller, ['/S', '_?=' + artifact], {
      windowsHide: true,
      cwd: directory,
      timeout: 180000
    })
    assert.equal(removal.status, 0, 'NSIS_UNINSTALL_FAILED')
    await until(() => !existsSync(executable), 'NSIS_APP_NOT_REMOVED', 30000)
    assert.equal(hash(join(profile, 'opspilot.db')), dbHash)
    assert.equal(hash(join(profile, 'credential-master-key.protected')), keyHash)
    assert.equal(hash(model), modelHash)
    proof.checks.push(
      'unique_fixture_nsis_uninstall_removes_executable_and_preserves_separate_user_data'
    )
  }
  assert.equal(realpathSync(directory), resolve(directory))
  assert.equal(readFileSync(join(directory, '.owner'), 'utf8'), nonce)
  for (const path of [profile, home]) {
    assert.equal(dirname(path), directory)
    assert(!lstatSync(path).isSymbolicLink())
    rmSync(path, { recursive: true, maxRetries: 10, retryDelay: 100 })
  }
  proof.private_fixture_removed = true
  proof.status = 'PASS'
} catch (error) {
  proof.error = String(error.message).slice(0, 300)
  if (cdp) {
    void cdp.evaluate('window.api.invoke("window:close"); true').catch(() => {})
    await pause(1000)
    cdp.close()
  }
  if (child && child.exitCode === null)
    spawnSync(join(system, 'System32/taskkill.exe'), ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
      timeout: 10000
    })
  proof.private_fixture_retained_for_diagnostics = true
}
await pause(200)
writeFileSync(join(directory, 'result.json'), JSON.stringify(proof, null, 2) + '\n')
console.log(
  JSON.stringify({
    status: proof.status,
    checks: proof.checks.length,
    record: nonce,
    error: proof.error
  })
)
process.exitCode = proof.status === 'PASS' ? 0 : 1
