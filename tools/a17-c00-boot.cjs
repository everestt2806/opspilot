// Boot the real built app, capture its real renderer, then use its normal shutdown.
const { createRequire } = require('node:module')
const { resolve, join } = require('node:path')
const { writeFileSync } = require('node:fs')
const root = resolve(__dirname, '..')
const appRequire = createRequire(join(root, 'app/package.json'))
const { app, BrowserWindow } = appRequire('electron')
const out = join(root, 'docs/evidence/tk-a17/c00')
app.setName('OpsPilot')
app.setPath('userData', join(app.getPath('appData'), 'OpsPilot'))
app.setAppPath(join(root, 'app'))
const evidence = { startedUtc: new Date().toISOString(), errors: [], frames: 0 }
const deadline = setTimeout(() => {
  evidence.errors.push('Boot smoke exceeded 60s')
  finish(1)
}, 60000)
let finished = false
function finish(code) {
  if (finished) return
  finished = true
  clearTimeout(deadline)
  evidence.exitCode = code
  evidence.finishedUtc = new Date().toISOString()
  writeFileSync(join(out, 'boot.json'), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify(evidence))
  process.exitCode = code
  app.quit()
}
app.once('browser-window-created', (_event, win) => {
  win.webContents.on('render-process-gone', (_e, details) => evidence.errors.push(details.reason))
  win.webContents.once('did-finish-load', async () => {
    try {
      win.setContentSize(1366, 768)
      const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
      for (let attempt = 0; attempt < 30; attempt++) {
        evidence.ml = await win.webContents.executeJavaScript("window.api.invoke('system:ml-status')")
        if (evidence.ml.ok && evidence.ml.data?.running) break
        await delay(500)
      }
      evidence.renderer = await win.webContents.executeJavaScript(
        '({title:document.title,url:location.href,text:document.body.innerText,viewport:[innerWidth,innerHeight],ipc:typeof window.api.invoke})'
      )
      if (!evidence.renderer.text.includes('OpsPilot')) throw new Error('App renderer missing')
      writeFileSync(join(out, 'app-1366x768.png'), (await win.webContents.capturePage()).toPNG())
      win.webContents.debugger.attach('1.3')
      win.webContents.debugger.on('message', (_e, method, params) => {
        if (method === 'Page.screencastFrame') {
          evidence.frames++
          void win.webContents.debugger.sendCommand('Page.screencastFrameAck', { sessionId: params.sessionId })
        }
      })
      await win.webContents.debugger.sendCommand('Page.startScreencast', { format: 'jpeg', quality: 60 })
      await delay(1500)
      await win.webContents.debugger.sendCommand('Page.stopScreencast')
      win.webContents.debugger.detach()
      if (!evidence.frames) throw new Error('No screencast frame received')
      evidence.windowCount = BrowserWindow.getAllWindows().length
      finish(evidence.errors.length ? 1 : 0)
    } catch (error) {
      evidence.errors.push(error.message)
      finish(1)
    }
  })
})
require(join(root, 'app/out/main/index.js'))
