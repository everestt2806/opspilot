import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { closeDatabase, initializeDatabase } from './index'
import Database from 'better-sqlite3'
import migration001 from './migrations/001_init.sql?raw'

let testDirectory: string | null = null

afterEach(() => {
  closeDatabase()
  if (testDirectory) {
    rmSync(testDirectory, { recursive: true, force: true })
    testDirectory = null
  }
})

describe('initializeDatabase', () => {
  it('tao schema v1, bat WAL va foreign key', () => {
    testDirectory = mkdtempSync(join(tmpdir(), 'opspilot-db-'))
    const database = initializeDatabase(testDirectory)

    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>
    const schemaVersion = database
      .prepare('SELECT MAX(version) AS version FROM schema_version')
      .get() as { version: number }

    expect(tables).toHaveLength(12)
    expect(schemaVersion.version).toBe(3)
    expect(database.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(database.pragma('foreign_keys', { simple: true })).toBe(1)
  })

  it('upgrades a populated v1 database and reopens after a partial v2 migration', () => {
    testDirectory = mkdtempSync(join(tmpdir(), 'opspilot-db-v1-'))
    const path = join(testDirectory, 'opspilot.db')
    const legacy = new Database(path)
    legacy.exec(migration001)
    legacy.exec(
      "INSERT INTO vps (name,host,username,auth_type,encrypted_secret) VALUES ('v','h','u','password','x')"
    )
    legacy.exec(
      "INSERT INTO app (vps_id,name,framework,host_port,container_port) VALUES (1,'legacy','express',3000,3000)"
    )
    legacy.exec(
      "INSERT INTO deployment (app_id,version,image_tag,status) VALUES (1,1,'legacy:v1','running')"
    )
    legacy.exec('UPDATE app SET current_deployment_id=1, metrics_offset=42 WHERE id=1')
    legacy.exec(
      "ALTER TABLE app ADD COLUMN metrics_stream_generation TEXT NOT NULL DEFAULT 'legacy'"
    )
    legacy.close()

    const database = initializeDatabase(testDirectory)
    expect(database.prepare('SELECT name,metrics_offset FROM app WHERE id=1').get()).toEqual({
      name: 'legacy',
      metrics_offset: 42
    })
    expect(database.prepare('SELECT MAX(version) AS version FROM schema_version').get()).toEqual({
      version: 3
    })
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM pragma_table_info('migration_job') WHERE name='error_message'"
        )
        .get()
    ).toEqual({ count: 1 })
    expect(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM pragma_table_info('app') WHERE name='metrics_stream_inode'"
        )
        .get()
    ).toEqual({ count: 1 })
    closeDatabase()
    testDirectory = null
    expect(initializeDatabase(path.replace('opspilot.db', ''))).toBeTruthy()
  })
})
