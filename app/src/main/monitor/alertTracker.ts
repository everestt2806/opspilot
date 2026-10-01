import type Database from 'better-sqlite3'
import type { DetectionMethod } from '@shared/ipc'

function parseNumericEpochUs(s: string): bigint | null {
  const match = /^(-?\d+)(?:\.(\d+))?$/.exec(s)
  if (!match) return null
  try {
    const isNeg = match[1].startsWith('-')
    const sec = BigInt(match[1].replace('-', ''))
    const fracStr = match[2] || ''
    const frac = BigInt(fracStr.padEnd(6, '0').slice(0, 6))
    const total = sec * 1000000n + frac
    return isNeg ? -total : total
  } catch {
    return null
  }
}

export function parseTimestampUs(val: string | number | null | undefined): bigint | null {
  if (val === null || val === undefined) return null
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return null
    return parseNumericEpochUs(val.toString())
  }
  const s = String(val).trim()
  if (!s) return null
  if (/^-?\d+(?:\.\d+)?$/.test(s)) return parseNumericEpochUs(s)

  const m =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|([+-])(\d{2}):?(\d{2}))?$/.exec(
      s
    )
  if (m) {
    const y = Number(m[1]),
      mo = Number(m[2]),
      d = Number(m[3])
    const h = Number(m[4]),
      min = Number(m[5]),
      sec = Number(m[6])
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || min > 59 || sec > 59) return null
    const dt = new Date(Date.UTC(y, mo - 1, d, h, min, sec))
    if (
      dt.getUTCFullYear() !== y ||
      dt.getUTCMonth() !== mo - 1 ||
      dt.getUTCDate() !== d ||
      dt.getUTCHours() !== h ||
      dt.getUTCMinutes() !== min ||
      dt.getUTCSeconds() !== sec
    ) {
      return null
    }
    let secMs = BigInt(dt.getTime())
    if (m[8]) {
      const sign = m[8] === '-' ? -1n : 1n
      const offH = BigInt(m[9])
      const offM = BigInt(m[10])
      if (offH > 23n || offM > 59n) return null
      const offsetMs = sign * (offH * 60n + offM) * 60n * 1000n
      secMs -= offsetMs
    }
    const fracStr = m[7] || ''
    const us = BigInt(fracStr.padEnd(6, '0').slice(0, 6))
    return secMs * 1000n + us
  }
  return null
}

export function parseTimestampMs(val: string | number | null | undefined): number | null {
  const us = parseTimestampUs(val)
  return us === null ? null : Number(us / 1000n)
}

export function isSampleInRunWindow(
  sampleTs: string | null | undefined,
  startTs: string | null | undefined,
  endTs: string | null | undefined
): boolean {
  if (!sampleTs) return false
  const sampleUs = parseTimestampUs(sampleTs)
  if (sampleUs === null) return false

  if (!startTs) return false
  const startUs = parseTimestampUs(startTs)
  if (startUs === null) return false
  if (sampleUs < startUs) return false

  if (endTs !== null && endTs !== undefined && endTs !== '') {
    const endUs = parseTimestampUs(endTs)
    if (endUs === null) return false
    if (sampleUs > endUs) return false
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
