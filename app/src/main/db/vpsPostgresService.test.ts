import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'

import { closeDatabase, initializeDatabase } from './index'
import { VpsPostgresService } from './vpsPostgresService'

function seedVpsAndApp(options?: { needsDb?: 0 | 1; imported?: 0 | 1 }): {
  dir: string
  db: Database.Database
} {
  const dir = mkdtempSync(join(process.env.TEMP ?? '.', 'opspilot-vps-pg-'))
  const db = initializeDatabase(dir)
  db.exec(
    "INSERT INTO vps (name,host,username,auth_type,encrypted_secret) VALUES ('v1','203.0.113.10','root','password','enc');"
  )
  db.prepare(
    "INSERT INTO app (vps_id,name,framework,host_port,container_port,needs_db,imported_from_vps) VALUES (1,'demo-pg','express',30000,3000,?,?)"
  ).run(options?.needsDb ?? 1, options?.imported ?? 0)
  return { dir, db }
}

describe('VpsPostgresService (R8b)', () => {
  it('rejects VPS without a tool-managed PostgreSQL app', async () => {
    const { dir, db } = seedVpsAndApp({ needsDb: 0 })
    try {
      const service = new VpsPostgresService(db, { exec: vi.fn() } as never)
      await expect(service.listDatabases(1)).rejects.toMatchObject({ code: 'VALIDATION' })
    } finally {
      closeDatabase()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('lists databases and users, creates user without leaking password in SSH command', async () => {
    const { dir, db } = seedVpsAndApp()
    try {
      const exec = vi.fn(async (_vpsId: number, command: string) => {
        if (command.includes('printf %s')) {
          const match = /printf %s '([^']+)'/.exec(command)
          const sql = match ? Buffer.from(match[1], 'base64').toString('utf8') : ''
          if (sql.includes('FROM pg_database')) {
            return { code: 0, stdout: '16384\topspilot\t8388608\n', stderr: '' }
          }
          if (sql.includes('COUNT(*) FROM information_schema.tables')) {
            return { code: 0, stdout: '3\n', stderr: '' }
          }
          if (sql.includes('FROM pg_roles')) {
            return { code: 0, stdout: '10\topspilot\n16400\tapp_reader\n', stderr: '' }
          }
          return { code: 0, stdout: '', stderr: '' }
        }
        return { code: 0, stdout: '', stderr: '' }
      })
      const service = new VpsPostgresService(db, { exec } as never)

      const dbs = await service.listDatabases(1)
      expect(dbs).toEqual([{ oid: 16384, name: 'opspilot', size_bytes: 8388608, table_count: 3 }])

      const createdUser = await service.createUser(1, {
        username: 'app_reader',
        password: 'SuperSecretPassword!123'
      })
      expect(createdUser).toEqual({ oid: 16400, username: 'app_reader' })
      expect(exec.mock.calls.every(([, cmd]) => !cmd.includes('SuperSecretPassword!123'))).toBe(
        true
      )
    } finally {
      closeDatabase()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('validates identifiers, rejects psql meta-commands, and parses bounded query rows', async () => {
    const { dir, db } = seedVpsAndApp()
    try {
      const exec = vi.fn(async () => ({
        code: 0,
        stdout: 'id\tname\n1\talpha\n2\tbeta\n',
        stderr: ''
      }))
      const service = new VpsPostgresService(db, { exec } as never)

      await expect(service.createDatabase(1, 'bad-name; DROP TABLE x')).rejects.toMatchObject({
        code: 'VALIDATION'
      })
      await expect(service.query(1, 'opspilot', '\\! id')).rejects.toMatchObject({
        code: 'VALIDATION'
      })

      const result = await service.query(1, 'opspilot', 'SELECT id, name FROM items LIMIT 10;')
      expect(result.columns).toEqual(['id', 'name'])
      expect(result.row_count).toBe(2)
      expect(result.rows).toEqual([
        { id: '1', name: 'alpha' },
        { id: '2', name: 'beta' }
      ])
    } finally {
      closeDatabase()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
