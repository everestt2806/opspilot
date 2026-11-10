import assert from 'node:assert/strict'
import { app, BrowserWindow } from 'electron'
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Public web only. No preload, Desktop DB, SSH credential, or admin API.
const url = new URL(process.argv[2])
if (
  url.protocol !== 'http:' ||
  url.hostname !== '167.71.202.116' ||
  url.port !== '30000' ||
  url.pathname !== '/'
)
  throw Error('LIVE_DEMO_URL_NOT_ALLOWED')
const root = resolve(import.meta.dirname, '../../..')
const output = join(root, 'app/.out-scripts/live-demo-web', randomBytes(6).toString('hex'))
const screenshots = join(root, 'docs/ui-redesign/screenshots/r3c6h3')
mkdirSync(output, { recursive: true })
mkdirSync(screenshots, { recursive: true })
app.setPath('userData', join(output, 'profile'))
app.commandLine.appendSwitch('force-device-scale-factor', '1')
const watchdog = setTimeout(() => app.exit(1), 30000)
void app.whenReady().then(async () => {
  try {
    const window = new BrowserWindow({
      width: 1280,
      height: 800,
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    await window.loadURL(url.href)
    const facts = await window.webContents.executeJavaScript(`(()=>({title:document.title,
      text:document.body.innerText.slice(0,300),horizontal:document.documentElement.scrollWidth>innerWidth,
      slots:document.querySelectorAll('button').length}))()`)
    assert.equal(facts.horizontal, false)
    assert.ok(facts.slots > 0)
    const screenshot = join(screenshots, 'san-nha-public-vps-1280x800.png')
    writeFileSync(screenshot, (await window.webContents.capturePage()).toPNG())
    writeFileSync(
      join(output, 'result.json'),
      JSON.stringify(
        {
          status: 'PASS',
          scope: 'ACTUAL_DEVELOPMENT_VPS_PUBLIC_WEB',
          url: url.href,
          facts,
          screenshot,
          production_desktop_profile_used: false
        },
        null,
        2
      )
    )
    console.log(JSON.stringify({ status: 'PASS', evidence: output, screenshot }))
    clearTimeout(watchdog)
    app.exit(0)
  } catch {
    clearTimeout(watchdog)
    console.error('LIVE_DEMO_CAPTURE_FAILED')
    app.exit(1)
  }
})
