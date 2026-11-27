/* eslint-disable @typescript-eslint/explicit-function-return-type -- Standalone Electron interaction/layout proof. */
import assert from 'node:assert/strict'
import { app, BrowserWindow, ipcMain } from 'electron'
import { createRequire } from 'node:module'
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../../..'),
  require = createRequire(import.meta.url)
const esbuild = createRequire(require.resolve('vite/package.json'))('esbuild')
const directory = join(
  root,
  'app/.out-scripts/controller-installer-ui',
  randomBytes(6).toString('hex')
)
const screenshots = join(root, 'docs/ui-redesign/screenshots/r3c6h2c')
mkdirSync(directory, { recursive: true })
mkdirSync(screenshots, { recursive: true })
app.setPath('userData', join(directory, 'profile'))
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('force-device-scale-factor', '1')
const copyPath = join(directory, 'copy.cjs')
esbuild.buildSync({
  entryPoints: [join(root, 'app/src/renderer/src/components/controllerInstallerCopy.ts')],
  outfile: copyPath,
  bundle: true,
  platform: 'node',
  format: 'cjs'
})
const copy = require(copyPath).CONTROLLER_INSTALLER_COPY
const key = '11111111-1111-4111-8111-111111111111',
  binding = '33333333-3333-4333-8333-333333333333'
const calls = [],
  checks = [],
  errors = []
let installation,
  loseReply = false,
  missingPackage = false
const record = (state) => ({
  request_key: key,
  vps_id: 1,
  authority_revision: 1,
  release_id: 'linux22',
  release_sha256: 'a'.repeat(64),
  installer_sha256: 'b'.repeat(64),
  state,
  controller_id: state === 'installed' ? key : null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  last_result:
    state === 'installed'
      ? {
          format: 1,
          request_key: key,
          phase: 'installed',
          controller_id: key,
          service_state: 'running',
          runtime_uid: 1001,
          service_enabled: true,
          artifact_path: '/opt/controller/payload/control-plane.cjs',
          node_path: '/opt/controller/node',
          data_directory: '/var/lib/controller',
          payload_sha256: 'c'.repeat(64)
        }
      : null
})
const ok = (data) => ({ ok: true, data })
for (const channel of [
  'controller:list',
  'controller:installer-overview',
  'controller:review-installation',
  'controller:prepare-installation',
  'controller:send-installation',
  'controller:inspect-installation',
  'controller:prepare-installed-binding',
  'controller:register-installed',
  'vps:list',
  'app:list',
  'window:set-titlebar-overlay',
  'window:is-maximized',
  'ml:get-status'
])
  ipcMain.handle(channel, (_event, input) => {
    calls.push({ channel, input })
    if (channel === 'controller:installer-overview')
      return ok({
        releases: missingPackage
          ? []
          : [
              {
                release_id: 'linux22',
                node_version: '22.23.4',
                minimum_glibc: '2.39',
                platform: 'linux-x64-glibc',
                state: 'available'
              }
            ],
        installations: installation ? [installation] : [],
        connections: []
      })
    if (channel === 'vps:list')
      return ok([
        {
          id: 1,
          name: 'Development VPS',
          host: '192.0.2.1',
          username: 'root',
          port: 22,
          auth_type: 'key',
          host_fingerprint: 'SHA256:' + 'A'.repeat(43)
        }
      ])
    if (channel === 'controller:review-installation')
      return ok({
        next: 'install',
        root_required: false,
        plan: {
          plan_id: key,
          expires_at: new Date(Date.now() + 60000).toISOString(),
          vps_id: 1,
          host: '192.0.2.1',
          username: 'root',
          host_fingerprint: 'SHA256:' + 'A'.repeat(43),
          release_id: 'linux22',
          request_key: key,
          remote_existing: false,
          rebind_required: false
        },
        host: {
          state: 'compatible_snapshot',
          service_mode: 'system',
          reasons: [],
          facts: {
            format: 1,
            system: 'Linux',
            architecture: 'x86_64',
            libc: 'glibc',
            libc_version: '2.39',
            uid: 0,
            available_memory_bytes: 3 * 1024 ** 3,
            free_disk_bytes: 70 * 1024 ** 3,
            systemd_system: true,
            systemd_user_bus: false,
            user_linger: false,
            installation_conflict: false
          }
        }
      })
    if (channel === 'controller:prepare-installation') {
      installation = record('prepared')
      return ok(installation)
    }
    if (channel === 'controller:send-installation') {
      assert.equal(input.request_key, key)
      assert.equal(input.consent, true)
      if (input.operation === 'install' && loseReply) {
        installation = record('outcome_unknown')
        return { ok: false, error: { code: 'VALIDATION', technical: 'BOOTSTRAP_OUTCOME_UNKNOWN' } }
      }
      installation = record(input.operation === 'transfer' ? 'transferred' : 'installed')
      return ok(installation)
    }
    if (channel === 'controller:inspect-installation') {
      assert.equal(input, key)
      installation = record('installed')
      return ok(installation)
    }
    if (channel === 'controller:prepare-installed-binding')
      return ok({ binding_id: binding, state: 'pending' })
    if (channel === 'controller:register-installed') {
      assert.equal(input.binding_id, binding)
      assert.equal(input.allow_write, false)
      return ok({ state: 'active' })
    }
    return ok(
      channel === 'window:is-maximized'
        ? false
        : channel === 'ml:get-status'
          ? { running: false, port: null }
          : []
    )
  })
const delay = (ms) => new Promise((done) => setTimeout(done, ms))
let window
const js = (expression) => window.webContents.executeJavaScript(expression)
const wait = async (expression) => {
  const until = Date.now() + 15000
  while (Date.now() < until) {
    if (await js(expression)) return
    await delay(50)
  }
  throw Error('UI_CONDITION_TIMEOUT')
}
const buttonExpression = (text) =>
  `Array.from(document.querySelectorAll('button')).find(el=>el.textContent.replace(/\\s/g,'')===${JSON.stringify(text.replace(/\s/g, ''))})`
const click = async (text) => {
  const expression = buttonExpression(text)
  await wait(`${expression} && !${expression}.disabled`)
  await js(`${expression}.click()`)
}
const capture = async (view, width, height, theme, locale) => {
  await delay(180)
  const layout =
    await js(`(()=>{const el=document.querySelector('.ant-modal-content'),body=document.querySelector('.ant-modal-body'),footer=document.querySelector('.ant-modal-footer');return {
    window_horizontal:document.documentElement.scrollWidth>document.documentElement.clientWidth,
    modal_horizontal:el.scrollWidth>el.clientWidth,body_horizontal:body.scrollWidth>body.clientWidth,
    footer_inside:footer.getBoundingClientRect().bottom<=innerHeight,password_fields:el.querySelectorAll('input[type=password]').length,
    body_vertical:body.scrollHeight>body.clientHeight};})()`)
  assert.equal(layout.window_horizontal, false)
  assert.equal(layout.modal_horizontal, false)
  assert.equal(layout.body_horizontal, false)
  assert.equal(layout.footer_inside, true)
  assert.equal(layout.password_fields, 0)
  const file = `installer-${view}-${width}x${height}-${theme}-${locale}.png`
  writeFileSync(join(screenshots, file), (await window.webContents.capturePage()).toPNG())
  checks.push({ view, width, height, theme, locale, ...layout, file })
}
const watchdog = setTimeout(() => {
  console.error('INSTALLER_UI_TIMEOUT')
  app.exit(1)
}, 180000)
void app.whenReady().then(async () => {
  try {
    window = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: {
        preload: join(root, 'app/out/preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    })
    window.webContents.on('render-process-gone', () => errors.push('RENDER_PROCESS_GONE'))
    window.webContents.on('console-message', (_event, level) => {
      if (level >= 3) errors.push('RENDERER_ERROR')
    })
    await window.loadFile(join(root, 'app/out/renderer/index.html'))
    window.showInactive()
    for (const [width, height] of [
      [1280, 800],
      [1366, 768]
    ]) {
      window.setContentSize(width, height)
      for (const theme of ['dark', 'light'])
        for (const locale of ['vi', 'en', 'cn', 'jp']) {
          installation = null
          await js(
            `localStorage.setItem('opspilot-ui-session',JSON.stringify({state:{theme:${JSON.stringify(theme)},locale:${JSON.stringify(locale)},activePage:'settings',selectedVpsIds:[]},version:0}))`
          )
          await new Promise((done) => {
            window.webContents.once('did-finish-load', done)
            window.webContents.reload()
          })
          const t = copy[locale]
          await click(t.title)
          await click(t.review)
          await wait(`document.querySelector('.ant-modal-body input[type=checkbox]')!==null`)
          assert.equal(await js(`${buttonExpression(t.install)}.disabled`), true)
          await capture('review', width, height, theme, locale)
          if (locale === 'en' && theme === 'dark' && width === 1280) {
            loseReply = true
            await js(`document.querySelectorAll('.ant-modal-body input[type=checkbox]')[1].click()`)
            await click(t.install)
            await wait(
              `document.querySelector('.ant-modal-body').textContent.includes(${JSON.stringify(t.unknown)})`
            )
            await capture('unknown', width, height, theme, locale)
            const installCalls = calls.filter(
              (v) => v.channel === 'controller:send-installation' && v.input.operation === 'install'
            ).length
            await click(t.check)
            await wait(`!!${buttonExpression(t.connect)}`)
            assert.equal(
              calls.filter(
                (v) =>
                  v.channel === 'controller:send-installation' && v.input.operation === 'install'
              ).length,
              installCalls
            )
            await click(t.connect)
            await wait(
              `document.querySelector('.ant-modal-body').textContent.includes(${JSON.stringify(t.connected)})`
            )
            await capture('connected', width, height, theme, locale)
            loseReply = false
          }
          await js(`document.querySelector('.ant-modal-close').click()`)
          await wait(`!document.querySelector('.ant-modal')`)
        }
    }
    missingPackage = true
    await click(copy.jp.title)
    await wait(
      `document.querySelector('.ant-modal-body').textContent.includes(${JSON.stringify(copy.jp.noPackage)})`
    )
    assert.equal(await js(`!!${buttonExpression(copy.jp.install)}`), false)
    assert.deepEqual(errors, [])
    checks.push({ view: 'missing_package', blocked: true })
    writeFileSync(
      join(directory, 'result.json'),
      JSON.stringify(
        {
          status: 'PASS',
          scope: 'REAL_ELECTRON_IPC_FIXTURE',
          checks,
          calls,
          renderer_errors: errors,
          production_profile_used: false,
          backend_network_exercised: false
        },
        null,
        2
      )
    )
    console.log(
      JSON.stringify({
        status: 'PASS',
        checks: checks.length,
        evidence: join(directory, 'result.json'),
        screenshots
      })
    )
    clearTimeout(watchdog)
    app.exit(0)
  } catch {
    writeFileSync(
      join(directory, 'result.json'),
      JSON.stringify({ status: 'FAIL', checks, calls, renderer_errors: errors }, null, 2)
    )
    console.error(
      JSON.stringify({ status: 'FAIL', evidence: directory, code: 'INSTALLER_UI_CHECK_FAILED' })
    )
    clearTimeout(watchdog)
    app.exit(1)
  }
})
