import { dialog, ipcMain, shell } from 'electron'

import type { IpcInvokeMap, IpcResult } from '@shared/ipc'

import { AppError, toIpcError } from './errors'
import type { MlServiceManager } from './mlClient'
import type { VpsService } from './vps/service'

type Channel = keyof IpcInvokeMap
type ChannelArgs<K extends Channel> = Parameters<IpcInvokeMap[K]>
type ChannelResult<K extends Channel> = ReturnType<IpcInvokeMap[K]>
type ChannelData<K extends Channel> = ChannelResult<K> extends IpcResult<infer T> ? T : never

export function handle<K extends Channel>(
  channel: K,
  handler: (...args: ChannelArgs<K>) => ChannelData<K> | Promise<ChannelData<K>>
): void {
  ipcMain.handle(channel, async (_event, ...args: ChannelArgs<K>): Promise<ChannelResult<K>> => {
    try {
      const data = await handler(...args)
      return { ok: true, data } as ChannelResult<K>
    } catch (error) {
      return { ok: false, error: toIpcError(error) } as ChannelResult<K>
    }
  })
}

export function registerIpcHandlers(mlService: MlServiceManager, vpsService: VpsService): void {
  handle('vps:list', () => vpsService.list())
  handle('vps:create', (input) => vpsService.create(input))
  handle('vps:update', (id, patch) => vpsService.update(id, patch))
  handle('vps:delete', (id) => vpsService.delete(id))

  handle('system:ml-status', async () => mlService.status())
  handle('system:ml-restart', async () => {
    await mlService.restart()
  })
  handle('system:pick-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return { path: result.canceled ? null : (result.filePaths[0] ?? null) }
  })
  handle('system:open-external', async (rawUrl) => {
    const url = new URL(rawUrl)
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new AppError('VALIDATION', 'Chỉ được phép mở liên kết HTTP hoặc HTTPS.')
    }
    await shell.openExternal(url.toString())
  })
}
