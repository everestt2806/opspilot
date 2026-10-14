import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  closeDatabase,
  initializeDatabase,
  runMigrations,
  setMigration005TestInterceptor
} from './index'
import Database from 'better-sqlite3'
import migration001 from './migrations/001_init.sql?raw'
import migration003 from './migrations/003_migration_error_message.sql?raw'
import migration004 from './migrations/004_publish_doctor_domain.sql?raw'
import { SshManager } from '../ssh/manager'

let testDirectory: string | null = null

function downgradeMigration009ToV8(database: Database.Database): void {
  downgradeMigration010ToV9(database)
  database.pragma('foreign_keys = OFF')
  database.exec(`
    CREATE TABLE deployment_v8 (
      id INTEGER PRIMARY KEY,
      app_id INTEGER NOT NULL REFERENCES app(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      image_tag TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN
        ('building','deploying','running','failed','rolled_back','stopped')),
      failed_step TEXT CHECK (failed_step IN
        ('PRECHECK','UPLOAD','RENDER','BUILD','DEPLOY','HEALTHCHECK','RECORD')),
      env_json TEXT,
      detector_json TEXT,
      build_duration_ms INTEGER,
      total_duration_ms INTEGER,
      is_rollback_of INTEGER REFERENCES deployment_v8(id),
      started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      finished_at TEXT,
      exposure_status TEXT NOT NULL DEFAULT 'not_checked' CHECK (exposure_status IN
        ('reachable','degraded','tunnel_only','not_checked')),
      exposure_evidence_json TEXT,
      git_repo_url TEXT,
      git_commit_sha TEXT,
      UNIQUE (app_id, version)
    );
    INSERT INTO deployment_v8 (
      id, app_id, version, image_tag, status, failed_step, env_json, detector_json,
      build_duration_ms, total_duration_ms, is_rollback_of, started_at, finished_at,
      exposure_status, exposure_evidence_json, git_repo_url, git_commit_sha
    )
    SELECT id, app_id, version, image_tag, status, failed_step, env_json, detector_json,
      build_duration_ms, total_duration_ms, is_rollback_of, started_at, finished_at,
      exposure_status, exposure_evidence_json, git_repo_url, git_commit_sha
    FROM deployment;
    DROP TABLE deployment;
    ALTER TABLE deployment_v8 RENAME TO deployment;
    CREATE INDEX idx_deployment_app_started ON deployment(app_id, started_at DESC);
    ALTER TABLE app DROP COLUMN imported_from_vps;
    DELETE FROM schema_version WHERE version = 9;
  `)
  database.pragma('foreign_keys = ON')
}

function downgradeMigration010ToV9(database: Database.Database): void {
  database.exec(`
    DROP TRIGGER domain_binding_active_requires_https_insert;
    DROP TRIGGER domain_binding_active_requires_https_update;
    DROP INDEX idx_domain_binding_route_ownership;
    DROP INDEX idx_domain_binding_app_dns_status;
    ALTER TABLE domain_binding DROP COLUMN https_probe_hostname;
    ALTER TABLE domain_binding DROP COLUMN certificate_hostname;
    ALTER TABLE domain_binding DROP COLUMN https_probe_checked_at;
    ALTER TABLE domain_binding DROP COLUMN certificate_checked_at;
    ALTER TABLE domain_binding DROP COLUMN route_checked_at;
    ALTER TABLE domain_binding DROP COLUMN ingress_reason_code;
    ALTER TABLE domain_binding DROP COLUMN route_ownership_key;
    ALTER TABLE domain_binding DROP COLUMN observed_generation;
    ALTER TABLE domain_binding DROP COLUMN desired_generation;
    ALTER TABLE domain_binding DROP COLUMN https_probe_status;
    ALTER TABLE domain_binding DROP COLUMN certificate_status;
    ALTER TABLE domain_binding DROP COLUMN route_status;
    ALTER TABLE domain_binding DROP COLUMN dns_evidence_json;
    ALTER TABLE domain_binding DROP COLUMN dns_status;
    DELETE FROM schema_version WHERE version = 10;
  `)
}

afterEach(() => {
  setMigration005TestInterceptor(null)
  closeDatabase()
  if (testDirectory) {
    rmSync(testDirectory, { recursive: true, force: true })
    testDirectory = null
  }
})

describe('initializeDatabase', () => {
  it('migration v9 to v10 preserves legacy domain binding and adds separate HTTPS state idempotently', () => {
    testDirectory = mkdtempSync(join(tmpdir(), 'opspilot-db-v9-v10-domain-'))
    const database = initializeDatabase(testDirectory)
    downgradeMigration010ToV9(database)
    database.exec(`
      INSERT INTO vps (id, name, host, username, auth_type, encrypted_secret)
        VALUES (42, 'Existing VPS', '203.0.113.42', 'deploy', 'key', X'00');
      INSERT INTO app (id, vps_id, name, framework, host_port, container_port)
        VALUES (72, 42, 'existing-app', 'express', 30042, 3000);
      INSERT INTO domain_binding
        (id, app_id, hostname, mode, provider, zone_id, record_type, record_name,
         target, ownership_key, status, last_check_at, evidence_json, created_at, updated_at)
      VALUES
        (82, 72, 'legacy.example.com', 'shared_ingress', 'cloudflare', 'zone-1', 'A',
         'legacy.example.com', '203.0.113.42', 'dns-owner:82', 'active',
         '2026-10-12T10:11:12Z', '{"legacy":true}', '2026-10-01T00:00:00Z',
         '2026-10-12T10:11:12Z');
    `)
    const legacyBefore = database
      .prepare(
        `SELECT id, app_id, hostname, mode, provider, zone_id, record_type, record_name,
                target, ownership_key, status, last_check_at, evidence_json, created_at, updated_at
         FROM domain_binding WHERE id=82`
      )
      .get()

    expect(database.prepare('SELECT MAX(version) AS version FROM schema_version').get()).toEqual({
      version: 9
    })
    runMigrations(database)

    expect(
      database
        .prepare(
          `SELECT id, app_id, hostname, mode, provider, zone_id, record_type, record_name,
                  target, ownership_key, status, last_check_at, evidence_json, created_at, updated_at
           FROM domain_binding WHERE id=82`
        )
        .get()
    ).toEqual(legacyBefore)
    expect(
      database
        .prepare(
          `SELECT dns_status, route_status, certificate_status, https_probe_status,
                  desired_generation, observed_generation, route_ownership_key
           FROM domain_binding WHERE id=82`
        )
        .get()
    ).toEqual({
      dns_status: 'propagated',
      route_status: 'not_configured',
      certificate_status: 'not_requested',
      https_probe_status: 'not_run',
      desired_generation: 1,
      observed_generation: 0,
      route_ownership_key: 'opspilot-ingress:72:legacy.example.com'
    })
    expect(database.pragma('foreign_key_check')).toEqual([])
    expect(() =>
      database
        .prepare("UPDATE domain_binding SET route_status='active' WHERE id=82")
        .run()
    ).toThrow(/domain_https_active_requires_verified_evidence/)
    expect(() =>
      database
        .prepare("UPDATE domain_binding SET ingress_reason_code='UNRECOGNIZED' WHERE id=82")
        .run()
    ).toThrow(/CHECK constraint failed/)

    runMigrations(database)
    expect(database.prepare('SELECT COUNT(*) AS count FROM domain_binding').get()).toEqual({
      count: 1
    })
    expect(database.prepare('SELECT MAX(version) AS version FROM schema_version').get()).toEqual({
      version: 10
    })
    expect(database.pragma('foreign_key_check')).toEqual([])
  })

  it('migration v8 to v9 preserves deployment-linked records and foreign keys', () => {
    testDirectory = mkdtempSync(join(tmpdir(), 'opspilot-db-v8-v9-linked-'))
    const database = initializeDatabase(testDirectory)
    database.exec(`
      INSERT INTO vps (id, name, host, username, auth_type, encrypted_secret)
        VALUES (42, 'Existing VPS', '203.0.113.42', 'deploy', 'key', X'00');
      INSERT INTO app (id, vps_id, name, framework, host_port, container_port)
        VALUES (72, 42, 'existing-app', 'express', 30042, 3000);
      INSERT INTO deployment (id, app_id, version, image_tag, status, started_at)
        VALUES (82, 72, 3, 'existing-app:v3', 'running', '2026-10-11T12:13:14Z');
      INSERT INTO deployment_activation
        (id, app_id, deployment_id, stream_generation, start_offset, reason, state)
        VALUES (92, 72, 82, 'stream-1', 1, 'deploy', 'active');
      INSERT INTO metric_sample (id, deployment_id, seq, ts_vps, ts_local, raw_json)
        VALUES (102, 82, 1, '2026-10-11T12:13:14Z', '2026-10-11T12:13:15Z', '{"seq":1}');
      INSERT INTO score_sample (id, metric_sample_id, deployment_id, ts_vps, method, score)
        VALUES (112, 102, 82, '2026-10-11T12:13:14Z', 'rule', 0.25);
      INSERT INTO alert (id, deployment_id, metric_sample_id, method, ts_vps, peak_score)
        VALUES (122, 82, 102, 'rule', '2026-10-11T12:13:14Z', 0.25);
      INSERT INTO doctor_run
        (id, deployment_id, trigger, evidence_json, diagnosis_code, confidence)
        VALUES (132, 82, 'manual', '{"source":"test"}', 'test-diagnosis', 'low');
      INSERT INTO doctor_action (id, doctor_run_id, action_type, status)
        VALUES (142, 132, 'inspect', 'success');
      INSERT INTO experiment_run
        (id, scenario, repeat_index, deployment_id, vps_id, status)
        VALUES (152, 'memory_leak', 1, 82, 42, 'completed');
    `)

    downgradeMigration009ToV8(database)
    expect(database.prepare('SELECT MAX(version) AS version FROM schema_version').get()).toEqual({
      version: 8
    })
    runMigrations(database)

    expect(
      database.prepare('SELECT id, started_at, origin FROM deployment WHERE id=82').get()
    ).toEqual({
      id: 82,
      started_at: '2026-10-11T12:13:14Z',
      origin: 'opspilot'
    })
    expect(database.prepare('SELECT imported_from_vps FROM app WHERE id=72').get()).toEqual({
      imported_from_vps: 0
    })
    expect(
      database.prepare('SELECT id, deployment_id, state FROM deployment_activation').get()
    ).toEqual({
      id: 92,
      deployment_id: 82,
      state: 'active'
    })
    expect(database.prepare('SELECT id, deployment_id, raw_json FROM metric_sample').get()).toEqual(
      {
        id: 102,
        deployment_id: 82,
        raw_json: '{"seq":1}'
      }
    )
    expect(
      database.prepare('SELECT id, metric_sample_id, deployment_id, score FROM score_sample').get()
    ).toEqual({
      id: 112,
      metric_sample_id: 102,
      deployment_id: 82,
      score: 0.25
    })
    expect(database.prepare('SELECT id, deployment_id, metric_sample_id FROM alert').get()).toEqual(
      {
        id: 122,
        deployment_id: 82,
        metric_sample_id: 102
      }
    )
    expect(database.prepare('SELECT id, deployment_id FROM doctor_run').get()).toEqual({
      id: 132,
      deployment_id: 82
    })
    expect(database.prepare('SELECT id, doctor_run_id, status FROM doctor_action').get()).toEqual({
      id: 142,
      doctor_run_id: 132,
      status: 'success'
    })
    expect(database.prepare('SELECT id, deployment_id, status FROM experiment_run').get()).toEqual({
      id: 152,
      deployment_id: 82,
      status: 'completed'
    })
    expect(database.pragma('foreign_key_check')).toEqual([])
  })

  it('migration v8 to v9 rolls back all changes after an intermediate SQL error', () => {
    testDirectory = mkdtempSync(join(tmpdir(), 'opspilot-db-v8-v9-rollback-'))
    const database = initializeDatabase(testDirectory)
    database.exec(`
      INSERT INTO vps (id, name, host, username, auth_type, encrypted_secret)
        VALUES (42, 'Existing VPS', '203.0.113.42', 'deploy', 'key', X'00');
      INSERT INTO app (id, vps_id, name, framework, host_port, container_port)
        VALUES (72, 42, 'existing-app', 'express', 30042, 3000);
      INSERT INTO deployment (id, app_id, version, image_tag, status, started_at)
        VALUES (82, 72, 3, 'existing-app:v3', 'running', '2026-10-11T12:13:14Z');
    `)
    downgradeMigration009ToV8(database)
    database.exec('DROP INDEX idx_deployment_app_started')

    expect(() => runMigrations(database)).toThrow(/no such index: idx_deployment_app_started/)
    expect(
      database.prepare('SELECT id, image_tag, started_at FROM deployment WHERE id=82').get()
    ).toMatchObject({
      id: 82,
      image_tag: 'existing-app:v3'
    })
    expect(database.pragma('table_info(app)')).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'imported_from_vps' })])
    )
    expect(database.pragma('table_info(deployment)')).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'origin' })])
    )
    expect(database.prepare('SELECT MAX(version) AS version FROM schema_version').get()).toEqual({
      version: 8
    })
    expect(database.pragma('foreign_key_check')).toEqual([])
  })

  it('migration v7 to v8 keeps existing VPS and app records intact', () => {
    testDirectory = mkdtempSync(join(tmpdir(), 'opspilot-db-v7-v8-'))
    const database = initializeDatabase(testDirectory)
    database.exec(`
      INSERT INTO vps (id, name, host, username, auth_type, encrypted_secret)
        VALUES (42, 'Existing VPS', '203.0.113.42', 'deploy', 'key', X'00');
      INSERT INTO app (id, vps_id, name, framework, host_port, container_port)
        VALUES (72, 42, 'existing-app', 'express', 30042, 3000);
      INSERT INTO deployment (id, app_id, version, image_tag, status)
        VALUES (82, 72, 1, 'existing-app:v1', 'running');
      DROP INDEX idx_vps_archived_identity;
      ALTER TABLE vps DROP COLUMN archived_name;
      ALTER TABLE vps DROP COLUMN archived_at;
      DELETE FROM schema_version WHERE version = 8;
    `)

    runMigrations(database)
    expect(database.prepare('SELECT id, name, archived_at FROM vps WHERE id=42').get()).toEqual({
      id: 42,
      name: 'Existing VPS',
      archived_at: null
    })
    expect(database.prepare('SELECT id, vps_id FROM app WHERE id=72').get()).toEqual({
      id: 72,
      vps_id: 42
    })
    expect(database.prepare('SELECT id, app_id FROM deployment WHERE id=82').get()).toEqual({
      id: 82,
      app_id: 72
    })
    expect(database.prepare('SELECT imported_from_vps FROM app WHERE id=72').get()).toEqual({
      imported_from_vps: 0
    })
    expect(
      database.prepare('SELECT origin, started_at FROM deployment WHERE id=82').get()
    ).toMatchObject({ origin: 'opspilot' })
    expect(database.pragma('table_info(deployment)')).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'origin' })])
    )
    expect(database.pragma('foreign_key_check')).toEqual([])
  })

  it('migration v6 to v7 preserves local app/deployment provenance without inventing Git data', () => {
    testDirectory = mkdtempSync(join(tmpdir(), 'opspilot-db-v6-v7-'))
    const database = initializeDatabase(testDirectory)
    database.exec(`
      INSERT INTO vps (id, name, host, username, auth_type, encrypted_secret)
        VALUES (1, 'Local VPS', 'localhost', 'test-user', 'key', X'00');
      INSERT INTO app (id, vps_id, name, framework, source_path, host_port, container_port)
        VALUES (1, 1, 'legacy-app', 'express', 'D:/legacy/source', 30000, 3000);
      INSERT INTO deployment (id, app_id, version, image_tag, status)
        VALUES (1, 1, 1, 'legacy:v1', 'running');
      ALTER TABLE deployment DROP COLUMN git_commit_sha;
      ALTER TABLE deployment DROP COLUMN git_repo_url;
      ALTER TABLE app DROP COLUMN git_root;
      ALTER TABLE app DROP COLUMN git_ref;
      ALTER TABLE app DROP COLUMN git_repo_url;
      ALTER TABLE app DROP COLUMN source_type;
      DELETE FROM schema_version WHERE version = 7;
    `)

    runMigrations(database)

    expect(
      database
        .prepare(
          'SELECT source_type, source_path, git_repo_url, git_ref, git_root FROM app WHERE id=1'
        )
        .get()
    ).toEqual({
      source_type: 'local',
      source_path: 'D:/legacy/source',
      git_repo_url: null,
      git_ref: null,
      git_root: null
    })
    expect(
      database.prepare('SELECT git_repo_url, git_commit_sha FROM deployment WHERE id=1').get()
    ).toEqual({
      git_repo_url: null,
      git_commit_sha: null
    })
  })

  it('migration v5 to v6 preserves VPS rows and blocks legacy records without a fingerprint', async () => {
    testDirectory = mkdtempSync(join(tmpdir(), 'opspilot-db-v5-v6-'))
    const database = initializeDatabase(testDirectory)
    database.exec('DROP INDEX idx_vps_archived_identity')
    database.exec('ALTER TABLE vps DROP COLUMN archived_name')
    database.exec('ALTER TABLE vps DROP COLUMN archived_at')
    database.exec('ALTER TABLE vps DROP COLUMN host_fingerprint')
    database.prepare('DELETE FROM schema_version WHERE version = 6').run()
    database.prepare('DELETE FROM schema_version WHERE version = 8').run()
    database
      .prepare(
        "INSERT INTO vps (id, name, host, port, username, auth_type, encrypted_secret) VALUES (1, 'Legacy', 'legacy.example.invalid', 2222, 'test-user', 'key', X'00')"
      )
      .run()

    runMigrations(database)

    const legacy = database
      .prepare('SELECT id, name, host, port, username, host_fingerprint FROM vps WHERE id = 1')
      .get() as {
      id: number
      name: string
      host: string
      port: number
      username: string
      host_fingerprint: string | null
    }
    expect(legacy).toEqual({
      id: 1,
      name: 'Legacy',
      host: 'legacy.example.invalid',
      port: 2222,
      username: 'test-user',
      host_fingerprint: null
    })

    const ssh = new SshManager(async () => ({
      host: legacy.host,
      port: legacy.port,
      hostFingerprint: legacy.host_fingerprint,
      username: legacy.username,
      authType: 'key',
      secret: ''
    }))
    await expect(ssh.connect(legacy.id)).rejects.toMatchObject({
      userMessage: expect.stringContaining('Thiếu fingerprint SSH')
    })
  })

  it('tao schema v1, bat WAL va foreign key', () => {
    testDirectory = mkdtempSync(join(tmpdir(), 'opspilot-db-'))
    const database = initializeDatabase(testDirectory)

    const tables = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ name: string }>
    const schemaVersion = database
      .prepare('SELECT MAX(version) AS version FROM schema_version')
      .get() as { version: number }

    expect(tables).toHaveLength(15)
    expect(schemaVersion.version).toBe(10)
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
      version: 10
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

  it('migration 004: ho tro 4 trang thai exposure, luu evidence json va chan trang thai khong hop le', () => {
    testDirectory = mkdtempSync(join(tmpdir(), 'opspilot-db-v4-'))
    const database = initializeDatabase(testDirectory)

    database.exec(
      "INSERT INTO vps (id, name, host, username, auth_type, encrypted_secret) VALUES (1, 'v', 'h', 'u', 'password', 'x')"
    )
    database.exec(
      "INSERT INTO app (id, vps_id, name, framework, host_port, container_port) VALUES (1, 1, 'demo', 'express', 3000, 3000)"
    )

    const validStatuses = ['reachable', 'degraded', 'tunnel_only', 'not_checked'] as const
    for (const [index, status] of validStatuses.entries()) {
      const depId = index + 1
      database
        .prepare(
          'INSERT INTO deployment (id, app_id, version, image_tag, status, exposure_status, exposure_evidence_json) VALUES (?, 1, ?, ?, ?, ?, ?)'
        )
        .run(depId, depId, `demo:v${depId}`, 'running', status, JSON.stringify({ status }))

      const row = database
        .prepare('SELECT exposure_status, exposure_evidence_json FROM deployment WHERE id = ?')
        .get(depId) as { exposure_status: string; exposure_evidence_json: string }
      expect(row.exposure_status).toBe(status)
      expect(JSON.parse(row.exposure_evidence_json)).toEqual({ status })
    }

    // Default exposure_status is 'not_checked'
    database.exec(
      "INSERT INTO deployment (id, app_id, version, image_tag, status) VALUES (99, 1, 99, 'demo:v99', 'running')"
    )
    const defaultRow = database
      .prepare('SELECT exposure_status, exposure_evidence_json FROM deployment WHERE id = 99')
      .get() as { exposure_status: string; exposure_evidence_json: string | null }
    expect(defaultRow.exposure_status).toBe('not_checked')
    expect(defaultRow.exposure_evidence_json).toBeNull()

    // Invalid exposure_status should throw CHECK constraint error
    expect(() => {
      database.exec(
        "INSERT INTO deployment (id, app_id, version, image_tag, status, exposure_status) VALUES (100, 1, 100, 'demo:v100', 'running', 'invalid_status')"
      )
    }).toThrow(/CHECK constraint failed/i)
  })

  it('migration 005: rollback sach se khi loi duoc tiem giua migration, bao toan DB v4 cu va chay lai thanh cong', () => {
    testDirectory = mkdtempSync(join(tmpdir(), 'opspilot-db-v5-'))
    const path = join(testDirectory, 'opspilot.db')

    // 1. Tạo DB v4 với dữ liệu hoàn chỉnh
    const v4Db = new Database(path)
    v4Db.pragma('journal_mode = WAL')
    v4Db.pragma('foreign_keys = ON')

    // Áp dụng migrations 1..4
    v4Db.exec(migration001)
    v4Db.exec(`
      ALTER TABLE app ADD COLUMN metrics_stream_generation TEXT NOT NULL DEFAULT 'legacy';
      ALTER TABLE app ADD COLUMN metrics_stream_device INTEGER;
      ALTER TABLE app ADD COLUMN metrics_stream_inode INTEGER;
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
    `)
    v4Db.exec(migration003)
    v4Db.exec(migration004)

    for (let v = 1; v <= 4; v++) {
      v4Db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(v)
    }

    // Nạp dữ liệu tiền đề
    v4Db.exec(
      "INSERT INTO vps (id, name, host, username, auth_type, encrypted_secret) VALUES (1, 'v', 'h', 'u', 'password', 'x')"
    )
    v4Db.exec(
      "INSERT INTO app (id, vps_id, name, framework, host_port, container_port) VALUES (1, 1, 'demo', 'express', 3000, 3000)"
    )
    v4Db.exec(
      "INSERT INTO deployment (id, app_id, version, image_tag, status) VALUES (1, 1, 1, 'demo:v1', 'running')"
    )

    // Nạp 3 bản ghi experiment_run v4 (chưa có cột attempt_index, có ID nhảy cóc)
    v4Db.exec(`
      INSERT INTO experiment_run (id, scenario, repeat_index, deployment_id, vps_id, status)
      VALUES (10, 'cpu_spike', 1, 1, 1, 'completed');

      INSERT INTO experiment_run (id, scenario, repeat_index, deployment_id, vps_id, status, abort_reason)
      VALUES (20, 'memory_leak', 1, 1, 1, 'aborted', 'clock_skew_too_large');

      INSERT INTO experiment_run (id, scenario, repeat_index, deployment_id, vps_id, status)
      VALUES (30, 'error_burst', 2, 1, 1, 'running');
    `)

    // Nạp các bản ghi alert có liên kết tới experiment_run
    v4Db.exec(`
      INSERT INTO alert (id, deployment_id, method, ts_vps, peak_score, experiment_run_id)
      VALUES (101, 1, 'rule', '2026-10-01T12:00:00Z', 1.0, 10);

      INSERT INTO alert (id, deployment_id, method, ts_vps, peak_score, experiment_run_id)
      VALUES (102, 1, 'iforest', '2026-10-01T12:05:00Z', 0.95, 20);

      INSERT INTO alert (id, deployment_id, method, ts_vps, peak_score, experiment_run_id)
      VALUES (103, 1, 'ocsvm', '2026-10-01T12:10:00Z', 0.88, NULL);
    `)

    // 2. KỊCH BẢN A: TIÊM LỖI GIỮA MIGRATION 005
    setMigration005TestInterceptor(() => {
      throw new Error('Loi mo phong duoc tiem giua migration 005')
    })

    // Khởi tạo chạy migration trực tiếp trên chính kết nối v4Db, văng lỗi do interceptor
    expect(() => runMigrations(v4Db)).toThrow(/Loi mo phong duoc tiem giua migration 005/)

    // Kiểm tra tính toàn vẹn của DB trên chính kết nối chạy migration sau rollback
    // a. Version vẫn dừng ở 4, migration 5 CHƯA được ghi nhận
    const verRow = v4Db.prepare('SELECT MAX(version) AS version FROM schema_version').get() as {
      version: number
    }
    expect(verRow.version).toBe(4)

    // b. Bảng experiment_run vẫn giữ nguyên cấu trúc schema v4 cũ (KHÔNG có cột attempt_index)
    const hasAttemptCol = (
      v4Db
        .prepare(
          "SELECT COUNT(*) AS c FROM pragma_table_info('experiment_run') WHERE name = 'attempt_index'"
        )
        .get() as { c: number }
    ).c
    expect(hasAttemptCol).toBe(0)

    // c. Ràng buộc cũ UNIQUE(scenario, repeat_index) vẫn còn
    expect(() => {
      v4Db.exec(
        "INSERT INTO experiment_run (id, scenario, repeat_index) VALUES (99, 'cpu_spike', 1)"
      )
    }).toThrow(/UNIQUE constraint failed/i)

    // d. Dữ liệu cũ của experiment_run còn nguyên vẹn 100%
    const oldRuns = v4Db
      .prepare('SELECT id, scenario, repeat_index, status FROM experiment_run ORDER BY id')
      .all()
    expect(oldRuns).toEqual([
      { id: 10, scenario: 'cpu_spike', repeat_index: 1, status: 'completed' },
      { id: 20, scenario: 'memory_leak', repeat_index: 1, status: 'aborted' },
      { id: 30, scenario: 'error_burst', repeat_index: 2, status: 'running' }
    ])

    // e. Từng cặp alert.id -> experiment_run_id còn nguyên vẹn
    const oldAlerts = v4Db.prepare('SELECT id, experiment_run_id FROM alert ORDER BY id').all()
    expect(oldAlerts).toEqual([
      { id: 101, experiment_run_id: 10 },
      { id: 102, experiment_run_id: 20 },
      { id: 103, experiment_run_id: null }
    ])

    // f. Trạng thái foreign_keys ở ngoài transaction trên chính kết nối vẫn được khôi phục là ON (1)
    expect(v4Db.pragma('foreign_keys', { simple: true })).toBe(1)

    // 3. KỊCH BẢN B: CHẠY LẠI THÀNH CÔNG (Sau khi gỡ lỗi tiêm, trên cùng kết nối)
    setMigration005TestInterceptor(null)

    runMigrations(v4Db)

    // a. Version nâng lên 5
    const successVer = v4Db.prepare('SELECT MAX(version) AS version FROM schema_version').get() as {
      version: number
    }
    expect(successVer.version).toBe(10)

    // b. Bảng experiment_run đã có cột attempt_index và backfill = 1 cho tất cả bản ghi cũ
    const postRuns = v4Db
      .prepare(
        'SELECT id, scenario, repeat_index, attempt_index, status FROM experiment_run ORDER BY id'
      )
      .all()
    expect(postRuns).toEqual([
      { id: 10, scenario: 'cpu_spike', repeat_index: 1, attempt_index: 1, status: 'completed' },
      { id: 20, scenario: 'memory_leak', repeat_index: 1, attempt_index: 1, status: 'aborted' },
      { id: 30, scenario: 'error_burst', repeat_index: 2, attempt_index: 1, status: 'running' }
    ])

    // c. Giữ nguyên chính xác tập ID run
    const postRunIds = (
      v4Db.prepare('SELECT id FROM experiment_run ORDER BY id').all() as Array<{ id: number }>
    ).map((r) => r.id)
    expect(postRunIds).toEqual([10, 20, 30])

    // d. Giữ nguyên chính xác từng cặp alert.id -> experiment_run_id
    const postAlerts = v4Db.prepare('SELECT id, experiment_run_id FROM alert ORDER BY id').all()
    expect(postAlerts).toEqual([
      { id: 101, experiment_run_id: 10 },
      { id: 102, experiment_run_id: 20 },
      { id: 103, experiment_run_id: null }
    ])

    // e. foreign_key_check sạch sẽ
    const fkErrors = v4Db.pragma('foreign_key_check') as Array<unknown>
    expect(fkErrors).toEqual([])

    // f. Trạng thái foreign_keys sau khi hoàn tất migration thành công vẫn là ON (1)
    expect(v4Db.pragma('foreign_keys', { simple: true })).toBe(1)

    // g. Ràng buộc mới UNIQUE(scenario, repeat_index, attempt_index) hoạt động:
    // Cho phép chèn attempt 2 cho kịch bản cpu_spike repeat 1 (trước đây bị chặn ở schema v1)
    v4Db.exec(
      "INSERT INTO experiment_run (id, scenario, repeat_index, attempt_index, status) VALUES (40, 'cpu_spike', 1, 2, 'running')"
    )
    const newRun = v4Db.prepare('SELECT id, attempt_index FROM experiment_run WHERE id = 40').get()
    expect(newRun).toEqual({ id: 40, attempt_index: 2 })

    // Nhưng chèn trùng (cpu_spike, 1, 1) hoặc (cpu_spike, 1, 2) sẽ bị chặn
    expect(() => {
      v4Db.exec(
        "INSERT INTO experiment_run (id, scenario, repeat_index, attempt_index) VALUES (41, 'cpu_spike', 1, 1)"
      )
    }).toThrow(/UNIQUE constraint failed/i)

    // CHECK constraint attempt_index BETWEEN 1 AND 3 hoạt động
    expect(() => {
      v4Db.exec(
        "INSERT INTO experiment_run (id, scenario, repeat_index, attempt_index) VALUES (42, 'slow_db', 1, 4)"
      )
    }).toThrow(/CHECK constraint failed/i)
    expect(() => {
      v4Db.exec(
        "INSERT INTO experiment_run (id, scenario, repeat_index, attempt_index) VALUES (43, 'slow_db', 1, 0)"
      )
    }).toThrow(/CHECK constraint failed/i)

    v4Db.close()
  })
})
