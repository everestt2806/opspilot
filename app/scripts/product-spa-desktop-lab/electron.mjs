/* eslint-disable @typescript-eslint/explicit-function-return-type -- Gate Electron riêng cho Product SPA. */
import assert from 'node:assert/strict'
import { app, BrowserWindow, ipcMain } from 'electron'
import { createRequire } from 'node:module'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
const next = process.argv.includes('--nextjs')
const framework = next ? 'nextjs' : 'static-spa'
const frameworkLabel = next ? 'Next.js' : 'Vite SPA'
const root = resolve(import.meta.dirname, '../../..'),
  require = createRequire(join(root, 'app/package.json')),
  esbuild = createRequire(require.resolve('vite/package.json'))('esbuild'),
  nonce = randomBytes(6).toString('hex'),
  directory = join(root, 'app/.out-scripts/product-spa-desktop-lab', nonce),
  privateData = join(directory, 'private'),
  screenshots = join(root, 'docs/ui-redesign/screenshots', next ? 'r7e' : 'r7b', nonce)
mkdirSync(privateData, { recursive: true })
mkdirSync(screenshots, { recursive: true })
app.setPath('userData', join(directory, 'profile'))
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('force-device-scale-factor', '1')
const checks = [],
  calls = [],
  captures = [],
  errors = []
const proof = {
  status: 'FAIL',
  framework,
  scope: 'REAL_ELECTRON_PRELOAD_UI_MAIN_SQLITE_SYNTHETIC_CONTROLLER',
  checks,
  captures,
  errors,
  production_profile_used: false,
  ssh_transport_real: false
}
let database,
  window,
  code,
  stage = 'start'
const watchdog = setTimeout(() => app.exit(2), 180000)
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
    database
      .prepare(
        "INSERT INTO vps(id,name,host,username,auth_type,host_fingerprint,encrypted_secret) VALUES(1,'private fixture','fixture.invalid','operator','key',?,X'00')"
      )
      .run('SHA256:' + 'A'.repeat(43))
    const vault = new code.DesktopControllerVault(
        database,
        new code.AesGcmCredentialCipher(randomBytes(32))
      ),
      bindingId = randomUUID(),
      client = randomUUID(),
      expires = new Date(Date.now() + 86400000).toISOString(),
      token = 'opspilot_' + randomBytes(32).toString('base64url')
    vault.prepare({
      binding_id: bindingId,
      controller_id: 'spa-ui-controller',
      vps_id: 1,
      ssh_security_revision: 1,
      principal: {
        vpsId: 1,
        host: 'fixture.invalid',
        port: 22,
        username: 'operator',
        authType: 'key',
        hostFingerprint: 'SHA256:' + 'A'.repeat(43)
      },
      artifact_path: '/opt/opspilot/controller.cjs',
      data_directory: '/var/lib/opspilot',
      node_path: '/opt/opspilot/node',
      manifest_sha256: 'a'.repeat(64),
      display_name: 'Private SPA lab',
      requested_scopes: ['read', 'deploy:manual', 'policy:write']
    })
    vault.activate(bindingId, 1, {
      state: 'issued_once',
      controller_id: 'spa-ui-controller',
      client: {
        client_id: client,
        controller_id: 'spa-ui-controller',
        display_name: 'Private SPA lab',
        scopes: ['read', 'deploy:manual', 'policy:write'],
        created_at: new Date().toISOString(),
        revoked_at: null,
        token_expires_at: expires
      },
      credential: { access_token: token, token_type: 'Bearer', expires_at: expires }
    })
    const remote = new Map()
    let mismatch = false
    const setups = new code.DesktopProjectSetups(database, vault, {
      projectTargets: async () => ({
        controller_id: 'spa-ui-controller',
        items: [
          {
            id: 77,
            name: 'SPA target',
            host: 'target.invalid',
            port: 22,
            username: 'operator',
            host_fingerprint: 'SHA256:' + 'B'.repeat(43),
            ssh_security_revision: 3
          }
        ],
        next_after_id: null,
        has_more: false
      }),
      registerProject: async (_binding, body) => {
        assert.equal(body.framework, framework)
        assert.equal(body.container_port, next ? 3000 : 80)
        assert.equal(body.healthcheck_path, '/')
        const response = {
          state: remote.has(body.request_key) ? 'already_registered' : 'registered',
          controller_id: body.controller_id,
          request_key: body.request_key,
          app_id: 42,
          target_vps_id: 77,
          host_port: 30000,
          ownership_generation: 1,
          source_generation: 1,
          source_config_sha256: 'b'.repeat(64),
          auto_deploy_paused: true,
          source_verification: 'required',
          target_enrollment: 'required',
          runtime_preflight: 'required'
        }
        remote.set(body.request_key, response)
        return response
      }
    })
    const metadata = vault.get(bindingId)
    const binding = {
      ...metadata,
      display_name: 'Private SPA lab',
      scopes: metadata.client.scopes,
      credential_expires_at: expires
    }
    const methods = {
      'controller:projects': 'list',
      'controller:project-targets': 'targets',
      'controller:prepare-project': 'prepare',
      'controller:send-project': 'send',
      'controller:cancel-project': 'cancel'
    }
    for (const [channel, method] of Object.entries(methods))
      ipcMain.handle(channel, async (_event, input) => {
        calls.push(channel)
        try {
          const data =
            channel === 'controller:project-targets'
              ? await setups.targets(input.binding_id, input.after_id)
              : await setups[method](input)
          return {
            ok: true,
            data:
              mismatch && channel === 'controller:prepare-project'
                ? { ...data, framework: 'express' }
                : data
          }
        } catch {
          return {
            ok: false,
            error: { technical: 'PROJECT_SETUP_FAILED', message: 'Không xác nhận được yêu cầu' }
          }
        }
      })
    ipcMain.handle('controller:project-target-state', () => ({
      ok: false,
      error: { technical: 'FIXTURE_NOT_ENROLLED' }
    }))
    stage = 'renderer'
    await esbuild.build({
      stdin: {
        contents: `import React from 'react';import{createRoot}from'react-dom/client';import{App,ConfigProvider}from'antd';import{ControllerProjectPanel}from'./src/renderer/src/components/ControllerProjectPanel';import{CONTROLLER_PROJECT_COPY}from'./src/renderer/src/components/controllerProjectCopy';import{useUiState}from'./src/renderer/src/store/uiState';import{themeTokens,applyTheme}from'./src/renderer/src/utils/themeTokens';import'./src/renderer/src/assets/main.css';const root=createRoot(document.getElementById('root'));let id=0;window.showProjects=(locale,theme)=>{useUiState.setState({locale,theme});applyTheme(theme);window.copy=CONTROLLER_PROJECT_COPY[locale];root.render(<ConfigProvider theme={themeTokens[theme]}><App><main style={{padding:24}}><h1>OpsPilot</h1><ControllerProjectPanel key={++id} binding={${JSON.stringify(binding)}}/></main></App></ConfigProvider>)};`,
        resolveDir: join(root, 'app'),
        sourcefile: 'spa-ui-lab.jsx',
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
    window.webContents.on('console-message', (event) => {
      if (event.level === 'error') errors.push('RENDERER_ERROR')
    })
    await window.loadFile(join(directory, 'index.html'))
    window.showInactive()
    const js = (source) => window.webContents.executeJavaScript(source, true)
    const wait = async (source) => {
      proof.last_wait = source
      const until = Date.now() + 15000
      while (!(await js(source))) {
        if (Date.now() > until) throw Error('UI_WAIT_TIMEOUT')
        await new Promise((r) => setTimeout(r, 60))
      }
    }
    const click = async (label) => {
      const expr = `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)})`
      await wait(`!!(${expr})&&!(${expr}).disabled`)
      await js(`(${expr}).click()`)
    }
    const choose = async (name, value) => {
      await js(
        `document.querySelector('#${name}').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`
      )
      const expr = `Array.from(document.querySelectorAll('.ant-select-item-option')).find(e=>e.textContent.trim()===${JSON.stringify(value)})`
      await wait(`!!(${expr})`)
      await js(`(${expr}).click()`)
    }
    const field = async (name, value) =>
      js(
        `(()=>{const e=document.querySelector('#${name}');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`
      )
    const form = async (locale, theme) => {
      await js(`window.showProjects(${JSON.stringify(locale)},${JSON.stringify(theme)})`)
      await wait('!!window.copy&&!!document.querySelector(".controller-project-panel")')
      const t = await js('window.copy')
      await click(t.create)
      await wait(
        '!!document.querySelector("#framework")&&!document.querySelector(".ant-select-loading")'
      )
      await choose('framework', frameworkLabel)
      await choose('target_vps_id', 'SPA target · target.invalid (#77)')
      await field('app_name', 'spa-ui-' + locale + '-' + theme)
      await field('repository_url', 'https://github.com/example/spa')
      assert.deepEqual(
        await js(
          '({port:document.querySelector("#container_port").value,disabled:document.querySelector("#container_port").disabled,path:document.querySelector("#healthcheck_path").value})'
        ),
        { port: next ? '3000' : '80', disabled: !next, path: '/' }
      )
      await click(t.review)
      await wait(`document.body.textContent.includes(${JSON.stringify(t.confirmHint)})`)
      assert.equal(
        await js(
          `document.querySelector(".ant-descriptions").textContent.includes(${JSON.stringify(frameworkLabel)})`
        ),
        true
      )
      return t
    }
    const capture = async (name, width, height) => {
      window.setContentSize(width, height)
      await new Promise((r) => setTimeout(r, 120))
      const layout = await js(
        '({window:document.documentElement.scrollWidth>document.documentElement.clientWidth,modal:document.querySelector(".ant-modal-body").scrollWidth>document.querySelector(".ant-modal-body").clientWidth})'
      )
      assert.deepEqual(layout, { window: false, modal: false })
      const file = join(screenshots, `${name}-${width}x${height}.png`),
        bytes = (await window.webContents.capturePage()).toPNG()
      writeFileSync(file, bytes)
      captures.push({
        file: file.slice(root.length + 1).replaceAll('\\', '/'),
        sha256: createHash('sha256').update(bytes).digest('hex'),
        layout
      })
    }
    for (const locale of ['vi', 'en', 'cn', 'jp'])
      for (const theme of ['dark', 'light']) {
        await form(locale, theme)
        await capture(`${locale}-${theme}`, 1280, 800)
        if (locale === 'vi') await capture(`${locale}-${theme}`, 1366, 768)
        await js('document.querySelector(".ant-modal-close").click()')
      }
    checks.push('4locale_2theme_' + framework + '_defaults_review_native_layout')
    stage = 'register'
    let t = await form('vi', 'dark')
    await click(t.confirm)
    await wait(
      '!document.querySelector(".ant-modal-wrap")||document.querySelector(".ant-modal-wrap").style.display==="none"'
    )
    await wait(`document.body.textContent.includes(${JSON.stringify(t.registeredHint)})`)
    const registered = setups.list(bindingId)[0]
    assert.equal(registered.framework, framework)
    assert.equal(registered.state, 'registered')
    assert.equal(remote.size, 1)
    checks.push('production_preload_main_sqlite_preserves_' + framework + '_registration')
    mismatch = true
    t = await form('en', 'light')
    const sentBefore = calls.filter((c) => c === 'controller:send-project').length
    await click(t.confirm)
    await wait(`document.body.textContent.includes(${JSON.stringify(t.changed)})`)
    assert.equal(calls.filter((c) => c === 'controller:send-project').length, sentBefore)
    assert.equal(setups.list(bindingId).filter((r) => r.state === 'prepared').length, 1)
    checks.push('framework_mismatch_leaves_journal_unsent')
    assert.equal(database.prepare('SELECT COUNT(*) n FROM deployment').get().n, 0)
    assert(!JSON.stringify(setups.list(bindingId)).includes(token))
    assert.equal(errors.length, 0)
    checks.push('no_deployment_or_secret_in_ui_metadata')
    proof.status = 'PASS'
  } catch (error) {
    proof.stage = stage
    proof.error = error.name
    proof.location = /electron\.mjs:\d+:\d+/.exec(error.stack ?? '')?.[0] ?? null
    if (window && !window.isDestroyed()) {
      proof.diagnostic_text = await window.webContents.executeJavaScript(
        'document.body.textContent.slice(-6000)'
      )
      writeFileSync(
        join(directory, 'failure.png'),
        (await window.webContents.capturePage()).toPNG()
      )
    }
  } finally {
    window?.destroy()
    code?.closeDatabase()
    assert.equal(realpathSync(privateData), resolve(privateData))
    assert.equal(resolve(privateData, '..'), directory)
    rmSync(privateData, { recursive: true })
    proof.private_data_removed = true
    proof.calls = calls
    writeFileSync(join(directory, 'result.json'), JSON.stringify(proof, null, 2) + '\n')
    console.log(
      JSON.stringify({
        status: proof.status,
        checks: checks.length,
        captures: captures.length,
        directory,
        stage: proof.stage,
        location: proof.location
      })
    )
    clearTimeout(watchdog)
    app.exit(proof.status === 'PASS' ? 0 : 1)
  }
})
