/* eslint-disable @typescript-eslint/explicit-function-return-type -- Private Electron gate. */
import assert from 'node:assert/strict'
import { app, BrowserWindow, ipcMain } from 'electron'
import { createRequire } from 'node:module'
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, realpathSync, rmSync, lstatSync } from 'node:fs'
import { join, resolve } from 'node:path'
if (process.argv.slice(2).join(' ') !== '--confirm-local-project-reconnection-ui') app.exit(2)
const root = resolve(import.meta.dirname, '../../..'),
  require = createRequire(join(root, 'app/package.json')),
  esbuild = createRequire(require.resolve('vite/package.json'))('esbuild'),
  nonce = randomBytes(6).toString('hex'),
  directory = join(root, 'app/.out-scripts/product-project-reconnection-ui-lab', nonce),
  privateData = join(directory, 'private'),
  screenshots = join(root, 'docs/ui-redesign/screenshots/r7h4e3', nonce)
mkdirSync(privateData, { recursive: true })
mkdirSync(screenshots, { recursive: true })
app.setPath('userData', join(directory, 'profile'))
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('force-device-scale-factor', '1')
const proof = {
  status: 'FAIL',
  scope: 'REAL_ELECTRON_PRELOAD_MAIN_CLASSES_TWO_SQLITE_SYNTHETIC_ADMIN_AND_TARGET',
  nonce,
  checks: [],
  captures: [],
  IPC_calls: [],
  VPS_used: false,
  Docker_used: false,
  production_profile_used: false,
  service_composition: 'LAB_ROUTERS_TO_PRODUCTION_RECONNECTION_AND_INSPECTOR_CLASSES',
  installed_Root_transport: false
}
let code,
  f,
  window,
  stage = 'start',
  loseConfirmReply = false
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
app
  .whenReady()
  .then(async () => {
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
      const binding = {
        binding_id: f.bindingId,
        controller_id: f.controllerId,
        vps_id: 1,
        revision: f.vault.get(f.bindingId).revision,
        state: 'active',
        display_name: 'Private controller',
        remote_client_id: f.vault.get(f.bindingId).remote_client_id,
        credential_expires_at: '2030-01-01T00:00:00Z',
        updated_at: new Date().toISOString(),
        scopes: f.vault.get(f.bindingId).client.scopes
      }
      const c = await f.admin.reconnectionContext(f.bindingId, {
        format: 1,
        controller_id: f.controllerId,
        app_id: 42
      })
      const item = {
        app_id: 42,
        ownership_generation: c.scope.ownership_generation,
        source_generation: c.source.generation,
        app_name: c.app_name,
        production_ref: c.source.production_ref,
        desired_sha: null,
        auto_deploy_paused: c.auto_deploy_paused,
        reconciliation_state: 'paused',
        observed_at: null
      }
      const legacy = () =>
        JSON.stringify(
          [
            'desktop_project_setup',
            'desktop_environment_intent',
            'desktop_environment_selection',
            'desktop_postgres_intent'
          ].map((t) => f.db.prepare('SELECT * FROM ' + t).all())
        )
      const beforeLegacy = legacy()
      const methods = {
        'controller:review-project-reconnection': (input) => f.subject.review(input),
        'controller:confirm-project-reconnection': (input) => f.subject.confirm(input),
        'controller:current-project-reconnection': (key) => f.subject.current(key),
        'controller:latest-project-reconnection': (input) => f.subject.history(input),
        'controller:inspect-reconnected-postgres': (input) => f.reader.read(input)
      }
      for (const [channel, method] of Object.entries(methods))
        ipcMain.handle(channel, async (_event, input) => {
          f.clock.now = Date.now()
          proof.IPC_calls.push(channel)
          try {
            const data = await method(input)
            if (channel === 'controller:confirm-project-reconnection' && loseConfirmReply) {
              loseConfirmReply = false
              throw Error('SYNTHETIC_REPLY_LOST')
            }
            return { ok: true, data }
          } catch (error) {
            return {
              ok: false,
              error: {
                code: 'VALIDATION',
                message: 'Operation could not be confirmed',
                technical: /^[A-Z_]{1,64}$/.test(error.code ?? '')
                  ? error.code
                  : 'RECONNECTION_UNAVAILABLE'
              }
            }
          }
        })
      stage = 'renderer'
      await esbuild.build({
        stdin: {
          contents: `import React from'react';import{createRoot}from'react-dom/client';import{ConfigProvider}from'antd';import{ControllerProjectReconnection}from'./src/renderer/src/components/ControllerProjectReconnection';import{PROJECT_RECONNECTION_COPY}from'./src/renderer/src/components/projectReconnectionCopy';import{POSTGRES_INSPECTOR_COPY}from'./src/renderer/src/components/postgresInspectorCopy';import{useUiState}from'./src/renderer/src/store/uiState';import{themeTokens,applyTheme}from'./src/renderer/src/utils/themeTokens';import'./src/renderer/src/assets/main.css';const root=createRoot(document.getElementById('root'));let id=0;window.showReconnect=(locale,theme)=>{useUiState.setState({locale,theme});applyTheme(theme);window.copy=PROJECT_RECONNECTION_COPY[locale];window.inspectorCopy=POSTGRES_INSPECTOR_COPY[locale];root.render(<ConfigProvider theme={{...themeTokens[theme],token:{...themeTokens[theme].token,motion:false}}}><main style={{padding:24}}><h1>OpsPilot</h1><ControllerProjectReconnection key={++id} binding={${JSON.stringify(binding)}} app={${JSON.stringify(item)}}/></main></ConfigProvider>)};`,
          resolveDir: join(root, 'app'),
          sourcefile: 'reconnection-ui-lab.jsx',
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
          assert(Date.now() < until, 'UI_WAIT_TIMEOUT')
          await new Promise((r) => setTimeout(r, 60))
        }
      }
      const click = async (label) => {
        const expr = `Array.from(document.querySelectorAll('button')).filter(b=>b.textContent.replaceAll(' ','')===${JSON.stringify(label.replaceAll(' ', ''))}).at(-1)`
        await wait(`!!(${expr})&&!(${expr}).disabled`)
        await js(`(${expr}).click()`)
      }
      const text = async (label) =>
        wait(`document.body.textContent.includes(${JSON.stringify(label)})`)
      const capture = async (name, width, height) => {
        window.setContentSize(width, height)
        await new Promise((r) => setTimeout(r, 180))
        const layout = await js(
          '({window:document.documentElement.scrollWidth>document.documentElement.clientWidth,modal:Array.from(document.querySelectorAll(".ant-modal-body")).some(e=>e.scrollWidth>e.clientWidth)})'
        )
        assert.deepEqual(layout, { window: false, modal: false })
        let painted
        for (let i = 0; i < 15; i++) {
          await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
          await new Promise((r) => setTimeout(r, 100))
          const img = await window.webContents.capturePage(),
            bitmap = img.toBitmap(),
            colors = new Set()
          for (let off = 0; off + 4 <= bitmap.length; off += 256)
            colors.add(bitmap.readUInt32LE(off))
          if (colors.size >= 16) {
            painted = img
            break
          }
        }
        assert(painted, 'UI_CAPTURE_NOT_PAINTED')
        const file = join(screenshots, `${name}-${width}x${height}.png`),
          bytes = painted.toPNG()
        writeFileSync(file, bytes)
        proof.captures.push({
          file: file.slice(root.length + 1).replaceAll('\\', '/'),
          sha256: createHash('sha256').update(bytes).digest('hex'),
          layout
        })
      }
      const show = async (locale = 'en', theme = 'dark') => {
        await js(`window.showReconnect(${JSON.stringify(locale)},${JSON.stringify(theme)})`)
        await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
        const t = await js('window.copy')
        await click(t.open)
        await text(t.note)
        return t
      }
      for (const locale of ['vi', 'en', 'jp', 'cn'])
        for (const theme of ['dark', 'light']) {
          stage = `preview-${locale}-${theme}`
          const t = await show(locale, theme)
          await text(t.consent)
          for (const [w, h] of [
            [1280, 800],
            [1366, 768]
          ])
            await capture(`review-${locale}-${theme}`, w, h)
          assert.equal(
            f.db.prepare('SELECT count(*) n FROM desktop_project_reconnection').get().n,
            0
          )
          await click(t.close)
          await wait('!document.querySelector(".ant-modal-body")')
        }
      proof.checks.push(
        'production_renderer_4locale_2theme_2sizes_review_only_no_journal_no_outer_overflow'
      )
      stage = 'explicit-consent-lost-reply'
      const t = await show()
      await text(t.consent)
      await js('document.querySelector("input[type=checkbox]").click()')
      loseConfirmReply = true
      await click(t.confirm)
      await text(t.error)
      assert.equal(f.db.prepare('SELECT count(*) n FROM desktop_project_reconnection').get().n, 1)
      await click(t.check)
      await text(t.confirmed)
      assert.equal(
        proof.IPC_calls.filter((c) => c === 'controller:confirm-project-reconnection').length,
        1
      )
      assert.equal(legacy(), beforeLegacy)
      proof.checks.push(
        'typed_preload_actual_Main_classes_two_SQLite_explicit_consent_lost_reply_restored_without_resend_or_fake_receipt'
      )
      for (const theme of ['dark', 'light']) {
        stage = `inspector-${theme}`
        if (theme === 'light') {
          await click(t.close)
          await show('en', theme)
          await text(t.confirmed)
        }
        for (const [w, h] of [
          [1280, 800],
          [1366, 768]
        ])
          await capture(`confirmed-en-${theme}`, w, h)
        const p = await js('window.inspectorCopy')
        await click(p.open)
        await click(p.load)
        await click('public.notes')
        await text('Deployment checklist')
        for (const [w, h] of [
          [1280, 800],
          [1366, 768]
        ])
          await capture(`inspector-en-${theme}`, w, h)
        await click(p.close)
        await wait('document.querySelectorAll(".ant-modal-body").length===1')
        assert(!(await js('document.body.textContent.includes("Deployment checklist")')))
      }
      proof.checks.push(
        'reconnected_source2_selected_database_readonly_tables_rows_clear_on_close_dark_light_2sizes'
      )
      stage = 'drift'
      f.remote.exec('UPDATE product_app_control SET auto_deploy_paused=0,pause_reason=NULL')
      await click(t.check)
      await text(t.previous)
      await text(t.consent)
      assert(!(await js(`document.body.textContent.includes(${JSON.stringify(t.confirmed)})`)))
      proof.checks.push(
        'policy_drift_clears_confirmed_state_shows_previous_current_requires_new_consent'
      )
      stage = 'policy-cycle'
      await js('document.querySelector("input[type=checkbox]").click()')
      await click(t.confirm)
      await text(t.confirmed)
      assert.equal(f.db.prepare('SELECT count(*) n FROM desktop_project_reconnection').get().n, 2)
      f.remote.exec("UPDATE product_app_control SET auto_deploy_paused=1,pause_reason='operator'")
      await click(t.check)
      await text(t.confirmed)
      assert.equal(
        proof.IPC_calls.filter((c) => c === 'controller:confirm-project-reconnection').length,
        2
      )
      assert.equal(f.db.prepare('SELECT count(*) n FROM desktop_project_reconnection').get().n, 2)
      await capture('restored-A-en-light', 1280, 800)
      proof.checks.push(
        'policy_A_B_A_restores_matching_old_consent_after_fresh_current_check_without_third_confirmation'
      )
      assert.equal(legacy(), beforeLegacy)
      assert.equal(f.remote.prepare('SELECT count(*) n FROM product_deploy_job').get().n, 0)
      assert(!f.db.serialize().toString().includes('Deployment checklist'))
      proof.checks.push('samples_not_persisted_no_job_no_legacy_receipt_mutation')
      proof.status = 'PASS'
    } catch (error) {
      proof.error =
        error?.code === 'ERR_ASSERTION' ? 'ASSERTION_FAILED' : 'RECONNECTION_UI_LAB_FAILED'
      proof.stage = stage
      proof.location = /electron\.mjs:\d+:\d+/.exec(error?.stack ?? '')?.[0] ?? null
      process.exitCode = 1
    } finally {
      window?.destroy()
      code?.closeDatabase()
      if (f?.remote.open) f.remote.close()
      assert.equal(realpathSync(privateData), privateData)
      assert(!lstatSync(privateData).isSymbolicLink())
      rmSync(privateData, { recursive: true })
      proof.private_cleanup = true
      writeFileSync(join(directory, 'result.json'), JSON.stringify(proof, null, 2) + '\n')
      clearTimeout(watchdog)
      console.log(
        JSON.stringify({
          status: proof.status,
          nonce,
          checks: proof.checks.length,
          captures: proof.captures.length,
          stage
        })
      )
      app.exit(proof.status === 'PASS' ? 0 : 1)
    }
  })
  .catch(() => app.exit(2))
