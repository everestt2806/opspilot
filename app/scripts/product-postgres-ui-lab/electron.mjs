/* eslint-disable @typescript-eslint/explicit-function-return-type -- Native Electron gate JavaScript. */
import assert from 'node:assert/strict'
import { app, BrowserWindow, ipcMain } from 'electron'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { createRequire } from 'node:module'
import { randomBytes, createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
if (process.argv.slice(2).join(' ') !== '--confirm-local-postgres-ui') app.exit(2)
const root = resolve(import.meta.dirname, '../../..'),
  require = createRequire(join(root, 'app/package.json')),
  esbuild = createRequire(require.resolve('vite/package.json'))('esbuild'),
  nonce = randomBytes(6).toString('hex'),
  directory = join(root, 'app/.out-scripts/product-postgres-ui-lab', nonce),
  privateData = join(directory, 'private'),
  screenshots = join(root, 'docs/ui-redesign/screenshots/r7h4d3b', nonce)
mkdirSync(privateData, { recursive: true })
mkdirSync(screenshots, { recursive: true })
app.setPath('userData', join(directory, 'profile'))
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('force-device-scale-factor', '1')
const proof = {
  status: 'FAIL',
  scope: 'REAL_ELECTRON_POSTGRES_PRELOAD_MAIN_SQLITE_SYNTHETIC_SSH',
  Docker_used: false,
  nonce,
  checks: [],
  captures: [],
  production_profile_used: false,
  ssh_transport_real: false,
  database_read_transport: 'SYNTHETIC_TARGET_RESPONSE_PRODUCTION_MAIN_GUARDS',
  vps_used: false
}
let code,
  f,
  window,
  service,
  loseReply = false,
  stage = 'start'
const marker = 'SYNTHETIC_UI_PG_' + randomBytes(16).toString('hex')
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
    const methodsByOperation = {
      'project-configuration-context': 'postgresContext',
      'prepare-managed-postgres': 'preparePostgres',
      'managed-postgres-prepare-state': 'postgresPrepareState',
      'managed-postgres-state': 'postgresState',
      'managed-postgres-review': 'reviewPostgres',
      'select-managed-postgres': 'selectPostgres',
      'managed-postgres-selection-state': 'postgresSelectionState'
    }
    const ssh = {
      async openProductBootstrapChannel() {
        const channel = Object.assign(new EventEmitter(), {
          stderr: new PassThrough(),
          destroy() {
            /* Synthetic channel owns no external resource. */
          },
          end(body) {
            queueMicrotask(async () => {
              try {
                const { operation, payload } = JSON.parse(body)
                proof.last_operation = operation
                const method = methodsByOperation[operation]
                let data
                if (operation === 'managed-postgres-inspection') {
                  const context = code.reviewPostgresInspection(
                    f.remote,
                    f.remoteCipher,
                    f.controllerId,
                    payload.context
                  )
                  const columns = [
                    { name: 'id', data_type: 'integer', nullable: false },
                    { name: 'marker', data_type: 'text', nullable: true }
                  ]
                  data = {
                    context,
                    read: payload.read,
                    instance: {
                      database_id: context.database.database_id,
                      container_id: 'a'.repeat(64),
                      image_id: 'sha256:' + 'b'.repeat(64),
                      volume: `opspilot-pg-${context.database.database_id}-data`,
                      volume_created_at: '2026-11-17T00:00:00Z',
                      system_identifier: '1234567',
                      state: 'ready',
                      public_port: null
                    },
                    checked_at: new Date().toISOString(),
                    data:
                      payload.read.operation === 'tables'
                        ? [{ schema: 'public', name: 'sample', columns }]
                        : payload.read.operation === 'rows'
                          ? [
                              { id: 1, marker: 'Release checklist' },
                              { id: 2, marker: 'Review deployment' }
                            ]
                          : null
                  }
                } else {
                  assert(method && typeof f.pgAdmin[method] === 'function')
                  data = await f.pgAdmin[method](
                    f.bindingId,
                    payload.selection ?? payload,
                    () => {}
                  )
                }
                if (
                  loseReply &&
                  ['prepare-managed-postgres', 'select-managed-postgres'].includes(operation)
                ) {
                  loseReply = false
                  channel.emit('close', 1)
                  return
                }
                channel.emit('data', Buffer.from(JSON.stringify({ ok: true, data })))
                channel.emit('end')
                channel.emit('close', 0)
              } catch (error) {
                proof.transport_error = /^[A-Z][A-Z0-9_]+$/.test(error.code ?? '')
                  ? error.code
                  : 'SYNTHETIC_OPERATION_FAILED'
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
    const binding = (await service.list()).find((b) => b.binding_id === f.bindingId),
      project = f.projects.list(f.bindingId)[0]
    const methods = {
      'controller:postgres-context': 'postgresContext',
      'controller:inspect-postgres': 'inspectPostgres',
      'controller:prepare-postgres-intent': 'preparePostgresIntent',
      'controller:send-postgres-intent': 'sendPostgresIntent',
      'controller:check-postgres-intent': 'checkPostgresIntent',
      'controller:postgres-intents': 'listPostgresIntents',
      'controller:cancel-postgres-intent': 'cancelPostgresIntent'
    }
    for (const [channel, method] of Object.entries(methods))
      ipcMain.handle(channel, async (_event, input) => {
        try {
          return { ok: true, data: await service[method](input) }
        } catch {
          return {
            ok: false,
            error: {
              technical: 'POSTGRES_UNAVAILABLE',
              message: 'Operation could not be confirmed'
            }
          }
        }
      })
    stage = 'renderer'
    await esbuild.build({
      stdin: {
        contents: `import React from'react';import{createRoot}from'react-dom/client';import{ConfigProvider}from'antd';import{ControllerProjectDatabase}from'./src/renderer/src/components/ControllerProjectDatabase';import{CONTROLLER_DATABASE_COPY}from'./src/renderer/src/components/controllerDatabaseCopy';import{POSTGRES_INSPECTOR_COPY}from'./src/renderer/src/components/postgresInspectorCopy';import{useUiState}from'./src/renderer/src/store/uiState';import{themeTokens,applyTheme}from'./src/renderer/src/utils/themeTokens';import'./src/renderer/src/assets/main.css';const root=createRoot(document.getElementById('root'));let id=0;window.showDatabase=(locale,theme)=>{useUiState.setState({locale,theme});applyTheme(theme);window.copy=CONTROLLER_DATABASE_COPY[locale];window.inspectorCopy=POSTGRES_INSPECTOR_COPY[locale];root.render(<ConfigProvider theme={themeTokens[theme]}><main style={{padding:24}}><h1>OpsPilot</h1><ControllerProjectDatabase key={++id} binding={${JSON.stringify(binding)}} project={${JSON.stringify(project)}} onSourceChanged={()=>{window.sourceChanges=(window.sourceChanges||0)+1}}/></main></ConfigProvider>)};`,
        resolveDir: join(root, 'app'),
        sourcefile: 'postgres-ui-lab.jsx',
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
    const checkbox = async (label) => {
      const expression =
        'Array.from(document.querySelectorAll("label")).find(e=>e.textContent.trim()===' +
        JSON.stringify(label) +
        ')?.querySelector("input")'
      await wait(`!!(${expression})&&!(${expression}).disabled`)
      await js(`(${expression}).click()`)
    }
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
    const show = async (locale = 'en', theme = 'dark') => {
      await js(`window.showDatabase(${JSON.stringify(locale)},${JSON.stringify(theme)})`)
      await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
      await wait('!!window.copy')
      const t = await js('window.copy')
      await click(t.open)
      await wait(
        `!!Array.from(document.querySelectorAll('button')).find(b=>b.textContent.replace(/\\s/g,'')===${JSON.stringify(t.refresh.replace(/\s/g, ''))}&&!b.disabled)`
      )
      return t
    }
    for (const locale of ['vi', 'en', 'cn', 'jp'])
      for (const theme of ['dark', 'light']) {
        stage = `renderer-${locale}-${theme}`
        const t = await show(locale, theme)
        await wait(`document.body.textContent.includes(${JSON.stringify(t.none)})`)
        await capture(`empty-${locale}-${theme}`, 1280, 800)
        if (locale === 'vi') await capture(`empty-${locale}-${theme}`, 1366, 768)
        await click(t.close)
        await wait('!document.querySelector(".ant-modal-body")')
      }
    proof.checks.push(
      'production_PostgreSQL_component_4locale_2theme_2resolutions_no_horizontal_overflow'
    )
    stage = 'prepare'
    const t = await show()
    await checkbox(t.consent)
    await click(t.create)
    await wait(`document.body.textContent.includes(${JSON.stringify(t.states.prepared)})`)
    assert.equal(f.remote.prepare('SELECT count(*) n FROM product_managed_postgres').get().n, 0)
    await capture('prepared-en-dark', 1280, 800)
    proof.checks.push('typed_preload_Main_038_journal_prepare_without_server_resource_or_job')
    stage = 'lost-prepare'
    loseReply = true
    await checkbox(t.consent)
    await click(t.send)
    await wait(`document.body.textContent.includes(${JSON.stringify(t.unknown)})`)
    assert.equal(f.remote.prepare('SELECT count(*) n FROM product_managed_postgres').get().n, 1)
    await capture('prepare-unknown-en-dark', 1280, 800)
    code.closeDatabase()
    f.db = code.initializeDatabase(join(privateData, 'desktop'))
    service = new code.DesktopControllerService(f.db, f.cipher, ssh)
    await click(t.close)
    await wait('!document.querySelector(".ant-modal-body")')
    await click(t.open)
    await wait(`document.body.textContent.includes(${JSON.stringify(t.unknown)})`)
    await click(t.check)
    await wait(`document.body.textContent.includes(${JSON.stringify(t.prepared)})`)
    assert.equal(f.remote.prepare('SELECT count(*) n FROM product_managed_postgres').get().n, 1)
    proof.checks.push('lost_prepare_reply_Main_SQLite_reopen_original_receipt_lookup_one_resource')
    stage = 'select'
    stage = 'prepare-selection'
    await checkbox(t.consent)
    await click(t.select)
    await wait(`document.body.textContent.includes(${JSON.stringify(t.states.prepared)})`)
    assert.equal(f.remote.prepare('SELECT count(*) n FROM product_source_postgres').get().n, 0)
    stage = 'send-selection'
    loseReply = true
    await checkbox(t.consent)
    await click(t.send)
    await wait(`document.body.textContent.includes(${JSON.stringify(t.unknown)})`)
    await capture('select-unknown-en-dark', 1280, 800)
    assert.equal(f.remote.prepare('SELECT count(*) n FROM product_source_postgres').get().n, 1)
    await click(t.check)
    await wait('window.sourceChanges===1')
    await wait(
      `!!Array.from(document.querySelectorAll('button')).find(b=>b.textContent.replace(/\\s/g,'')===${JSON.stringify(t.select.replace(/\s/g, ''))})`
    )
    proof.checks.push(
      'lost_select_reply_exact_lookup_no_resend_one_source_binding_deployment_views_invalidated'
    )
    for (const theme of ['dark', 'light']) {
      const copy = await show('vi', theme)
      await wait(`document.body.textContent.includes(${JSON.stringify(copy.states.selected)})`)
      await capture(`selected-vi-${theme}`, 1280, 800)
      await capture(`selected-vi-${theme}`, 1366, 768)
      await click(copy.close)
      await wait('!document.querySelector(".ant-modal-body")')
    }
    assert.equal(f.remote.prepare('SELECT count(*) n FROM product_deploy_job').get().n, 0)
    assert.equal(f.remote.prepare('SELECT count(*) n FROM product_managed_postgres').get().n, 1)
    assert.equal(f.remote.prepare('SELECT count(*) n FROM product_source_postgres').get().n, 1)
    assert.equal(await js('!!document.querySelector("input[type=password]")'), false)
    proof.checks.push(
      'metadata_only_no_password_readback_no_deploy_no_Docker_or_runtime_health_claim'
    )
    const changesBefore = f.db.prepare('SELECT total_changes() n').get().n
    const remoteChangesBefore = f.remote.prepare('SELECT total_changes() n').get().n
    for (const locale of ['vi', 'en', 'jp', 'cn'])
      for (const theme of ['dark', 'light']) {
        stage = `inspector-${locale}-${theme}`
        await js(`window.showDatabase(${JSON.stringify(locale)},${JSON.stringify(theme)})`)
        await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
        const c = await js('window.inspectorCopy')
        await click(c.open)
        await click(c.load)
        await click('public.sample')
        await wait('document.body.textContent.includes("Release checklist")')
        await capture(`inspector-rows-${locale}-${theme}`, 1280, 800)
        if (locale === 'vi') await capture(`inspector-rows-${locale}-${theme}`, 1366, 768)
        if (locale === 'vi' && theme === 'dark') {
          await js(
            `Array.from(document.querySelectorAll('[role=tab]')).find(e=>e.textContent===${JSON.stringify(c.structure)}).click()`
          )
          await wait('document.body.textContent.includes("integer")')
          await capture('inspector-columns-vi-dark', 1366, 768)
        }
        await click(c.close)
        await wait('!document.querySelector(".ant-modal-body")')
        assert(!(await js('document.body.textContent.includes("Release checklist")')))
      }
    assert.equal(f.db.prepare('SELECT total_changes() n').get().n, changesBefore)
    assert.equal(f.remote.prepare('SELECT total_changes() n').get().n, remoteChangesBefore)
    assert(!f.db.serialize().includes(Buffer.from('Release checklist')))
    proof.checks.push(
      'inspector_4locale_2theme_table_rows_columns_production_preload_Main_real_SQLite_synthetic_target'
    )
    proof.checks.push(
      'inspector_scope_derived_and_samples_removed_after_close_not_persisted_no_controller_writes'
    )
    proof.status = 'PASS'
  } catch (error) {
    proof.stage = stage
    proof.error_code = /^[A-Z][A-Z0-9_]+$/.test(error.message ?? '')
      ? error.message
      : 'POSTGRES_UI_GATE_FAILED'
  } finally {
    window?.destroy()
    code?.closeDatabase()
    f?.remote.close()
    assert.equal(resolve(realpathSync(privateData), '..'), realpathSync(directory))
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
