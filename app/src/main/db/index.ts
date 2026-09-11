import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

import Database from 'better-sqlite3'

import migration001 from './migrations/001_init.sql?raw'
import migration002 from './migrations/002_metric_activation.sql?raw'

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
  },
  {
    name: '002_metric_activation.sql',
    version: 2,
    sql: migration002
  }
]

export let db: Database.Database

export function initializeDatabase(userDataPath: string): Database.Database {
  const databasePath = join(userDataPath, 'opspilot.db')
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

    database.transaction(() => {
      applyMigration(database, migration)
      const alreadyRecorded = database
        .prepare('SELECT 1 FROM schema_version WHERE version = ?')
        .get(migration.version)
      if (!alreadyRecorded) {
        database.prepare('INSERT INTO schema_version (version) VALUES (?)').run(migration.version)
      }
    })()
  }
}

function applyMigration(database: Database.Database, migration: Migration): void {
  if (migration.version !== 2) {
    database.exec(migration.sql)
    return
  }

  const columns = new Set(
    (database.prepare('PRAGMA table_info(app)').all() as Array<{ name: string }>).map(
      (column) => column.name
    )
  )
  for (const definition of [
    "metrics_stream_generation TEXT NOT NULL DEFAULT 'legacy'",
    'metrics_stream_device INTEGER',
    'metrics_stream_inode INTEGER'
  ]) {
    const name = definition.split(' ', 1)[0]
    if (!columns.has(name)) database.exec(`ALTER TABLE app ADD COLUMN ${definition}`)
  }
  database.exec(`
    CREATE TABLE IF NOT EXISTS deployment_activation (
      id INTEGER PRIMARY KEY,
      app_id INTEGER NOT NULL REFERENCES app(id) ON DELETE CASCADE,
      deployment_id INTEGER NOT NULL REFERENCES deployment(id) ON DELETE CASCADE,
      stream_generation TEXT NOT NULL,
      start_offset INTEGER NOT NULL CHECK (start_offset >= 1),
      end_offset INTEGER CHECK (end_offset IS NULL OR end_offset >= start_offset),
      reason TEXT NOT NULL CHECK (reason IN ('deploy','manual_rollback','auto_rollback','rotation','legacy')),
      state TEXT NOT NULL CHECK (state IN ('prepared','active','closed','aborted')),
      prepared_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      activated_at TEXT,
      closed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_activation_app_range
      ON deployment_activation(app_id, stream_generation, start_offset, end_offset);
    CREATE INDEX IF NOT EXISTS idx_activation_deployment
      ON deployment_activation(deployment_id, id);
    CREATE UNIQUE INDEX IF NOT EXISTS one_prepared_activation
      ON deployment_activation(app_id) WHERE state='prepared';
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_activation
      ON deployment_activation(app_id) WHERE state='active';
  `)
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
