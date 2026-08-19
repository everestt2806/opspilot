import type Database from 'better-sqlite3'

import type { App } from '@shared/ipc'

import { AppError } from '../errors'

export interface CreateAppRecord {
  vps_id: number
  name: string
  framework: App['framework']
  source_path: string
  host_port: number
  container_port: number
  healthcheck_path: string
  needs_db: 0 | 1
}

const APP_COLUMNS = `
  a.id, a.vps_id, a.name, a.framework, a.host_port, a.container_port,
  a.healthcheck_path, a.needs_db, a.current_deployment_id,
  'http://' || v.host || ':' || a.host_port AS url
`

export class AppRepository {
  constructor(private readonly database: Database.Database) {}

  create(record: CreateAppRecord): App {
    try {
      const result = this.database
        .prepare(
          `INSERT INTO app (
            vps_id, name, framework, source_path, host_port, container_port,
            healthcheck_path, needs_db
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          record.vps_id,
          record.name,
          record.framework,
          record.source_path,
          record.host_port,
          record.container_port,
          record.healthcheck_path,
          record.needs_db
        )
      return this.getById(Number(result.lastInsertRowid))
    } catch (error) {
      throw mapAppDatabaseError(error)
    }
  }

  getById(id: number): App {
    const app = this.database
      .prepare(`SELECT ${APP_COLUMNS} FROM app a JOIN vps v ON v.id = a.vps_id WHERE a.id = ?`)
      .get(id) as App | undefined

    if (!app) {
      throw new AppError('VALIDATION', 'Không tìm thấy app. Hãy tải lại danh sách rồi thử lại.')
    }
    return app
  }

  getByVpsAndName(vpsId: number, name: string): App | undefined {
    return this.database
      .prepare(
        `SELECT ${APP_COLUMNS} FROM app a JOIN vps v ON v.id = a.vps_id
         WHERE a.vps_id = ? AND a.name = ?`
      )
      .get(vpsId, name) as App | undefined
  }

  listByVps(vpsId: number): App[] {
    return this.database
      .prepare(
        `SELECT ${APP_COLUMNS} FROM app a JOIN vps v ON v.id = a.vps_id
         WHERE a.vps_id = ? ORDER BY a.id DESC`
      )
      .all(vpsId) as App[]
  }

  listAll(): App[] {
    return this.database
      .prepare(`SELECT ${APP_COLUMNS} FROM app a JOIN vps v ON v.id = a.vps_id ORDER BY a.id DESC`)
      .all() as App[]
  }

  /** Các host_port đã cấp cho một VPS — để cấp port mới không trùng (ADR-006). */
  usedPorts(vpsId: number): number[] {
    const rows = this.database
      .prepare('SELECT host_port FROM app WHERE vps_id = ?')
      .all(vpsId) as Array<{ host_port: number }>
    return rows.map((row) => row.host_port)
  }

  setCurrentDeployment(appId: number, deploymentId: number | null): void {
    this.database
      .prepare('UPDATE app SET current_deployment_id = ? WHERE id = ?')
      .run(deploymentId, appId)
  }
}

function mapAppDatabaseError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error
  }
  return new AppError('DB_ERROR', 'Không thể lưu app. Hãy kiểm tra database rồi thử lại.', {
    cause: error
  })
}
