/* eslint-disable @typescript-eslint/explicit-function-return-type -- Standalone JavaScript Electron UI harness. */
import assert from 'node:assert/strict'
import { app, BrowserWindow, ipcMain } from 'electron'
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../..')
const directory = join(root, 'app/.out-scripts/controller-ui', randomBytes(6).toString('hex'))
const screenshots = join(root, 'docs/ui-redesign/screenshots/r3c6g2')
mkdirSync(directory, { recursive: true })
mkdirSync(screenshots, { recursive: true })
app.setPath('userData', directory)
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('force-device-scale-factor', '1')
const bindingId = '11111111-1111-4111-8111-111111111111',
  clientId = '22222222-2222-4222-8222-222222222222'
const connection = {
  binding_id: bindingId,
  controller_id: 'demo-controller',
  vps_id: 1,
  revision: 2,
  state: 'active',
  scopes: ['read', 'deploy:manual', 'policy:write'],
  display_name: 'Controller lab',
  remote_client_id: clientId,
  credential_expires_at: '2030-01-01T00:00:00Z',
  updated_at: new Date().toISOString()
}
const calls = [],
  checks = [],
  errors = []
let commandRows = []
let projectRows = []
for (const channel of [
  'controller:list',
  'controller:apps',
  'controller:commands',
  'controller:app-status',
  'controller:prepare-command',
  'controller:send-command',
  'controller:check-command',
  'controller:cancel-command',
  'controller:project-targets',
  'controller:prepare-project',
  'controller:send-project',
  'controller:projects',
  'controller:cancel-project',
  'vps:list',
  'app:list',
  'window:set-titlebar-overlay',
  'window:is-maximized',
  'ml:get-status'
]) {
  ipcMain.handle(channel, (_event, input) => {
    calls.push(channel)
    if (channel === 'controller:list') return { ok: true, data: [connection] }
    if (channel === 'controller:projects') return { ok: true, data: projectRows }
    if (channel === 'controller:project-targets')
      return {
        ok: true,
        data: {
          binding_id: bindingId,
          binding_revision: 2,
          controller_id: connection.controller_id,
          items: [
            {
              id: 77,
              name: 'Target lab',
              host: '192.0.2.2',
              port: 22,
              username: 'operator',
              host_fingerprint: 'SHA256:' + 'B'.repeat(43),
              ssh_security_revision: 3
            }
          ],
          next_after_id: null,
          has_more: false
        }
      }
    if (channel === 'controller:prepare-project') {
      assert.equal(input.target_vps_id, 77)
      assert.equal(input.repository_url, 'https://github.com/example/demo.git')
      projectRows = [
        {
          request_key: '44444444-4444-4444-8444-444444444444',
          binding_id: bindingId,
          binding_revision: 2,
          controller_id: connection.controller_id,
          target_vps_id: 77,
          target_security_revision: 3,
          app_name: input.app_name,
          repository_url: input.repository_url,
          production_ref: input.production_ref,
          repository_root: input.repository_root,
          host_port: input.host_port,
          container_port: input.container_port,
          healthcheck_path: input.healthcheck_path,
          state: 'prepared',
          app_id: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ]
      return { ok: true, data: projectRows[0] }
    }
    if (channel === 'controller:send-project') {
      assert.equal(input, projectRows[0].request_key)
      projectRows = projectRows.map((row) => ({
        ...row,
        state: 'registered',
        app_id: 43,
        host_port: 30000
      }))
      return { ok: true, data: projectRows[0] }
    }
    if (channel === 'controller:cancel-project') throw new Error('UNEXPECTED_GUI_PROJECT_CANCEL')
    if (channel === 'controller:commands') return { ok: true, data: commandRows }
    if (channel === 'controller:prepare-command') {
      commandRows = [
        {
          request_key: '33333333-3333-4333-8333-333333333333',
          binding_id: bindingId,
          controller_id: connection.controller_id,
          client_id: clientId,
          binding_revision: 2,
          app_id: input.app_id,
          operation: input.operation,
          state: 'prepared',
          remote_state: null,
          reason_code: null,
          job_id: null,
          target_sha: null,
          auto_deploy_paused: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ]
      assert.equal(input.target.sha, 'a'.repeat(40))
      assert.equal(input.expected_ownership_generation, 1)
      return { ok: true, data: commandRows[0] }
    }
    if (channel === 'controller:send-command') {
      commandRows = commandRows.map((row) => ({ ...row, state: 'outcome_unknown' }))
      return { ok: true, data: commandRows[0] }
    }
    if (channel === 'controller:check-command' || channel === 'controller:cancel-command')
      throw new Error('UNEXPECTED_GUI_REPLAY')
    if (channel === 'controller:app-status')
      return {
        ok: true,
        data: {
          binding_id: bindingId,
          binding_revision: 2,
          controller_id: connection.controller_id,
          app_id: input.app_id,
          ownership_generation: 1,
          source_generation: 1,
          current_deployment_id: 12,
          current_deployment_sha: 'a'.repeat(40),
          current_deployment_state: 'running',
          latest_job_id: 'job-12',
          latest_job_state: commandRows.length ? 'queued' : 'succeeded',
          checked_at: new Date().toISOString(),
          data_freshness: 'current'
        }
      }
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
          capabilities: { redeploy: 'available', pause: 'available', resume: 'available' },
          items: [
            {
              app_id: 1,
              ownership_generation: 1,
              source_generation: 1,
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
          `Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='Close app list').click()`
        )
        await wait(window, `!document.querySelector('.controller-command-panel')`)
        commandRows = []
        projectRows = []
        await window.webContents.executeJavaScript(
          `Array.from(document.querySelectorAll('button')).find(el=>el.textContent.trim()==='View Product apps').click()`
        )
        await wait(window, `!!document.querySelector('.controller-command-panel')`)
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
        await window.webContents.executeJavaScript(`(()=>{
          const panel=document.querySelector('.controller-command-panel');panel.scrollIntoView({block:'start'});
          panel.querySelector('.ant-select-selector').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));})()`)
        await wait(
          window,
          `!!document.querySelector('.ant-select-item-option[title="Booking service"]')`
        )
        await window.webContents.executeJavaScript(
          `document.querySelector('.ant-select-item-option[title="Booking service"]').click()`
        )
        await wait(
          window,
          `Array.from(document.querySelectorAll('.controller-command-panel button')).some(el=>el.textContent.trim()==='Deploy this commit'&&!el.disabled)`
        )
        await delay(350)
        const actionFile = `controller-actions-${width}x${height}-${theme}.png`
        writeFileSync(
          join(screenshots, actionFile),
          (await window.webContents.capturePage()).toPNG()
        )
        checks.push({
          view: 'actions',
          width,
          height,
          theme,
          enabled_after_fresh_status: true,
          screenshot: actionFile
        })
        await window.webContents.executeJavaScript(
          `Array.from(document.querySelectorAll('.controller-command-panel button')).find(el=>el.textContent.trim()==='Deploy this commit').click()`
        )
        await wait(window, `!!document.querySelector('.ant-modal-confirm-body')`)
        await delay(350)
        const confirmation = await window.webContents.executeJavaScript(
          `document.querySelector('.ant-modal-confirm-body').textContent`
        )
        assert.ok(confirmation.includes('a'.repeat(40)))
        const confirmationFile = `controller-confirm-${width}x${height}-${theme}.png`
        writeFileSync(
          join(screenshots, confirmationFile),
          (await window.webContents.capturePage()).toPNG()
        )
        checks.push({
          view: 'confirmation',
          width,
          height,
          theme,
          exact_sha_shown: true,
          screenshot: confirmationFile
        })
        await window.webContents.executeJavaScript(
          `Array.from(document.querySelectorAll('.ant-modal-confirm button')).find(el=>el.textContent.trim()==='Confirm').click()`
        )
        await wait(
          window,
          `document.querySelector('.controller-command-panel')?.textContent.includes('Acceptance is unknown')`
        )
        await wait(window, `!document.querySelector('.ant-modal-confirm')`)
        await delay(350)
        const unknownFile = `controller-unknown-${width}x${height}-${theme}.png`
        writeFileSync(
          join(screenshots, unknownFile),
          (await window.webContents.capturePage()).toPNG()
        )
        assert.equal(commandRows.length, 1)
        checks.push({
          view: 'unknown',
          width,
          height,
          theme,
          no_automatic_replay: true,
          screenshot: unknownFile
        })
        await window.webContents.executeJavaScript(
          `Array.from(document.querySelectorAll('.controller-project-panel button')).find(el=>el.textContent.trim()==='Create project').click()`
        )
        await wait(window, `!!document.querySelector('.ant-modal input[id="app_name"]')`)
        await window.webContents.executeJavaScript(
          `document.querySelector('.ant-modal .ant-select-selector').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`
        )
        await wait(
          window,
          `!!document.querySelector('.ant-select-item-option[title="Target lab · 192.0.2.2 (#77)"]')`
        )
        await window.webContents.executeJavaScript(
          `document.querySelector('.ant-select-item-option[title="Target lab · 192.0.2.2 (#77)"]').click()`
        )
        await window.webContents.executeJavaScript(
          `(()=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const [id,value] of [['app_name','demo-api'],['repository_url','https://github.com/example/demo']]){const el=document.getElementById(id);setter.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));}})()`
        )
        await delay(300)
        const projectForm = await window.webContents.executeJavaScript(
          `(()=>{const el=document.querySelector('.ant-modal-content');return{horizontal:el.scrollWidth>el.clientWidth,height:el.getBoundingClientRect().height,viewport:innerHeight,password_fields:el.querySelectorAll('input[type=password]').length}})()`
        )
        assert.equal(projectForm.horizontal, false)
        assert.ok(projectForm.height < projectForm.viewport)
        assert.equal(projectForm.password_fields, 0)
        const projectFormFile = `project-form-${width}x${height}-${theme}.png`
        writeFileSync(
          join(screenshots, projectFormFile),
          (await window.webContents.capturePage()).toPNG()
        )
        checks.push({
          view: 'project_form',
          width,
          height,
          theme,
          ...projectForm,
          screenshot: projectFormFile
        })
        await window.webContents.executeJavaScript(
          `document.querySelector('.ant-modal-body').scrollTop=document.querySelector('.ant-modal-body').scrollHeight`
        )
        await delay(150)
        const projectFooter = await window.webContents.executeJavaScript(
          `(()=>{const el=Array.from(document.querySelectorAll('.ant-modal button')).find(el=>el.textContent.trim()==='Review configuration').getBoundingClientRect();const body=document.querySelector('.ant-modal-body').getBoundingClientRect();return{visible:el.top>=body.top&&el.bottom<=body.bottom,within_viewport:el.bottom<=innerHeight}})()`
        )
        assert.equal(projectFooter.visible, true)
        assert.equal(projectFooter.within_viewport, true)
        const projectBottomFile = `project-form-bottom-${width}x${height}-${theme}.png`
        writeFileSync(
          join(screenshots, projectBottomFile),
          (await window.webContents.capturePage()).toPNG()
        )
        checks.push({
          view: 'project_form_footer',
          width,
          height,
          theme,
          ...projectFooter,
          screenshot: projectBottomFile
        })
        await window.webContents.executeJavaScript(
          `Array.from(document.querySelectorAll('.ant-modal button')).find(el=>el.textContent.trim()==='Review configuration').click()`
        )
        await wait(
          window,
          `Array.from(document.querySelectorAll('.ant-modal button')).some(el=>el.textContent.trim()==='Register project')`
        )
        await window.webContents.executeJavaScript(
          `document.querySelector('.ant-modal-body').scrollTop=0`
        )
        await delay(250)
        const projectReview = await window.webContents.executeJavaScript(
          `document.querySelector('.ant-modal').textContent`
        )
        assert.ok(projectReview.includes('#77'))
        assert.ok(projectReview.includes('https://github.com/example/demo.git'))
        assert.equal(projectRows.length, 0)
        const projectReviewFile = `project-review-${width}x${height}-${theme}.png`
        writeFileSync(
          join(screenshots, projectReviewFile),
          (await window.webContents.capturePage()).toPNG()
        )
        checks.push({
          view: 'project_review',
          width,
          height,
          theme,
          remote_target_and_canonical_source: true,
          no_create_before_confirmation: true,
          screenshot: projectReviewFile
        })
        await window.webContents.executeJavaScript(
          `Array.from(document.querySelectorAll('.ant-modal button')).find(el=>el.textContent.trim()==='Register project').click()`
        )
        await wait(
          window,
          `document.querySelector('.controller-project-panel')?.textContent.includes('The project is registered; this is not a deployment.')`
        )
        await wait(window, `!document.querySelector('.ant-modal')`)
        await window.webContents.executeJavaScript(
          `document.querySelector('.controller-project-panel').scrollIntoView({block:'start'})`
        )
        await delay(250)
        assert.equal(projectRows.length, 1)
        assert.equal(projectRows[0].state, 'registered')
        const projectResultFile = `project-registered-${width}x${height}-${theme}.png`
        writeFileSync(
          join(screenshots, projectResultFile),
          (await window.webContents.capturePage()).toPNG()
        )
        checks.push({
          view: 'project_registered',
          width,
          height,
          theme,
          registered_distinct_from_deployed: true,
          screenshot: projectResultFile
        })
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
