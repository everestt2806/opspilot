import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handleMock } = vi.hoisted(() => ({ handleMock: vi.fn() }))

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: handleMock },
  shell: { openExternal: vi.fn() }
}))

import { AppError } from './errors'
import { handle } from './ipc'

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
})
