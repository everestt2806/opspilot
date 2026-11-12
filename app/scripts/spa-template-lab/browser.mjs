import { app, BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const directory = resolve(process.argv[2] ?? ''),
  config = JSON.parse(readFileSync(join(directory, 'browser.json'), 'utf8'))
assert(directory.includes('.out-scripts'))
assert.equal(readFileSync(join(directory, '.owner'), 'utf8'), config.nonce)
assert(/^http:\/\/127\.0\.0\.1:\d+\/library\/book\/42\?view=details$/.test(config.url))
const profile = join(directory, 'browser-profile')
assert(!existsSync(profile))
mkdirSync(profile)
app.setPath('userData', profile)
const timeout = setTimeout(() => app.exit(2), 45000)
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
  })
  const proof = { status: 'FAIL', checks: [] }
  try {
    await window.loadURL(config.url)
    assert.equal(
      await window.webContents.executeJavaScript('document.querySelector("#route")?.textContent'),
      '/library/book/42?view=details'
    )
    proof.checks.push('actual_browser_direct_client_route_renders_app_script')
    await new Promise((done, reject) => {
      window.webContents.once('did-finish-load', done)
      window.webContents.once('did-fail-load', () => reject(Error('SPA_RELOAD_FAILED')))
      window.webContents.reload()
    })
    assert.equal(
      await window.webContents.executeJavaScript('document.querySelector("#route")?.textContent'),
      '/library/book/42?view=details'
    )
    proof.checks.push('actual_browser_reload_preserves_client_route_and_query')
    writeFileSync(join(directory, 'browser.png'), (await window.webContents.capturePage()).toPNG())
    proof.status = 'PASS'
  } catch (error) {
    proof.error = error.message
  }
  writeFileSync(join(directory, 'browser-result.json'), JSON.stringify(proof, null, 2) + '\n')
  window.destroy()
  clearTimeout(timeout)
  app.exit(proof.status === 'PASS' ? 0 : 1)
})
