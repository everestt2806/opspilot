import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

import Database from 'better-sqlite3'

import migration001 from './migrations/001_init.sql?raw'
import migration002 from './migrations/002_metric_activation.sql?raw'
import migration003 from './migrations/003_migration_error_message.sql?raw'
import migration004 from './migrations/004_publish_doctor_domain.sql?raw'
import migration005 from './migrations/005_experiment_run_attempt.sql?raw'
import migration006 from './migrations/006_vps_host_fingerprint.sql?raw'
import migration007 from './migrations/007_git_source_provenance.sql?raw'
import migration008 from './migrations/008_vps_archive.sql?raw'
import migration009 from './migrations/009_vps_app_import.sql?raw'
import migration010 from './migrations/010_domain_ingress_state.sql?raw'
import migration011 from './migrations/011_domain_ingress_identity_guards.sql?raw'
import migration012 from './migrations/012_ingress_reconcile_observation.sql?raw'
import migration013 from './migrations/013_ingress_production_probe_evidence.sql?raw'
import migration014 from './migrations/014_https_probe_policy_and_peer_set.sql?raw'
import migration015 from './migrations/015_repair_legacy_https_probe_evidence.sql?raw'
import migration016 from './migrations/016_product_auto_deploy_persistence.sql?raw'
import migration017 from './migrations/017_product_auto_deploy_pause_policy.sql?raw'
import migration018 from './migrations/018_product_auto_deploy_pause_provenance.sql?raw'
import migration019 from './migrations/019_vps_ssh_security_revision.sql?raw'
import migration020 from './migrations/020_product_runtime_terminal.sql?raw'

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
  },
  {
    name: '003_migration_error_message.sql',
    version: 3,
    sql: migration003
  },
  {
    name: '004_publish_doctor_domain.sql',
    version: 4,
    sql: migration004
  },
  {
    name: '005_experiment_run_attempt.sql',
    version: 5,
    sql: migration005
  },
  {
    name: '006_vps_host_fingerprint.sql',
    version: 6,
    sql: migration006
  },
  {
    name: '007_git_source_provenance.sql',
    version: 7,
    sql: migration007
  },
  {
    name: '008_vps_archive.sql',
    version: 8,
    sql: migration008
  },
  {
    name: '009_vps_app_import.sql',
    version: 9,
    sql: migration009
  },
  {
    name: '010_domain_ingress_state.sql',
    version: 10,
    sql: migration010
  },
  {
    name: '011_domain_ingress_identity_guards.sql',
    version: 11,
    sql: migration011
  },
  {
    name: '012_ingress_reconcile_observation.sql',
    version: 12,
    sql: migration012
  },
  {
    name: '013_ingress_production_probe_evidence.sql',
    version: 13,
    sql: migration013
  },
  {
    name: '014_https_probe_policy_and_peer_set.sql',
    version: 14,
    sql: migration014
  },
  {
    name: '015_repair_legacy_https_probe_evidence.sql',
    version: 15,
    sql: migration015
  },
  {
    name: '016_product_auto_deploy_persistence.sql',
    version: 16,
    sql: migration016
  },
  {
    name: '017_product_auto_deploy_pause_policy.sql',
    version: 17,
    sql: migration017
  },
  {
    name: '018_product_auto_deploy_pause_provenance.sql',
    version: 18,
    sql: migration018
  },
  {
    name: '019_vps_ssh_security_revision.sql',
    version: 19,
    sql: migration019
  },
  {
    name: '020_product_runtime_terminal.sql',
    version: 20,
    sql: migration020
  }
]

export let db: Database.Database

export let migration005TestInterceptor: ((database: Database.Database) => void) | null = null

export function setMigration005TestInterceptor(
  interceptor: ((database: Database.Database) => void) | null
): void {
  migration005TestInterceptor = interceptor
}

export function initializeDatabase(userDataPath: string): Database.Database {
  const databasePath = join(userDataPath, 'opspilot.db')
  mkdirSync(dirname(databasePath), { recursive: true })

  db = new Database(databasePath)
  try {
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    runMigrations(db)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

export function closeDatabase(): void {
  if (db?.open) {
    db.close()
  }
}

export function runMigrations(
  database: Database.Database,
  maxVersion = Number.POSITIVE_INFINITY
): void {
  const applied = getAppliedVersions(database)

  for (const migration of migrations.toSorted((left, right) =>
    left.name.localeCompare(right.name)
  )) {
    if (migration.version > maxVersion) break
    if (applied.has(migration.version)) {
      continue
    }

    if (migration.version === 5) {
      runMigration005(database, migration)
      continue
    }

    if (migration.version === 9) {
      runMigration009(database, migration)
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

function runMigration009(database: Database.Database, migration: Migration): void {
  const wasFkEnabled = database.pragma('foreign_keys', { simple: true }) === 1
  if (wasFkEnabled) database.pragma('foreign_keys = OFF')
  try {
    database.transaction(() => {
      database.exec(migration.sql)
      const fkErrors = database.pragma('foreign_key_check') as Array<unknown>
      if (fkErrors.length > 0) {
        throw new Error(`Migration 009 vi phạm foreign_key_check: ${JSON.stringify(fkErrors)}`)
      }
      database.prepare('INSERT INTO schema_version (version) VALUES (?)').run(migration.version)
    })()
  } finally {
    if (wasFkEnabled) database.pragma('foreign_keys = ON')
  }
}

function runMigration005(database: Database.Database, migration: Migration): void {
  const wasFkEnabled = database.pragma('foreign_keys', { simple: true }) === 1
  if (wasFkEnabled) {
    database.pragma('foreign_keys = OFF')
    const currentFk = database.pragma('foreign_keys', { simple: true })
    if (currentFk !== 0) {
      throw new Error('Không thể tắt foreign_keys trước transaction cho migration 005')
    }
  }

  try {
    database.transaction(() => {
      // 1. Snapshot tiền migration
      const preRunRows = database
        .prepare('SELECT id FROM experiment_run ORDER BY id')
        .all() as Array<{ id: number }>
      const preRunIds = preRunRows.map((r) => r.id)

      const preAlertPairs = database
        .prepare(
          'SELECT id, experiment_run_id FROM alert WHERE experiment_run_id IS NOT NULL ORDER BY id'
        )
        .all() as Array<{ id: number; experiment_run_id: number }>

      const preNullAlertCount = (
        database
          .prepare('SELECT COUNT(*) AS c FROM alert WHERE experiment_run_id IS NULL')
          .get() as {
          c: number
        }
      ).c

      // 2. Thực thi DDL/DML của migration 005
      database.exec(migration.sql)

      // 3. Test interceptor (nếu có để kiểm thử lỗi được tiêm giữa migration)
      if (migration005TestInterceptor) {
        migration005TestInterceptor(database)
      }

      // 4. Kiểm tra foreign_key_check trước khi commit
      const fkErrors = database.pragma('foreign_key_check') as Array<unknown>
      if (fkErrors.length > 0) {
        throw new Error(`Migration 005 vi phạm foreign_key_check: ${JSON.stringify(fkErrors)}`)
      }

      // 5. Kiểm tra giữ nguyên chính xác tập ID run
      const postRunRows = database
        .prepare('SELECT id FROM experiment_run ORDER BY id')
        .all() as Array<{ id: number }>
      const postRunIds = postRunRows.map((r) => r.id)
      if (
        postRunIds.length !== preRunIds.length ||
        !postRunIds.every((id, idx) => id === preRunIds[idx])
      ) {
        throw new Error(
          `Migration 005 không bảo toàn tập ID experiment_run: trước=[${preRunIds.join(',')}], sau=[${postRunIds.join(',')}]`
        )
      }

      // 6. Kiểm tra giữ nguyên từng cặp alert.id -> experiment_run_id
      const postAlertPairs = database
        .prepare(
          'SELECT id, experiment_run_id FROM alert WHERE experiment_run_id IS NOT NULL ORDER BY id'
        )
        .all() as Array<{ id: number; experiment_run_id: number }>

      if (postAlertPairs.length !== preAlertPairs.length) {
        throw new Error(
          `Migration 005 làm thay đổi số lượng alert có experiment_run_id: trước=${preAlertPairs.length}, sau=${postAlertPairs.length}`
        )
      }

      for (let i = 0; i < preAlertPairs.length; i++) {
        const pre = preAlertPairs[i]
        const post = postAlertPairs[i]
        if (pre.id !== post.id || pre.experiment_run_id !== post.experiment_run_id) {
          throw new Error(
            `Migration 005 làm sai lệch liên kết alert: alert id=${pre.id} trước trỏ tới run ${pre.experiment_run_id}, sau trỏ tới ${post?.experiment_run_id}`
          )
        }
      }

      // 7. Kiểm tra không có alert nào bị cascade SET NULL
      const postNullAlertCount = (
        database
          .prepare('SELECT COUNT(*) AS c FROM alert WHERE experiment_run_id IS NULL')
          .get() as {
          c: number
        }
      ).c
      if (postNullAlertCount !== preNullAlertCount) {
        throw new Error(
          `Migration 005 làm tăng số alert có experiment_run_id = NULL: trước=${preNullAlertCount}, sau=${postNullAlertCount}`
        )
      }

      // 8. Ghi nhận version 5 vào schema_version
      const alreadyRecorded = database
        .prepare('SELECT 1 FROM schema_version WHERE version = ?')
        .get(migration.version)
      if (!alreadyRecorded) {
        database.prepare('INSERT INTO schema_version (version) VALUES (?)').run(migration.version)
      }
    })()
  } finally {
    if (wasFkEnabled) {
      database.pragma('foreign_keys = ON')
    }
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
