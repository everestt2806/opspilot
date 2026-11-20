import type Database from 'better-sqlite3'
import type { DetectionMethod, MonitorSetting } from '@shared/ipc'

import { parseTimestampMs } from './alertTracker'

export type AutoRollbackReason = 'ok' | 'disabled' | 'not_enough' | 'cooldown'

/**
 * Pure policy decision for M08 automatic rollback:
 * triggers only when auto_rollback is enabled, the trusted method has at least
 * `rollback_consecutive` consecutive triggered samples, and cooldown has elapsed.
 */
export function shouldAutoRollback(ctx: {
  setting: MonitorSetting
  consecutiveTriggered: number
  lastRollbackAt: string | null
  now: string
}): { rollback: boolean; reason: AutoRollbackReason } {
  if (ctx.setting.auto_rollback !== 1) {
    return { rollback: false, reason: 'disabled' }
  }
  if (ctx.consecutiveTriggered < ctx.setting.rollback_consecutive) {
    return { rollback: false, reason: 'not_enough' }
  }
  if (ctx.lastRollbackAt !== null && ctx.setting.cooldown_minutes > 0) {
    const lastMs = parseTimestampMs(ctx.lastRollbackAt)
    const nowMs = parseTimestampMs(ctx.now)
    if (
      lastMs !== null &&
      nowMs !== null &&
      nowMs - lastMs < ctx.setting.cooldown_minutes * 60_000
    ) {
      return { rollback: false, reason: 'cooldown' }
    }
  }
  return { rollback: true, reason: 'ok' }
}

/**
 * Counts consecutive triggered scores from the most recent sample backward.
 * Any missing score (`null`, e.g., when ML service is down) or non-triggered sample
 * breaks the streak immediately so stale/incomplete runs do not trigger rollback.
 */
export function countConsecutiveTriggeredScores(
  db: Database.Database,
  deploymentId: number,
  method: DetectionMethod,
  requiredCount: number
): { count: number; metricSampleIds: number[]; peakScore: number } {
  const limit = Math.max(requiredCount, 1)
  const rows = db
    .prepare(
      `SELECT score, above_threshold, metric_sample_id
       FROM score_sample
       WHERE deployment_id = ? AND method = ?
       ORDER BY ts_vps DESC, id DESC
       LIMIT ?`
    )
    .all(deploymentId, method, limit) as Array<{
    score: number | null
    above_threshold: number
    metric_sample_id: number
  }>

  let count = 0
  let peakScore = 0
  const metricSampleIds: number[] = []
  for (const row of rows) {
    if (row.score === null || row.above_threshold !== 1) break
    count += 1
    if (row.score > peakScore) peakScore = row.score
    metricSampleIds.push(row.metric_sample_id)
  }
  return { count, metricSampleIds, peakScore }
}

function hasTable(db: Database.Database, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name))
}

/**
 * Ensures Desktop MonitorService never executes auto-rollback on an app owned by
 * the Product control plane or with a pending prepared cutover activation.
 */
export function isDesktopAutoRollbackAllowed(db: Database.Database, appId: number): boolean {
  const prepared = db
    .prepare("SELECT 1 FROM deployment_activation WHERE app_id=? AND state='prepared' LIMIT 1")
    .get(appId)
  if (prepared) return false

  if (hasTable(db, 'product_app_control')) {
    const control = db.prepare('SELECT mode FROM product_app_control WHERE app_id=?').get(appId) as
      { mode: string } | undefined
    if (control?.mode === 'product') return false
  }

  if (hasTable(db, 'product_runtime_execution')) {
    const claim = db
      .prepare(
        `SELECT 1 FROM product_runtime_execution pre
         JOIN deployment d ON d.id = pre.deployment_id
         JOIN app a ON a.current_deployment_id = d.id
         WHERE a.id = ?
         LIMIT 1`
      )
      .get(appId)
    if (claim) return false
  }

  return true
}
