import { dialog, ipcMain, shell } from 'electron'

import type { IpcInvokeMap, IpcResult } from '@shared/ipc'

import type { DeployService } from './deploy/service'
import { AppError, toIpcError } from './errors'
import type { MlServiceManager } from './mlClient'
import type { SshManager } from './ssh/manager'
import { readVpsResources, testConnectionWithCredentials } from './vps/connectionService'
import { installDockerOnVps } from './vps/dockerInstall'
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

export function registerIpcHandlers(
  mlService: MlServiceManager,
  vpsService: VpsService,
  ssh: SshManager,
  deployService: DeployService
): void {
  handle('vps:list', () => vpsService.list())
  handle('vps:create', (input) => vpsService.create(input))
  handle('vps:update', (id, patch) => vpsService.update(id, patch))
  handle('vps:delete', (id) => vpsService.delete(id))
  handle('vps:test-connection', (input) =>
    testConnectionWithCredentials({
      host: input.host,
      port: input.port,
      username: input.username,
      authType: input.auth_type,
      secret: input.secret
    })
  )
  handle('vps:get-resources', (vpsId) => readVpsResources(ssh, vpsId))
  handle('vps:install-docker', async (vpsId) => {
    const dockerVersion = await installDockerOnVps(ssh, vpsId)
    vpsService.recordDockerInstalled(vpsId, dockerVersion)
    return { docker_version: dockerVersion }
  })

  handle('deploy:detect', (sourcePath) => deployService.detect(sourcePath))
  handle('deploy:precheck', (input) => deployService.precheck(input))
  handle('deploy:start', (input) => deployService.start(input))
  handle('deploy:cancel', (deploymentId) => {
    deployService.cancel(deploymentId)
  })
  handle('app:list', (vpsId) => deployService.listApps(vpsId))
  handle('app:get', (appId) => deployService.getApp(appId))
  handle('app:versions', (appId) => deployService.versions(appId))
  handle('app:rollback', (appId, targetDeploymentId) =>
    deployService.rollback(appId, targetDeploymentId)
  )

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
