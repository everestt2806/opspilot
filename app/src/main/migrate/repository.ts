import type Database from 'better-sqlite3'

export type MigrationStatus =
  | 'preparing'
  | 'backing_up'
  | 'transferring'
  | 'restoring'
  | 'verifying'
  | 'awaiting_confirm'
  | 'completed'
  | 'failed'
  | 'rolled_back'

export interface MigrationJob {
  id: number
  app_id: number
  source_vps_id: number
  target_vps_id: number
  status: MigrationStatus
  failed_step: string | null
  downtime_ms: number | null
  bytes_transferred: number | null
  verify_json: string | null
  source_kept: 0 | 1 | null
  started_at: string
  finished_at: string | null
}

export class MigrationRepository {
  constructor(private readonly database: Database.Database) {}

  create(appId: number, sourceVpsId: number, targetVpsId: number): MigrationJob {
    const result = this.database
      .prepare(
        `INSERT INTO migration_job (app_id, source_vps_id, target_vps_id, status)
         VALUES (?, ?, ?, 'preparing')`
      )
      .run(appId, sourceVpsId, targetVpsId)
    return this.get(Number(result.lastInsertRowid))
  }

  get(id: number): MigrationJob {
    const row = this.database.prepare('SELECT * FROM migration_job WHERE id=?').get(id) as
      MigrationJob | undefined
    if (!row) throw new Error(`migration job ${id} not found`)
    return row
  }

  list(): MigrationJob[] {
    return this.database
      .prepare('SELECT * FROM migration_job ORDER BY id DESC')
      .all() as MigrationJob[]
  }

  activeForApp(appId: number): MigrationJob | undefined {
    return this.database
      .prepare(
        `SELECT * FROM migration_job WHERE app_id=? AND status IN
         ('preparing','backing_up','transferring','restoring','verifying','awaiting_confirm')
         ORDER BY id DESC LIMIT 1`
      )
      .get(appId) as MigrationJob | undefined
  }

  update(
    id: number,
    patch: Partial<
      Pick<
        MigrationJob,
        | 'status'
        | 'failed_step'
        | 'downtime_ms'
        | 'bytes_transferred'
        | 'verify_json'
        | 'source_kept'
      >
    >
  ): void {
    const fields = Object.entries(patch)
    if (fields.length === 0) return
    const values = fields.map(([, value]) => value)
    this.database
      .prepare(
        `UPDATE migration_job SET ${fields.map(([field]) => `${field}=?`).join(', ')}${
          patch.status === 'completed' ||
          patch.status === 'failed' ||
          patch.status === 'rolled_back'
            ? ", finished_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')"
            : ''
        } WHERE id=?`
      )
      .run(...values, id)
  }
}
