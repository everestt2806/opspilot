import { join } from 'node:path'

import { app, BrowserWindow, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'

import icon from '../../resources/icon.png?asset'
import { createCredentialCipher } from './crypto/masterKey'
import { loadSecret } from './crypto/credentials'
import { closeDatabase, initializeDatabase } from './db'
import { ActionLogRepository } from './db/actionLogRepository'
import { VpsRepository } from './db/vpsRepository'
import { DeployService } from './deploy/service'
import { HistoryService } from './history/service'
import { registerIpcHandlers } from './ipc'
import { logger } from './logger'
import { MlServiceManager } from './mlClient'
import { SshManager } from './ssh/manager'
import { VpsService } from './vps/service'

let mainWindow: BrowserWindow | null = null
let mlService: MlServiceManager | null = null
let sshManager: SshManager | null = null

function emitMlStatus(status: { running: boolean; reason?: string }): void {
  mainWindow?.webContents.send('system:ml-status', status)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1280,
    minHeight: 800,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0F1115',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
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

    const historyService = new HistoryService(new ActionLogRepository(database))

    registerIpcHandlers(mlService, vpsService, sshManager, deployService, historyService)

    createWindow()

    try {
      await mlService.start()
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

app.on('before-quit', () => {
  mlService?.stopSync()
  sshManager?.disconnectAll()
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
