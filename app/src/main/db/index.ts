import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

import Database from 'better-sqlite3'

import migration001 from './migrations/001_init.sql?raw'

interface Migration {
  name: string
  version: number
  sql: string
}

const migrations: Migration[] = [
  {
    name: '001_init.sql',
    version: 1,
    sql: migration001
  }
]

export let db: Database.Database

export function initializeDatabase(userDataPath: string): Database.Database {
  const databasePath = join(userDataPath, 'deploytool.db')
  mkdirSync(dirname(databasePath), { recursive: true })

  db = new Database(databasePath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)

  return db
}

export function closeDatabase(): void {
  if (db?.open) {
    db.close()
  }
}

function runMigrations(database: Database.Database): void {
  const applied = getAppliedVersions(database)

  for (const migration of migrations.toSorted((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    if (applied.has(migration.version)) {
      continue
    }

    database.exec(migration.sql)

    const alreadyRecorded = database
      .prepare('SELECT 1 FROM schema_version WHERE version = ?')
      .get(migration.version)

    if (!alreadyRecorded) {
      database.prepare('INSERT INTO schema_version (version) VALUES (?)').run(migration.version)
    }
  }
}

function getAppliedVersions(database: Database.Database): Set<number> {
  const schemaTable = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'")
    .get()

  if (!schemaTable) {
    return new Set()
  }

  const rows = database.prepare('SELECT version FROM schema_version').all() as Array<{
    version: number
  }>
  return new Set(rows.map((row) => row.version))
}
