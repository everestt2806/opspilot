import { dialog, ipcMain, shell } from 'electron'

import type { IpcInvokeMap, IpcResult } from '@shared/ipc'

import type { DeployService } from './deploy/service'
import { AppError, toIpcError } from './errors'
import type { HistoryService } from './history/service'
import type { MlServiceManager } from './mlClient'
import type { SshManager } from './ssh/manager'
import { readVpsResources, testConnectionWithCredentials } from './vps/connectionService'
import { installDockerOnVps } from './vps/dockerInstall'
import { scanVpsEnvironment } from './vps/scanService'
import type { VpsService } from './vps/service'
import type { MonitorService } from './monitor/service'
import { MlApiClient } from './monitor/mlApi'
import type { MigrateService } from './migrate/service'
import { diagnose, redactEvidence, redactText } from './doctor/engine'
import { maskSecrets } from './logger'
import { checkDomainTarget, planDomain } from './domain/assistant'
import { CloudflareDnsProvider } from './domain/dns'
import { DomainRepository } from './domain/repository'
import { DoctorFixService } from './doctor/fix'
import { DoctorRepository } from './doctor/repository'
import { VpsRepository } from './db/vpsRepository'
import { db as database } from './db'

export interface WindowController {
  minimize(): void
  maximize(): void
  unmaximize(): void
  isMaximized(): boolean
  close(): void
  /** Chỉ có trên Windows (titleBarOverlay); nền tảng khác bỏ qua. */
  setTitleBarOverlay?(overlay: { color: string; symbolColor: string }): void
}

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
  deployService: DeployService,
  historyService: HistoryService,
  getWindow: () => WindowController | null,
  monitorService?: MonitorService,
  migrateService?: MigrateService
): void {
  handle('vps:list', () => vpsService.list())
  handle('vps:create', (input) => vpsService.create(input))
  handle('vps:update', (id, patch) => vpsService.update(id, patch))
  handle('vps:delete', (id) => vpsService.delete(id))
  handle('vps:test-connection', (input) =>
    testConnectionWithCredentials({
      host: input.host,
      port: input.port,
      hostFingerprint: input.host_fingerprint ?? null,
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
  handle('vps:scan', async (vpsId) => {
    const result = await scanVpsEnvironment(ssh, vpsId)
    const docker = result.items.find((item) => item.key === 'docker')
    vpsService.recordOnline(vpsId, docker?.ok ? (docker.version ?? undefined) : undefined)
    return result
  })

  handle('deploy:detect', (sourcePath) => deployService.detect(sourcePath))
  handle('deploy:prepare-git', (requestId, input) => deployService.prepareGit(requestId, input))
  handle('deploy:cancel-git-prepare', (requestId) => {
    deployService.cancelGitPrepare(requestId)
  })
  handle('deploy:precheck', (input) => deployService.precheck(input))
  handle('deploy:start', (input) => deployService.start(input))
  handle('deploy:cancel', (deploymentId) => {
    deployService.cancel(deploymentId)
  })
  handle('doctor:diagnose', (input) => {
    const e = input.evidence
    const redacted = redactEvidence({
      step: e.step,
      errorCode: e.error_code,
      logs: e.logs,
      containerState: e.container_state
        ? {
            status: e.container_state.status,
            exitCode: e.container_state.exit_code,
            health: e.container_state.health,
            oomKilled: e.container_state.oom_killed
          }
        : undefined,
      diskFreeMb: e.disk_free_mb,
      inodeFreePct: e.inode_free_pct,
      listenerPort: e.listener_port,
      expectedPort: e.expected_port,
      httpStatusByPath: e.http_status_by_path,
      dbError: e.db_error,
      requiredEnv: e.required_env,
      presentEnv: e.present_env,
      dnsStatus: e.dns_status,
      externalProbe: e.external_probe,
      dockerAvailable: e.docker_available,
      sshTransient: e.ssh_transient
    })
    const result = diagnose(redacted)
    if (typeof input.deployment_id === 'number') {
      new DoctorRepository(database).create({
        deploymentId: input.deployment_id,
        trigger: 'manual',
        evidence: redacted,
        diagnosis: result
      })
    }
    return {
      code: result.code,
      title: result.title,
      confidence: result.confidence,
      evidence: result.evidence,
      fix_id: result.fixId,
      verify_probe: result.verifyProbe,
      safe_to_auto_fix: result.safeToAutoFix,
      abstained: result.abstained
    }
  })
  handle('doctor:fix', async (input) => {
    const row = database
      .prepare('SELECT app_id FROM deployment WHERE id = ?')
      .get(input.deployment_id) as { app_id: number } | undefined
    if (!row) throw new AppError('VALIDATION', 'Không tìm thấy deployment để tự sửa.')
    const app = deployService.getApp(row.app_id)
    const vps = new VpsRepository(database).getById(app.vps_id)
    return new DoctorFixService(ssh, database).execute({
      fixId: input.fix_id,
      deploymentId: input.deployment_id,
      app,
      vps
    })
  })
  handle('domain:plan', (input) =>
    planDomain({
      hostname: input.hostname,
      target: input.target,
      appPort: input.app_port,
      mode: input.mode
    })
  )
  handle('domain:check', (hostname, target, recordType) =>
    checkDomainTarget(hostname, target, recordType)
  )
  handle('domain:upsert', async (input) => {
    if (input.provider !== 'cloudflare') {
      throw new AppError('VALIDATION', 'Provider DNS chưa được hỗ trợ.')
    }
    if (!input.api_token.trim() || !/^[a-f0-9]{32}$/i.test(input.zone_id.trim())) {
      throw new AppError('VALIDATION', 'Cần nhập Cloudflare API token và Zone ID.')
    }
    const deployment = database
      .prepare(
        `SELECT d.app_id, a.host_port, v.host
         FROM deployment d
         JOIN app a ON a.id = d.app_id
         JOIN vps v ON v.id = a.vps_id
         WHERE d.id = ?`
      )
      .get(input.deployment_id) as { app_id: number; host_port: number; host: string } | undefined
    if (!deployment) throw new AppError('VALIDATION', 'Không tìm thấy deployment để gắn domain.')

    const existingBinding = database
      .prepare('SELECT app_id FROM domain_binding WHERE hostname = ?')
      .get(input.hostname.trim().toLowerCase()) as { app_id: number } | undefined
    if (existingBinding && existingBinding.app_id !== deployment.app_id) {
      throw new AppError(
        'VALIDATION',
        'Hostname này đã được gắn cho app khác. Hãy disable binding cũ trước khi chuyển domain.'
      )
    }

    if (input.mode === 'named_tunnel') {
      throw new AppError(
        'VALIDATION',
        'Mode named_tunnel yêu cầu CNAME target của tunnel đã được thiết lập; chưa hỗ trợ tự tạo named tunnel từ IP VPS.'
      )
    }

    const plan = planDomain({
      hostname: input.hostname,
      target: deployment.host,
      appPort: deployment.host_port,
      mode: input.mode
    })
    const ownershipKey = `opspilot:${deployment.app_id}:${plan.hostname}`
    const provider = new CloudflareDnsProvider({
      apiToken: input.api_token.trim(),
      zoneId: input.zone_id.trim()
    })
    const record = {
      type: plan.record_type,
      name: plan.record_name,
      content: plan.target,
      ownershipKey
    }
    const result = await provider.upsertRecord(record)
    const propagation = result.ok ? await provider.checkPropagation(record) : null
    const status: 'pending' | 'propagated' | 'conflict' | 'failed' = !result.ok
      ? result.conflict
        ? 'conflict'
        : 'failed'
      : propagation?.status === 'propagated'
        ? 'propagated'
        : 'pending'

    const safeMessage = redactText(maskSecrets(result.message))
    const safeTechnical = result.technical ? redactText(maskSecrets(result.technical)) : undefined

    new DomainRepository(database).upsert({
      app_id: deployment.app_id,
      hostname: plan.hostname,
      mode: plan.mode,
      provider: input.provider,
      zone_id: input.zone_id.trim(),
      record_type: plan.record_type,
      record_name: plan.record_name,
      target: plan.target,
      ownership_key: ownershipKey,
      status,
      evidence_json: JSON.stringify({
        message: safeMessage,
        id: result.id ?? null,
        conflict: result.conflict ?? false,
        technical: safeTechnical ?? null,
        propagation: propagation
          ? { status: propagation.status, observed: propagation.observed }
          : null
      })
    })
    if (!result.ok) {
      const errorMessage = safeTechnical ? `${safeMessage}: ${safeTechnical}` : safeMessage
      throw new AppError(result.conflict ? 'VALIDATION' : 'UNKNOWN', errorMessage, {
        cause: safeTechnical ? new Error(safeTechnical) : undefined
      })
    }
    return {
      hostname: plan.hostname,
      record_type: plan.record_type,
      record_name: plan.record_name,
      target: plan.target,
      public_url: plan.public_url,
      status,
      message: propagation?.message ? `${result.message} ${propagation.message}` : result.message
    }
  })
  handle('app:list', (vpsId) => deployService.listApps(vpsId))
  handle('app:get', (appId) => deployService.getApp(appId))
  handle('app:versions', (appId) => deployService.versions(appId))
  handle('app:runtime-inspect', async (appId) => {
    const target = deployService.getApp(appId)
    const result = await ssh.exec(
      target.vps_id,
      `docker inspect -f '{{.Config.Image}}|{{.State.Status}}' ${target.name}-app`,
      { timeoutMs: 15_000, retryOnReconnect: true }
    )
    const [image, state] = result.stdout.trim().split('|')
    if (result.code !== 0 || !image || !state) {
      throw new AppError('UNKNOWN', `Không xác minh được runtime app ${target.name}.`, {
        cause: new Error(result.stderr.trim() || result.stdout.trim())
      })
    }
    return { image, state }
  })
  handle('app:rollback', (appId, targetDeploymentId) =>
    deployService.rollback(appId, targetDeploymentId)
  )

  if (migrateService) {
    handle('migrate:start', (input) => migrateService.start(input))
    handle('migrate:list', () => migrateService.list())
    handle('migrate:confirm', (jobId, keepSource) => migrateService.confirm(jobId, keepSource))
    handle('migrate:abort', (jobId) => migrateService.abort(jobId))
  }

  handle('history:list', (filter) => historyService.list(filter))

  if (monitorService) {
    handle('monitor:samples', (deploymentId, fromTs) =>
      monitorService.samples(deploymentId, fromTs)
    )
    handle('monitor:scores', (deploymentId, fromTs) => monitorService.scores(deploymentId, fromTs))
    handle('monitor:alerts', (deploymentId, limit) => monitorService.alerts(deploymentId, limit))
    handle('monitor:get-setting', (appId) => monitorService.getSetting(appId))
    handle('monitor:set-setting', (appId, patch) => monitorService.setSetting(appId, patch))
    handle('monitor:label-alert', (alertId, label) => monitorService.labelAlert(alertId, label))
    handle('monitor:train-now', async (deploymentId) => {
      const port = mlService.getPort()
      if (!port) throw new AppError('ML_SERVICE_DOWN', 'ML service chưa sẵn sàng.')
      return monitorService.trainNow(deploymentId, new MlApiClient(`http://127.0.0.1:${port}`))
    })
  }

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
  handle('window:minimize', () => {
    getWindow()?.minimize()
  })
  handle('window:toggle-maximize', () => {
    const window = getWindow()
    if (!window) return { maximized: false }
    if (window.isMaximized()) {
      window.unmaximize()
    } else {
      window.maximize()
    }
    return { maximized: window.isMaximized() }
  })
  handle('window:is-maximized', () => ({ maximized: getWindow()?.isMaximized() ?? false }))
  handle('window:close', () => {
    getWindow()?.close()
  })
  handle('window:set-titlebar-overlay', (overlay) => {
    if (process.platform !== 'win32') return
    getWindow()?.setTitleBarOverlay?.(overlay)
  })
}
