import type Database from 'better-sqlite3'
import type {
  DbDatabase,
  DbExportFile,
  DbImportInput,
  DbQueryResult,
  DbSchemaColumn,
  DbSchemaForeignKey,
  DbSchemaTable,
  DbUser,
  DbUserInput
} from '@shared/ipc'
import { join as posixJoin } from 'node:path/posix'

import { AppError } from '../errors'
import { maskSecrets } from '../logger'
import { redactText } from '../doctor/engine'
import type { SshManager } from '../ssh/manager'
import { shellQuote } from '../ssh/shellQuote'

const SAFE_IDENT = /^[a-z_][a-z0-9_]{0,62}$/
const SAFE_TYPE = /^[A-Za-z][A-Za-z0-9_ ()]*$/
const MAX_DDL_BYTES = 256 * 1024
const MAX_QUERY_BYTES = 32 * 1024
const MAX_QUERY_ROWS = 200
const DEFAULT_DB = 'opspilot'

function assertSafeIdent(value: string, label: string): string {
  const trimmed = value.trim()
  if (!SAFE_IDENT.test(trimmed)) {
    throw new AppError(
      'VALIDATION',
      `${label} không hợp lệ: chỉ dùng chữ thường a-z, số 0-9 và dấu gạch dưới (_), bắt đầu bằng chữ cái hoặc _.`
    )
  }
  return trimmed
}

function quoteIdent(ident: string): string {
  return `"${ident}"`
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function assertSafeSqlScript(sql: string, maxBytes: number, label: string): string {
  const trimmed = sql.trim()
  if (!trimmed) {
    throw new AppError('VALIDATION', `${label} không được để trống.`)
  }
  if (Buffer.byteLength(trimmed, 'utf8') > maxBytes) {
    throw new AppError('VALIDATION', `${label} vượt quá giới hạn kích thước cho phép.`)
  }
  if (trimmed.includes('\0')) {
    throw new AppError('VALIDATION', `${label} chứa ký tự null không hợp lệ.`)
  }
  if (/(?:^|\n)\s*\\/.test(trimmed)) {
    throw new AppError('VALIDATION', `${label} không cho phép lệnh điều khiển psql (\\...).`)
  }
  if (/\b(?:ALTER\s+SYSTEM|DROP\s+DATABASE|COPY\b[\s\S]*\bPROGRAM)\b/i.test(trimmed)) {
    throw new AppError('VALIDATION', `${label} chứa câu lệnh bị giới hạn vì an toàn hệ thống.`)
  }
  return trimmed
}

function safeDbErrorMessage(err: string): string {
  return redactText(maskSecrets(err.trim()))
}

/**
 * Backend cho 9 kênh `db:*` (R8b): thao tác PostgreSQL của container `postgres` thuộc các app do OpsPilot
 * triển khai trên VPS (`needs_db=1`, `imported_from_vps=0`). Dùng base64 stdin qua SSH nên không bao giờ
 * nối raw SQL hay password vào shell args.
 */
export class VpsPostgresService {
  constructor(
    private readonly db: Database.Database,
    private readonly ssh: SshManager
  ) {}

  private resolveComposeDir(vpsId: number): string {
    const row = this.db
      .prepare(
        `SELECT a.name
         FROM app a
         JOIN vps v ON v.id = a.vps_id
         WHERE a.vps_id = ? AND v.archived_at IS NULL AND a.needs_db = 1 AND a.imported_from_vps = 0
         ORDER BY CASE WHEN a.current_deployment_id IS NOT NULL THEN 0 ELSE 1 END, a.id ASC
         LIMIT 1`
      )
      .get(vpsId) as { name: string } | undefined

    if (!row) {
      throw new AppError(
        'VALIDATION',
        'VPS này chưa có ứng dụng PostgreSQL nào do OpsPilot quản lý.'
      )
    }
    return posixJoin('/opt/opspilot', row.name)
  }

  private async execPsql(
    vpsId: number,
    database: string,
    sql: string,
    options: { header?: boolean; timeoutMs?: number; redactCause?: boolean } = {}
  ): Promise<string> {
    const composeDir = this.resolveComposeDir(vpsId)
    const safeDb = assertSafeIdent(database, 'Tên database')
    const encoded = Buffer.from(sql, 'utf8').toString('base64')
    const flags = options.header ? '-A -F "\t" -P footer=off' : '-At -F "\t"'
    const command =
      `cd ${shellQuote(composeDir)} && ` +
      `printf %s ${shellQuote(encoded)} | base64 -d | ` +
      `docker compose exec -T postgres psql -U opspilot -d ${shellQuote(safeDb)} -v ON_ERROR_STOP=1 -X ${flags}`

    const result = await this.ssh.exec(vpsId, command, {
      timeoutMs: options.timeoutMs ?? 20_000,
      retryOnReconnect: false
    })
    if (result.code !== 0) {
      const detail = options.redactCause
        ? 'Postgres command failed'
        : safeDbErrorMessage(result.stderr || result.stdout || `exit ${result.code}`)
      throw new AppError('UNKNOWN', `Lỗi thực thi PostgreSQL trên VPS: ${detail}`)
    }
    return result.stdout
  }

  async listUsers(vpsId: number): Promise<DbUser[]> {
    const out = await this.execPsql(
      vpsId,
      DEFAULT_DB,
      'SELECT oid, rolname FROM pg_roles WHERE rolcanlogin = true ORDER BY rolname;'
    )
    return out
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const [oidRaw, username] = line.split('\t')
        return { oid: Number(oidRaw), username: username ?? '' }
      })
      .filter((row) => Number.isFinite(row.oid) && row.username.length > 0)
  }

  async createUser(vpsId: number, input: DbUserInput): Promise<DbUser> {
    const username = assertSafeIdent(input.username, 'Tên người dùng')
    if (
      typeof input.password !== 'string' ||
      input.password.length < 1 ||
      input.password.length > 256 ||
      /[\0\r\n]/.test(input.password)
    ) {
      throw new AppError('VALIDATION', 'Mật khẩu người dùng không hợp lệ (1–256 ký tự).')
    }
    const sql = `CREATE USER ${quoteIdent(username)} WITH PASSWORD ${sqlLiteral(input.password)};`
    await this.execPsql(vpsId, DEFAULT_DB, sql, { redactCause: true })
    const users = await this.listUsers(vpsId)
    const created = users.find((u) => u.username === username)
    if (!created) {
      throw new AppError('UNKNOWN', `Đã tạo user ${username} nhưng không đọc lại được metadata.`)
    }
    return created
  }

  async listDatabases(vpsId: number): Promise<DbDatabase[]> {
    const out = await this.execPsql(
      vpsId,
      DEFAULT_DB,
      `SELECT d.oid, d.datname, pg_database_size(d.oid)
       FROM pg_database d
       WHERE d.datistemplate = false
       ORDER BY d.datname;`
    )
    const base = out
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const [oidRaw, name, sizeRaw] = line.split('\t')
        return {
          oid: Number(oidRaw),
          name: name ?? '',
          size_bytes: Number(sizeRaw ?? 0),
          table_count: 0
        }
      })
      .filter((row) => Number.isFinite(row.oid) && row.name.length > 0)

    for (const entry of base) {
      if (!SAFE_IDENT.test(entry.name)) continue
      try {
        const countOut = await this.execPsql(
          vpsId,
          entry.name,
          "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';"
        )
        const parsed = Number(countOut.trim().split(/\r?\n/)[0] ?? '0')
        if (Number.isFinite(parsed)) entry.table_count = parsed
      } catch {
        entry.table_count = 0
      }
    }
    return base
  }

  async createDatabase(vpsId: number, name: string): Promise<DbDatabase> {
    const safeName = assertSafeIdent(name, 'Tên database')
    await this.execPsql(vpsId, DEFAULT_DB, `CREATE DATABASE ${quoteIdent(safeName)};`)
    const list = await this.listDatabases(vpsId)
    const created = list.find((item) => item.name === safeName)
    if (!created) {
      throw new AppError(
        'UNKNOWN',
        `Đã tạo database ${safeName} nhưng không đọc lại được metadata.`
      )
    }
    return created
  }

  async listTables(vpsId: number, database: string): Promise<DbSchemaTable[]> {
    const colOut = await this.execPsql(
      vpsId,
      database,
      `SELECT c.table_name, c.column_name, UPPER(c.udt_name), c.is_nullable, COALESCE(c.column_default, '')
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
       WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
       ORDER BY c.table_name, c.ordinal_position;`
    )
    const pkOut = await this.execPsql(
      vpsId,
      database,
      `SELECT tc.table_name, kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public';`
    )
    const fkOut = await this.execPsql(
      vpsId,
      database,
      `SELECT tc.table_name, kcu.column_name, ccu.table_name, ccu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public';`
    )

    const pks = new Set(
      pkOut
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .map((l) => l.replace('\t', '.'))
    )

    const fksByTable = new Map<string, DbSchemaForeignKey[]>()
    for (const line of fkOut.split(/\r?\n/)) {
      if (!line.trim()) continue
      const [tableName, columnName, refTable, refColumn] = line.split('\t')
      if (!tableName || !columnName || !refTable || !refColumn) continue
      const existing = fksByTable.get(tableName) ?? []
      existing.push({ column_name: columnName, ref_table: refTable, ref_column: refColumn })
      fksByTable.set(tableName, existing)
    }

    const tablesMap = new Map<string, DbSchemaColumn[]>()
    for (const line of colOut.split(/\r?\n/)) {
      if (!line.trim()) continue
      const [tableName, colName, dataType, isNullable, defaultVal] = line.split('\t')
      if (!tableName || !colName) continue
      const cols = tablesMap.get(tableName) ?? []
      cols.push({
        name: colName,
        data_type: dataType || 'TEXT',
        nullable: isNullable !== 'NO',
        primary_key: pks.has(`${tableName}.${colName}`),
        default_value: defaultVal ? defaultVal : null
      })
      tablesMap.set(tableName, cols)
    }

    return [...tablesMap.entries()].map(([name, columns]) => ({
      name,
      columns,
      foreign_keys: fksByTable.get(name) ?? []
    }))
  }

  async saveSchema(vpsId: number, database: string, ddl: string): Promise<void> {
    const safeDdl = assertSafeSqlScript(ddl, MAX_DDL_BYTES, 'DDL schema')
    await this.execPsql(vpsId, database, `BEGIN;\n${safeDdl}\nCOMMIT;`)
  }

  async importData(
    vpsId: number,
    database: string,
    input: DbImportInput
  ): Promise<{ imported_tables: number; imported_rows: number }> {
    if (!input || !Array.isArray(input.tables) || input.tables.length === 0) {
      throw new AppError('VALIDATION', 'Dữ liệu import không có bảng nào.')
    }
    const statements: string[] = ['BEGIN;']
    let importedRows = 0
    for (const table of input.tables) {
      const tableName = assertSafeIdent(table.name, 'Tên bảng')
      if (!Array.isArray(table.columns) || table.columns.length === 0) {
        throw new AppError('VALIDATION', `Bảng ${tableName} không có cột nào.`)
      }
      const colDefs = table.columns.map((col) => {
        const colName = assertSafeIdent(col.name, 'Tên cột')
        const rawType = (col.data_type || 'TEXT').trim()
        if (!SAFE_TYPE.test(rawType)) {
          throw new AppError('VALIDATION', `Kiểu dữ liệu cột ${colName} không hợp lệ.`)
        }
        return `${quoteIdent(colName)} ${rawType}${col.nullable ? '' : ' NOT NULL'}${col.primary_key ? ' PRIMARY KEY' : ''}`
      })
      statements.push(
        `CREATE TABLE IF NOT EXISTS ${quoteIdent(tableName)} (${colDefs.join(', ')});`
      )
      const colNames = table.columns.map((c) => quoteIdent(assertSafeIdent(c.name, 'Tên cột')))
      for (const row of table.rows) {
        const values = table.columns.map((c) => {
          const raw = row[c.name]
          return raw === undefined || raw === null ? 'NULL' : sqlLiteral(String(raw))
        })
        statements.push(
          `INSERT INTO ${quoteIdent(tableName)} (${colNames.join(', ')}) VALUES (${values.join(', ')});`
        )
        importedRows += 1
      }
    }
    statements.push('COMMIT;')
    await this.execPsql(vpsId, database, statements.join('\n'), { timeoutMs: 60_000 })
    return { imported_tables: input.tables.length, imported_rows: importedRows }
  }

  async exportData(
    vpsId: number,
    database: string,
    format: 'json' | 'csv' | 'sql'
  ): Promise<DbExportFile> {
    const safeDb = assertSafeIdent(database, 'Tên database')
    const tables = await this.listTables(vpsId, safeDb)
    const dump: Record<string, Array<Record<string, string>>> = {}
    for (const table of tables) {
      if (!SAFE_IDENT.test(table.name)) continue
      const res = await this.query(
        vpsId,
        safeDb,
        `SELECT * FROM ${quoteIdent(table.name)} LIMIT 500;`
      )
      dump[table.name] = res.rows
    }

    if (format === 'json') {
      return {
        filename: `${safeDb}.json`,
        content: JSON.stringify(dump, null, 2),
        mime: 'application/json'
      }
    }
    if (format === 'csv') {
      const blocks = Object.entries(dump).map(([tableName, rows]) => {
        if (rows.length === 0) return `# ${tableName}\n`
        const headers = Object.keys(rows[0])
        const csvLines = [
          headers.join(','),
          ...rows.map((r) => headers.map((h) => `"${(r[h] ?? '').replace(/"/g, '""')}"`).join(','))
        ]
        return `# ${tableName}\n${csvLines.join('\n')}`
      })
      return {
        filename: `${safeDb}.csv`,
        content: blocks.join('\n\n'),
        mime: 'text/csv'
      }
    }
    const sqlBlocks: string[] = []
    for (const [tableName, rows] of Object.entries(dump)) {
      for (const row of rows) {
        const cols = Object.keys(row).map(quoteIdent)
        const vals = Object.values(row).map((v) => sqlLiteral(v))
        sqlBlocks.push(
          `INSERT INTO ${quoteIdent(tableName)} (${cols.join(', ')}) VALUES (${vals.join(', ')});`
        )
      }
    }
    return {
      filename: `${safeDb}.sql`,
      content: sqlBlocks.join('\n'),
      mime: 'text/plain'
    }
  }

  async query(vpsId: number, database: string, sql: string): Promise<DbQueryResult> {
    const safeSql = assertSafeSqlScript(sql, MAX_QUERY_BYTES, 'Câu truy vấn SQL')
    const started = Date.now()
    const out = await this.execPsql(vpsId, database, safeSql, { header: true })
    const duration_ms = Date.now() - started

    const lines = out.split(/\r?\n/).filter((line) => line.length > 0)
    if (lines.length === 0) {
      return { columns: [], rows: [], row_count: 0, duration_ms }
    }
    const columns = lines[0].split('\t')
    const dataLines = lines.slice(1, 1 + MAX_QUERY_ROWS)
    const rows = dataLines.map((line) => {
      const cells = line.split('\t')
      const record: Record<string, string> = {}
      for (let i = 0; i < columns.length; i += 1) {
        record[columns[i]] = cells[i] ?? ''
      }
      return record
    })
    return {
      columns,
      rows,
      row_count: rows.length,
      duration_ms
    }
  }
}
