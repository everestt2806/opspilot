import { describe, expect, it } from 'vitest'

import type { DbSchemaTable } from '@shared/ipc'

import { quoteIdent, quoteLiteral, tableToDdl, tablesToDdl } from './sqlDdl'

const USERS: DbSchemaTable = {
  name: 'users',
  columns: [
    { name: 'id', data_type: 'SERIAL', nullable: false, primary_key: true, default_value: null },
    { name: 'name', data_type: 'TEXT', nullable: true, primary_key: false, default_value: null },
    {
      name: 'created_at',
      data_type: 'TIMESTAMP',
      nullable: false,
      primary_key: false,
      default_value: 'now()'
    }
  ],
  foreign_keys: []
}

describe('sqlDdl — sinh DDL PostgreSQL từ schema trên canvas', () => {
  it('quoteIdent: tên thường giữ nguyên, tên lạ bọc nháy kép', () => {
    expect(quoteIdent('users')).toBe('users')
    expect(quoteIdent('user-name')).toBe('"user-name"')
    expect(quoteIdent('say "hi"')).toBe('"say ""hi"""')
  })

  it('quoteLiteral: nháy đơn được nhân đôi đúng quy tắc SQL', () => {
    expect(quoteLiteral("it's")).toBe("'it''s'")
  })

  it('tableToDdl: PRIMARY KEY, NOT NULL, DEFAULT ra đúng câu CREATE TABLE', () => {
    const ddl = tableToDdl(USERS)
    expect(ddl).toContain('CREATE TABLE users (')
    expect(ddl).toContain('id SERIAL NOT NULL')
    expect(ddl).toContain('name TEXT')
    expect(ddl).toContain('created_at TIMESTAMP NOT NULL DEFAULT now()')
    expect(ddl).toContain('PRIMARY KEY (id)')
    expect(ddl).toContain(');')
  })

  it('tableToDdl: khoá ngoại sinh FOREIGN KEY ... REFERENCES', () => {
    const posts: DbSchemaTable = {
      name: 'posts',
      columns: [
        {
          name: 'id',
          data_type: 'SERIAL',
          nullable: false,
          primary_key: true,
          default_value: null
        },
        {
          name: 'author_id',
          data_type: 'INTEGER',
          nullable: false,
          primary_key: false,
          default_value: null
        }
      ],
      foreign_keys: [{ column_name: 'author_id', ref_table: 'users', ref_column: 'id' }]
    }
    const ddl = tableToDdl(posts)
    expect(ddl).toContain('FOREIGN KEY (author_id) REFERENCES users (id)')
  })

  it('tablesToDdl: nối nhiều bảng, cách nhau dòng trống', () => {
    const orders: DbSchemaTable = {
      name: 'orders',
      columns: [
        { name: 'id', data_type: 'SERIAL', nullable: false, primary_key: true, default_value: null }
      ],
      foreign_keys: []
    }
    const ddl = tablesToDdl([USERS, orders])
    expect(ddl).toContain('CREATE TABLE users (')
    expect(ddl).toContain('CREATE TABLE orders (')
    expect(ddl).toContain(');\n\nCREATE TABLE')
  })

  it('tableToDdl: bảng rỗng không treo — thân CREATE TABLE để trống', () => {
    const ddl = tableToDdl({ name: 'draft', columns: [], foreign_keys: [] })
    expect(ddl).toBe('CREATE TABLE draft (\n\n);')
  })
})
