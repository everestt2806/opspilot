import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { realpathSync } from 'node:fs'

import { app, BrowserWindow, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'

import icon from '../../resources/icon.png?asset'
import { createCredentialCipher } from './crypto/masterKey'
import { loadSecret } from './crypto/credentials'
import { closeDatabase, initializeDatabase } from './db'
import { AppRepository } from './db/appRepository'
import { ActionLogRepository } from './db/actionLogRepository'
import { DeploymentRepository } from './db/deploymentRepository'
import { DomainRepository } from './domain/repository'
import { SharedIngressService } from './domain/ingress/sharedIngressService'
import { VpsRepository } from './db/vpsRepository'
import { DeployService } from './deploy/service'
import { HistoryService } from './history/service'
import { registerIpcHandlers } from './ipc'
import { logger } from './logger'
import { MlServiceManager } from './mlClient'
import { SshManager } from './ssh/manager'
import { VpsService } from './vps/service'
import { MonitorService } from './monitor/service'
import { MonitorScheduler } from './monitor/scheduler'
import { MlApiClient } from './monitor/mlApi'
import { shutdownRuntime } from './shutdown'
import { MigrateService } from './migrate/service'
import { getMainWindowOptions } from './windowOptions'
import { runRecoveryManifestCli } from './vps/recoveryManifestCli'
import { AppError } from './errors'

const recoverySourceProfile = process.env.OPSPILOT_R3D_SOURCE_PROFILE
if (recoverySourceProfile) {
  const sourcePath = resolve(recoverySourceProfile)
  const sourceRealPath = realpathSync(sourcePath)
  if (!sourceRealPath.startsWith(`${realpathSync(tmpdir())}${sep}`)) {
    throw new Error(
      'R3d source profile must be an isolated directory under the system temp directory.'
    )
  }
  app.setPath('userData', sourcePath)
}

let mainWindow: BrowserWindow | null = null
let mlService: MlServiceManager | null = null
let sshManager: SshManager | null = null
let monitorScheduler: MonitorScheduler | null = null
let deployRuntime: DeployService | null = null
let quitting = false

function emitMlStatus(status: { running: boolean; reason?: string }): void {
  mainWindow?.webContents.send('system:ml-status', status)
}

function createWindow(): void {
  mainWindow = new BrowserWindow(getMainWindowOptions(join(__dirname, '../preload/index.js'), icon))

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
    mainWindow?.focus()
  })
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized-changed', { maximized: true })
  })
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximized-changed', { maximized: false })
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  mainWindow.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL) => {
      logger.error('renderer', `Failed to load ${validatedURL}: ${errorDescription} (${errorCode})`)
    }
  )

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.show()
  mainWindow.focus()
}

void app
  .whenReady()
  .then(async () => {
    electronApp.setAppUserModelId('vn.opspilot.desktop')
    app.setName('OpsPilot')

    app.on('browser-window-created', (_event, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    const userDataPath = app.getPath('userData')
    const database = initializeDatabase(userDataPath)
    const credentialCipher = createCredentialCipher(userDataPath)
    const vpsRepository = new VpsRepository(database)
    const vpsService = new VpsService(vpsRepository, credentialCipher)
    sshManager = new SshManager((vpsId) => {
      const vps = vpsRepository.getById(vpsId)
      return {
        host: vps.host,
        port: vps.port,
        hostFingerprint: vps.host_fingerprint ?? null,
        username: vps.username,
        authType: vps.auth_type,
        secret: loadSecret(database, credentialCipher, vpsId)
      }
    })
    sshManager.on('status', (update) => {
      mainWindow?.webContents.send('system:ssh-status', update)
    })
    mlService = new MlServiceManager(emitMlStatus)

    const deployService = new DeployService({
      ssh: sshManager,
      db: database,
      emit: (event) => {
        mainWindow?.webContents.send('deploy:event', event)
      }
    })
    deployRuntime = deployService

    const historyService = new HistoryService(new ActionLogRepository(database))
    const monitorService = new MonitorService(database)
    const migrateService = new MigrateService(database, sshManager, (event) => {
      mainWindow?.webContents.send('migrate:event', event)
    })
    const sharedIngressService = new SharedIngressService({
      vpsRepository,
      appRepository: new AppRepository(database),
      deploymentRepository: new DeploymentRepository(database),
      domainRepository: new DomainRepository(database),
      ssh: sshManager,
      policy: { certificateEnvironment: 'production', stagingLabHostnames: [] }
    })

    registerIpcHandlers(
      mlService,
      vpsService,
      sshManager,
      deployService,
      historyService,
      () => mainWindow,
      monitorService,
      migrateService,
      sharedIngressService
    )
    if (process.env.OPSPILOT_R3D_SOURCE_PROFILE) {
      try {
        const vpsId = Number(process.env.OPSPILOT_R3D_VPS_ID)
        const name = process.env.OPSPILOT_R3D_APP_NAME ?? ''
        const targetProfile = process.env.OPSPILOT_R3D_TARGET_PROFILE ?? ''
        const result = await runRecoveryManifestCli(database, sshManager, {
          vpsId,
          name,
          targetProfile
        })
        console.log(JSON.stringify({ status: 'PASS', ...result }))
      } catch (error) {
        const reason =
          error instanceof AppError ? error.message : 'Không hoàn tất được thao tác SSH recovery.'
        console.log(JSON.stringify({ status: 'BLOCKED', reason }))
        database.close()
        app.exit(2)
        return
      }
      await sshManager.disconnectAll()
      database.close()
      app.exit(0)
      return
    }
    if (process.env.OPSPILOT_C01_DEPLOY_ONLY !== '1') {
      monitorScheduler = new MonitorScheduler(async () => {
        const port = mlService?.getPort()
        await monitorService.pollAll(
          sshManager!,
          port ? new MlApiClient(`http://127.0.0.1:${port}`) : undefined,
          (event) => mainWindow?.webContents.send('monitor:tick', event),
          (status) => emitMlStatus(status)
        )
      })
      monitorScheduler.start()
    }

    createWindow()

    try {
      if (process.env.OPSPILOT_C01_DEPLOY_ONLY !== '1') {
        await mlService.start()
      }
    } catch (error) {
      logger.error('ml', 'ML service khởi động thất bại', {
        error: error instanceof Error ? error.message : String(error)
      })
      emitMlStatus({
        running: false,
        reason: error instanceof Error ? error.message : String(error)
      })
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })
  .catch((error: unknown) => {
    logger.error('system', 'Ứng dụng khởi động thất bại', {
      error: error instanceof Error ? error.message : String(error)
    })
    app.quit()
  })

app.on('before-quit', (event) => {
  if (quitting) return
  event.preventDefault()
  quitting = true
  void shutdownRuntime({
    stopScheduler: async () => monitorScheduler?.stop(),
    stopDeploy: async () => deployRuntime?.shutdown(),
    stopMl: () => mlService?.stopSync(),
    disconnectSsh: async () => sshManager?.disconnectAll(),
    quit: () => app.quit(),
    report: (error) =>
      logger.error('system', 'Dọn dẹp khi thoát thất bại', {
        error: error instanceof Error ? error.message : String(error)
      })
  })
})

app.on('will-quit', () => {
  closeDatabase()
})

process.on('exit', () => {
  mlService?.stopSync()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
