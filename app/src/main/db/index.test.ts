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

afterEach(() => {
  setMigration005TestInterceptor(null)
  closeDatabase()
  if (testDirectory) {
    rmSync(testDirectory, { recursive: true, force: true })
    testDirectory = null
  }
})

describe('initializeDatabase', () => {
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
    expect(
      database.prepare('SELECT imported_from_vps FROM app WHERE id=72').get()
    ).toEqual({ imported_from_vps: 0 })
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
    expect(schemaVersion.version).toBe(9)
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
      version: 9
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
    expect(successVer.version).toBe(9)

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
