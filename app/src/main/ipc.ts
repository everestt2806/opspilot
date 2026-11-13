import { dialog, ipcMain, shell } from 'electron'

import type {
  DomainIngressActionInput,
  DomainIngressListInput,
  DomainIngressStatusInput,
  IpcInvokeMap,
  IpcResult,
  SharedIngressBindingDto
} from '@shared/ipc'

import type { DeployService } from './deploy/service'
import { AppError, toIpcError } from './errors'
import type { HistoryService } from './history/service'
import type { MlServiceManager } from './mlClient'
import type { SshManager } from './ssh/manager'
import { readVpsResources, testConnectionWithCredentials } from './vps/connectionService'
import { readVpsOperationalDiagnostics } from './vps/operationalDiagnostics'
import { discoverVpsApps } from './vps/discovery'
import { VpsAppImportService } from './vps/importService'
import { RecoveryManifestService } from './vps/recoveryManifestService'
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
import { checkSharedIngressReadiness } from './domain/ingress/dnsReadiness'
import { preflightSharedIngress } from './domain/ingress/preflight'
import {
  SharedIngressService,
  type SharedIngressServiceResult
} from './domain/ingress/sharedIngressService'
import { DomainRepository } from './domain/repository'
import { AppRepository } from './db/appRepository'
import { DeploymentRepository } from './db/deploymentRepository'
import { DoctorFixService } from './doctor/fix'
import { DoctorRepository } from './doctor/repository'
import { VpsRepository } from './db/vpsRepository'
import { db as database } from './db'
import type { DesktopControllerService } from './controlPlane/desktopControllerService'

export interface WindowController {
  minimize(): void
  maximize(): void
  unmaximize(): void
  isMaximized(): boolean
  close(): void
  /** Chỉ có trên Windows (titleBarOverlay); nền tảng khác bỏ qua. */
  setTitleBarOverlay?(overlay: { color: string; symbolColor: string }): void
}

async function safeIngressIpc<T>(work: () => T | Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof AppError) {
      throw new AppError(error.code, error.userMessage)
    }
    throw new AppError(
      'UNKNOWN',
      'Không thể hoàn tất thao tác shared ingress. Hãy kiểm tra trạng thái và thử lại.'
    )
  }
}

function parseIngressListInput(value: unknown): DomainIngressListInput {
  const input = exactInput(value, ['vps_id', 'app_id'])
  return { vps_id: positiveSafeId(input.vps_id), app_id: positiveSafeId(input.app_id) }
}

function parseIngressStatusInput(value: unknown): DomainIngressStatusInput {
  const input = exactInput(value, ['vps_id', 'binding_id'])
  return { vps_id: positiveSafeId(input.vps_id), binding_id: positiveSafeId(input.binding_id) }
}

function parseIngressActionInput(value: unknown): DomainIngressActionInput {
  const input = exactInput(value, ['vps_id', 'binding_id', 'action'])
  const vps_id = positiveSafeId(input.vps_id)
  const binding_id = positiveSafeId(input.binding_id)
  if (
    input.action !== 'install' &&
    input.action !== 'reconcile' &&
    input.action !== 'https_check'
  ) {
    throw new AppError('VALIDATION', 'Shared ingress action is invalid.')
  }
  return { vps_id, binding_id, action: input.action }
}

function exactInput(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AppError('VALIDATION', 'Shared ingress input must be an object.')
  }
  const input = value as Record<string, unknown>
  const actual = Object.keys(input).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new AppError('VALIDATION', 'Shared ingress input contains missing or unsupported fields.')
  }
  return input
}

function positiveSafeId(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new AppError('VALIDATION', 'Shared ingress identifiers must be positive safe integers.')
  }
  return value
}

function ingressResultDto(
  vpsId: number,
  bindingId: number,
  result: SharedIngressServiceResult
): SharedIngressBindingDto {
  const state = new DomainRepository(database).getSharedIngressBindingById(vpsId, bindingId)
  if (!state)
    throw new AppError('VALIDATION', 'Shared ingress binding does not belong to this VPS.')
  const reasonCode = result.reason?.code
  return {
    vps_id: vpsId,
    binding_id: bindingId,
    app_id: state.app_id,
    hostname: state.hostname,
    operation: result.operation,
    status: result.status,
    failed_step: result.failed_step,
    reason: reasonCode
      ? { code: reasonCode, message: 'Saved ingress state requires attention.' }
      : null,
    retryable: result.retryable,
    http_url: result.http_url,
    dns_status: state.dns_status,
    route_status: result.route_status ?? state.route_status,
    certificate_status: result.certificate_status ?? state.certificate_status,
    https_probe_status: result.https_probe_status ?? state.https_probe_status,
    ...(result.route_count === undefined ? {} : { route_count: result.route_count })
  }
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
  migrateService?: MigrateService,
  sharedIngressService?: SharedIngressService,
  desktopControllerService?: DesktopControllerService
): void {
  if (desktopControllerService) {
    handle('controller:review-adoption', (input) =>
      desktopControllerService.reviewControllerAdoption(input)
    )
    handle('controller:confirm-adoption', (input) =>
      desktopControllerService.confirmControllerAdoption(input)
    )
    handle('controller:review-ssh-authority', (input) =>
      desktopControllerService.reviewControllerAuthority(input)
    )
    handle('controller:confirm-ssh-authority', (input) =>
      desktopControllerService.confirmControllerAuthority(input)
    )
    handle('controller:upgrade-overview', () => desktopControllerService.upgradeOverview())
    handle('controller:review-upgrade', (input) => desktopControllerService.reviewUpgrade(input))
    handle('controller:prepare-upgrade', (input) => desktopControllerService.prepareUpgrade(input))
    handle('controller:send-upgrade', (input) => desktopControllerService.sendUpgrade(input))
    handle('controller:inspect-upgrade', (key) => desktopControllerService.inspectUpgrade(key))
    handle('controller:cancel-upgrade', (key) => desktopControllerService.cancelUpgrade(key))
    handle('controller:review-upgrade-binding', (input) =>
      desktopControllerService.reviewUpgradeBinding(input)
    )
    handle('controller:refresh-upgrade-binding', (input) =>
      desktopControllerService.refreshUpgradeBinding(input)
    )
    handle('controller:installer-overview', () => desktopControllerService.installerOverview())
    handle('controller:review-installation', (input) =>
      desktopControllerService.reviewInstaller(input)
    )
    handle('controller:prepare-installation', (input) =>
      desktopControllerService.prepareInstaller(input)
    )
    handle('controller:send-installation', (input) => desktopControllerService.sendInstaller(input))
    handle('controller:inspect-installation', (key) =>
      desktopControllerService.inspectInstallation(key)
    )
    handle('controller:rebind-installation', (input) =>
      desktopControllerService.rebindInstaller(input)
    )
    handle('controller:cancel-installation', (key) =>
      desktopControllerService.cancelInstallation(key)
    )
    handle('controller:prepare-installed-binding', (input) =>
      desktopControllerService.prepareInstalledRegistration(input)
    )
    handle('controller:register-installed', (input) =>
      desktopControllerService.registerInstalled(input)
    )
    handle('controller:list', () => desktopControllerService.list())
    handle('controller:register', (input) => desktopControllerService.register(input))
    handle('controller:retry-enrollment', (bindingId) => desktopControllerService.retry(bindingId))
    handle('controller:revoke', (bindingId) => desktopControllerService.revoke(bindingId))
    handle('controller:disconnect', (bindingId) => desktopControllerService.disconnect(bindingId))
    handle('controller:apps', (input) => desktopControllerService.apps(input))
    handle('controller:app-status', (input) => desktopControllerService.appStatus(input))
    handle('controller:exposure-read', (input) => desktopControllerService.exposure(input))
    handle('controller:exposure-check', (input) => desktopControllerService.exposure(input, true))
    handle('controller:prepare-command', (input) => desktopControllerService.prepareCommand(input))
    handle('controller:send-command', (key) => desktopControllerService.sendCommand(key))
    handle('controller:check-command', (key) => desktopControllerService.checkCommand(key))
    handle('controller:cancel-command', (key) => desktopControllerService.cancelCommand(key))
    handle('controller:commands', (bindingId) => desktopControllerService.listCommands(bindingId))
    handle('controller:prepare-target', (input) => desktopControllerService.prepareTarget(input))
    handle('controller:send-target', (input) => desktopControllerService.sendTarget(input))
    handle('controller:target-setups', (binding) =>
      desktopControllerService.listTargetSetups(binding)
    )
    handle('controller:cancel-target', (key) => desktopControllerService.cancelTarget(key))
    handle('controller:project-readiness', (key) => desktopControllerService.projectReadiness(key))
    handle('controller:prepare-first-deployment', (input) =>
      desktopControllerService.prepareFirstDeployment(input)
    )
    handle('controller:send-first-deployment', (input) =>
      desktopControllerService.sendFirstDeployment(input)
    )
    handle('controller:project-targets', (input) => desktopControllerService.projectTargets(input))
    handle('controller:project-target-state', (key) =>
      desktopControllerService.projectTargetState(key)
    )
    handle('controller:enroll-project-target', (input) =>
      desktopControllerService.enrollProjectTarget(input)
    )
    handle('controller:verify-project-source', (key) =>
      desktopControllerService.verifyProjectSource(key)
    )
    handle('controller:environment-context', (input) =>
      desktopControllerService.environmentContext(input)
    )
    handle('controller:prepare-environment', (input) =>
      desktopControllerService.prepareEnvironment(input)
    )
    handle('controller:send-environment', (input) =>
      desktopControllerService.sendEnvironment(input)
    )
    handle('controller:check-environment', (input) =>
      desktopControllerService.checkEnvironment(input)
    )
    handle('controller:environment-intents', (input) =>
      desktopControllerService.listEnvironmentIntents(input)
    )
    handle('controller:cancel-environment', (input) =>
      desktopControllerService.cancelEnvironment(input)
    )
    handle('controller:prepare-project', (input) => desktopControllerService.prepareProject(input))
    handle('controller:send-project', (key) => desktopControllerService.sendProject(key))
    handle('controller:projects', (bindingId) => desktopControllerService.listProjects(bindingId))
    handle('controller:cancel-project', (key) => desktopControllerService.cancelProject(key))
  }
  const ingressService =
    sharedIngressService ??
    new SharedIngressService({
      vpsRepository: new VpsRepository(database),
      appRepository: new AppRepository(database),
      deploymentRepository: new DeploymentRepository(database),
      domainRepository: new DomainRepository(database),
      ssh,
      policy: { certificateEnvironment: 'production', stagingLabHostnames: [] }
    })
  handle('vps:list', () => vpsService.list())
  handle('vps:create', (input) => vpsService.create(input))
  handle('vps:update', (id, patch) => vpsService.update(id, patch))
  handle('vps:delete', async (id) => {
    vpsService.delete(id)
    await ssh.disconnect(id)
  })
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
  handle('vps:get-operational-diagnostics', (vpsId) => readVpsOperationalDiagnostics(ssh, vpsId))
  handle('vps:discover-apps', (vpsId) => discoverVpsApps(ssh, vpsId))
  handle('vps:import-app', (vpsId, name, snapshot) =>
    new VpsAppImportService(database, ssh).importApp(vpsId, name, snapshot)
  )
  handle('vps:write-recovery-manifest', (vpsId, name) =>
    new RecoveryManifestService(database, ssh).write(vpsId, name)
  )
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
  handle('deploy:release-git-prepare', (handle) => {
    deployService.releaseGitPrepare(handle)
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
      .prepare(
        'SELECT d.app_id, d.origin, a.imported_from_vps FROM deployment d JOIN app a ON a.id=d.app_id WHERE d.id = ?'
      )
      .get(input.deployment_id) as
      { app_id: number; origin: 'opspilot' | 'vps_import'; imported_from_vps: 0 | 1 } | undefined
    if (!row) throw new AppError('VALIDATION', 'Không tìm thấy deployment để tự sửa.')
    if (row.origin === 'vps_import' || row.imported_from_vps === 1) {
      throw new AppError('VALIDATION', 'Chưa thể chạy Doctor fix cho app vừa nhập từ VPS.')
    }
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
  handle('domain:ingress-readiness', async (input) => {
    const hostname = input.hostname.trim().toLowerCase().replace(/\.$/, '')
    if (!Number.isInteger(input.vps_id) || input.vps_id < 1 || !hostname) {
      throw new AppError('VALIDATION', 'Cần chọn VPS và hostname hợp lệ.')
    }
    const proxyHint = input.cloudflare_proxy_hint ?? 'unknown'
    if (!['enabled', 'disabled', 'unknown'].includes(proxyHint)) {
      throw new AppError('VALIDATION', 'Gợi ý Cloudflare Proxy không hợp lệ.')
    }
    const binding = database
      .prepare(
        `SELECT b.hostname, b.mode, v.host
       FROM domain_binding b
       JOIN app a ON a.id = b.app_id
       JOIN vps v ON v.id = a.vps_id
       WHERE b.hostname = ? AND v.id = ? AND v.archived_at IS NULL`
      )
      .get(hostname, input.vps_id) as { hostname: string; mode: string; host: string } | undefined
    if (!binding || binding.mode !== 'shared_ingress') {
      throw new AppError(
        'VALIDATION',
        'Không tìm thấy shared_ingress binding cho hostname và VPS đã chọn.'
      )
    }
    const ingress = await preflightSharedIngress(ssh, input.vps_id)
    return checkSharedIngressReadiness({
      hostname: binding.hostname,
      vpsHost: binding.host,
      cloudflareProxyHint: proxyHint,
      ingress
    })
  })
  handle('domain:ingress-list', (rawInput) =>
    safeIngressIpc(() => {
      const input = parseIngressListInput(rawInput)
      return ingressService.listBindings(input.vps_id, input.app_id)
    })
  )
  handle('domain:ingress-status', async (rawInput) =>
    safeIngressIpc(async () => {
      const input = parseIngressStatusInput(rawInput)
      const result = await ingressService.readStatus(input.vps_id, input.binding_id)
      return ingressResultDto(input.vps_id, input.binding_id, result)
    })
  )
  handle('domain:ingress-action', async (rawInput) =>
    safeIngressIpc(async () => {
      const input = parseIngressActionInput(rawInput)
      const result =
        input.action === 'install'
          ? await ingressService.prepareOrInstall(input.vps_id, input.binding_id)
          : input.action === 'reconcile'
            ? await ingressService.reconcile(input.vps_id, input.binding_id)
            : await ingressService.checkHttps(input.vps_id, input.binding_id)
      return ingressResultDto(input.vps_id, input.binding_id, result)
    })
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
        `SELECT d.app_id, a.host_port, v.host, d.origin
         FROM deployment d
         JOIN app a ON a.id = d.app_id
         JOIN vps v ON v.id = a.vps_id
         WHERE d.id = ? AND v.archived_at IS NULL`
      )
      .get(input.deployment_id) as
      | { app_id: number; host_port: number; host: string; origin: 'opspilot' | 'vps_import' }
      | undefined
    if (!deployment) throw new AppError('VALIDATION', 'Không tìm thấy deployment để gắn domain.')

    if (deployment.origin === 'vps_import') {
      throw new AppError('VALIDATION', 'Chưa thể quản lý domain cho app vừa nhập từ VPS.')
    }

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

    new DomainRepository(database).upsertDns({
      app_id: deployment.app_id,
      hostname: plan.hostname,
      mode: plan.mode,
      provider: input.provider,
      zone_id: input.zone_id.trim(),
      record_type: plan.record_type,
      record_name: plan.record_name,
      target: plan.target,
      ownership_key: ownershipKey,
      route_ownership_key: `opspilot-ingress:${deployment.app_id}:${plan.hostname}`,
      dns_status: status,
      dns_evidence_json: JSON.stringify({
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
