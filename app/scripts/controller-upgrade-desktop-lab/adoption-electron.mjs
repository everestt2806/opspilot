/* eslint-disable @typescript-eslint/explicit-function-return-type -- Private Electron/Main/SQLite feature proof. */
import assert from 'node:assert/strict'
import { app, BrowserWindow, ipcMain } from 'electron'
import { createRequire } from 'node:module'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
const root = resolve(import.meta.dirname, '../../..'),
  require = createRequire(join(root, 'app/package.json')),
  esbuild = createRequire(require.resolve('vite/package.json'))('esbuild'),
  nonce = randomBytes(6).toString('hex'),
  directory = join(root, 'app/.out-scripts/controller-adoption-electron', nonce),
  privateData = join(directory, 'private'),
  screenshots = join(root, 'docs/ui-redesign/screenshots/r3c6h4c3b1')
mkdirSync(privateData, { recursive: true })
mkdirSync(screenshots, { recursive: true })
app.setPath('userData', join(directory, 'profile'))
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('force-device-scale-factor', '1')
const checks = [],
  calls = [],
  errors = [],
  captures = []
const proof = {
  status: 'FAIL',
  scope: 'REAL_ELECTRON_PRODUCTION_PRELOAD_UI_MAIN_JOURNAL_VAULT_PRIVATE_SQLITE_SYNTHETIC_SSH',
  checks,
  captures,
  production_profile_used: false,
  actual_ssh_transport: false,
  private_data_removed: false
}
let database,
  window,
  code,
  service,
  stage = 'start'
const raw = {
  name: 'raw',
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, (args) => ({
      path: resolve(args.resolveDir, args.path.slice(0, -4)),
      namespace: 'raw'
    }))
    build.onLoad({ filter: /.*/, namespace: 'raw' }, (args) => ({
      contents: readFileSync(args.path, 'utf8'),
      loader: 'text'
    }))
  }
}
const watchdog = setTimeout(() => app.exit(2), 180000)
app.whenReady().then(async () => {
  try {
    await esbuild.build({
      entryPoints: [join(import.meta.dirname, 'entry.ts')],
      outfile: join(directory, 'entry.cjs'),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      packages: 'external',
      plugins: [raw]
    })
    code = require(join(directory, 'entry.cjs'))
    database = code.initializeDatabase(privateData)
    const cipher = new code.AesGcmCredentialCipher(randomBytes(32)),
      vps = new code.VpsRepository(database)
    vps.create({
      name: 'Private UI fixture',
      host: 'fixture.test',
      port: 22,
      username: 'root',
      auth_type: 'key',
      host_fingerprint: 'SHA256:' + 'A'.repeat(43),
      credential: cipher.encrypt(randomBytes(32).toString('base64url'))
    })
    const originalDescriptor = JSON.parse(
      readFileSync(join(root, 'app/resources/controller-releases/catalog.json'), 'utf8')
    ).releases[0]
    const upgradeDescriptor = JSON.parse(
      readFileSync(join(root, 'app/control-plane-runtime/desktop-upgrade-release.json'), 'utf8')
    )
    const resources = new code.ControllerInstallerResources(
      { format: 1, releases: [originalDescriptor, upgradeDescriptor] },
      join(root, 'app/resources/controller-releases')
    )
    const catalog = resources.entries(),
      original = catalog.find((r) => r.release_id === originalDescriptor.release_id)
    const ik = randomUUID(),
      cid = randomUUID(),
      serverRoot = '/opt/opspilot-controller'
    const oldResult = {
      format: 1,
      request_key: ik,
      phase: 'installed',
      controller_id: cid,
      service_state: 'running',
      runtime_uid: 997,
      service_enabled: true,
      artifact_path: serverRoot + '/runtime/payload/control-plane.cjs',
      node_path: serverRoot + '/runtime/node',
      data_directory: '/var/lib/opspilot-controller',
      payload_sha256: JSON.parse(
        readFileSync(join(original.release_directory, 'release-manifest.json'), 'utf8')
      ).payload_sha256
    }

    const uk = randomUUID(),
      target = catalog.find((r) => r.release_id === upgradeDescriptor.release_id)
    const result = {
      format: 1,
      request_key: uk,
      installation_request_key: ik,
      controller_id: cid,
      parent_upgrade_key: null,
      parent_release_sha256: original.release_sha256,
      release_sha256: target.release_sha256,
      payload_sha256: JSON.parse(
        readFileSync(join(target.release_directory, 'release-manifest.json'), 'utf8')
      ).payload_sha256,
      runtime_release_sha256: target.release_sha256,
      runtime_payload_sha256: JSON.parse(
        readFileSync(join(target.release_directory, 'release-manifest.json'), 'utf8')
      ).payload_sha256,
      runtime_upgrade_key: uk,
      phase: 'active',
      is_current: true,
      service_state: 'running',
      runtime_uid: 997,
      artifact_path: `${serverRoot}/revisions/${uk}/runtime/payload/control-plane.cjs`,
      node_path: `${serverRoot}/revisions/${uk}/runtime/node`,
      data_directory: oldResult.data_directory
    }
    const discovery = async (input) => {
      input.assertCurrent()
      return {
        state: 'current_revision',
        original: {
          request_key: ik,
          release_sha256: original.release_sha256,
          installer_sha256: original.installer_sha256,
          installation: { ...oldResult, service_state: 'stopped' }
        },
        upgrade: {
          request_key: uk,
          installation_request_key: ik,
          controller_id: cid,
          parent_upgrade_key: null,
          parent_release_sha256: original.release_sha256,
          release_sha256: target.release_sha256,
          installer_sha256: target.installer_sha256
        },
        original_receipt_sha256: '1'.repeat(64),
        current_journal_sha256: '2'.repeat(64)
      }
    }
    const transport = {
      upgrade: async (input) => {
        assert.equal(input.request.operation, 'inspect-upgrade')
        input.assertCurrent()
        return structuredClone(result)
      },
      call: async (input) => {
        assert.equal(input.operation, 'status')
        input.assertCurrent()
        return { state: 'verified', ...input.locator, completed_files: 1, total_files: 1 }
      },
      transfer: async () => {
        throw Error('NO_MUTATION')
      }
    }
    const ssh = {
      openProductBootstrapChannel: async () => {
        throw Error('NO_REAL_SSH_IN_UI_LAB')
      }
    }
    const vault = new code.DesktopControllerVault(database, cipher)
    service = new code.DesktopControllerService(
      database,
      cipher,
      ssh,
      undefined,
      catalog,
      resources,
      { upgrade: { transport, discovery } }
    )
    ipcMain.handle('vps:list', () => ({ ok: true, data: vps.list() }))
    const methods = {
      'controller:installer-overview': 'installerOverview',
      'controller:review-adoption': 'reviewControllerAdoption',
      'controller:confirm-adoption': 'confirmControllerAdoption',
      'controller:inspect-installation': 'inspectInstallation',
      'controller:prepare-installed-binding': 'prepareInstalledRegistration'
    }
    for (const [channel, method] of Object.entries(methods))
      ipcMain.handle(channel, async (_event, input) => {
        const call = { channel, completed: false }
        calls.push(call)
        try {
          return { ok: true, data: await service[method](input) }
        } catch (error) {
          return {
            ok: false,
            error: {
              code: 'VALIDATION',
              message: 'UPGRADE_UNAVAILABLE',
              technical: error.code ?? 'UPGRADE_UNAVAILABLE'
            }
          }
        } finally {
          call.completed = true
        }
      })
    stage = 'renderer'
    await esbuild.build({
      stdin: {
        contents: `import React from 'react';import{createRoot}from'react-dom/client';import{App,ConfigProvider}from'antd';import{ControllerInstallWizard}from'./src/renderer/src/components/ControllerInstallWizard';import{useUiState}from'./src/renderer/src/store/uiState';import{themeTokens,applyTheme}from'./src/renderer/src/utils/themeTokens';import'./src/renderer/src/assets/main.css';const root=createRoot(document.getElementById('root'));let showId=0;window.showAdoption=(locale,theme)=>{useUiState.setState({locale,theme});applyTheme(theme);root.render(<ConfigProvider theme={themeTokens[theme]}><App><main style={{padding:24}}><h1>OpsPilot</h1><ControllerInstallWizard key={locale+theme+(++showId)} open onClose={()=>{}} onChanged={()=>{}}/></main></App></ConfigProvider>)};`,
        resolveDir: join(root, 'app'),
        sourcefile: 'upgrade-ui-lab.jsx',
        loader: 'jsx'
      },
      outfile: join(directory, 'renderer.js'),
      bundle: true,
      platform: 'browser',
      format: 'iife',
      define: { 'process.env.NODE_ENV': '"production"' },
      loader: { '.png': 'file', '.woff2': 'file' },
      tsconfig: join(root, 'app/tsconfig.web.json')
    })
    writeFileSync(
      join(directory, 'index.html'),
      '<!doctype html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="renderer.css"></head><body><div id="root"></div><script src="renderer.js"></script></body></html>'
    )
    window = new BrowserWindow({
      width: 1280,
      height: 800,
      show: false,
      webPreferences: {
        preload: join(root, 'app/out/preload/index.js'),
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
    const wait = async (condition) => {
      const until = Date.now() + 20000
      while (!(await js(condition))) {
        if (Date.now() > until) throw Error('UI_WAIT_TIMEOUT')
        await new Promise((done) => setTimeout(done, 60))
      }
    }
    const click = async (text) => {
      const expr = `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)})`
      await wait(`!!(${expr})&&!(${expr}).disabled`)
      await js(`(${expr}).click()`)
    }
    const show = async (locale, theme) => {
      await js(`window.showAdoption(${JSON.stringify(locale)},${JSON.stringify(theme)})`)
      await wait(
        'document.querySelectorAll(".ant-select").length>=1&&!document.querySelector(".ant-spin-spinning")'
      )
    }
    const capture = async (name, width, height) => {
      window.setContentSize(width, height)
      await new Promise((done) => setTimeout(done, 120))
      const layout = await js(
        '({window:document.documentElement.scrollWidth>document.documentElement.clientWidth,modal:document.querySelector(".ant-modal-body").scrollWidth>document.querySelector(".ant-modal-body").clientWidth})'
      )
      assert.deepEqual(layout, { window: false, modal: false })
      const path = join(screenshots, `${name}-${width}x${height}.png`)
      writeFileSync(path, (await window.webContents.capturePage()).toPNG())
      captures.push({ file: path.split(root).pop().replaceAll('\\', '/'), layout })
    }

    stage = 'adoption-review'
    await show('vi', 'dark')
    await click('Tìm controller đã nâng cấp')
    await wait('document.body.textContent.includes("Đã xác minh controller hiện hành")')
    assert.equal(
      database.prepare('SELECT count(*) n FROM desktop_controller_installation').get().n,
      0
    )
    assert.equal(database.prepare('SELECT count(*) n FROM desktop_controller_binding').get().n, 0)
    const disabled = await js(
      'Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="Nhận lại controller").disabled'
    )
    assert.equal(disabled, true)
    await js(
      'Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="Nhận lại controller").scrollIntoView({block:"end"})'
    )
    await capture('adoption-review-dark', 1280, 800)
    checks.push(
      'production_preload_ids_only_review_reaches_actual_main_without_creating_local_journals_or_enrolling'
    )
    await js('document.querySelector("input[type=checkbox]").click()')
    await click('Nhận lại controller')
    await wait('document.body.textContent.includes("Đã nhận lại controller.")')
    const overview = await service.installerOverview()
    assert.equal(overview.installations[0].request_key, ik)
    assert.equal(overview.installations[0].last_result.service_state, 'stopped')
    assert.equal(overview.installations[0].current_revision.request_key, uk)
    assert.equal(overview.installations[0].current_revision.last_result.service_state, 'running')
    assert.equal(database.prepare('SELECT count(*) n FROM desktop_controller_binding').get().n, 0)
    assert.equal(
      await js(
        'Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="Lưu kết nối").disabled'
      ),
      true
    )
    checks.push(
      'explicit_adoption_atomically_retains_remote_uuids_and_shows_current_runtime_without_implicit_enrollment'
    )
    await capture('adoption-confirmed-dark', 1280, 800)
    stage = 'separate-binding-preparation'
    // Fresh current inspection is mandatory again for explicit API preparation.
    const pending = await service.prepareInstalledRegistration({
      installation_request_key: ik,
      display_name: 'Private UI fixture',
      allow_write: false
    })
    const intent = vault.storedIntent(pending.binding_id)
    assert.equal(intent.artifact_path, result.artifact_path)
    assert.equal(intent.upgrade.request_key, uk)
    assert.deepEqual(intent.requested_scopes, ['read'])
    assert.equal(pending.state, 'pending')
    checks.push(
      'separate_real_main_binding_preparation_uses_current_revision_and_read_scope_without_remote_enrollment'
    )
    stage = 'layout'
    for (const locale of ['vi', 'en', 'cn', 'jp'])
      for (const theme of ['dark', 'light']) {
        await show(locale, theme)
        for (const [w, h] of [
          [1280, 800],
          [1366, 768]
        ])
          await capture(`adoption-${locale}-${theme}`, w, h)
      }
    checks.push('four_locales_two_themes_two_sizes_no_horizontal_overflow')
    assert.equal(errors.length, 0)
    checks.push('no_renderer_errors_and_no_credential_in_renderer_or_recorded_ipc')
    proof.status = 'PASS'
  } catch (error) {
    proof.stage = stage
    proof.error = error instanceof Error ? error.name : 'UNKNOWN'
    const stable = error?.context?.cause?.message
    if (typeof stable === 'string' && /^[A-Z_]+$/.test(stable)) proof.technical = stable
    proof.failure_location =
      /adoption-electron\.mjs:\d+:\d+/.exec(error?.stack ?? '')?.[0] ?? 'unknown'
  } finally {
    window?.destroy()
    if (database?.open) database.close()
    assert.equal(realpathSync(privateData), resolve(privateData))
    assert(
      privateData.startsWith(
        resolve(root, 'app/.out-scripts/controller-adoption-electron') + '/'
      ) ||
        privateData.startsWith(
          resolve(root, 'app/.out-scripts/controller-adoption-electron') + '\\'
        )
    )
    rmSync(privateData, { recursive: true })
    proof.private_data_removed = true
    proof.calls = calls
    proof.renderer_errors = errors
    writeFileSync(join(directory, 'result.json'), JSON.stringify(proof, null, 2) + '\n')
    console.log(
      JSON.stringify({
        status: proof.status,
        checks: checks.length,
        captures: captures.length,
        evidence: directory,
        stage: proof.stage
      })
    )
    clearTimeout(watchdog)
    app.exit(proof.status === 'PASS' ? 0 : 1)
  }
})
