import type Database from 'better-sqlite3'

import type { ActionLogEntry } from '@shared/ipc'

export interface InsertActionLog {
  action: string
  status?: ActionLogEntry['status']
  message?: string
  vps_id?: number | null
  app_id?: number | null
  deployment_id?: number | null
  detail_json?: string | null
}

export class ActionLogRepository {
  constructor(private readonly database: Database.Database) {}

  insert(entry: InsertActionLog): number {
    const result = this.database
      .prepare(
        `INSERT INTO action_log (action, status, message, vps_id, app_id, deployment_id, detail_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        entry.action,
        entry.status ?? null,
        entry.message ?? null,
        entry.vps_id ?? null,
        entry.app_id ?? null,
        entry.deployment_id ?? null,
        entry.detail_json ?? null
      )
    return Number(result.lastInsertRowid)
  }

  list(filter: {
    actions?: string[]
    vps_id?: number
    from_ts?: string
    to_ts?: string
    limit: number
    offset: number
  }): ActionLogEntry[] {
    const conditions: string[] = []
    const values: unknown[] = []

    if (filter.actions && filter.actions.length > 0) {
      conditions.push(`action IN (${filter.actions.map(() => '?').join(', ')})`)
      values.push(...filter.actions)
    }
    if (filter.vps_id !== undefined) {
      conditions.push('vps_id = ?')
      values.push(filter.vps_id)
    }
    if (filter.from_ts !== undefined) {
      conditions.push('ts >= ?')
      values.push(filter.from_ts)
    }
    if (filter.to_ts !== undefined) {
      conditions.push('ts <= ?')
      values.push(filter.to_ts)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    return this.database
      .prepare(
        `SELECT id, ts, action, status, message, vps_id, app_id, deployment_id, detail_json
         FROM action_log ${where}
         ORDER BY ts DESC, id DESC
         LIMIT ? OFFSET ?`
      )
      .all(...values, filter.limit, filter.offset) as ActionLogEntry[]
  }
}
