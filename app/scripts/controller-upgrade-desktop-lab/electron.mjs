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
  directory = join(root, 'app/.out-scripts/controller-upgrade-electron', nonce),
  privateData = join(directory, 'private'),
  screenshots = join(root, 'docs/ui-redesign/screenshots/r3c6h4c2b3')
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
  loss = true,
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
      bindingId = randomUUID(),
      serverRoot = '/opt/opspilot-controller',
      remote = new Map()
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
      payload_sha256: 'c'.repeat(64)
    }
    const installTransport = {
      discover: async () => ({
        state: 'discovered',
        request_key: ik,
        release_sha256: original.release_sha256,
        installer_sha256: original.installer_sha256
      }),
      call: async (input) => {
        input.assertCurrent()
        return input.operation === 'status'
          ? { state: 'verified', ...input.locator, completed_files: 1, total_files: 1 }
          : { state: 'installation_result', request_key: ik, installation: oldResult }
      },
      transfer: async () => {
        throw Error('NO_INSTALL_TRANSFER')
      }
    }
    const transport = {
      call: async (input) => {
        input.assertCurrent()
        return { state: 'verified', ...input.locator, completed_files: 1, total_files: 1 }
      },
      transfer: async (input) => {
        input.assertCurrent()
        return { state: 'verified', ...input.locator, completed_files: 1, total_files: 1 }
      },
      upgrade: async (input) => {
        input.assertCurrent()
        const r = input.request
        if (r.operation === 'inspect-upgrade') {
          if (!remote.has(r.request_key)) throw Error('FIXTURE_NOT_FOUND')
          return remote.get(r.request_key)
        }
        const rolled = r.operation === 'rollback-upgrade',
          runtime = rolled
            ? serverRoot + '/runtime'
            : `${serverRoot}/revisions/${r.request_key}/runtime`
        const result = {
          format: 1,
          request_key: r.request_key,
          installation_request_key: ik,
          controller_id: cid,
          parent_upgrade_key: null,
          parent_release_sha256: original.release_sha256,
          release_sha256: upgradeDescriptor.release_sha256,
          payload_sha256: 'd'.repeat(64),
          runtime_release_sha256: rolled
            ? original.release_sha256
            : upgradeDescriptor.release_sha256,
          runtime_payload_sha256: rolled ? oldResult.payload_sha256 : 'd'.repeat(64),
          runtime_upgrade_key: rolled ? null : r.request_key,
          phase: rolled ? 'rolled_back' : 'active',
          is_current: true,
          service_state: 'running',
          runtime_uid: 997,
          artifact_path: runtime + '/payload/control-plane.cjs',
          node_path: runtime + '/node',
          data_directory: oldResult.data_directory
        }
        remote.set(r.request_key, result)
        if (loss) {
          loss = false
          throw Error('SYNTHETIC_LOST_REPLY')
        }
        return result
      }
    }
    const ssh = {
      openProductBootstrapChannel: async () => {
        throw Error('UNEXPECTED_REAL_SSH')
      }
    }
    const installs = new code.DesktopControllerInstallations(database, ssh, catalog, {
      transport: installTransport
    })
    installs.prepare((await installs.plan(1, original.release_id)).plan_id)
    await installs.inspect(ik)
    const vault = new code.DesktopControllerVault(database, cipher),
      intent = installs.bindingIntent(ik, bindingId, 'Private retained connection')
    vault.prepare(intent)
    const token = 'opspilot_' + randomBytes(32).toString('base64url'),
      expires = new Date(Date.now() + 86400000).toISOString(),
      clientId = randomUUID()
    vault.activate(bindingId, 1, {
      state: 'issued_once',
      controller_id: cid,
      client: {
        client_id: clientId,
        controller_id: cid,
        display_name: intent.display_name,
        scopes: ['read'],
        created_at: new Date().toISOString(),
        revoked_at: null,
        token_expires_at: expires
      },
      credential: { access_token: token, token_type: 'Bearer', expires_at: expires }
    })
    service = new code.DesktopControllerService(
      database,
      cipher,
      ssh,
      undefined,
      catalog,
      resources,
      { installation: { transport: installTransport }, upgrade: { transport } }
    )
    const methods = {
      'controller:review-ssh-authority': 'reviewControllerAuthority',
      'controller:confirm-ssh-authority': 'confirmControllerAuthority',
      'controller:upgrade-overview': 'upgradeOverview',
      'controller:review-upgrade': 'reviewUpgrade',
      'controller:prepare-upgrade': 'prepareUpgrade',
      'controller:send-upgrade': 'sendUpgrade',
      'controller:inspect-upgrade': 'inspectUpgrade',
      'controller:cancel-upgrade': 'cancelUpgrade',
      'controller:review-upgrade-binding': 'reviewUpgradeBinding',
      'controller:refresh-upgrade-binding': 'refreshUpgradeBinding'
    }
    for (const [channel, method] of Object.entries(methods))
      ipcMain.handle(channel, async (_event, input) => {
        const call = { channel, completed: false }
        calls.push(call)
        try {
          return { ok: true, data: await service[method](input) }
        } catch {
          return { ok: false, error: { code: 'VALIDATION', message: 'UPGRADE_UNAVAILABLE' } }
        } finally {
          call.completed = true
        }
      })
    stage = 'renderer'
    await esbuild.build({
      stdin: {
        contents: `import React from 'react';import{createRoot}from'react-dom/client';import{App,ConfigProvider}from'antd';import{ControllerUpgradeWizard}from'./src/renderer/src/components/ControllerUpgradeWizard';import{useUiState}from'./src/renderer/src/store/uiState';import{themeTokens,applyTheme}from'./src/renderer/src/utils/themeTokens';import'./src/renderer/src/assets/main.css';const root=createRoot(document.getElementById('root'));let showId=0;window.showUpgrade=(locale,theme)=>{useUiState.setState({locale,theme});applyTheme(theme);root.render(<ConfigProvider theme={themeTokens[theme]}><App><main style={{padding:24}}><h1>OpsPilot</h1><ControllerUpgradeWizard key={locale+theme+(++showId)} open onClose={()=>{}} onChanged={()=>{}}/></main></App></ConfigProvider>)};`,
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
      await js(`window.showUpgrade(${JSON.stringify(locale)},${JSON.stringify(theme)})`)
      await wait(
        'document.querySelectorAll(".ant-select").length>=2&&!document.querySelector(".ant-spin-spinning")'
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
    await show('vi', 'dark')
    const start = calls.length
    await click('Kiểm tra nâng cấp')
    await wait(
      '!!Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="Tạo giao dịch")'
    )
    assert(!calls.slice(start).some((c) => c.channel === 'controller:prepare-upgrade'))
    await js('document.querySelector("input[type=checkbox]").click()')
    await click('Tạo giao dịch')
    await click('Chuyển gói')
    await click('Nâng cấp')
    await wait('document.body.textContent.includes("Chưa rõ kết quả. Kiểm tra cùng giao dịch")')
    assert.throws(() => vault.resolve(bindingId))
    checks.push('unknown_upgrade_never_replays_and_blocks_old_vault_binding')
    await capture('upgrade-unknown-dark', 1280, 800)
    await click('Kiểm tra lại')
    await click('Kiểm tra cập nhật kết nối')
    await click('Xác nhận cập nhật kết nối')
    await wait(
      '!Array.from(document.querySelectorAll("button")).some(b=>b.textContent.trim()==="Xác nhận cập nhật kết nối")'
    )
    assert.equal(vault.resolve(bindingId).accessToken, token)
    assert.equal(vault.get(bindingId).remote_client_id, clientId)
    assert.equal(vault.get(bindingId).revision, 3)
    checks.push(
      'real_production_preload_typed_ipc_main_fresh_review_explicit_refresh_preserves_encrypted_token_client_scope'
    )
    await click('Quay về bản trước')
    await wait('document.body.textContent.includes("Đã quay về bản trước")')
    assert.throws(() => vault.resolve(bindingId))
    await click('Kiểm tra cập nhật kết nối')
    await click('Xác nhận cập nhật kết nối')
    await wait(
      '!Array.from(document.querySelectorAll("button")).some(b=>b.textContent.trim()==="Xác nhận cập nhật kết nối")'
    )
    assert.equal(vault.resolve(bindingId).accessToken, token)
    assert.equal(vault.get(bindingId).revision, 4)
    checks.push('rollback_requires_separate_binding_confirmation_and_preserves_token')
    stage = 'ssh-authority-rebind'
    new code.VpsRepository(database).delete(1)
    const candidate = new code.VpsRepository(database).create({
      name: 'Readded private VPS',
      host: 'fixture.test',
      port: 22,
      username: 'root',
      auth_type: 'key',
      host_fingerprint: 'SHA256:' + 'A'.repeat(43),
      credential: cipher.encrypt(randomBytes(32).toString('base64url'))
    })
    assert.throws(() => vault.resolve(bindingId))
    await show('vi', 'dark')
    await js(
      `document.querySelector('[aria-label="Thông tin VPS hiện tại"]').closest('.ant-select').querySelector('.ant-select-selector').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`
    )
    await wait(
      `!!Array.from(document.querySelectorAll('.ant-select-item-option-content')).find(v=>v.textContent.includes('Readded private VPS'))`
    )
    await js(
      `Array.from(document.querySelectorAll('.ant-select-item-option-content')).find(v=>v.textContent.includes('Readded private VPS')).click()`
    )
    await click('Kiểm tra quyền SSH')
    await wait('document.body.textContent.includes("Fingerprint SSH")')
    assert.throws(() => vault.resolve(bindingId))
    await capture('ssh-authority-review-dark', 1280, 800)
    await capture('ssh-authority-review-dark', 1366, 768)
    await js(
      `Array.from(document.querySelectorAll('label')).find(v=>v.textContent.includes('Tôi xác nhận đây là cùng máy chủ')).querySelector('input').click()`
    )
    await click('Xác nhận kết nối lại')
    await wait('document.body.textContent.includes("Đã cập nhật quyền SSH")')
    assert.throws(() => vault.resolve(bindingId))
    assert.equal(vault.get(bindingId).revision, 4)
    await click('Kiểm tra cập nhật kết nối')
    await click('Xác nhận cập nhật kết nối')
    await wait(
      '!Array.from(document.querySelectorAll("button")).some(b=>b.textContent.trim()==="Xác nhận cập nhật kết nối")'
    )
    assert.equal(vault.resolve(bindingId).accessToken, token)
    assert.equal(vault.resolve(bindingId).principal.vpsId, candidate.id)
    assert.equal(vault.get(bindingId).revision, 5)
    assert.equal(vault.get(bindingId).remote_client_id, clientId)
    assert.equal(
      database.prepare('SELECT count(*) n FROM desktop_controller_authority_rebind').get().n,
      1
    )
    checks.push(
      'readded_vps_review_and_separate_ssh_consent_then_separate_api_confirmation_keep_existing_token_and_client'
    )
    stage = 'screenshots'
    for (const locale of ['vi', 'en', 'cn', 'jp'])
      for (const theme of ['dark', 'light']) {
        await show(locale, theme)
        for (const [w, h] of [
          [1280, 800],
          [1366, 768]
        ])
          await capture(`upgrade-${locale}-${theme}`, w, h)
      }
    checks.push('four_locales_two_themes_two_desktop_sizes_no_window_or_modal_horizontal_overflow')
    assert.equal(errors.length, 0)
    const metadata = await service.upgradeOverview()
    assert(!JSON.stringify(metadata).includes(token))
    assert(!JSON.stringify(calls).includes(token))
    checks.push('no_token_in_renderer_metadata_or_recorded_ipc_and_no_renderer_errors')
    proof.status = 'PASS'
  } catch (error) {
    proof.stage = stage
    proof.error = error instanceof Error ? error.name : 'UNKNOWN'
    proof.failure_location = /electron\.mjs:\d+:\d+/.exec(error?.stack ?? '')?.[0] ?? 'unknown'
  } finally {
    window?.destroy()
    if (database?.open) database.close()
    assert.equal(realpathSync(privateData), resolve(privateData))
    assert(
      privateData.startsWith(resolve(root, 'app/.out-scripts/controller-upgrade-electron') + '/') ||
        privateData.startsWith(resolve(root, 'app/.out-scripts/controller-upgrade-electron') + '\\')
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
