const { createRequire } = require('node:module')
const { resolve, join } = require('node:path')
const { mkdirSync, writeFileSync } = require('node:fs')

const root = resolve(__dirname, '..')
const appRequire = createRequire(join(root, 'app/package.json'))
const { app } = appRequire('electron')
const output = join(root, 'docs/evidence/tk-a18/after')
const pages = ['vps', 'apps', 'deploy', 'dashboard', 'migrate', 'history', 'settings']
const evidence = { viewport: '1366x768', pages: [], errors: [] }
mkdirSync(output, { recursive: true })
app.setName('OpsPilot')
app.setPath('userData', join(app.getPath('appData'), 'OpsPilot'))
app.setAppPath(join(root, 'app'))

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
const scrub = (win) => win.webContents.executeJavaScript(`(() => {
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        child.textContent = child.textContent
          .replace(/\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b/g, 'host.local')
          .replace(/221\\.121\\.1\\.(?:79|80)/g, 'host.local')
      } else walk(child)
    }
  }
  walk(document.body)
})()`)
let done = false
function finish(code) {
  if (done) return
  done = true
  evidence.exitCode = code
  writeFileSync(join(output, 'capture.json'), JSON.stringify(evidence, null, 2))
  app.quit()
}

app.once('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', async () => {
    try {
      win.setContentSize(1366, 768)
      await win.webContents.executeJavaScript("localStorage.removeItem('opspilot-ui-session'); location.reload()")
      await new Promise((resolveLoad) => win.webContents.once('did-finish-load', resolveLoad))
      await delay(800)
      for (const page of pages) {
        if (page !== 'vps') {
          await win.webContents.executeJavaScript(
            `document.querySelector('.ant-menu-item[data-menu-id$="-${page}"]')?.click()`
          )
          await delay(300)
        }
        await scrub(win)
        await delay(100)
        const image = await win.webContents.capturePage()
        const filename = `${page}-1366x768.png`
        writeFileSync(join(output, filename), image.toPNG())
        evidence.pages.push(filename)
      }
      for (const page of ['deploy', 'migrate']) {
        win.setContentSize(1920, 1080)
        await win.webContents.executeJavaScript(
          `document.querySelector('.ant-menu-item[data-menu-id$="-${page}"]')?.click()`
        )
        await delay(500)
        await scrub(win)
        await delay(100)
        const filename = `${page}-1920x1080.png`
        writeFileSync(join(output, filename), (await win.webContents.capturePage()).toPNG())
        evidence.pages.push(filename)
      }
      finish(0)
    } catch (error) {
      evidence.errors.push(error instanceof Error ? error.message : String(error))
      finish(1)
    }
  })
})
require(join(root, 'app/out/main/index.js'))
