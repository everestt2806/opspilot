/* eslint-disable @typescript-eslint/explicit-function-return-type -- Isolated real Electron/Main/SQLite feature lab. */
import assert from 'node:assert/strict'
import { app, BrowserWindow, ipcMain } from 'electron'
import { createRequire } from 'node:module'
import { randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { once } from 'node:events'
import { mkdirSync, readFileSync, writeFileSync, realpathSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../..'),
  require = createRequire(join(root, 'app/package.json')),
  esbuild = createRequire(require.resolve('vite/package.json'))('esbuild'),
  directory = join(
    root,
    'app/.out-scripts/controller-exposure-electron',
    randomBytes(8).toString('hex')
  ),
  privateRoot = join(directory, 'private-data'),
  screenshots = join(root, 'docs/ui-redesign/screenshots/r3c6h4b')
mkdirSync(privateRoot, { recursive: true })
mkdirSync(screenshots, { recursive: true })
app.setPath('userData', join(directory, 'profile'))
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('force-device-scale-factor', '1')
const checks = [],
  errors = [],
  calls = [],
  key = randomBytes(32),
  bindingId = randomUUID()
let database,
  local,
  server,
  api,
  window,
  code,
  service,
  connection,
  oldServer = false,
  dropPost = false,
  dropRead = false,
  posts = 0
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
const copyPath = join(directory, 'copy.cjs')
esbuild.buildSync({
  entryPoints: [join(root, 'app/src/renderer/src/components/controllerExposureCopy.ts')],
  outfile: copyPath,
  bundle: true,
  platform: 'node',
  format: 'cjs'
})
const copy = require(copyPath).CONTROLLER_EXPOSURE_COPY
const watchdog = setTimeout(() => {
  console.error('EXPOSURE_ELECTRON_TIMEOUT')
  app.exit(2)
}, 180000)
app.whenReady().then(async () => {
  const result = {
    status: 'FAIL',
    scope: 'REAL_ELECTRON_TYPED_IPC_MAIN_PUBLIC_HTTP_PRIVATE_SQLITE_SYNTHETIC_RUNTIME',
    checks,
    screenshots: [],
    production_profile_used: false,
    actual_ssh_transport: false,
    actual_network_probe_performed: false,
    private_db_removed: false
  }
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
    const Database = require('better-sqlite3')
    database = new Database(join(privateRoot, 'controller.db'))
    database.pragma('journal_mode = WAL')
    database.pragma('foreign_keys = ON')
    code.runMigrations(database)
    const seed = code.seedExposureFixture(database, Date.now(), '167.71.202.116')
    seed.settle()
    const beforeTerminal = database.prepare('SELECT * FROM product_runtime_terminal').all(),
      auth = new code.ControllerClientAuth(
        database,
        seed.controllerId,
        `unix:${process.getuid?.() ?? 0}`
      ),
      grant = auth.enroll({
        request_key: randomUUID(),
        display_name: 'Private Electron lab',
        requested_scopes: ['read', 'policy:write']
      })
    assert.equal(grant.state, 'issued_once')
    const cipher = new code.AesGcmCredentialCipher(key)
    local = new Database(join(privateRoot, 'desktop.db'))
    local.pragma('journal_mode = WAL')
    local.pragma('foreign_keys = ON')
    code.runMigrations(local)
    local
      .prepare(
        "INSERT INTO vps(id,name,host,host_fingerprint,username,auth_type,encrypted_secret) VALUES(1,'fixture','controller.lab',?,'ops','key',X'00')"
      )
      .run('SHA256:' + 'A'.repeat(43))
    let vault = new code.DesktopControllerVault(local, cipher)
    const principal = {
      vpsId: 1,
      host: 'controller.lab',
      port: 22,
      hostFingerprint: 'SHA256:' + 'A'.repeat(43),
      username: 'ops',
      authType: 'key'
    }
    vault.prepare({
      binding_id: bindingId,
      controller_id: seed.controllerId,
      vps_id: 1,
      ssh_security_revision: 1,
      principal,
      artifact_path: '/opt/opspilot/payload/control-plane.cjs',
      data_directory: '/var/lib/opspilot',
      node_path: '/opt/opspilot/node',
      manifest_sha256: 'a'.repeat(64),
      display_name: 'Private Electron lab',
      requested_scopes: ['read', 'policy:write']
    })
    vault.activate(bindingId, 1, grant)
    local.close()
    local = new Database(join(privateRoot, 'desktop.db'))
    local.pragma('foreign_keys = ON')
    code.runMigrations(local)
    vault = new code.DesktopControllerVault(local, cipher)
    assert.equal(vault.resolve(bindingId).accessToken, grant.credential.access_token)
    checks.push('real_electron_native_sqlite_cold_private_profile_vault')
    api = new code.ControllerReadApi(
      database,
      seed.controllerId,
      privateRoot,
      new code.ControllerReadCursor(cipher, seed.controllerId),
      () => ({ service_state: 'ready', last_branch_poll_at: null, reason_code: null }),
      { commands: new code.ControllerCommands(database, seed.controllerId, () => true) }
    )
    server = createServer((req, res) => {
      if (oldServer) {
        req.resume()
        res.writeHead(501, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            error: {
              code: 'UNSUPPORTED',
              message: 'UNSUPPORTED',
              retryable: false,
              request_id: randomUUID()
            }
          })
        )
        return
      }
      if (dropRead && req.method === 'GET') {
        dropRead = false
        req.socket.destroy()
        return
      }
      if (req.method === 'POST') {
        posts++
        if (dropPost) {
          dropPost = false
          res.end = () => {
            dropRead = true
            req.socket.destroy()
            return res
          }
        }
      }
      if (!api.handle(req, res)) {
        res.writeHead(404)
        res.end()
      }
    })
    await new Promise((done) => server.listen(0, '127.0.0.1', done))
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    service = new code.DesktopControllerService(local, cipher, {
      async openControllerApiChannel() {
        const channel = connect({ host: '127.0.0.1', port: address.port })
        await once(channel, 'connect')
        return { channel, identity: principal }
      }
    })
    connection = (await service.list())[0]
    for (const channel of ['controller:exposure-read', 'controller:exposure-check'])
      ipcMain.handle(channel, async (_event, input) => {
        const call = { channel, input, completed: false }
        calls.push(call)
        try {
          return {
            ok: true,
            data: await service.exposure(input, channel === 'controller:exposure-check')
          }
        } catch {
          return { ok: false, error: { code: 'VALIDATION', message: 'CONTROLLER_UNAVAILABLE' } }
        } finally {
          call.completed = true
        }
      })
    const renderer = join(directory, 'renderer.js')
    await esbuild.build({
      stdin: {
        contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {App,ConfigProvider} from 'antd';
      import {ControllerExposurePanel} from './src/renderer/src/components/ControllerExposurePanel';
      import {useUiState} from './src/renderer/src/store/uiState'; import {themeTokens,applyTheme} from './src/renderer/src/utils/themeTokens';
      import './src/renderer/src/assets/main.css'; const root=createRoot(document.getElementById('root'));
      window.showExposure=(binding,locale,theme)=>{useUiState.setState({locale,theme});applyTheme(theme);root.render(<ConfigProvider theme={themeTokens[theme]}><App><main style={{padding:32,maxWidth:1100,margin:'auto'}}><h1>OpsPilot</h1><ControllerExposurePanel binding={binding} appId={1} currentDeploymentId={1} fresh /></main></App></ConfigProvider>)};`,
        resolveDir: join(root, 'app'),
        sourcefile: 'exposure-ui-lab.jsx',
        loader: 'jsx'
      },
      outfile: renderer,
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
      if (event.level === 'error')
        errors.push({
          code: 'RENDERER_ERROR',
          message: event.message.replace(/opspilot_[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 1500)
        })
    })
    await window.loadFile(join(directory, 'index.html'))
    window.showInactive()
    const js = (source) => window.webContents.executeJavaScript(source, true)
    const wait = async (condition) => {
      const deadline = Date.now() + 15000
      while (!(await js(condition))) {
        if (Date.now() > deadline) throw Error('UI_WAIT_TIMEOUT')
        await new Promise((done) => setTimeout(done, 80))
      }
    }
    const click = async (text) => {
      const expression = `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)})`
      await wait(`!!(${expression})&&!(${expression}).disabled`)
      await js(`(${expression}).click()`)
    }
    const show = (locale, theme) =>
      js(
        `window.showExposure(${JSON.stringify(connection)},${JSON.stringify(locale)},${JSON.stringify(theme)})`
      )
    const capture = async (name, width, height) => {
      window.setContentSize(width, height)
      await new Promise((done) => setTimeout(done, 150))
      const layout = await js(
        '({overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,main:document.querySelector("main").scrollWidth>document.querySelector("main").clientWidth})'
      )
      assert.deepEqual(layout, { overflow: false, main: false })
      const file = `${name}-${width}x${height}.png`
      writeFileSync(join(screenshots, file), (await window.webContents.capturePage()).toPNG())
      result.screenshots.push(file)
    }
    await show('vi', 'dark')
    const readDeadline = Date.now() + 15000
    while (!calls[0]?.completed) {
      if (Date.now() > readDeadline) throw Error('INITIAL_READ_TIMEOUT')
      await new Promise((done) => setTimeout(done, 30))
    }
    result.stage = 'initial_check_click'
    await click(copy.vi.check)
    result.stage = 'initial_check_readback'
    await wait(`document.body.textContent.includes(${JSON.stringify(copy.vi.reachable)})`)
    assert.equal(posts, 1)
    result.actual_network_probe_performed = true
    checks.push('real_renderer_typed_ipc_main_public_probe_authenticated_sqlite_persistence')
    for (const locale of ['vi', 'en', 'cn', 'jp'])
      for (const theme of ['dark', 'light']) {
        await show(locale, theme)
        await wait(`document.body.textContent.includes(${JSON.stringify(copy[locale].reachable)})`)
        await capture(`exposure-${locale}-${theme}`, 1280, 800)
      }
    await show('vi', 'dark')
    await capture('exposure-vi-dark', 1366, 768)
    await show('vi', 'light')
    await capture('exposure-vi-light', 1366, 768)
    checks.push('four_locales_two_themes_and_two_window_sizes_without_horizontal_overflow')
    dropPost = true
    await click(copy.vi.check)
    await wait(`document.body.textContent.includes(${JSON.stringify(copy.vi.unknown)})`)
    assert.equal(posts, 2)
    await capture('exposure-unknown', 1280, 800)
    await click(copy.vi.read)
    await wait(`document.body.textContent.includes(${JSON.stringify(copy.vi.reachable)})`)
    assert.equal(posts, 2)
    checks.push('unknown_write_explicit_read_without_second_post')
    oldServer = true
    await click(copy.vi.read)
    await wait(`document.body.textContent.includes(${JSON.stringify(copy.vi.unsupported)})`)
    await capture('exposure-unsupported', 1280, 800)
    assert.deepEqual(
      database.prepare('SELECT * FROM product_runtime_terminal').all(),
      beforeTerminal
    )
    assert.equal(local.prepare('SELECT count(*) n FROM desktop_controller_command').get().n, 0)
    assert.equal(database.prepare('SELECT count(*) n FROM product_deploy_job').get().n, 1)
    assert.deepEqual(errors, [])
    assert.ok(calls.every((v) => Object.keys(v.input).sort().join(',') === 'app_id,binding_id'))
    checks.push('unsupported_no_legacy_fallback_no_runtime_h2_or_command_mutation')
    result.status = 'PASS'
  } catch (error) {
    result.failure_sites = [
      ...(error instanceof Error ? (error.stack ?? '') : '').matchAll(/electron\.mjs:\d+:\d+/g)
    ].map((match) => match[0])
    if (window && !window.isDestroyed())
      result.failure_ui = await window.webContents.executeJavaScript(
        '({text:document.body.textContent.slice(0,3000),buttons:Array.from(document.querySelectorAll("button")).map(b=>({text:b.textContent,disabled:b.disabled}))})'
      )
    result.failure_location =
      /electron\.mjs:\d+:\d+/.exec(error instanceof Error ? (error.stack ?? '') : '')?.[0] ??
      'unknown'
    result.error = 'EXPOSURE_ELECTRON_CHECK_FAILED'
  } finally {
    window?.destroy()
    await api?.close()
    server?.closeAllConnections()
    if (server) await new Promise((done) => server.close(done))
    database?.close()
    local?.close()
    key.fill(0)
    assert.equal(realpathSync(privateRoot), resolve(directory, 'private-data'))
    assert.equal(
      resolve(privateRoot).startsWith(resolve(directory) + '\\'),
      process.platform === 'win32'
    )
    rmSync(privateRoot, { recursive: true })
    result.private_db_removed = true
    result.renderer_errors = errors
    result.ipc_call_count = calls.length
    writeFileSync(join(directory, 'result.json'), JSON.stringify(result, null, 2))
    console.log(
      JSON.stringify({
        status: result.status,
        evidence: join(directory, 'result.json'),
        checks: checks.length,
        screenshots: result.screenshots.length
      })
    )
    clearTimeout(watchdog)
    app.exit(result.status === 'PASS' ? 0 : 1)
  }
})
