/* eslint-disable @typescript-eslint/explicit-function-return-type -- Standalone JavaScript Electron UI harness. */
import assert from 'node:assert/strict'
import { app, BrowserWindow, ipcMain } from 'electron'
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
const directory = join(root, 'app/.out-scripts/controller-ui', randomBytes(6).toString('hex'))
const screenshots = join(root, 'docs/ui-redesign/screenshots/r3c6d')
mkdirSync(directory, { recursive: true })
mkdirSync(screenshots, { recursive: true })
app.setPath('userData', directory)
app.commandLine.appendSwitch('disable-renderer-backgrounding')
const bindingId = '11111111-1111-4111-8111-111111111111',
  clientId = '22222222-2222-4222-8222-222222222222'
const connection = {
  binding_id: bindingId,
  controller_id: 'demo-controller',
  vps_id: 1,
  revision: 2,
  state: 'active',
  display_name: 'Controller lab',
  remote_client_id: clientId,
  credential_expires_at: '2030-01-01T00:00:00Z',
  updated_at: new Date().toISOString()
}
const calls = [],
  checks = [],
  errors = []
for (const channel of [
  'controller:list',
  'controller:apps',
  'vps:list',
  'app:list',
  'window:set-titlebar-overlay',
  'window:is-maximized',
  'ml:get-status'
]) {
  ipcMain.handle(channel, () => {
    calls.push(channel)
    if (channel === 'controller:list') return { ok: true, data: [connection] }
    if (channel === 'controller:apps')
      return {
        ok: true,
        data: {
          binding_id: bindingId,
          controller_id: connection.controller_id,
          binding_revision: 2,
          service_state: 'ready',
          data_freshness: 'current',
          checked_at: new Date().toISOString(),
          items: [
            {
              app_id: 1,
              app_name: 'Booking service',
              production_ref: 'main',
              desired_sha: 'a'.repeat(40),
              auto_deploy_paused: false,
              reconciliation_state: 'satisfied',
              observed_at: new Date().toISOString()
            }
          ],
          next_cursor: null,
          has_more: false
        }
      }
    if (channel === 'vps:list')
      return {
        ok: true,
        data: [
          {
            id: 1,
            name: 'Lab VPS',
            host: '192.0.2.1',
            port: 22,
            username: 'root',
            host_fingerprint: 'SHA256:' + 'A'.repeat(43),
            auth_type: 'key',
            provider: null,
            region: null,
            docker_version: null,
            last_status: 'unknown',
            last_seen_at: null,
            created_at: new Date().toISOString()
          }
        ]
      }
    return {
      ok: true,
      data:
        channel === 'window:is-maximized'
          ? false
          : channel === 'ml:get-status'
            ? { running: false, port: null }
            : []
    }
  })
}
const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
const wait = async (window, expression) => {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(expression)) return
    await delay(50)
  }
  throw new Error('UI_CONDITION_TIMEOUT')
}
let window,
  finished = false
const finish = (status, code) => {
  if (finished) return
  finished = true
  writeFileSync(
    join(directory, 'result.json'),
    JSON.stringify(
      {
        status,
        scope: 'REAL_ELECTRON_CONTROLLER_UI_WITH_METADATA_FIXTURE',
        code,
        checks,
        calls,
        renderer_errors: errors,
        backend_network_exercised: false,
        production_profile_used: false
      },
      null,
      2
    )
  )
  console.log(
    JSON.stringify({
      status,
      evidence: join(directory, 'result.json'),
      screenshots,
      checks: checks.length,
      code
    })
  )
  app.exit(status === 'PASS' ? 0 : 1)
}
const watchdog = setTimeout(() => finish('FAIL', 'UI_CAPTURE_TIMEOUT'), 90000)
void app.whenReady().then(async () => {
  try {
    window = new BrowserWindow({
      width: 1280,
      height: 800,
      show: false,
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#181818', symbolColor: '#CCCCCC', height: 34 },
      webPreferences: {
        preload: join(root, 'app/out/preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    })
    window.webContents.on('render-process-gone', () => errors.push('RENDER_PROCESS_GONE'))
    window.webContents.on('console-message', (_event, level, message) => {
      if (level >= 3) errors.push(message.slice(0, 160))
    })
    await window.loadFile(join(root, 'app/out/renderer/index.html'))
    window.showInactive()
    await window.webContents.executeJavaScript(
      `localStorage.setItem('opspilot-ui-session',JSON.stringify({state:{theme:'dark',locale:'en',activePage:'settings',selectedVpsIds:[]},version:0}))`
    )
    await new Promise((resolveLoad) => {
      window.webContents.once('did-finish-load', resolveLoad)
      window.webContents.reload()
    })
    await wait(
      window,
      `document.querySelector('[data-page-key="settings"] .controller-panel')?.textContent.includes('Controller lab')`
    )
    await window.webContents.executeJavaScript(
      `Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='View Product apps').click()`
    )
    await wait(
      window,
      `document.querySelector('.controller-panel')?.textContent.includes('Booking service')`
    )
    for (const [width, height] of [
      [1280, 800],
      [1366, 768]
    ]) {
      window.setContentSize(width, height)
      for (const theme of ['dark', 'light']) {
        await window.webContents.executeJavaScript(
          `Array.from(document.querySelectorAll('.ant-segmented-item')).find(el=>el.textContent.trim()===${JSON.stringify(theme === 'dark' ? 'Dark' : 'Light')}).click()`
        )
        await delay(500)
        await window.webContents.executeJavaScript(
          'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'
        )
        const layout = await window.webContents.executeJavaScript(`(()=>{
          const main=document.querySelector('.app-main'); const panel=document.querySelector('.controller-panel');
          return {window_horizontal:document.documentElement.scrollWidth>document.documentElement.clientWidth,
            main_horizontal:main.scrollWidth>main.clientWidth,panel_width:panel.getBoundingClientRect().width,
            viewport:[innerWidth,innerHeight],has_apps:panel.textContent.includes('Booking service'),password_fields:document.querySelectorAll('input[type=password]').length};})()`)
        assert.equal(layout.window_horizontal, false)
        assert.equal(layout.main_horizontal, false)
        assert.equal(layout.has_apps, true)
        assert.equal(layout.password_fields, 0)
        await window.webContents.executeJavaScript(
          `document.querySelector('.controller-panel').scrollIntoView({block:'start'})`
        )
        const file = `controller-apps-${width}x${height}-${theme}.png`
        writeFileSync(join(screenshots, file), (await window.webContents.capturePage()).toPNG())
        checks.push({ view: 'apps', width, height, theme, ...layout, screenshot: file })
        await window.webContents.executeJavaScript(
          `Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='Register controller').click()`
        )
        await wait(window, `!!document.querySelector('.ant-modal input[id="controller_id"]')`)
        await delay(500)
        await window.webContents.executeJavaScript(
          'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'
        )
        const modal = await window.webContents.executeJavaScript(
          `(()=>{const el=document.querySelector('.ant-modal-content');return {horizontal:el.scrollWidth>el.clientWidth,height:el.getBoundingClientRect().height,viewport:innerHeight,inputs:el.querySelectorAll('input').length,password_fields:el.querySelectorAll('input[type=password]').length}})()`
        )
        assert.equal(modal.horizontal, false)
        assert.ok(modal.height < modal.viewport)
        assert.equal(modal.password_fields, 0)
        assert.ok(modal.inputs >= 6)
        const modalFile = `controller-register-${width}x${height}-${theme}.png`
        writeFileSync(
          join(screenshots, modalFile),
          (await window.webContents.capturePage()).toPNG()
        )
        checks.push({ view: 'register', width, height, theme, ...modal, screenshot: modalFile })
        await window.webContents.executeJavaScript(
          `document.querySelector('.ant-modal-body').scrollTop=document.querySelector('.ant-modal-body').scrollHeight`
        )
        await delay(200)
        const footer = await window.webContents.executeJavaScript(
          `(()=>{const body=document.querySelector('.ant-modal-body').getBoundingClientRect();const button=document.querySelector('.ant-modal button[type="submit"]').getBoundingClientRect();return {visible:button.top>=body.top&&button.bottom<=body.bottom,within_viewport:button.bottom<=innerHeight};})()`
        )
        assert.equal(footer.visible, true)
        assert.equal(footer.within_viewport, true)
        const bottomFile = `controller-register-bottom-${width}x${height}-${theme}.png`
        writeFileSync(
          join(screenshots, bottomFile),
          (await window.webContents.capturePage()).toPNG()
        )
        checks.push({
          view: 'register_footer',
          width,
          height,
          theme,
          ...footer,
          screenshot: bottomFile
        })
        await window.webContents.executeJavaScript(
          `document.querySelector('.ant-modal-close').click()`
        )
        await wait(window, `!document.querySelector('.ant-modal')`)
      }
    }
    assert.equal(errors.length, 0)
    clearTimeout(watchdog)
    finish('PASS')
  } catch {
    clearTimeout(watchdog)
    finish('FAIL', 'UI_CAPTURE_CHECK_FAILED')
  }
})
