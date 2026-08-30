import type Database from 'better-sqlite3'

import type { MetricSample, MonitorSetting } from '@shared/ipc'

import type { MetricLine } from './metricParser'

export const METHODS = ['rule', 'zscore_ewma', 'iforest', 'ocsvm', 'ensemble'] as const
export type MonitorMethod = (typeof METHODS)[number]

export interface MonitorTarget {
  app_id: number
  vps_id: number
  app_name: string
  deployment_id: number
  metrics_offset: number
  setting: MonitorSetting
}

export interface InsertSampleInput {
  deploymentId: number
  line: MetricLine
  rawJson: string
  tsLocal: string
}

export class MonitorRepository {
  constructor(private readonly database: Database.Database) {}

  getTarget(deploymentId: number): MonitorTarget | undefined {
    const row = this.database.prepare(`
      SELECT a.id app_id, a.vps_id, a.name app_name, d.id deployment_id, a.metrics_offset,
        ms.app_id setting_app_id, ms.collector_interval_s, ms.poll_interval_s,
        ms.rule_cpu_pct, ms.rule_mem_pct, ms.rule_latency_ms, ms.rule_error_rate,
        ms.rule_consecutive, ms.ml_score_threshold, ms.ml_consecutive, ms.auto_rollback,
        ms.trusted_method, ms.rollback_consecutive, ms.cooldown_minutes
      FROM deployment d JOIN app a ON a.id=d.app_id
      LEFT JOIN monitor_setting ms ON ms.app_id=a.id
      WHERE d.id=? AND d.status='running'`).get(deploymentId) as Record<string, unknown> | undefined
    if (!row) return undefined
    const setting = row.setting_app_id
      ? ({ app_id: row.setting_app_id, collector_interval_s: row.collector_interval_s, poll_interval_s: row.poll_interval_s, rule_cpu_pct: row.rule_cpu_pct, rule_mem_pct: row.rule_mem_pct, rule_latency_ms: row.rule_latency_ms, rule_error_rate: row.rule_error_rate, rule_consecutive: row.rule_consecutive, ml_score_threshold: row.ml_score_threshold, ml_consecutive: row.ml_consecutive, auto_rollback: row.auto_rollback, trusted_method: row.trusted_method, rollback_consecutive: row.rollback_consecutive, cooldown_minutes: row.cooldown_minutes } as MonitorSetting)
      : this.getOrCreateSetting(Number(row.app_id))
    return { app_id: Number(row.app_id), vps_id: Number(row.vps_id), app_name: String(row.app_name), deployment_id: Number(row.deployment_id), metrics_offset: Number(row.metrics_offset), setting }
  }

  getOrCreateSetting(appId: number): MonitorSetting {
    this.database.prepare('INSERT OR IGNORE INTO monitor_setting (app_id) VALUES (?)').run(appId)
    return this.database.prepare('SELECT app_id, collector_interval_s, poll_interval_s, rule_cpu_pct, rule_mem_pct, rule_latency_ms, rule_error_rate, rule_consecutive, ml_score_threshold, ml_consecutive, auto_rollback, trusted_method, rollback_consecutive, cooldown_minutes FROM monitor_setting WHERE app_id=?').get(appId) as MonitorSetting
  }

  insertSample(input: InsertSampleInput): number {
    const result = this.database.prepare(`INSERT OR IGNORE INTO metric_sample (deployment_id,seq,ts_vps,ts_local,cpu_pct,mem_mb,mem_pct,mem_limit_mb,latency_ms,http_error_rate,db_response_ms,container_up,host_cpu_pct,host_mem_pct,raw_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(input.deploymentId, input.line.seq, input.line.ts, input.tsLocal, input.line.cpu_pct, input.line.mem_mb, input.line.mem_pct, input.line.mem_limit_mb, input.line.latency_ms, input.line.http_error_rate, input.line.db_response_ms, input.line.container_up, input.line.host_cpu_pct, input.line.host_mem_pct, input.rawJson)
    if (result.changes === 0) return 0
    return Number(result.lastInsertRowid)
  }

  updateOffset(appId: number, offset: number): void { this.database.prepare('UPDATE app SET metrics_offset=? WHERE id=?').run(offset, appId) }
  getMetric(id: number): MetricSample { return this.database.prepare('SELECT id,deployment_id,seq,ts_vps,cpu_pct,mem_mb,mem_pct,latency_ms,http_error_rate,db_response_ms,container_up FROM metric_sample WHERE id=?').get(id) as MetricSample }
  insertScore(input: { metricSampleId: number; deploymentId: number; ts: string; method: MonitorMethod; score: number | null; above: boolean; detail?: string }): void {
    this.database.prepare('INSERT OR IGNORE INTO score_sample (metric_sample_id,deployment_id,ts_vps,method,score,above_threshold,detail_json) VALUES (?,?,?,?,?,?,?)').run(input.metricSampleId, input.deploymentId, input.ts, input.method, input.score, input.above ? 1 : 0, input.detail ?? null)
  }
}
