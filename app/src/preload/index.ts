import { contextBridge, ipcRenderer } from 'electron'

import type { IpcEventMap, IpcInvokeMap } from '@shared/ipc'

export interface OpsPilotApi {
  invoke<K extends keyof IpcInvokeMap>(
    channel: K,
    ...args: Parameters<IpcInvokeMap[K]>
  ): Promise<ReturnType<IpcInvokeMap[K]>>
  on<K extends keyof IpcEventMap>(
    channel: K,
    callback: (payload: IpcEventMap[K]) => void
  ): () => void
}

const api: OpsPilotApi = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: IpcEventMap[typeof channel]
    ): void => {
      callback(payload)
    }
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
