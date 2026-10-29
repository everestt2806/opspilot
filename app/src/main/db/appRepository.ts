import type Database from 'better-sqlite3'

import type { App } from '@shared/ipc'

import { AppError } from '../errors'

export interface CreateAppRecord {
  vps_id: number
  name: string
  framework: App['framework']
  source_path: string | null
  source_type?: 'local' | 'git'
  git_repo_url?: string | null
  git_ref?: string | null
  git_root?: string | null
  host_port: number
  container_port: number
  healthcheck_path: string
  healthcheck_response_type?: 'status_2xx' | 'json'
  needs_db: 0 | 1
  imported_from_vps?: 0 | 1
}

export interface ImportedBaselineRecord {
  version: number
  image_tag: string
}

const APP_COLUMNS = `
  a.id, a.vps_id, a.name, a.framework, a.source_path, a.source_type,
  a.git_repo_url, a.git_ref, a.git_root, a.host_port, a.container_port,
  a.healthcheck_path, a.healthcheck_response_type, a.needs_db, a.current_deployment_id, a.imported_from_vps,
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
            healthcheck_path, healthcheck_response_type, needs_db, source_type,
            git_repo_url, git_ref, git_root, imported_from_vps
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          record.vps_id,
          record.name,
          record.framework,
          record.source_path,
          record.host_port,
          record.container_port,
          record.healthcheck_path,
          record.healthcheck_response_type ?? 'status_2xx',
          record.needs_db,
          record.source_type ?? 'local',
          record.git_repo_url ?? null,
          record.git_ref ?? null,
          record.git_root ?? null,
          record.imported_from_vps ?? 0
        )
      return this.getById(Number(result.lastInsertRowid))
    } catch (error) {
      throw mapAppDatabaseError(error)
    }
  }

  createVpsImportedBaseline(
    record: CreateAppRecord,
    baseline: ImportedBaselineRecord
  ): { app: App; deploymentId: number } {
    const insert = this.database.transaction(() => {
      const app = this.create({ ...record, source_path: null, imported_from_vps: 1 })
      const result = this.database
        .prepare(
          `INSERT INTO deployment (
            app_id, version, image_tag, status, started_at, git_repo_url, origin
          ) VALUES (?, ?, ?, 'running', NULL, ?, 'vps_import')`
        )
        .run(app.id, baseline.version, baseline.image_tag, record.git_repo_url ?? null)
      const deploymentId = Number(result.lastInsertRowid)
      this.setCurrentDeployment(app.id, deploymentId)
      return { app: this.getById(app.id), deploymentId }
    })
    try {
      return insert()
    } catch (error) {
      throw mapAppDatabaseError(error)
    }
  }

  getById(id: number): App {
    const app = this.database
      .prepare(
        `SELECT ${APP_COLUMNS} FROM app a JOIN vps v ON v.id = a.vps_id WHERE a.id = ? AND v.archived_at IS NULL`
      )
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
         WHERE a.vps_id = ? AND a.name = ? AND v.archived_at IS NULL`
      )
      .get(vpsId, name) as App | undefined
  }

  listByVps(vpsId: number): App[] {
    return this.database
      .prepare(
        `SELECT ${APP_COLUMNS} FROM app a JOIN vps v ON v.id = a.vps_id
         WHERE a.vps_id = ? AND v.archived_at IS NULL ORDER BY a.id DESC`
      )
      .all(vpsId) as App[]
  }

  listAll(): App[] {
    return this.database
      .prepare(
        `SELECT ${APP_COLUMNS} FROM app a JOIN vps v ON v.id = a.vps_id WHERE v.archived_at IS NULL ORDER BY a.id DESC`
      )
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
  const code = getSqliteErrorCode(error)
  const message = error instanceof Error ? error.message : String(error)
  if (code.startsWith('SQLITE_CONSTRAINT') && message.includes('app.vps_id, app.host_port')) {
    return new AppError(
      'PORT_EXHAUSTED',
      'Cổng deploy vừa được cấp cho app khác trên VPS. Hãy chạy precheck lại rồi thử lại.',
      { cause: error }
    )
  }
  if (code.startsWith('SQLITE_CONSTRAINT') && message.includes('app.vps_id, app.name')) {
    return new AppError('VALIDATION', 'Tên app đã tồn tại trên VPS. Hãy tải lại danh sách app.', {
      cause: error
    })
  }
  return new AppError('DB_ERROR', 'Không thể lưu app. Hãy kiểm tra database rồi thử lại.', {
    cause: error
  })
}

function getSqliteErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String(error.code)
  }
  return ''
}
