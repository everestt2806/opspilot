import { join } from 'node:path'

import { app, BrowserWindow, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'

import icon from '../../resources/icon.png?asset'
import { closeDatabase, initializeDatabase } from './db'
import { registerIpcHandlers } from './ipc'
import { logger } from './logger'
import { MlServiceManager } from './mlClient'

let mainWindow: BrowserWindow | null = null
let mlService: MlServiceManager | null = null

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
    ...(process.platform === 'linux' ? { icon } : {}),
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

    initializeDatabase(app.getPath('userData'))
    mlService = new MlServiceManager(emitMlStatus)
    registerIpcHandlers(mlService)
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
