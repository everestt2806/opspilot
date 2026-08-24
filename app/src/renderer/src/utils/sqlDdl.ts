import type { DbSchemaTable } from '@shared/ipc'

/** Sinh DDL PostgreSQL cho các bảng thiết kế trên canvas. UI hiển thị trước,
 *  "Save schema" gửi nguyên chuỗi này cho backend chạy qua psql. */

const PLAIN_IDENT = /^[a-z_][a-z0-9_]*$/i

/** Bọc tên bảng/cột bằng nháy kép nếu không phải chữ thường hợp lệ. */
export function quoteIdent(name: string): string {
  return PLAIN_IDENT.test(name) ? name : `"${name.replace(/"/g, '""')}"`
}

export function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export function tableToDdl(table: DbSchemaTable): string {
  const lines: string[] = []
  for (const col of table.columns) {
    const parts: string[] = [`  ${quoteIdent(col.name)} ${col.data_type}`]
    if (!col.nullable) parts.push('NOT NULL')
    if (col.default_value !== null && col.default_value !== '') {
      parts.push(`DEFAULT ${col.default_value}`)
    }
    lines.push(parts.join(' '))
  }
  const pk = table.columns.filter((col) => col.primary_key).map((col) => quoteIdent(col.name))
  if (pk.length > 0) {
    lines.push(`  PRIMARY KEY (${pk.join(', ')})`)
  }
  for (const fk of table.foreign_keys) {
    lines.push(
      `  FOREIGN KEY (${quoteIdent(fk.column_name)}) REFERENCES ${quoteIdent(fk.ref_table)} (${quoteIdent(fk.ref_column)})`
    )
  }
  return `CREATE TABLE ${quoteIdent(table.name)} (\n${lines.join(',\n')}\n);`
}

export function tablesToDdl(tables: DbSchemaTable[]): string {
  return tables.map(tableToDdl).join('\n\n')
}
