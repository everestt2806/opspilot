import type Database from 'better-sqlite3'
import type { DetectionMethod } from '@shared/ipc'

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
      const result = this.db
        .prepare(
          'INSERT INTO alert (deployment_id,metric_sample_id,method,ts_vps,peak_score,detail_json) VALUES (?,?,?,?,?,?)'
        )
        .run(
          input.deploymentId,
          first.metric_sample_id,
          input.method,
          first.ts_vps,
          Math.max(...rows.slice(0, input.consecutive).map((row) => row.score ?? 0)),
          input.detail ?? null
        )
      this.db
        .prepare('INSERT INTO action_log (action,status,message,deployment_id) VALUES (?,?,?,?)')
        .run('alert_raised', 'success', `Mở alert ${input.method}`, input.deploymentId)
      return Number(result.lastInsertRowid)
    }
    return null
  }
}
