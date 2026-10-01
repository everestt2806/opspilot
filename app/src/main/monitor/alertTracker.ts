import type Database from 'better-sqlite3'
import type { DetectionMethod } from '@shared/ipc'

export function parseTimestampMs(val: string | number | null | undefined): number | null {
  if (val === null || val === undefined) return null
  if (typeof val === 'number') {
    return Number.isFinite(val) ? (val < 1e11 ? Math.round(val * 1000) : Math.round(val)) : null
  }
  const s = String(val).trim()
  if (!s) return null
  const num = Number(s)
  if (!Number.isNaN(num) && /^-?\d+(\.\d+)?$/.test(s)) {
    return num < 1e11 ? Math.round(num * 1000) : Math.round(num)
  }
  const parsed = Date.parse(s)
  return Number.isNaN(parsed) ? null : parsed
}

export function isSampleInRunWindow(
  sampleTs: string | null | undefined,
  startTs: string | null | undefined,
  endTs: string | null | undefined
): boolean {
  if (!sampleTs) return false
  const sampleMs = parseTimestampMs(sampleTs)
  if (sampleMs === null) return false

  if (!startTs) return false
  const startMs = parseTimestampMs(startTs)
  if (startMs === null) return false
  if (sampleMs < startMs) return false

  if (endTs !== null && endTs !== undefined && endTs !== '') {
    const endMs = parseTimestampMs(endTs)
    if (endMs === null) return false
    if (sampleMs > endMs) return false
  }

  return true
}

export class AlertTracker {
  constructor(private readonly db: Database.Database) {}

  update(input: {
    deploymentId: number
    metricSampleId: number
    ts: string
    method: DetectionMethod
    score: number | null
    above: boolean
    threshold: number
    consecutive: number
    detail?: string
    experimentRunId?: number | null
  }): number | null {
    const rows = this.db
      .prepare(
        'SELECT above_threshold, metric_sample_id, score, ts_vps FROM score_sample WHERE deployment_id=? AND method=? ORDER BY ts_vps DESC, id DESC LIMIT ?'
      )
      .all(input.deploymentId, input.method, Math.max(input.consecutive, 3)) as Array<{
      above_threshold: number
      metric_sample_id: number
      score: number | null
      ts_vps: string
    }>
    const high =
      input.score !== null &&
      input.above &&
      rows.length >= input.consecutive &&
      rows.slice(0, input.consecutive).every((r) => r.score !== null && r.above_threshold === 1)
    const low =
      input.score !== null &&
      !input.above &&
      rows.length >= 3 &&
      rows.slice(0, 3).every((r) => r.score !== null && r.above_threshold === 0)
    const open = this.db
      .prepare(
        'SELECT * FROM alert WHERE deployment_id=? AND method=? AND ts_resolved IS NULL ORDER BY id DESC LIMIT 1'
      )
      .get(input.deploymentId, input.method) as { id: number; peak_score: number } | undefined
    if (open) {
      if (input.score !== null && input.score > open.peak_score)
        this.db.prepare('UPDATE alert SET peak_score=? WHERE id=?').run(input.score, open.id)
      if (low) this.db.prepare('UPDATE alert SET ts_resolved=? WHERE id=?').run(input.ts, open.id)
      return null
    }
    if (high) {
      const first = rows[input.consecutive - 1]
      let experimentRunId = input.experimentRunId ?? null
      if (experimentRunId !== null) {
        const run = this.db
          .prepare(
            'SELECT status, baseline_start_ts, run_end_ts, deployment_id FROM experiment_run WHERE id = ?'
          )
          .get(experimentRunId) as
          | {
              status: string
              baseline_start_ts: string | null
              run_end_ts: string | null
              deployment_id: number | null
            }
          | undefined
        if (
          !run ||
          run.status !== 'running' ||
          run.deployment_id !== input.deploymentId ||
          !isSampleInRunWindow(first.ts_vps, run.baseline_start_ts, run.run_end_ts)
        ) {
          experimentRunId = null
        }
      }
      const result = this.db
        .prepare(
          'INSERT INTO alert (deployment_id,metric_sample_id,method,ts_vps,peak_score,detail_json,experiment_run_id) VALUES (?,?,?,?,?,?,?)'
        )
        .run(
          input.deploymentId,
          first.metric_sample_id,
          input.method,
          first.ts_vps,
          Math.max(...rows.slice(0, input.consecutive).map((row) => row.score ?? 0)),
          input.detail ?? null,
          experimentRunId
        )
      this.db
        .prepare('INSERT INTO action_log (action,status,message,deployment_id) VALUES (?,?,?,?)')
        .run('alert_raised', 'success', `Mở alert ${input.method}`, input.deploymentId)
      return Number(result.lastInsertRowid)
    }
    return null
  }
}
