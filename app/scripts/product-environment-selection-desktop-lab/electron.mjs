/* eslint-disable @typescript-eslint/explicit-function-return-type -- Native Electron gate JavaScript. */
import assert from 'node:assert/strict'
import { app, BrowserWindow, ipcMain } from 'electron'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { createRequire } from 'node:module'
import { randomBytes, createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
if (process.argv.slice(2).join(' ') !== '--confirm-local-environment-selection-ui') app.exit(2)
const root = resolve(import.meta.dirname, '../../..'),
  require = createRequire(join(root, 'app/package.json')),
  esbuild = createRequire(require.resolve('vite/package.json'))('esbuild'),
  nonce = randomBytes(6).toString('hex'),
  directory = join(root, 'app/.out-scripts/product-environment-selection-desktop-lab', nonce),
  privateData = join(directory, 'private'),
  screenshots = join(root, 'docs/ui-redesign/screenshots/r7h3c', nonce)
mkdirSync(privateData, { recursive: true })
mkdirSync(screenshots, { recursive: true })
app.setPath('userData', join(directory, 'profile'))
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('force-device-scale-factor', '1')
const proof = {
  status: 'FAIL',
  scope: 'REAL_ELECTRON_ENVIRONMENT_SELECTION_PRELOAD_MAIN_SQLITE_SYNTHETIC_SSH',
  nonce,
  checks: [],
  captures: [],
  production_profile_used: false,
  ssh_transport_real: false,
  vps_used: false
}
let code,
  f,
  window,
  service,
  loseReply = false,
  stage = 'start'
const marker = 'SYNTHETIC_UI_ENV_' + randomBytes(16).toString('hex')
const watchdog = setTimeout(() => app.exit(2), 180000)
const raw = {
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
    f = await code.fixture(privateData)
    const identity = {
      vpsId: 1,
      host: 'controller.test',
      port: 22,
      username: 'operator',
      authType: 'key',
      hostFingerprint: 'SHA256:' + 'A'.repeat(43)
    }
    const ssh = {
      async openProductBootstrapChannel() {
        const channel = Object.assign(new EventEmitter(), {
          stderr: new PassThrough(),
          destroy() {
            /* Synthetic channel has no external resource. */
          },
          end(body) {
            queueMicrotask(() => {
              try {
                const { operation, payload } = JSON.parse(body)
                let data
                if (operation === 'project-environment-review')
                  data = new code.ProductEnvironmentSelection(f.remote, f.remoteCipher).review(
                    payload,
                    f.controllerId,
                    'unix:1000'
                  )
                else if (operation === 'project-environment-selection-state')
                  data = new code.ProductEnvironmentSelection(f.remote, f.remoteCipher).lookup(
                    payload,
                    f.controllerId,
                    'unix:1000'
                  )
                else if (operation === 'select-project-environment') {
                  data = new code.ProductEnvironmentSelection(f.remote, f.remoteCipher).select(
                    payload,
                    f.controllerId,
                    'unix:1000'
                  )
                  if (loseReply) {
                    loseReply = false
                    channel.emit('close', 1)
                    return
                  }
                } else if (operation === 'project-environment-context')
                  data = f.repo.context(payload, f.controllerId, 'unix:1000')
                else if (operation === 'project-environment-state')
                  data = f.repo.state(payload, f.controllerId, 'unix:1000')
                else if (operation === 'stage-project-environment') {
                  data = f.repo.stage(payload, f.controllerId, 'unix:1000')
                  if (loseReply) {
                    loseReply = false
                    channel.emit('close', 1)
                    return
                  }
                } else throw Error()
                channel.emit('data', Buffer.from(JSON.stringify({ ok: true, data })))
                channel.emit('end')
                channel.emit('close', 0)
              } catch {
                channel.emit('data', Buffer.from('{"ok":false,"code":"CONTROLLER_ADMIN_FAILED"}'))
                channel.emit('end')
                channel.emit('close', 0)
              }
            })
          }
        })
        return { channel, identity }
      }
    }
    service = new code.DesktopControllerService(f.db, f.cipher, ssh)
    const bindings = await service.list(),
      binding = bindings.find((b) => b.binding_id === f.bindingId),
      project = f.projects.list(f.bindingId)[0]
    const methods = {
      'controller:environment-context': 'environmentContext',
      'controller:prepare-environment-selection': 'prepareEnvironmentSelection',
      'controller:send-environment-selection': 'sendEnvironmentSelection',
      'controller:check-environment-selection': 'checkEnvironmentSelection',
      'controller:environment-selections': 'listEnvironmentSelections',
      'controller:cancel-environment-selection': 'cancelEnvironmentSelection',
      'controller:prepare-environment': 'prepareEnvironment',
      'controller:send-environment': 'sendEnvironment',
      'controller:check-environment': 'checkEnvironment',
      'controller:environment-intents': 'listEnvironmentIntents',
      'controller:cancel-environment': 'cancelEnvironment'
    }
    for (const [channel, method] of Object.entries(methods))
      ipcMain.handle(channel, async (_event, input) => {
        try {
          const data = await service[method](input)
          assert(!JSON.stringify(data).includes(marker))
          return { ok: true, data }
        } catch {
          return {
            ok: false,
            error: {
              technical: 'ENVIRONMENT_UNAVAILABLE',
              message: 'Operation could not be confirmed'
            }
          }
        }
      })
    stage = 'renderer'
    await esbuild.build({
      stdin: {
        contents: `import React from'react';import{createRoot}from'react-dom/client';import{ConfigProvider}from'antd';import{ControllerProjectEnvironment}from'./src/renderer/src/components/ControllerProjectEnvironment';import{CONTROLLER_ENVIRONMENT_COPY}from'./src/renderer/src/components/controllerEnvironmentCopy';import{ENVIRONMENT_SELECTION_COPY}from'./src/renderer/src/components/ControllerEnvironmentSelection';import{useUiState}from'./src/renderer/src/store/uiState';import{themeTokens,applyTheme}from'./src/renderer/src/utils/themeTokens';import'./src/renderer/src/assets/main.css';const root=createRoot(document.getElementById('root'));let id=0;window.showEnvironment=(locale,theme)=>{useUiState.setState({locale,theme});applyTheme(theme);window.copy=CONTROLLER_ENVIRONMENT_COPY[locale];window.selectionCopy=ENVIRONMENT_SELECTION_COPY[locale];root.render(<ConfigProvider theme={themeTokens[theme]}><main style={{padding:24}}><h1>OpsPilot</h1><ControllerProjectEnvironment key={++id} binding={${JSON.stringify(binding)}} project={${JSON.stringify(project)}}/></main></ConfigProvider>)};`,
        resolveDir: join(root, 'app'),
        sourcefile: 'environment-ui-lab.jsx',
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
    await window.loadFile(join(directory, 'index.html'))
    window.showInactive()
    const js = (source) => window.webContents.executeJavaScript(source, true)
    const wait = async (source) => {
      const until = Date.now() + 15000
      while (!(await js(source))) {
        if (Date.now() > until) throw Error('UI_WAIT_TIMEOUT')
        await new Promise((r) => setTimeout(r, 60))
      }
    }
    const click = async (label) => {
      const expr = `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.replace(/\\s/g,'')===${JSON.stringify(label.replace(/\s/g, ''))})`
      await wait(`!!(${expr})&&!(${expr}).disabled`)
      await js(`(${expr}).click()`)
    }
    const checkbox = async (label) =>
      js(
        'Array.from(document.querySelectorAll("label")).find(e=>e.textContent.trim()===' +
          JSON.stringify(label) +
          ').querySelector("input").click()'
      )
    const capture = async (name, width, height) => {
      window.setContentSize(width, height)
      await new Promise((r) => setTimeout(r, 150))
      const layout = await js(
        '({window:document.documentElement.scrollWidth>document.documentElement.clientWidth,modal:document.querySelector(".ant-modal-body").scrollWidth>document.querySelector(".ant-modal-body").clientWidth})'
      )
      assert.deepEqual(layout, { window: false, modal: false })
      assert(!(await js(`document.body.textContent.includes(${JSON.stringify(marker)})`)))
      let painted,
        paintAttempts = 0
      for (; paintAttempts < 15; paintAttempts++) {
        await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
        await new Promise((resolve) => setTimeout(resolve, 100))
        const candidate = await window.webContents.capturePage(),
          bitmap = candidate.toBitmap(),
          colors = new Set()
        for (let offset = 0; offset + 4 <= bitmap.length; offset += 256)
          colors.add(bitmap.readUInt32LE(offset))
        if (colors.size >= 16) {
          painted = candidate
          break
        }
      }
      if (!painted) throw Error('UI_CAPTURE_NOT_PAINTED')
      const file = join(screenshots, `${name}-${width}x${height}.png`),
        bytes = painted.toPNG()
      writeFileSync(file, bytes)
      proof.captures.push({
        file: file.slice(root.length + 1).replaceAll('\\', '/'),
        sha256: createHash('sha256').update(bytes).digest('hex'),
        paint_attempts: paintAttempts + 1,
        layout
      })
    }
    for (const locale of ['vi', 'en', 'cn', 'jp'])
      for (const theme of ['dark', 'light']) {
        await js(`window.showEnvironment(${JSON.stringify(locale)},${JSON.stringify(theme)})`)
        await wait('!!window.copy')
        const t = await js('window.copy')
        await click(t.open)
        await wait(`document.body.textContent.includes(${JSON.stringify(t.snapshot)})`)
        await capture(`${locale}-${theme}`, 1280, 800)
        if (locale === 'vi') await capture(`${locale}-${theme}`, 1366, 768)
        await click(t.close)
        await wait('!document.querySelector(".ant-modal-body")')
      }
    proof.checks.push('production_component_4locale_2theme_2resolutions_no_horizontal_overflow')
    stage = 'prepare'
    await js('window.showEnvironment("en","dark")')
    await wait('window.copy.open==="Configuration"')
    const t = await js('window.copy')
    await click(t.open)
    await wait(`document.body.textContent.includes(${JSON.stringify(t.snapshot)})`)
    await click(t.add + ' — ' + t.runtime)
    const field = async (label, value) =>
      js(
        `(()=>{const e=document.querySelector('input[aria-label='+${JSON.stringify(JSON.stringify(label))}+']');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))})()`
      )
    await field(`${t.runtime} ${t.key} 1`, 'APP_TOKEN')
    await field(`${t.runtime} ${t.value} 1`, marker)
    await checkbox(t.consent)
    await click(t.prepare)
    await wait(`document.body.textContent.includes(${JSON.stringify(t.prepared)})`)
    assert(
      !(await js(
        `Array.from(document.querySelectorAll('input')).some(e=>e.value.includes(${JSON.stringify(marker)}))`
      ))
    )
    assert.equal(f.remote.prepare('SELECT count(*) n FROM product_environment_revision').get().n, 0)
    await capture('prepared-en-dark', 1280, 800)
    proof.checks.push('typed_preload_main_prepare_encrypts_values_clears_form_and_does_not_send')
    stage = 'lostreply'
    loseReply = true
    await checkbox(t.consent)
    await click(t.send)
    await wait(`document.body.textContent.includes(${JSON.stringify(t.outcome_unknown)})`)
    assert.equal(f.remote.prepare('SELECT count(*) n FROM product_environment_revision').get().n, 1)
    await capture('unknown-en-dark', 1280, 800)
    code.closeDatabase()
    f.db = code.initializeDatabase(join(privateData, 'desktop'))
    service = new code.DesktopControllerService(f.db, f.cipher, ssh)
    await click(t.close)
    await wait('!document.querySelector(".ant-modal-body")')
    await click(t.open)
    await wait(`document.body.textContent.includes(${JSON.stringify(t.outcome_unknown)})`)
    await click(t.check)
    await wait(`document.body.textContent.includes(${JSON.stringify(t.staged)})`)
    assert.equal(f.remote.prepare('SELECT count(*) n FROM product_environment_revision').get().n, 1)
    await capture('saved-en-dark', 1280, 800)
    proof.checks.push('lost_ssh_reply_cold_main_sqlite_reopen_metadata_lookup_one_revision')

    stage = 'selection'
    const selectionCopy = await js('window.selectionCopy')
    await checkbox(selectionCopy.consent)
    await click(selectionCopy.choose + ' #1')
    await wait(
      '!!Array.from(document.querySelectorAll("button")).find(e=>e.textContent===' +
        JSON.stringify(selectionCopy.send) +
        ')'
    )
    assert.equal(f.remote.prepare('SELECT count(*) n FROM product_source_environment').get().n, 0)
    await capture('selection-prepared-en-dark', 1280, 800)
    loseReply = true
    await checkbox(selectionCopy.consent)
    await click(selectionCopy.send)
    await wait('document.body.textContent.includes(' + JSON.stringify(selectionCopy.unknown) + ')')
    assert.equal(f.remote.prepare('SELECT count(*) n FROM product_source_environment').get().n, 1)
    await capture('selection-unknown-en-dark', 1280, 800)
    code.closeDatabase()
    f.db = code.initializeDatabase(join(privateData, 'desktop'))
    service = new code.DesktopControllerService(f.db, f.cipher, ssh)
    await click(t.close)
    await wait('!document.querySelector(".ant-modal-body")')
    await click(t.open)
    await wait('document.body.textContent.includes(' + JSON.stringify(selectionCopy.unknown) + ')')
    await click(selectionCopy.check)
    await wait(
      'document.body.textContent.includes(' +
        JSON.stringify(selectionCopy.selectedState) +
        ')&&!document.body.textContent.includes(' +
        JSON.stringify(selectionCopy.unknown) +
        ')'
    )
    assert.equal(f.remote.prepare('SELECT count(*) n FROM product_source_environment').get().n, 1)
    assert.equal(
      f.remote.prepare('SELECT source_generation FROM product_app_control').get().source_generation,
      2
    )
    await capture('selection-selected-en-dark', 1280, 800)
    proof.checks.push(
      'selection_confirmation_lost_reply_cold_main_reopen_lookup_one_source_generation'
    )
    stage = 'stage-after-selection'
    await checkbox(t.consent)
    await click(t.prepare)
    await wait('document.body.textContent.includes(' + JSON.stringify(t.prepared) + ')')
    await checkbox(t.consent)
    await click(t.send)
    await wait('document.body.textContent.includes("#2")')
    assert.equal(
      f.remote.prepare('SELECT max(revision) n FROM product_environment_revision').get().n,
      2
    )
    await capture('latest2-selected1-en-dark', 1280, 800)
    proof.checks.push(
      'new_stage_after_selection_uses_current_source_and_keeps_previous_selected_revision'
    )
    for (const locale of ['vi', 'en', 'cn', 'jp'])
      for (const theme of ['dark', 'light']) {
        await click((await js('window.copy')).close)
        await wait('!document.querySelector(".ant-modal-body")')
        await js(
          'window.showEnvironment(' + JSON.stringify(locale) + ',' + JSON.stringify(theme) + ')'
        )
        await click((await js('window.copy')).open)
        await wait('document.body.textContent.includes("#2")')
        await capture('selected-' + locale + '-' + theme, 1280, 800)
      }
    proof.checks.push('selected_and_latest_visible_in_all_4locales_2themes')

    stage = 'stale-selection'
    const staleCopy = await js('window.selectionCopy')
    await checkbox(staleCopy.consent)
    await click(staleCopy.choose + ' #2')
    await wait(
      '!!Array.from(document.querySelectorAll("button")).find(e=>e.textContent===' +
        JSON.stringify(staleCopy.send) +
        ')'
    )
    const current = new code.ProductEnvironmentSelection(f.remote, f.remoteCipher).review(
      {
        format: 1,
        controller_id: f.controllerId,
        app_id: 42,
        expected_ownership_generation: 1,
        expected_source_generation: 1,
        expected_source_config_sha256: f.remote
          .prepare('SELECT config_sha256 FROM product_source_config WHERE source_generation=1')
          .get().config_sha256,
        expected_target_security_revision: 1
      },
      f.controllerId,
      'unix:1000'
    )
    f.repo.append({
      scope: current.scope,
      expected_source_generation: current.source_generation,
      expected_source_config_sha256: current.source_config_sha256,
      expected_latest_revision: 2,
      values: { runtime_env: { APP_TOKEN: marker }, public_build_args: {} }
    })
    await checkbox(staleCopy.consent)
    await click(staleCopy.send)
    await wait('document.body.textContent.includes(' + JSON.stringify(staleCopy.unknown) + ')')
    await click(staleCopy.check)
    await wait(
      'document.body.textContent.includes(' +
        JSON.stringify(staleCopy.not_applied) +
        ')&&document.body.textContent.includes("#3")'
    )
    assert.equal(f.remote.prepare('SELECT count(*) n FROM product_source_environment').get().n, 1)
    await capture('stale-selection-not-applied-jp-light', 1280, 800)
    proof.checks.push(
      'stale_other_admin_revision_authoritative_unapplied_unlocks_new_request_without_source_write'
    )
    f.db.pragma('wal_checkpoint(TRUNCATE)')
    f.remote.pragma('wal_checkpoint(TRUNCATE)')
    assert(!readFileSync(join(privateData, 'desktop', 'opspilot.db')).includes(Buffer.from(marker)))
    assert(!readFileSync(join(privateData, 'remote.db')).includes(Buffer.from(marker)))
    assert.equal(f.remote.prepare('SELECT count(*) n FROM product_deploy_job').get().n, 0)
    assert.equal(
      await js(`JSON.stringify({...localStorage}).includes(${JSON.stringify(marker)})`),
      false
    )
    assert.equal(await js('JSON.stringify({...localStorage}).includes("APP_TOKEN")'), false)
    proof.checks.push('no_plaintext_in_private_databases_or_localstorage_no_deployment_or_unpause')
    proof.status = 'PASS'
  } catch (error) {
    proof.stage = stage
    proof.error_code = /^[A-Z][A-Z0-9_]+$/.test(error.message ?? '')
      ? error.message
      : 'ENVIRONMENT_UI_GATE_FAILED'
  } finally {
    window?.destroy()
    code?.closeDatabase()
    f?.remote.close()
    assert.equal(realpathSync(privateData).startsWith(realpathSync(directory)), true)
    rmSync(privateData, { recursive: true })
    // Chromium giữ khóa profile tới khi process thoát; parent run.mjs dọn đúng nonce sau close.
    proof.private_data_removed = !existsSync(privateData)
    proof.profile_cleanup = 'PENDING_PARENT_AFTER_EXIT'
    writeFileSync(join(directory, 'result.json'), JSON.stringify(proof, null, 2) + '\n')
    console.log(JSON.stringify(proof))
    clearTimeout(watchdog)
    app.exit(proof.status === 'PASS' ? 0 : 1)
  }
})
