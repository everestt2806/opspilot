import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handleMock } = vi.hoisted(() => ({ handleMock: vi.fn() }))

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: handleMock },
  shell: { openExternal: vi.fn() }
}))

import { AppError } from './errors'
import { handle, registerIpcHandlers } from './ipc'

describe('handle', () => {
  beforeEach(() => {
    handleMock.mockReset()
  })

  it('boc du lieu thanh IpcResult ok', async () => {
    handle('vps:list', () => [])
    const callback = handleMock.mock.calls[0]?.[1]

    await expect(callback({})).resolves.toEqual({ ok: true, data: [] })
  })

  it('boc AppError thanh IpcResult error', async () => {
    handle('vps:list', () => {
      throw new AppError('DB_ERROR', 'Không đọc được VPS. Hãy thử lại.')
    })
    const callback = handleMock.mock.calls[0]?.[1]

    await expect(callback({})).resolves.toEqual({
      ok: false,
      error: {
        code: 'DB_ERROR',
        message: 'Không đọc được VPS. Hãy thử lại.',
        technical: undefined,
        step: undefined
      }
    })
  })

  it('dieu khien custom title bar tren dung BrowserWindow', async () => {
    let maximized = false
    const window = {
      minimize: vi.fn(),
      maximize: vi.fn(() => {
        maximized = true
      }),
      unmaximize: vi.fn(() => {
        maximized = false
      }),
      isMaximized: vi.fn(() => maximized),
      close: vi.fn()
    }

    registerIpcHandlers(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      () => window
    )
    const callbackFor = (channel: string): ((event: unknown) => Promise<unknown>) => {
      const callback = handleMock.mock.calls.find(([registered]) => registered === channel)?.[1]
      expect(callback).toBeTypeOf('function')
      return callback
    }

    await expect(callbackFor('window:toggle-maximize')({})).resolves.toEqual({
      ok: true,
      data: { maximized: true }
    })
    expect(window.maximize).toHaveBeenCalledOnce()

    await expect(callbackFor('window:toggle-maximize')({})).resolves.toEqual({
      ok: true,
      data: { maximized: false }
    })
    expect(window.unmaximize).toHaveBeenCalledOnce()

    await callbackFor('window:minimize')({})
    await callbackFor('window:close')({})
    expect(window.minimize).toHaveBeenCalledOnce()
    expect(window.close).toHaveBeenCalledOnce()
  })
})
