import type Database from 'better-sqlite3'
import { randomBytes } from 'node:crypto'

import type { Vps } from '@shared/ipc'

import { AppError } from '../errors'
import type { EncryptedCredential } from '../crypto/credentialCipher'

export interface CreateVpsRecord {
  name: string
  host: string
  port: number
  host_fingerprint?: string
  username: string
  auth_type: 'key' | 'password'
  provider?: string
  region?: string
  credential: EncryptedCredential
}

export interface UpdateVpsRecord {
  name?: string
  host?: string
  port?: number
  host_fingerprint?: string | null
  username?: string
  auth_type?: 'key' | 'password'
  provider?: string
  region?: string
  docker_version?: string
  last_status?: 'online' | 'offline' | 'unknown'
  last_seen_at?: string
  credential?: EncryptedCredential
}

const PUBLIC_VPS_COLUMNS = `
  id, name, host, port, host_fingerprint, username, auth_type, provider, region,
  docker_version, last_status, last_seen_at, created_at
`

export class VpsRepository {
  constructor(private readonly database: Database.Database) {}

  list(): Vps[] {
    return this.database
      .prepare(
        `SELECT ${PUBLIC_VPS_COLUMNS} FROM vps WHERE archived_at IS NULL ORDER BY created_at DESC, id DESC`
      )
      .all() as Vps[]
  }

  getById(id: number): Vps {
    const vps = this.database
      .prepare(`SELECT ${PUBLIC_VPS_COLUMNS} FROM vps WHERE id = ? AND archived_at IS NULL`)
      .get(id) as Vps | undefined

    if (!vps) {
      throw new AppError('VALIDATION', 'Không tìm thấy VPS. Hãy tải lại danh sách rồi thử lại.')
    }

    return vps
  }

  create(input: CreateVpsRecord): Vps {
    try {
      return this.database.transaction(() => {
        const existing = input.host_fingerprint
          ? this.database
              .prepare(
                `SELECT 1 FROM vps WHERE archived_at IS NULL
                 AND lower(host) = lower(?) AND port = ? AND host_fingerprint = ? LIMIT 1`
              )
              .get(input.host, input.port, input.host_fingerprint)
          : undefined
        if (existing) {
          throw new AppError('VALIDATION', 'VPS này đã có trong OpsPilot. Hãy mở hồ sơ hiện có.')
        }
        // Chỉ nối lại khi endpoint và fingerprint cùng khớp. Bản ghi cũ thiếu
        // fingerprint không đủ bằng chứng để liên kết tự động.
        const archived = input.host_fingerprint
          ? (this.database
              .prepare(
                `SELECT id FROM vps WHERE archived_at IS NOT NULL
                 AND lower(host) = lower(?) AND port = ? AND host_fingerprint = ? ORDER BY id`
              )
              .all(input.host, input.port, input.host_fingerprint) as Array<{ id: number }>)
          : []
        if (archived.length > 1) {
          throw new AppError(
            'VALIDATION',
            'Có nhiều hồ sơ cũ cho cùng VPS. Cần đối chiếu thủ công trước khi khôi phục.'
          )
        }
        if (archived.length === 1) {
          const id = archived[0].id
          this.database
            .prepare(
              `UPDATE vps SET name = ?, host = ?, port = ?, host_fingerprint = ?,
                 username = ?, auth_type = ?,
                 crypto_scheme = ?, encrypted_secret = ?, iv = ?, auth_tag = ?,
                 provider = ?, region = ?, last_status = 'unknown', last_seen_at = NULL,
                 archived_at = NULL, archived_name = NULL,
                 ssh_security_revision = ssh_security_revision + 1,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
               WHERE id = ? AND archived_at IS NOT NULL`
            )
            .run(
              input.name,
              input.host,
              input.port,
              input.host_fingerprint,
              input.username,
              input.auth_type,
              input.credential.crypto_scheme,
              input.credential.encrypted_secret,
              input.credential.iv,
              input.credential.auth_tag,
              normalizeOptionalText(input.provider),
              normalizeOptionalText(input.region),
              id
            )
          return this.getById(id)
        }

        const result = this.database
          .prepare(
            `INSERT INTO vps (
              name, host, port, host_fingerprint, username, auth_type,
              crypto_scheme, encrypted_secret, iv, auth_tag,
              provider, region
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            input.name,
            input.host,
            input.port,
            input.host_fingerprint ?? null,
            input.username,
            input.auth_type,
            input.credential.crypto_scheme,
            input.credential.encrypted_secret,
            input.credential.iv,
            input.credential.auth_tag,
            normalizeOptionalText(input.provider),
            normalizeOptionalText(input.region)
          )

        return this.getById(Number(result.lastInsertRowid))
      })()
    } catch (error) {
      throw mapDatabaseError(error)
    }
  }

  update(id: number, patch: UpdateVpsRecord): Vps {
    this.getById(id)

    const assignments: string[] = []
    const values: unknown[] = []
    const add = (column: string, value: unknown): void => {
      assignments.push(`${column} = ?`)
      values.push(value)
    }

    if (patch.name !== undefined) add('name', patch.name)
    if (patch.host !== undefined) add('host', patch.host)
    if (patch.port !== undefined) add('port', patch.port)
    if (patch.host_fingerprint !== undefined) add('host_fingerprint', patch.host_fingerprint)
    if (patch.username !== undefined) add('username', patch.username)
    if (patch.auth_type !== undefined) add('auth_type', patch.auth_type)
    if (patch.provider !== undefined) add('provider', normalizeOptionalText(patch.provider))
    if (patch.region !== undefined) add('region', normalizeOptionalText(patch.region))
    if (patch.docker_version !== undefined) add('docker_version', patch.docker_version)
    if (patch.last_status !== undefined) add('last_status', patch.last_status)
    if (patch.last_seen_at !== undefined) add('last_seen_at', patch.last_seen_at)
    if (patch.credential !== undefined) {
      add('crypto_scheme', patch.credential.crypto_scheme)
      add('encrypted_secret', patch.credential.encrypted_secret)
      add('iv', patch.credential.iv)
      add('auth_tag', patch.credential.auth_tag)
    }

    const securityProfileChanged =
      patch.host !== undefined ||
      patch.port !== undefined ||
      patch.host_fingerprint !== undefined ||
      patch.username !== undefined ||
      patch.auth_type !== undefined ||
      patch.credential !== undefined
    if (securityProfileChanged) assignments.push('ssh_security_revision = ssh_security_revision + 1')

    if (assignments.length === 0) {
      return this.getById(id)
    }

    assignments.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')")

    try {
      this.database
        .prepare(`UPDATE vps SET ${assignments.join(', ')} WHERE id = ?`)
        .run(...values, id)
      return this.getById(id)
    } catch (error) {
      throw mapDatabaseError(error)
    }
  }

  delete(id: number): void {
    this.database.transaction(() => {
      const vps = this.getById(id)
      if (!vps.host_fingerprint) {
        throw new AppError(
          'VALIDATION',
          'Cần xác minh và lưu fingerprint SSH của VPS trước khi gỡ để có thể nối lại an toàn.'
        )
      }
      const busy = this.database
        .prepare(
          `SELECT 1 FROM deployment d JOIN app a ON a.id = d.app_id
           WHERE a.vps_id = ? AND d.status IN ('building','deploying') LIMIT 1`
        )
        .get(id)
      const migrating = this.database
        .prepare(
          `SELECT 1 FROM migration_job WHERE (source_vps_id = ? OR target_vps_id = ?)
           AND status NOT IN ('completed','failed','rolled_back') LIMIT 1`
        )
        .get(id, id)
      const experimenting = this.database
        .prepare(
          `SELECT 1 FROM experiment_run e
           LEFT JOIN deployment d ON d.id = e.deployment_id
           LEFT JOIN app a ON a.id = d.app_id
           WHERE (a.vps_id = ? OR e.vps_id = ?) AND e.status = 'running' LIMIT 1`
        )
        .get(id, id)
      if (busy || migrating || experimenting) {
        throw new AppError(
          'VALIDATION',
          'VPS đang có tác vụ deploy, migrate hoặc thí nghiệm. Hãy hoàn tất tác vụ trước khi gỡ.'
        )
      }
      const archivedName = `__opspilot_archived_${id}_${randomBytes(8).toString('hex')}`
      this.database
        .prepare(
          `UPDATE vps SET name = ?, archived_name = ?,
             encrypted_secret = X'', iv = NULL, auth_tag = NULL,
             ssh_security_revision = ssh_security_revision + 1,
             archived_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
             updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
           WHERE id = ? AND archived_at IS NULL`
        )
        .run(archivedName, vps.name, id)
    })()
  }
}

function normalizeOptionalText(value: string | undefined): string | null {
  const normalized = value?.trim()
  return normalized ? normalized : null
}

function mapDatabaseError(error: unknown): AppError {
  const code = getSqliteErrorCode(error)
  if (code.startsWith('SQLITE_CONSTRAINT_UNIQUE')) {
    return new AppError('VALIDATION', 'Tên VPS đã tồn tại. Hãy chọn tên khác rồi lưu lại.', {
      cause: error
    })
  }

  if (error instanceof AppError) {
    return error
  }

  return new AppError('DB_ERROR', 'Không thể lưu dữ liệu VPS. Hãy kiểm tra database rồi thử lại.', {
    cause: error
  })
}

function getSqliteErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return String(error.code)
  }
  return ''
}
