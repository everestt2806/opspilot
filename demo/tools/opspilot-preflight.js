const net = require('node:net')
const path = require('node:path')
const { app } = require('electron')

// Chạy được từ bất kỳ checkout nào: demo/tools -> gốc repo -> app.
const repoApp = path.resolve(__dirname, '..', '..', 'app')
const { loadSecret } = require(path.join(repoApp, '.out-scripts/src/main/crypto/credentials.js'))
const { createCredentialCipher } = require(path.join(repoApp, '.out-scripts/src/main/crypto/masterKey.js'))
const { initializeDatabase, closeDatabase } = require(path.join(repoApp, '.out-scripts/src/main/db/index.js'))
const { VpsRepository } = require(path.join(repoApp, '.out-scripts/src/main/db/vpsRepository.js'))
const { AppRepository } = require(path.join(repoApp, '.out-scripts/src/main/db/appRepository.js'))
const { SshManager } = require(path.join(repoApp, '.out-scripts/src/main/ssh/manager.js'))
const { shellQuote } = require(path.join(repoApp, '.out-scripts/src/main/ssh/shellQuote.js'))

const keepTunnels = process.argv.includes('--tunnel')
const servers = []
const activeTunnelKeys = new Set()
let refreshingTunnels = false

app.setAppUserModelId('vn.opspilot.desktop')
app.setName('OpsPilot')
app.setPath('userData', path.resolve(path.join(app.getPath('appData'), 'OpsPilot')))

async function publicHttp(url) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const response = await fetch(url, { signal: controller.signal })
    return `HTTP ${response.status}`
  } catch (error) {
    return `FAIL (${error.name === 'AbortError' ? 'timeout' : error.message})`
  } finally {
    clearTimeout(timeout)
  }
}

function localPortFor(vps, hostPort) {
  const base = vps.name.toUpperCase() === 'VM01' ? 34000 : 33000
  return base + Math.max(0, hostPort - 30000)
}

function createTunnel(client, localPort, remotePort) {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      client.forwardOut(
        socket.remoteAddress || '127.0.0.1',
        socket.remotePort || 0,
        '127.0.0.1',
        remotePort,
        (error, stream) => {
          if (error) return socket.destroy(error)
          socket.pipe(stream).pipe(socket)
          stream.on('error', () => socket.destroy())
          socket.on('error', () => stream.destroy())
        }
      )
    })
    server.once('error', reject)
    server.listen(localPort, '127.0.0.1', () => resolve(server))
  })
}

async function discoverNewTunnels({ ssh, vpsRepository, appRepository }) {
  if (refreshingTunnels) return
  refreshingTunnels = true
  try {
    for (const vps of vpsRepository.list()) {
      for (const target of appRepository.listByVps(vps.id)) {
        const key = `${vps.id}:${target.id}`
        if (activeTunnelKeys.has(key)) continue
        try {
          await ssh.connect(vps.id)
          const entry = ssh.entries.get(vps.id)
          if (!entry || !entry.client) throw new Error('SSH client unavailable after connect')
          const localPort = localPortFor(vps, target.host_port)
          const server = await createTunnel(entry.client, localPort, target.host_port)
          servers.push(server)
          activeTunnelKeys.add(key)
          console.log(`[NEW TUNNEL] ${target.name}: http://127.0.0.1:${localPort} -> ${vps.name}:${target.host_port}`)
          if (target.framework === 'express') {
            console.log(`             VITE_API_URL=http://127.0.0.1:${localPort}`)
          }
        } catch (error) {
          console.log(`[TUNNEL FAIL] ${vps.name}/${target.name}: ${error.message}`)
        }
      }
    }
  } finally {
    refreshingTunnels = false
  }
}

async function main() {
  console.log('============================================================')
  console.log(' OPSPILOT DEMO PREFLIGHT - READ ONLY')
  console.log('============================================================')

  const database = initializeDatabase(app.getPath('userData'))
  const cipher = createCredentialCipher(app.getPath('userData'))
  const vpsRepository = new VpsRepository(database)
  const appRepository = new AppRepository(database)
  const allVps = vpsRepository.list()
  const ssh = new SshManager((vpsId) => {
    const saved = vpsRepository.getById(vpsId)
    return {
      host: saved.host,
      port: saved.port,
      username: saved.username,
      authType: saved.auth_type,
      secret: loadSecret(database, cipher, vpsId)
    }
  })

  const shutdown = async () => {
    for (const server of servers) server.close()
    await ssh.disconnectAll()
    closeDatabase()
    app.quit()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)

  if (!allVps.some((vps) => vps.name.toUpperCase() === 'VM01')) {
    console.log('[WARN] VM01 is not saved in the current OpsPilot profile.')
    console.log('       Add VM01 before rehearsing migration.\n')
  }
  if (!allVps.some((vps) => vps.name.toUpperCase() === 'VM02')) {
    console.log('[FAIL] VM02 is not saved in the current OpsPilot profile.\n')
  }

  for (const vps of allVps) {
    console.log(`--- ${vps.name} (${vps.host}:${vps.port}) ---`)
    try {
      await ssh.connect(vps.id)
      console.log('[PASS] SSH')
      const apps = appRepository.listByVps(vps.id)
      if (apps.length === 0) console.log('[INFO] No deployed apps recorded.')

      for (const target of apps) {
        const healthPath = target.healthcheck_path || '/'
        const container = `${target.name}-app`
        const command = [
          `docker inspect -f '{{.Config.Image}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' ${shellQuote(container)}`,
          `curl -fsS -m 5 -o /dev/null -w '|HTTP %{http_code}' http://127.0.0.1:${target.host_port}${shellQuote(healthPath)}`
        ].join('; ')
        const remote = await ssh.exec(vps.id, command, { timeoutMs: 15000, retryOnReconnect: true })
        const publicUrl = `http://${vps.host}:${target.host_port}`
        const publicStatus = await publicHttp(publicUrl + healthPath)
        console.log(`[APP] ${target.name}: ${remote.stdout.trim() || `remote exit ${remote.code}`}`)
        console.log(`      public ${publicUrl}${healthPath}: ${publicStatus}`)

        if (keepTunnels) {
          const entry = ssh.entries.get(vps.id)
          if (!entry || !entry.client) throw new Error('SSH client unavailable after connect')
          const localPort = localPortFor(vps, target.host_port)
          try {
            const server = await createTunnel(entry.client, localPort, target.host_port)
            servers.push(server)
            activeTunnelKeys.add(`${vps.id}:${target.id}`)
            console.log(`      tunnel http://127.0.0.1:${localPort} -> ${vps.name}:${target.host_port}`)
            if (target.framework === 'express') {
              console.log(`      fallback VITE_API_URL=http://127.0.0.1:${localPort}`)
            }
          } catch (error) {
            console.log(`      tunnel FAIL: ${error.message}`)
          }
        }
      }
    } catch (error) {
      console.log(`[FAIL] ${vps.name}: ${error.message}`)
    }
    console.log('')
  }

  if (keepTunnels) {
    console.log('Tunnels are ready. Keep this window open during the demo.')
    console.log('Newly deployed or migrated apps will be detected automatically.')
    console.log('Press Ctrl+C or close this window to stop them.')
    setInterval(() => {
      void discoverNewTunnels({ ssh, vpsRepository, appRepository })
    }, 5000)
  } else {
    await shutdown()
  }
}

app.whenReady().then(main).catch((error) => {
  console.error(`[FATAL] ${error instanceof Error ? error.message : String(error)}`)
  app.exit(1)
})
