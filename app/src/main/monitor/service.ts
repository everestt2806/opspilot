import type Database from 'better-sqlite3'
import type {
  Alert,
  DetectionMethod,
  IpcEventMap,
  MetricSample,
  MonitorSetting,
  ScoreSet
} from '@shared/ipc'
import { MonitorRepository } from './repository'
import { MetricSourceError, MonitorPoller, type MonitorRuntime } from './poller'
import { z } from 'zod'
import { AppError } from '../errors'
import { SshMetricSource } from './metricSource'
import type { SshManager } from '../ssh/manager'
import { join as posixJoin } from 'node:path/posix'
import { metricLineSchema } from './metricParser'
import type { MlApiClient } from './mlApi'
import { ActivationRepository } from './activation'
import { withAppLock } from './appLock'
import { DeploymentRepository } from '../db/deploymentRepository'
import {
  countConsecutiveTriggeredScores,
  isDesktopAutoRollbackAllowed,
  shouldAutoRollback
} from './auto-rollback'

export interface AutoRollbackRequest {
  appId: number
  currentDeploymentId: number
  targetDeploymentId: number
  fromVersion: number
  toVersion: number
  method: DetectionMethod
  consecutive: number
  peakScore: number
  alertId: number
}

export type AutoRollbackExecutor = (
  request: AutoRollbackRequest
) => Promise<{ ok: boolean; deploymentId?: number; error?: string }>

const settingPatchSchema = z
  .object({
    collector_interval_s: z.number().finite().int().min(1).optional(),
    poll_interval_s: z.number().finite().int().min(1).optional(),
    rule_cpu_pct: z.number().finite().min(0).optional(),
    rule_mem_pct: z.number().finite().min(0).max(100).optional(),
    rule_latency_ms: z.number().finite().min(0).optional(),
    rule_error_rate: z.number().finite().min(0).max(1).optional(),
    rule_consecutive: z.number().finite().int().min(1).optional(),
    ml_score_threshold: z.number().finite().min(0).max(1).optional(),
    ml_consecutive: z.number().finite().int().min(1).optional(),
    auto_rollback: z.union([z.literal(0), z.literal(1)]).optional(),
    trusted_method: z.enum(['rule', 'zscore_ewma', 'iforest', 'ocsvm', 'ensemble']).optional(),
    rollback_consecutive: z.number().finite().int().min(1).optional(),
    cooldown_minutes: z.number().finite().int().min(0).optional()
  })
  .strict()

export class MonitorService {
  private readonly repository: MonitorRepository
  private readonly autoTrainAttempts = new Map<number, number>()
  private readonly lastMlStatus = new Map<number, string>()
  private readonly lastMlLog = new Map<number, number>()
  constructor(
    private readonly db: Database.Database,
    private readonly options: {
      autoTrain?: boolean
      strict?: boolean
      autoRollback?: AutoRollbackExecutor
    } = {}
  ) {
    this.repository = new MonitorRepository(db)
  }
  samples(deploymentId: number, fromTs: string): MetricSample[] {
    return this.repository.listSamples(deploymentId, fromTs)
  }
  scores(deploymentId: number, fromTs: string): Array<{ ts_vps: string } & ScoreSet> {
    return this.repository.listScores(deploymentId, fromTs)
  }
  alerts(deploymentId: number, limit: number): Alert[] {
    return this.repository.listAlerts(deploymentId, Math.min(Math.max(limit, 1), 500))
  }
  getSetting(appId: number): MonitorSetting {
    this.assertNotImportedApp(appId)
    return this.repository.getOrCreateSetting(appId)
  }
  setSetting(appId: number, patch: Partial<MonitorSetting>): MonitorSetting {
    const imported = this.db.prepare('SELECT imported_from_vps FROM app WHERE id=?').get(appId) as
      { imported_from_vps: 0 | 1 } | undefined
    if (imported?.imported_from_vps === 1) {
      throw new AppError('VALIDATION', 'Chưa thể bật monitor cho app vừa nhập từ VPS.')
    }
    const parsed = settingPatchSchema.safeParse(patch)
    if (!parsed.success) throw new AppError('VALIDATION', 'Setting không hợp lệ.')
    const entries = Object.entries(parsed.data)
    if (!entries.length) return this.getSetting(appId)
    const update = this.db.transaction(() => {
      this.repository.getOrCreateSetting(appId)
      for (const [key, value] of entries) {
        this.db
          .prepare(`UPDATE monitor_setting SET ${key}=?, updated_at=? WHERE app_id=?`)
          .run(value, new Date().toISOString(), appId)
      }
      this.db
        .prepare('INSERT INTO action_log (action,status,message,app_id) VALUES (?,?,?,?)')
        .run('config_change', 'success', 'Cập nhật cấu hình monitor', appId)
    })
    update()
    return this.getSetting(appId)
  }
  labelAlert(alertId: number, label: 'true_positive' | 'false_positive' | null): void {
    if (label !== null && label !== 'true_positive' && label !== 'false_positive')
      throw new AppError('VALIDATION', 'Invalid alert label')
    const alert = this.db
      .prepare(
        'SELECT al.id, a.imported_from_vps FROM alert al LEFT JOIN deployment d ON d.id=al.deployment_id LEFT JOIN app a ON a.id=d.app_id WHERE al.id=?'
      )
      .get(alertId) as { id: number; imported_from_vps: number } | undefined
    if (!alert) throw new AppError('VALIDATION', 'Alert not found')
    if (alert.imported_from_vps === 1)
      throw new AppError('VALIDATION', 'Cannot label alerts for a VPS imported app.')
    const update = this.db.transaction(() => {
      const result = this.db
        .prepare('UPDATE alert SET label=?, labeled_at=? WHERE id=?')
        .run(label, label ? new Date().toISOString() : null, alertId)
      if (result.changes !== 1) throw new AppError('VALIDATION', 'Alert not found')
      this.db
        .prepare('INSERT INTO action_log (action,status,message) VALUES (?,?,?)')
        .run('alert_labeled', 'success', `Updated alert ${alertId}`)
    })
    update()
  }
  async trainNow(
    deploymentId: number,
    client: MlApiClient
  ): Promise<{ train_sample_count: number }> {
    const deployment = this.db
      .prepare(
        'SELECT a.imported_from_vps, d.origin FROM deployment d JOIN app a ON a.id=d.app_id WHERE d.id=?'
      )
      .get(deploymentId) as { imported_from_vps: number; origin: string } | undefined
    if (!deployment || deployment.imported_from_vps === 1 || deployment.origin === 'vps_import')
      throw new AppError('VALIDATION', 'Cannot train monitor for a VPS imported deployment.')
    const rows = this.db
      .prepare('SELECT raw_json FROM metric_sample WHERE deployment_id=? ORDER BY seq')
      .all(deploymentId) as Array<{ raw_json: string }>
    if (rows.length < 150) throw new AppError('VALIDATION', 'Chưa đủ 150 mẫu để train')
    const samples = rows.map((row) => metricLineSchema.parse(JSON.parse(row.raw_json)))
    const result = await client.train(deploymentId, samples)
    return { train_sample_count: result.train_sample_count }
  }
  async pollAll(
    ssh: SshManager,
    scorer?: MonitorRuntime,
    emit?: (event: IpcEventMap['monitor:tick']) => void,
    mlStatus?: (status: { running: boolean; reason?: string }) => void,
    onAutoRollback?: (event: IpcEventMap['system:auto-rollback']) => void
  ): Promise<void> {
    await this.reconcilePrepared(ssh)
    for (const target of this.repository.listTargets()) {
      const poller = new MonitorPoller(this.db, this.repository, undefined, scorer, {
        report: (status) => this.reportMl(target.deployment_id, mlStatus, status, target.app_id)
      })
      let result: { sampleIds: number[]; alertIds: number[] }
      try {
        result = await poller.poll(
          target.app_id,
          target.deployment_id,
          new SshMetricSource(
            ssh,
            target.vps_id,
            posixJoin('/opt/opspilot', target.app_name, 'metrics', 'metrics.jsonl')
          )
        )
      } catch (error) {
        this.repository.logAction(
          'ssh_error',
          'failed',
          'Không đọc được metrics.jsonl',
          target.app_id,
          target.deployment_id
        )
        if (this.options.strict) throw error
        if (!(error instanceof MetricSourceError)) throw error
        continue
      }
      if (scorer && this.options.autoTrain !== false)
        await this.maybeAutoTrain(target.deployment_id, scorer, (status) =>
          this.reportMl(target.deployment_id, mlStatus, status, target.app_id)
        )
      const samples = this.repository.listSamplesByIds(result.sampleIds)
      if (samples.length)
        emit?.({
          deployment_id: target.deployment_id,
          samples,
          scores: this.repository.listScoresBySampleIds(result.sampleIds),
          new_alerts: this.repository.listAlertsByIds(result.alertIds)
        })
      if (this.options.autoRollback && result.sampleIds.length > 0) {
        await this.evaluateAutoRollback(
          target.app_id,
          target.deployment_id,
          result.sampleIds,
          onAutoRollback
        )
      }
    }
  }

  private async evaluateAutoRollback(
    appId: number,
    deploymentId: number,
    freshSampleIds: number[],
    onAutoRollback?: (event: IpcEventMap['system:auto-rollback']) => void
  ): Promise<void> {
    if (!this.options.autoRollback || !isDesktopAutoRollbackAllowed(this.db, appId)) return

    const currentApp = this.db
      .prepare('SELECT current_deployment_id, imported_from_vps FROM app WHERE id=?')
      .get(appId) as { current_deployment_id: number | null; imported_from_vps: number } | undefined
    if (
      !currentApp ||
      currentApp.imported_from_vps === 1 ||
      currentApp.current_deployment_id !== deploymentId
    ) {
      return
    }

    const currentDeployment = new DeploymentRepository(this.db).getById(deploymentId)
    if (currentDeployment.status !== 'running' || currentDeployment.origin !== 'opspilot') return

    const setting = this.repository.getOrCreateSetting(appId)
    if (setting.auto_rollback !== 1) return

    const streak = countConsecutiveTriggeredScores(
      this.db,
      deploymentId,
      setting.trusted_method,
      setting.rollback_consecutive
    )
    if (streak.count < setting.rollback_consecutive) return

    // Only react when at least one sample in the active streak arrived in the current poll,
    // preventing historical alerts from re-triggering after restart when no new data arrived.
    const freshSet = new Set(freshSampleIds)
    if (!streak.metricSampleIds.some((id) => freshSet.has(id))) return

    const openAlert = this.db
      .prepare(
        'SELECT id, acted, peak_score FROM alert WHERE deployment_id=? AND method=? AND ts_resolved IS NULL ORDER BY id DESC LIMIT 1'
      )
      .get(deploymentId, setting.trusted_method) as
      { id: number; acted: Alert['acted']; peak_score: number } | undefined
    if (!openAlert || openAlert.acted !== 'none') return

    const cooldownRow = this.db
      .prepare('SELECT last_rollback_at FROM monitor_setting WHERE app_id=?')
      .get(appId) as { last_rollback_at: string | null } | undefined
    const decision = shouldAutoRollback({
      setting,
      consecutiveTriggered: streak.count,
      lastRollbackAt: cooldownRow?.last_rollback_at ?? null,
      now: new Date().toISOString()
    })

    if (decision.reason === 'cooldown') {
      this.db
        .prepare(
          "UPDATE alert SET acted='rollback_suppressed_cooldown' WHERE id=? AND acted='none'"
        )
        .run(openAlert.id)
      return
    }
    if (!decision.rollback) return

    const previous = new DeploymentRepository(this.db).previousCompleted(
      appId,
      currentDeployment.version
    )
    if (!previous) {
      const claimed = this.db
        .prepare("UPDATE alert SET acted='rollback_auto' WHERE id=? AND acted='none'")
        .run(openAlert.id)
      if (claimed.changes === 1) {
        this.repository.logAction(
          'rollback_auto',
          'failed',
          `Auto-rollback bị bỏ qua: app đang ở v${currentDeployment.version}, chưa có phiên bản trước đó.`,
          appId,
          deploymentId
        )
      }
      return
    }

    const claimed = this.db
      .prepare("UPDATE alert SET acted='rollback_auto' WHERE id=? AND acted='none'")
      .run(openAlert.id)
    if (claimed.changes !== 1) return

    let outcome: { ok: boolean; deploymentId?: number; error?: string }
    try {
      outcome = await this.options.autoRollback({
        appId,
        currentDeploymentId: deploymentId,
        targetDeploymentId: previous.id,
        fromVersion: currentDeployment.version,
        toVersion: previous.version,
        method: setting.trusted_method,
        consecutive: streak.count,
        peakScore: Math.max(openAlert.peak_score, streak.peakScore),
        alertId: openAlert.id
      })
    } catch (error) {
      outcome = { ok: false, error: error instanceof Error ? error.message : String(error) }
    }

    if (!outcome.ok) return

    this.db
      .prepare('UPDATE monitor_setting SET last_rollback_at=? WHERE app_id=?')
      .run(new Date().toISOString(), appId)
    onAutoRollback?.({
      app_id: appId,
      from_version: currentDeployment.version,
      to_version: previous.version,
      method: setting.trusted_method,
      alert_id: openAlert.id
    })
  }

  /** Reconcile a prepared cutover after process restart without trusting the DB pointer. */
  private async reconcilePrepared(ssh: SshManager): Promise<void> {
    const deployments = new DeploymentRepository(this.db)
    const appIds = this.db
      .prepare(
        "SELECT DISTINCT da.app_id FROM deployment_activation da JOIN app a ON a.id=da.app_id WHERE da.state='prepared' AND a.imported_from_vps=0"
      )
      .all() as Array<{ app_id: number }>

    for (const { app_id: appId } of appIds) {
      await withAppLock(appId, async () => {
        const activation = new ActivationRepository(this.db)
        const prepared = activation.preparedEpisode(appId)
        if (!prepared) return
        const desktopOwner = this.preparedDesktopOwner(appId, prepared.id, prepared.deploymentId)
        if (desktopOwner === null) return
        const stillDesktopOwned = (): boolean =>
          this.preparedDesktopOwner(appId, prepared.id, prepared.deploymentId) === desktopOwner
        const app = this.db.prepare('SELECT vps_id,name FROM app WHERE id=?').get(appId) as
          { vps_id: number; name: string } | undefined
        if (!app) return
        let preparedImage: string
        let activeImage: string | undefined
        try {
          preparedImage = deployments.runtimeImageTag(prepared.deploymentId)
          const active = activation.active(appId)
          activeImage = active ? deployments.runtimeImageTag(active.deploymentId) : undefined
        } catch (error) {
          this.repository.logAction(
            'ssh_error',
            'failed',
            `Prepared activation ${prepared.id} lineage cannot be resolved; reconciliation required: ${error instanceof Error ? error.message : String(error)}`,
            appId,
            prepared.deploymentId
          )
          return
        }
        const metricsPath = `/opt/opspilot/${app.name}/metrics/metrics.jsonl`
        try {
          const runtime = await ssh.exec(
            app.vps_id,
            `docker inspect -f '{{.Config.Image}}|{{.State.Status}}' ${app.name}-app`,
            { timeoutMs: 15_000, retryOnReconnect: true }
          )
          if (!stillDesktopOwned()) return
          const collector = await ssh.exec(
            app.vps_id,
            `docker inspect -f '{{.State.Status}}' ${app.name}-collector 2>/dev/null || printf 'missing'`,
            { timeoutMs: 15_000, retryOnReconnect: true }
          )
          if (!stillDesktopOwned()) return
          const snapshot = await ssh.metricSnapshot(app.vps_id, metricsPath)
          // Acquire the SQLite write lock before the final ownership read. Another
          // connection must not transfer authority between this read and activation.
          this.db
            .transaction(() => {
              if (!stillDesktopOwned()) return
              const [image, state] = runtime.stdout.trim().split('|')
              const ownerVerified =
                runtime.code === 0 &&
                state === 'running' &&
                collector.code === 0 &&
                collector.stdout.trim() === 'running' &&
                snapshot?.generation === prepared.generation &&
                snapshot.size + 1 >= prepared.startOffset
              if (ownerVerified && image === preparedImage) {
                const active = activation.active(appId)
                activation.activateAndPoint(prepared.id, prepared.deploymentId, active?.id ?? null)
                this.repository.logAction(
                  'deploy',
                  'success',
                  `Reconciled prepared activation ${prepared.id} after process restart`,
                  appId,
                  prepared.deploymentId
                )
                return
              }
              if (ownerVerified && activeImage && image === activeImage) {
                activation.abortIfCurrent(prepared.id, prepared.deploymentId)
                this.repository.logAction(
                  'deploy',
                  'success',
                  `Aborted prepared activation ${prepared.id}; verified previous owner`,
                  appId,
                  prepared.deploymentId
                )
              } else {
                this.repository.logAction(
                  'ssh_error',
                  'failed',
                  `Prepared activation ${prepared.id} requires reconciliation; runtime owner or source boundary unknown`,
                  appId,
                  prepared.deploymentId
                )
              }
            })
            .immediate()
        } catch (error) {
          if (!stillDesktopOwned()) return
          this.repository.logAction(
            'ssh_error',
            'failed',
            `Prepared activation ${prepared.id} requires reconnect/reconciliation: ${error instanceof Error ? error.message : String(error)}`,
            appId,
            prepared.deploymentId
          )
        }
      })
    }
  }

  /** Product C0 is finalized only by its fenced runtime receipt, never Desktop recovery. */
  private preparedDesktopOwner(
    appId: number,
    activationId: number,
    deploymentId: number
  ): number | null {
    const hasTable = (name: string): boolean =>
      Boolean(
        this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)
      )
    // Older standalone monitor fixtures do not include Product migrations.
    const control = hasTable('product_app_control')
      ? (this.db
          .prepare('SELECT mode,ownership_generation FROM product_app_control WHERE app_id=?')
          .get(appId) as { mode: string; ownership_generation: number } | undefined)
      : undefined
    if (control?.mode === 'product') return null
    if (
      hasTable('product_runtime_execution') &&
      this.db
        .prepare(
          'SELECT 1 FROM product_runtime_execution WHERE activation_id=? OR deployment_id=? LIMIT 1'
        )
        .get(activationId, deploymentId)
    )
      return null
    return control?.ownership_generation ?? 0
  }

  private assertNotImportedApp(appId: number): void {
    const app = this.db.prepare('SELECT imported_from_vps FROM app WHERE id=?').get(appId) as
      { imported_from_vps: number } | undefined
    if (app?.imported_from_vps === 1)
      throw new AppError('VALIDATION', 'Monitor is unavailable for apps imported from a VPS.')
  }

  private async maybeAutoTrain(
    deploymentId: number,
    client: MonitorRuntime,
    report?: (status: { running: boolean; reason?: string }) => void
  ): Promise<void> {
    try {
      const status = await client.status(deploymentId)
      report?.({ running: true })
      const count = (
        this.db
          .prepare('SELECT COUNT(*) n FROM metric_sample WHERE deployment_id=?')
          .get(deploymentId) as { n: number }
      ).n
      if (count < 150 || status.trained) return
      const previous = this.autoTrainAttempts.get(deploymentId) ?? 0
      if (previous && Date.now() - previous < 30_000) return
      this.autoTrainAttempts.set(deploymentId, Date.now())
      const rows = this.db
        .prepare('SELECT raw_json FROM metric_sample WHERE deployment_id=? ORDER BY seq')
        .all(deploymentId) as Array<{ raw_json: string }>
      await client.train(
        deploymentId,
        rows.map((row) => metricLineSchema.parse(JSON.parse(row.raw_json)))
      )
    } catch {
      report?.({
        running: false,
        reason: 'ML status/train không khả dụng'
      })
    }
  }

  private reportMl(
    deploymentId: number,
    report: ((status: { running: boolean; reason?: string }) => void) | undefined,
    status: { running: boolean; reason?: string },
    appId?: number
  ): void {
    const key = `${status.running}:${status.reason ?? ''}`
    const now = Date.now()
    const changed = this.lastMlStatus.get(deploymentId) !== key
    if (
      !status.running &&
      appId !== undefined &&
      (changed || now - (this.lastMlLog.get(deploymentId) ?? 0) >= 30_000)
    ) {
      this.repository.logAction(
        'ml_service_restart',
        'failed',
        status.reason ?? 'ML service không khả dụng',
        appId,
        deploymentId
      )
      this.lastMlLog.set(deploymentId, now)
    }
    if (!changed) return
    this.lastMlStatus.set(deploymentId, key)
    report?.(status)
  }
}
