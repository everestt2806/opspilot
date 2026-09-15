import type { BrowserWindowConstructorOptions } from 'electron'

/** Màu overlay native Windows khi khởi động — trùng token 'dark' của themeTokens.ts
 *  (theme mặc định). Khi người dùng đổi theme, renderer gọi window:set-titlebar-overlay
 *  để cập nhật màu động. */
export const INITIAL_TITLEBAR_OVERLAY = { color: '#181818', symbolColor: '#CCCCCC' }

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
    titleBarOverlay: isWindows ? { height: 34, ...INITIAL_TITLEBAR_OVERLAY } : false,
    backgroundMaterial: isWindows ? 'mica' : 'none',
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#1E1E1E',
    icon,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  }
}
