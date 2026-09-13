import type { BrowserWindowConstructorOptions } from 'electron'

export function getMainWindowOptions(
  preload: string,
  icon: string,
  platform = process.platform
): BrowserWindowConstructorOptions {
  const isWindows = platform === 'win32'

  return {
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hidden',
    titleBarOverlay: isWindows ? { color: '#202020', symbolColor: '#FFFFFF', height: 34 } : false,
    backgroundMaterial: isWindows ? 'mica' : 'none',
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#202020',
    icon,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  }
}
