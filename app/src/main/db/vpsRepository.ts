import type Database from 'better-sqlite3'

import type { Vps } from '@shared/ipc'

import { AppError } from '../errors'
import type { EncryptedCredential } from '../crypto/credentialCipher'

export interface CreateVpsRecord {
  name: string
  host: string
  port: number
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
  id, name, host, port, username, auth_type, provider, region,
  docker_version, last_status, last_seen_at, created_at
`

export class VpsRepository {
  constructor(private readonly database: Database.Database) {}

  list(): Vps[] {
    return this.database
      .prepare(`SELECT ${PUBLIC_VPS_COLUMNS} FROM vps ORDER BY created_at DESC, id DESC`)
      .all() as Vps[]
  }

  getById(id: number): Vps {
    const vps = this.database
      .prepare(`SELECT ${PUBLIC_VPS_COLUMNS} FROM vps WHERE id = ?`)
      .get(id) as Vps | undefined

    if (!vps) {
      throw new AppError('VALIDATION', 'Không tìm thấy VPS. Hãy tải lại danh sách rồi thử lại.')
    }

    return vps
  }

  create(input: CreateVpsRecord): Vps {
    try {
      const result = this.database
        .prepare(
          `INSERT INTO vps (
            name, host, port, username, auth_type,
            crypto_scheme, encrypted_secret, iv, auth_tag,
            provider, region
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.name,
          input.host,
          input.port,
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
    const result = this.database.prepare('DELETE FROM vps WHERE id = ?').run(id)
    if (result.changes === 0) {
      throw new AppError('VALIDATION', 'Không tìm thấy VPS. Hãy tải lại danh sách rồi thử lại.')
    }
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
