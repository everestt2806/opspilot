import type Database from 'better-sqlite3'
import type { Alert, MetricSample, MonitorSetting, ScoreSet } from '@shared/ipc'
import { MonitorRepository } from './repository'
import { MetricSourceError, MonitorPoller, type MonitorRuntime } from './poller'
import { z } from 'zod'
import { AppError } from '../errors'
import { SshMetricSource } from './metricSource'
import type { SshManager } from '../ssh/manager'
import { join as posixJoin } from 'node:path/posix'
import type { IpcEventMap } from '@shared/ipc'
import { metricLineSchema } from './metricParser'
import type { MlApiClient } from './mlApi'

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
    private readonly options: { autoTrain?: boolean } = {}
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
    return this.repository.getOrCreateSetting(appId)
  }
  setSetting(appId: number, patch: Partial<MonitorSetting>): MonitorSetting {
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
    if (!this.db.prepare('SELECT id FROM alert WHERE id=?').get(alertId))
      throw new AppError('VALIDATION', 'Alert not found')
    this.db.transaction(() => {
      const result = this.db
        .prepare('UPDATE alert SET label=?, labeled_at=? WHERE id=?')
        .run(label, label ? new Date().toISOString() : null, alertId)
      if (result.changes !== 1) throw new AppError('VALIDATION', 'Alert not found')
      this.db
        .prepare('INSERT INTO action_log (action,status,message) VALUES (?,?,?)')
        .run('alert_labeled', 'success', `Updated alert ${alertId}`)
    })
  }
  async trainNow(
    deploymentId: number,
    client: MlApiClient
  ): Promise<{ train_sample_count: number }> {
    const rows = this.db
      .prepare('SELECT raw_json FROM metric_sample WHERE deployment_id=? ORDER BY seq')
      .all(deploymentId) as Array<{ raw_json: string }>
    if (rows.length < 150) throw new Error('Chưa đủ 150 mẫu để train')
    const samples = rows.map((row) => metricLineSchema.parse(JSON.parse(row.raw_json)))
    const result = await client.train(deploymentId, samples)
    return { train_sample_count: result.train_sample_count }
  }
  async pollAll(
    ssh: SshManager,
    scorer?: MonitorRuntime,
    emit?: (event: IpcEventMap['monitor:tick']) => void,
    mlStatus?: (status: { running: boolean; reason?: string }) => void
  ): Promise<void> {
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
        if (!(error instanceof MetricSourceError)) throw error
        this.repository.logAction(
          'ssh_error',
          'failed',
          'Không đọc được metrics.jsonl',
          target.app_id,
          target.deployment_id
        )
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
    }
  }

  private async maybeAutoTrain(
    deploymentId: number,
    client: MonitorRuntime,
    report?: (status: { running: boolean; reason?: string }) => void
  ): Promise<void> {
    try {
      const status = await client.status(deploymentId)
      this.reportMl(deploymentId, report, { running: true })
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
      this.reportMl(deploymentId, report, {
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
