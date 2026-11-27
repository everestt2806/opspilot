/* eslint-disable @typescript-eslint/explicit-function-return-type -- Explicit live Electron proof. */
import assert from 'node:assert/strict'
import { app, BrowserWindow, ipcMain } from 'electron'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { journalKey } from '../controller-upgrade-live/journal-key.mjs'
import { snapshotCommand } from './snapshot.mjs'

const [nonce, mode] = process.argv.slice(2)
if (
  !/^[a-f0-9]{16}$/.test(nonce ?? '') ||
  !['--onboard', '--deploy'].includes(mode) ||
  process.argv.length !== 4
) {
  console.log('{"status":"REJECTED","error_code":"EXISTING_PRIVATE_LIVE_PROFILE_REQUIRED"}')
  app.exit(2)
}
const project = resolve(import.meta.dirname, '../..'),
  directory = join(project, '.out-scripts/controller-desktop-live', nonce),
  local = join(directory, 'private-profile'),
  require = createRequire(join(project, 'package.json')),
  captures = join(project, '../docs/ui-redesign/screenshots/r3c6h4c3b2', nonce),
  appName = 'desktop-live-' + nonce.slice(0, 8),
  proof = {
    status: 'RUNNING',
    mode,
    record: nonce,
    checks: [],
    captures: [],
    actual_ssh_transport: true,
    production_desktop_profile_used: false,
    temporary_client_revoked: false,
    private_db_removed: false
  },
  errors = [],
  calls = []
let window,
  db,
  ssh,
  service,
  vault,
  code,
  binding,
  stage = 'start'
const stable = (error) => {
  const value = error?.context?.cause?.message ?? error?.code ?? error?.message
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,80}$/.test(value)
    ? value
    : 'LIVE_DESKTOP_GATE_FAILED'
}
const save = () =>
  writeFileSync(
    join(directory, mode === '--onboard' ? 'onboarding.json' : 'result.json'),
    JSON.stringify({ ...proof, stage, calls, renderer_errors: errors }, null, 2) + '\n'
  )
const progress = (next) => {
  stage = next
  save()
  console.log(JSON.stringify({ record: nonce, stage }))
}
const watchdog = setTimeout(
  () => {
    proof.status = 'FAIL'
    proof.error_code = 'LIVE_UI_TIMEOUT'
    save()
    app.exit(2)
  },
  15 * 60 * 1000
)
assert.equal(realpathSync(directory), resolve(directory))
assert.equal(readFileSync(join(directory, '.owner'), 'utf8'), nonce)
assert(existsSync(join(local, 'opspilot.db')))
app.setPath('userData', join(directory, 'electron-profile'))
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('force-device-scale-factor', '1')

app.whenReady().then(async () => {
  try {
    code = require(join(directory, 'entry.cjs'))
    const key = journalKey(local, false),
      cipher = new code.AesGcmCredentialCipher(key)
    key.fill(0)
    db = code.initializeDatabase(local)
    const repository = new code.VpsRepository(db)
    const checkedVps = repository.getById(1)
    assert.equal(checkedVps.host, '167.71.202.116')
    assert.equal(checkedVps.port, 22)
    assert.equal(checkedVps.username, 'root')
    assert.equal(checkedVps.host_fingerprint, 'SHA256:0X8J5LfPr6iZqEspsD379FvFEWrLfYpN0wfNYjQ87+E')
    ssh = new code.SshManager((id) => {
      const v = repository.getById(id)
      return {
        host: v.host,
        port: v.port,
        username: v.username,
        authType: v.auth_type,
        hostFingerprint: v.host_fingerprint,
        secret: code.loadSecret(db, cipher, id)
      }
    })
    const verifier = require(join(project, 'out/main/controllerResourceVerifier.js'))
    verifier.verifyPackagedControllerResources(join(project, 'resources/controller-releases'))
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
    vault = new code.DesktopControllerVault(db, cipher)
    const baseline = JSON.parse(readFileSync(join(directory, 'preflight.json'), 'utf8')).before
    const snapshot = async () => {
      const r = await ssh.exec(1, snapshotCommand, {
        logCommand: false,
        retryOnReconnect: false,
        timeoutMs: 20000,
        maxStdoutBytes: 65536,
        maxStderrBytes: 1024
      })
      assert.equal(r.code, 0)
      return JSON.parse(r.stdout)
    }
    const preserved = (value) => {
      for (const key of [
        'receipt_sha256',
        'upgrade_sha256',
        'database_inode',
        'vps_digest',
        'service'
      ])
        assert.deepEqual(value[key], baseline[key], 'PRESERVATION_' + key)
      assert.deepEqual(value.files, baseline.files)
      assert.equal(value.apps.find((a) => a.id === 1).current_deployment_id, 4)
      assert.equal(value.deployment.git_commit_sha, baseline.deployment.git_commit_sha)
      assert.equal(value.deployment.status, 'running')
      assert.equal(value.desired.find((v) => v.app_id === 1).auto_paused, 1)
      assert.equal(value.active_jobs, 0)
      assert.equal(value.active_experiments, 0)
    }
    const methods = {
      'controller:installer-overview': 'installerOverview',
      'controller:review-installation': 'reviewInstaller',
      'controller:review-adoption': 'reviewControllerAdoption',
      'controller:confirm-adoption': 'confirmControllerAdoption',
      'controller:inspect-installation': 'inspectInstallation',
      'controller:prepare-installed-binding': 'prepareInstalledRegistration',
      'controller:register-installed': 'registerInstalled',
      'controller:apps': 'apps',
      'controller:app-status': 'appStatus',
      'controller:projects': 'listProjects',
      'controller:project-targets': 'projectTargets',
      'controller:prepare-project': 'prepareProject',
      'controller:send-project': 'sendProject',
      'controller:verify-project-source': 'verifyProjectSource',
      'controller:project-target-state': 'projectTargetState',
      'controller:enroll-project-target': 'enrollProjectTarget',
      'controller:project-readiness': 'projectReadiness',
      'controller:commands': 'listCommands',
      'controller:prepare-first-deployment': 'prepareFirstDeployment',
      'controller:send-first-deployment': 'sendFirstDeployment',
      'controller:check-command': 'checkCommand',
      'controller:cancel-command': 'cancelCommand'
    }
    ipcMain.handle('vps:list', () => ({ ok: true, data: repository.list() }))
    for (const [channel, method] of Object.entries(methods))
      ipcMain.handle(channel, async (_event, input) => {
        const receipt = { channel, completed: false }
        calls.push(receipt)
        try {
          const data = await service[method](input)
          receipt.ok = true
          return { ok: true, data }
        } catch (error) {
          receipt.error_code = stable(error)
          return {
            ok: false,
            error: {
              code: error.code ?? 'UNKNOWN',
              message: 'Không hoàn tất thao tác.',
              technical: stable(error)
            }
          }
        } finally {
          receipt.completed = true
          save()
        }
      })
    progress('real-electron-renderer')
    const esbuild = createRequire(require.resolve('vite/package.json'))('esbuild')
    mkdirSync(captures, { recursive: true })
    await esbuild.build({
      stdin: {
        contents: `import React from 'react';import{createRoot}from'react-dom/client';import{App,ConfigProvider}from'antd';import{ControllerInstallWizard}from'./src/renderer/src/components/ControllerInstallWizard';import{ControllerProjectPanel}from'./src/renderer/src/components/ControllerProjectPanel';import{useUiState}from'./src/renderer/src/store/uiState';import{themeTokens,applyTheme}from'./src/renderer/src/utils/themeTokens';import'./src/renderer/src/assets/main.css';useUiState.setState({locale:'vi',theme:'dark'});applyTheme('dark');const root=createRoot(document.getElementById('root'));function show(content){root.render(<ConfigProvider theme={themeTokens.dark}><App><main style={{padding:24}}><h1>OpsPilot</h1>{content}</main></App></ConfigProvider>)}window.showInstaller=()=>show(<ControllerInstallWizard open onClose={()=>show(null)} onChanged={()=>{}}/>);window.showProjects=async()=>{const r=await window.api.invoke('controller:list');if(!r.ok)throw Error('NO_CONNECTION');const b=r.data.find(b=>b.state==='active');if(!b)throw Error('NO_ACTIVE_CONNECTION');show(<ControllerProjectPanel binding={b}/>)};`,
        resolveDir: project,
        sourcefile: 'desktop-live.jsx',
        loader: 'jsx'
      },
      outfile: join(directory, 'renderer.js'),
      bundle: true,
      platform: 'browser',
      format: 'iife',
      define: { 'process.env.NODE_ENV': '"production"' },
      loader: { '.png': 'file', '.woff2': 'file' },
      tsconfig: join(project, 'tsconfig.web.json')
    })
    ipcMain.handle('controller:list', async () => ({ ok: true, data: await service.list() }))
    writeFileSync(
      join(directory, 'index.html'),
      '<!doctype html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="renderer.css"></head><body><div id="root"></div><script src="renderer.js"></script></body></html>'
    )
    window = new BrowserWindow({
      width: 1280,
      height: 800,
      show: false,
      webPreferences: {
        preload: join(project, 'out/preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    })
    window.webContents.on('render-process-gone', () => errors.push('RENDER_PROCESS_GONE'))
    window.webContents.on('console-message', (event) => {
      if (event.level === 'error') errors.push('RENDERER_ERROR')
    })
    await window.loadFile(join(directory, 'index.html'))
    window.showInactive()
    const js = (source) => window.webContents.executeJavaScript(source, true)
    const wait = async (condition, timeout = 120000) => {
      const until = Date.now() + timeout
      while (!(await js(condition))) {
        if (Date.now() > until) throw Error('UI_WAIT_TIMEOUT')
        await new Promise((done) => setTimeout(done, 100))
      }
    }
    const click = async (text) => {
      const expr = `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`
      await wait(`!!(${expr})`)
      await js(`(${expr}).scrollIntoView({block:'nearest'});(${expr}).click()`)
    }
    const capture = async (name) => {
      for (const [width, height] of [
        [1280, 800],
        [1366, 768]
      ]) {
        window.setContentSize(width, height)
        await new Promise((done) => setTimeout(done, 200))
        const layout = await js(
          '({window:document.documentElement.scrollWidth>document.documentElement.clientWidth,modal:[...document.querySelectorAll(".ant-modal-body")].some(e=>e.scrollWidth>e.clientWidth+1)})'
        )
        assert.deepEqual(layout, { window: false, modal: false })
        const file = join(captures, `${name}-${width}x${height}.png`)
        writeFileSync(file, (await window.webContents.capturePage()).toPNG())
        proof.captures.push({
          file: file.slice(resolve(project, '..').length + 1).replaceAll('\\', '/'),
          layout
        })
      }
    }
    const field = async (id, value) =>
      js(
        `{const e=document.getElementById(${JSON.stringify(id)});if(!e)throw Error('MISSING_FORM_FIELD');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));e.dispatchEvent(new FocusEvent('blur',{bubbles:true}));}`
      )
    if (mode === '--onboard') {
      progress('live-ui-cold-adoption')
      assert.equal(db.prepare('SELECT count(*) n FROM desktop_controller_installation').get().n, 0)
      await js('window.showInstaller()')
      await click('Kiểm tra VPS')
      await wait('document.body.textContent.includes("Đã xác minh controller hiện hành")')
      assert.equal(db.prepare('SELECT count(*) n FROM desktop_controller_installation').get().n, 0)
      await capture('cold-adoption-review')
      await js('document.querySelector("input[type=checkbox]").click()')
      await click('Nhận lại controller')
      await wait('document.body.textContent.includes("Đã nhận lại controller.")')
      assert.equal(db.prepare('SELECT count(*) n FROM desktop_controller_binding').get().n, 0)
      await js('document.querySelectorAll("input[type=checkbox]")[0].click()')
      await js('document.querySelectorAll("input[type=checkbox]")[1].click()')
      await capture('separate-api-consent')
      progress('live-ui-api-enrollment')
      await click('Lưu kết nối')
      await wait('document.body.textContent.includes("Đã lưu kết nối controller.")')
      const connections = await service.list()
      binding = connections.find((v) => v.state === 'active').binding_id
      const remote = await service.apps({ binding_id: binding })
      assert.equal(remote.data_freshness, 'current')
      assert(remote.items.some((v) => v.app_id === 1 && v.app_name === 'san-nha-live'))
      const installation = (await service.installerOverview()).installations[0]
      assert.equal(
        installation.current_revision.request_key,
        '37a115d5-71c6-4b87-bacb-6375a64c0c65'
      )
      proof.binding = {
        binding_id: binding,
        remote_client_id: vault.get(binding).remote_client_id,
        token_sha256: createHash('sha256').update(vault.resolve(binding).accessToken).digest('hex')
      }
      proof.installation = {
        request_key: installation.request_key,
        current_revision: installation.current_revision.request_key,
        controller_id: installation.controller_id
      }
      preserved(await snapshot())
      proof.checks.push(
        'actual_electron_preload_ui_main_pinned_ssh_cold_adoption_separate_write_consent_and_canonical_existing_app_read'
      )
      await capture('live-controller-connected')
      proof.status = 'PASS'
    } else {
      progress('cold-electron-reconnect')
      const retained = JSON.parse(readFileSync(join(directory, 'onboarding.json'), 'utf8'))
      assert.equal(retained.status, 'PASS')
      binding = retained.binding.binding_id
      assert.equal(vault.get(binding).remote_client_id, retained.binding.remote_client_id)
      assert.equal(
        createHash('sha256').update(vault.resolve(binding).accessToken).digest('hex'),
        retained.binding.token_sha256
      )
      await js('window.showInstaller()')
      await click('Kiểm tra kết quả')
      await wait(
        'document.body.textContent.includes("Đang chạy")&&!document.querySelector(".ant-spin-spinning")'
      )
      assert((await service.apps({ binding_id: binding })).items.some((v) => v.app_id === 1))
      proof.checks.push(
        'separate_cold_electron_process_dpapi_reopen_keeps_uuid_token_client_and_reads_existing_canonical_app'
      )
      await capture('cold-reconnected-controller')
      await js('window.showProjects()')
      await wait('document.body.textContent.includes("Tạo dự án")')
      let setup = (await service.listProjects(binding)).find((v) => v.app_name === appName)
      if (!setup) {
        progress('live-ui-project-registration')
        await click('Tạo dự án')
        await wait('!!document.getElementById("target_vps_id")')
        await js(
          'document.getElementById("target_vps_id").dispatchEvent(new MouseEvent("mousedown",{bubbles:true}))'
        )
        await wait('!!document.querySelector(".ant-select-item-option")')
        await js('document.querySelector(".ant-select-item-option").click()')
        for (const [id, value] of Object.entries({
          app_name: appName,
          repository_url: 'https://github.com/everestt2806/opspilot.git',
          production_ref: 'demo/r3c6h3-20261110',
          repository_root: 'demo-apps/san-nha-booking',
          host_port: 30001
        }))
          await field(id, value)
        await click('Xem lại cấu hình')
        await capture('project-registration-review')
        await click('Đăng ký dự án')
        await wait('document.body.textContent.includes("Đã đăng ký dự án")')
        setup = (await service.listProjects(binding)).find((v) => v.app_name === appName)
      }
      assert.equal(setup.state, 'registered')
      assert(setup.app_id !== 1)
      proof.project = setup
      progress('live-ui-source-and-target')
      await click('Kiểm tra source')
      await click('Xác minh source')
      await wait('document.body.textContent.includes("Đã xác minh source tại thời điểm kiểm tra.")')
      await capture('source-verified')
      await click('Đóng')
      await click('Chuẩn bị target')
      await wait('!!document.querySelector(".controller-target-modal input")')
      // Existing verified per-app helper namespace is shared by design, app ownership stays separate.
      const inputId = await js('document.querySelector(".controller-target-modal input").id')
      if (inputId) await field(inputId, '/var/lib/opspilot-product')
      else
        await js(
          `{const e=document.querySelector('.controller-target-modal input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'/var/lib/opspilot-product');e.dispatchEvent(new Event('input',{bubbles:true}));}`
        )
      await click('Xem lại')
      const previous = await service.projectTargetState(setup.request_key)
      await click(
        previous.state === 'enrolled' || previous.state === 'unknown'
          ? 'Xác minh cấu hình cũ'
          : 'Xác nhận chuẩn bị'
      )
      await wait('document.body.textContent.includes("Đã lưu xác nhận target")')
      await capture('target-enrolled')
      await click('Đóng')
      proof.checks.push(
        'actual_project_registration_source_verification_and_target_enrollment_through_product_ui_ipc_main_root_admin'
      )
      progress('live-ui-first-deployment')
      await click('Triển khai đầu tiên')
      await wait(
        '!!Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="Kiểm tra điều kiện"||b.textContent.trim()==="Cập nhật trạng thái")'
      )
      const pending = (await service.listCommands(binding)).find(
        (v) => v.app_id === setup.app_id && v.require_first_deployment && v.state !== 'cancelled'
      )
      if (!pending) {
        await click('Kiểm tra điều kiện')
        await wait('document.body.textContent.includes("Đủ điều kiện để xem lại")')
        await click('Xem lại triển khai')
        await capture('first-deployment-review')
        await click('Xác nhận triển khai')
      }
      const until = Date.now() + 8 * 60 * 1000
      for (;;) {
        await click('Cập nhật trạng thái')
        await new Promise((done) => setTimeout(done, 1000))
        const state = await service.appStatus({ binding_id: binding, app_id: setup.app_id })
        if (
          state.latest_job_state === 'succeeded' &&
          state.current_deployment_state === 'running'
        ) {
          proof.app_status = state
          break
        }
        if (['failed', 'rolled_back'].includes(state.latest_job_state))
          throw Error('LIVE_FIRST_DEPLOYMENT_FAILED')
        if (Date.now() > until) throw Error('LIVE_FIRST_DEPLOYMENT_TIMEOUT')
        await new Promise((done) => setTimeout(done, 2500))
      }
      await click('Cập nhật trạng thái')
      await wait(
        'document.body.textContent.includes("Bản triển khai đã chạy và vượt qua kiểm tra sức khỏe.")'
      )
      await capture('first-deployment-healthy')
      const command = (await service.listCommands(binding)).find(
        (v) => v.app_id === setup.app_id && v.require_first_deployment
      )
      assert.equal(command.target_sha, 'bfed8941e2a719b04fa960142b7c3df0eed66b57')
      proof.command = command
      proof.checks.push(
        'actual_product_first_deployment_review_send_and_status_ui_runs_exact_git_sha_in_owned_new_app'
      )
      progress('public-health-exposure-and-preservation')
      const publicUrl = 'http://167.71.202.116:30001'
      const response = await fetch(publicUrl + '/health', {
        redirect: 'error',
        signal: AbortSignal.timeout(10000)
      })
      assert.equal(response.status, 200)
      const exposure = await service.exposure({ binding_id: binding, app_id: setup.app_id }, true)
      assert.equal(exposure.view.observation.status, 'reachable')
      const current = await service.exposure({ binding_id: binding, app_id: setup.app_id })
      assert.equal(
        current.view.observation.observation_id,
        exposure.view.observation.observation_id
      )
      proof.exposure = current
      proof.public_url = publicUrl
      const after = await snapshot()
      preserved(after)
      assert.equal(after.desired.find((v) => v.app_id === setup.app_id).auto_paused, 1)
      proof.checks.push(
        'independent_windows_public_http200_and_authenticated_exposure_persistence_preserve_original_demo_pid_key_db_and_paused_policies'
      )
      progress('revoke-client-and-final-snapshot')
      await service.revoke(binding)
      proof.temporary_client_revoked = true
      proof.after = await snapshot()
      preserved(proof.after)
      assert.equal(proof.after.active_clients, 0)
      proof.demo_application_retained = true
      proof.checks.push(
        'temporary_api_client_revoked_owned_healthy_demo_retained_and_encrypted_private_profile_ready_for_cleanup'
      )
      assert.equal(errors.length, 0)
      proof.status = 'PASS'
    }
  } catch (error) {
    if (window && !window.isDestroyed()) {
      try {
        writeFileSync(
          join(directory, 'failure.png'),
          (await window.webContents.capturePage()).toPNG()
        )
      } catch {
        /* Keep public failure codes only. */
      }
    }
    proof.status = 'FAIL'
    proof.error_code = stable(error)
    proof.failure_location = /electron\.mjs:\d+:\d+/.exec(error?.stack ?? '')?.[0] ?? 'unknown'
  } finally {
    window?.destroy()
    await ssh?.disconnectAll()
    if (db?.open) db.close()
    save()
    clearTimeout(watchdog)
    console.log(
      JSON.stringify({
        status: proof.status,
        stage,
        record: nonce,
        mode,
        checks: proof.checks.length,
        error_code: proof.error_code
      })
    )
    app.exit(proof.status === 'PASS' ? 0 : 1)
  }
})
