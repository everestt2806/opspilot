import type Database from 'better-sqlite3'
import type { Alert, MetricSample, MonitorSetting, ScoreSet } from '@shared/ipc'
import { MonitorRepository } from './repository'
import { MetricSourceError, MonitorPoller, type MetricScorer } from './poller'
import { AppError } from '../errors'
import { SshMetricSource } from './metricSource'
import type { SshManager } from '../ssh/manager'
import { join as posixJoin } from 'node:path/posix'
import type { IpcEventMap } from '@shared/ipc'
import { metricLineSchema } from './metricParser'
import type { MlApiClient } from './mlApi'

export class MonitorService {
  private readonly repository: MonitorRepository
  private readonly autoTrained = new Set<number>()
  constructor(private readonly db: Database.Database) {
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
    const allowed = [
      'collector_interval_s',
      'poll_interval_s',
      'rule_cpu_pct',
      'rule_mem_pct',
      'rule_latency_ms',
      'rule_error_rate',
      'rule_consecutive',
      'ml_score_threshold',
      'ml_consecutive',
      'auto_rollback',
      'trusted_method',
      'rollback_consecutive',
      'cooldown_minutes'
    ] as const
    const entries = Object.entries(patch).filter(([key]) =>
      (allowed as readonly string[]).includes(key)
    )
    if (
      Object.keys(patch).some(
        (key) => key === 'app_id' || !(allowed as readonly string[]).includes(key)
      )
    )
      throw new AppError('VALIDATION', 'Setting không hợp lệ.')
    const update = this.db.transaction(() => {
      this.repository.getOrCreateSetting(appId)
      for (const [key, value] of entries) {
        if (typeof value !== 'number' && typeof value !== 'string')
          throw new AppError('VALIDATION', 'Setting không hợp lệ.')
        if (typeof value === 'number' && (!Number.isFinite(value) || value < 0))
          throw new AppError('VALIDATION', 'Setting ngoài miền cho phép.')
        if (
          (key.endsWith('_consecutive') || key.endsWith('_interval_s')) &&
          (typeof value !== 'number' || !Number.isInteger(value) || value < 1)
        )
          throw new AppError('VALIDATION', 'Setting phải là số nguyên dương.')
        if ((key === 'rule_error_rate' || key === 'ml_score_threshold') && Number(value) > 1)
          throw new AppError('VALIDATION', 'Ngưỡng phải từ 0 đến 1.')
        if (
          key === 'trusted_method' &&
          !['rule', 'zscore_ewma', 'iforest', 'ocsvm', 'ensemble'].includes(String(value))
        )
          throw new AppError('VALIDATION', 'Method không hợp lệ.')
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
    this.db
      .prepare('UPDATE alert SET label=?, labeled_at=? WHERE id=?')
      .run(label, label ? new Date().toISOString() : null, alertId)
    this.db
      .prepare('INSERT INTO action_log (action,status,message) VALUES (?,?,?)')
      .run('alert_labeled', 'success', `Cập nhật nhãn alert ${alertId}`)
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
    scorer?: MetricScorer,
    emit?: (event: IpcEventMap['monitor:tick']) => void,
    mlStatus?: (status: { running: boolean; reason?: string }) => void
  ): Promise<void> {
    for (const target of this.repository.listTargets()) {
      if (scorer && 'status' in scorer) {
        try {
          const status = await (scorer as MlApiClient).status(target.deployment_id)
          mlStatus?.({ running: true })
          if (
            status.sample_count >= 150 &&
            !status.trained &&
            !this.autoTrained.has(target.deployment_id)
          ) {
            const rows = this.db
              .prepare('SELECT raw_json FROM metric_sample WHERE deployment_id=? ORDER BY seq')
              .all(target.deployment_id) as Array<{ raw_json: string }>
            if (rows.length >= 150) {
              await (scorer as MlApiClient).train(
                target.deployment_id,
                rows.map((row) => metricLineSchema.parse(JSON.parse(row.raw_json)))
              )
              this.autoTrained.add(target.deployment_id)
            }
          }
        } catch {
          mlStatus?.({ running: false, reason: 'ML status/train không khả dụng' })
        }
      }
      const poller = new MonitorPoller(this.db, this.repository, undefined, scorer, {
        report: (status) => mlStatus?.(status)
      })
      let result: { sampleIds: number[] }
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
      const samples = result.sampleIds.map((id) => this.repository.getMetric(id))
      if (samples.length)
        emit?.({
          deployment_id: target.deployment_id,
          samples,
          scores: this.scores(target.deployment_id, samples[0]!.ts_vps),
          new_alerts: this.repository.listAlertsFrom(target.deployment_id, samples[0]!.ts_vps)
        })
    }
  }
}
