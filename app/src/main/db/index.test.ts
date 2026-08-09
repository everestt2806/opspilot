import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { closeDatabase, initializeDatabase } from './index'

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
    testDirectory = mkdtempSync(join(tmpdir(), 'deploytool-db-'))
    const database = initializeDatabase(testDirectory)

    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>
    const schemaVersion = database
      .prepare('SELECT MAX(version) AS version FROM schema_version')
      .get() as { version: number }

    expect(tables).toHaveLength(11)
    expect(schemaVersion.version).toBe(1)
    expect(database.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(database.pragma('foreign_keys', { simple: true })).toBe(1)
  })
})
