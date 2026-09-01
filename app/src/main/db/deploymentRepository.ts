import type Database from 'better-sqlite3'

import type { Deployment } from '@shared/ipc'

import { AppError } from '../errors'

export interface UpdateDeploymentRecord {
  status?: Deployment['status']
  failed_step?: Deployment['failed_step']
  build_duration_ms?: number | null
  total_duration_ms?: number | null
  is_rollback_of?: number | null
  finished_at?: string
}

export class DeploymentRepository {
  constructor(private readonly database: Database.Database) {}

  /**
   * Tạo deployment mới kèm cấp version tăng dần trong MỘT transaction
   * (bất biến 4 của deploy-events: SELECT MAX(version)+1). image_tag = `<app>:v<N>`
   * tính từ version ngay trong transaction để không lệch nhau.
   */
  createNextVersion(
    appId: number,
    appName: string,
    detectorJson: string | null,
    envJson: string | null
  ): Deployment {
    const insert = this.database.transaction(
      (app: number, name: string, detector: string | null, env: string | null) => {
        const row = this.database
          .prepare('SELECT MAX(version) AS max FROM deployment WHERE app_id = ?')
          .get(app) as { max: number | null }
        const version = (row.max ?? 0) + 1
        const imageTag = `${name}:v${version}`

        const result = this.database
          .prepare(
            `INSERT INTO deployment (app_id, version, image_tag, status, detector_json, env_json)
             VALUES (?, ?, ?, 'building', ?, ?)`
          )
          .run(app, version, imageTag, detector, env)
        return { id: Number(result.lastInsertRowid) }
      }
    )
    const record = insert(appId, appName, detectorJson, envJson)
    return this.getById(record.id)
  }

  getById(id: number): Deployment {
    const deployment = this.database
      .prepare(
        `SELECT id, app_id, version, image_tag, status, failed_step,
                build_duration_ms, total_duration_ms, is_rollback_of, started_at, finished_at
         FROM deployment WHERE id = ?`
      )
      .get(id) as Deployment | undefined

    if (!deployment) {
      throw new AppError(
        'VALIDATION',
        'Không tìm thấy deployment. Hãy tải lại lịch sử rồi thử lại.'
      )
    }
    return deployment
  }

  listByApp(appId: number): Deployment[] {
    return this.database
      .prepare(
        `SELECT id, app_id, version, image_tag, status, failed_step,
                build_duration_ms, total_duration_ms, is_rollback_of, started_at, finished_at
         FROM deployment WHERE app_id = ? ORDER BY version DESC`
      )
      .all(appId) as Deployment[]
  }

  /** Deployment chạy gần nhất TRƯỚC version hiện tại — đích rollback v(N-1). */
  previousCompleted(appId: number, beforeVersion: number): Deployment | undefined {
    return this.database
      .prepare(
        `SELECT id, app_id, version, image_tag, status, failed_step,
                build_duration_ms, total_duration_ms, is_rollback_of, started_at, finished_at
         FROM deployment
         WHERE app_id = ? AND version < ? AND status = 'running'
         ORDER BY version DESC LIMIT 1`
      )
      .get(appId, beforeVersion) as Deployment | undefined
  }

  /** Image thực sự của một attempt; manual rollback có image runtime của target, không phải tag vN mới. */
  runtimeImageTag(deploymentId: number): string {
    const row = this.database
      .prepare(
        `WITH RECURSIVE lineage(id, image_tag, is_rollback_of, depth) AS (
           SELECT id, image_tag, is_rollback_of, 0 FROM deployment WHERE id = ?
           UNION ALL
           SELECT d.id, d.image_tag, d.is_rollback_of, lineage.depth + 1
           FROM deployment d JOIN lineage ON d.id = lineage.is_rollback_of
           WHERE lineage.depth < 100
         )
         SELECT image_tag FROM lineage ORDER BY depth DESC LIMIT 1`
      )
      .get(deploymentId) as { image_tag: string } | undefined
    if (!row) {
      throw new AppError(
        'VALIDATION',
        'Không tìm thấy image của deployment. Hãy tải lại lịch sử rồi thử lại.'
      )
    }
    return row.image_tag
  }

  update(id: number, patch: UpdateDeploymentRecord): void {
    const assignments: string[] = []
    const values: unknown[] = []
    const add = (column: string, value: unknown): void => {
      if (value !== undefined) {
        assignments.push(`${column} = ?`)
        values.push(value)
      }
    }

    add('status', patch.status)
    add('failed_step', patch.failed_step)
    add('build_duration_ms', patch.build_duration_ms)
    add('total_duration_ms', patch.total_duration_ms)
    add('is_rollback_of', patch.is_rollback_of)
    add('finished_at', patch.finished_at)

    if (assignments.length === 0) {
      return
    }
    this.database
      .prepare(`UPDATE deployment SET ${assignments.join(', ')} WHERE id = ?`)
      .run(...values, id)
  }
}
