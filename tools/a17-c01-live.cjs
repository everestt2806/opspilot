// Run the real Electron deploy pipeline against the approved A17 profile.
// The script observes each finished event and never treats a helper exit alone as proof.
const { app, BrowserWindow } = require('electron')
const { execFileSync } = require('node:child_process')
const { homedir } = require('node:os')
const { join, resolve } = require('node:path')

const root = resolve(__dirname, '..')
const appRequire = require('node:module').createRequire(join(root, 'app/package.json'))
const sourcePath = join(root, 'demo-apps', 'express-api')
const appName = 'a17-notes-0911'
const vpsHost = '221.121.1.80'
const sshKey = join(homedir(), '.ssh', 'opspilot_ed25519')
const evidence = { startedUtc: new Date().toISOString(), events: [], deployments: [] }

function remoteCurl(port, path, args = []) {
  const remote = `curl -fsS ${args.join(' ')} 'http://127.0.0.1:${port}${path}'`
  return execFileSync('ssh', [
    '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'IdentitiesOnly=yes',
    '-i', sshKey, `deploy@${vpsHost}`, remote
  ], { encoding: 'utf8', timeout: 30_000 })
}

async function delay(ms) {
  await new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

async function waitFinished(win, deploymentId, timeoutMs = 30 * 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const events = await win.webContents.executeJavaScript('window.__c01Events ?? []')
    for (const event of events) {
      if (!evidence.events.some((item) => item.deployment_id === event.deployment_id && item.type === event.type && item.step === event.step && item.status === event.status)) {
        evidence.events.push(event)
        console.log(JSON.stringify(event))
      }
    }
    const finished = events.find((event) => event.type === 'finished' && event.deployment_id === deploymentId)
    if (finished) return finished
    await delay(500)
  }
  throw new Error(`No finished event for deployment ${deploymentId}`)
}

async function invoke(win, channel, ...args) {
  const expression = `window.api.invoke(${JSON.stringify(channel)}, ...${JSON.stringify(args)})`
  const result = await win.webContents.executeJavaScript(expression)
  if (!result.ok) throw new Error(`${channel}: ${result.error?.message ?? 'IPC failed'}`)
  return result.data
}

async function run() {
  app.setName('OpsPilot')
  app.setAppPath(join(root, 'app'))
  const finished = new Promise((resolveFinished, rejectFinished) => {
    app.once('browser-window-created', (_event, win) => {
      win.webContents.once('did-finish-load', async () => {
        try {
          await win.webContents.executeJavaScript(`window.__c01Events = []; void window.api.on('deploy:event', (event) => window.__c01Events.push(event)); true`)
          const first = await invoke(win, 'deploy:start', {
            vps_id: 2, app_name: appName, source_path: sourcePath, env: {}
          })
          const firstFinished = await waitFinished(win, first.deployment_id)
          if (firstFinished.status !== 'running') throw new Error(`v1 finished ${firstFinished.status}`)
          const apps = await invoke(win, 'app:list', 2)
          const deployed = apps.find((item) => item.name === appName)
          if (!deployed) throw new Error('A17 app record missing after v1')
          const marker = remoteCurl(deployed.host_port, '/items', [
            "-X", "POST", "-H", "'content-type: application/json'",
            "--data-binary", "'{\"name\":\"C01 marker 2026-09-11\"}'"
          ])
          console.log(`MARKER=${marker.trim()}`)
          const second = await invoke(win, 'deploy:start', {
            vps_id: 2, app_name: appName, source_path: sourcePath, env: {}
          })
          const secondFinished = await waitFinished(win, second.deployment_id)
          if (secondFinished.status !== 'running') throw new Error(`v2 finished ${secondFinished.status}`)
          const currentApps = await invoke(win, 'app:list', 2)
          const current = currentApps.find((item) => item.name === appName)
          const versions = await invoke(win, 'app:versions', current.id)
          const meta = JSON.parse(remoteCurl(current.host_port, '/meta'))
          const items = JSON.parse(remoteCurl(current.host_port, '/items?limit=1&offset=1000'))
          evidence.deployments = { v1: first, v1Finished: firstFinished, marker, v2: second, v2Finished: secondFinished, current, versions, meta, itemCount: items.length }
          if (meta.storage !== 'PostgreSQL' || !items.some((item) => item.name === 'C01 marker 2026-09-11')) {
            throw new Error('PostgreSQL marker was not preserved after redeploy')
          }
          console.log(JSON.stringify({ type: 'C01_REDEPLOY_VERIFIED', current, versions, meta, itemCount: items.length }))
          resolveFinished()
        } catch (error) {
          rejectFinished(error)
        }
      })
    })
    appRequire(join(root, 'app/out/main/index.js'))
  })
  await finished
  evidence.finishedUtc = new Date().toISOString()
  console.log(`C01_LIVE_PASS ${JSON.stringify(evidence)}`)
}

run().then(() => app.quit()).catch((error) => {
  console.error(`C01_LIVE_FAIL ${error.stack || error.message}`)
  process.exitCode = 1
  app.quit()
})
