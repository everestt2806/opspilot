import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import { closeDatabase, initializeDatabase, runMigrations } from './index'
import migration016 from './migrations/016_product_auto_deploy_persistence.sql?raw'
import migration017 from './migrations/017_product_auto_deploy_pause_policy.sql?raw'
import migration018 from './migrations/018_product_auto_deploy_pause_provenance.sql?raw'
import migration019 from './migrations/019_vps_ssh_security_revision.sql?raw'
import migration021 from './migrations/021_product_target_enrollment.sql?raw'
import migration022 from './migrations/022_product_desktop_clients.sql?raw'
import migration023 from './migrations/023_product_api_requests.sql?raw'
import migration024 from './migrations/024_desktop_controller_binding.sql?raw'
import migration025 from './migrations/025_desktop_controller_commands.sql?raw'
import migration026 from './migrations/026_product_project_registration.sql?raw'
import migration027 from './migrations/027_desktop_project_setup.sql?raw'
import migration028 from './migrations/028_desktop_target_registration.sql?raw'
import { ControllerClientAuth } from '../controlPlane/controllerClientAuth'

let testDirectory: string | null = null

afterEach(() => {
  closeDatabase()
  if (testDirectory) {
    rmSync(testDirectory, { recursive: true, force: true })
    testDirectory = null
  }
})

describe('Product persistence migrations 016-028', () => {
  it('keeps the cumulative schema contract synchronized with migrations 016-028', () => {
    const schema = readFileSync(
      new URL('../../../../docs/contracts/schema.sql', import.meta.url),
      'utf8'
    ).replaceAll('\r\n', '\n')
    expect(schema).toContain(migration016.replaceAll('\r\n', '\n').trim())
    expect(schema).toContain(migration017.replaceAll('\r\n', '\n').trim())
    expect(schema).toContain(migration018.replaceAll('\r\n', '\n').trim())
    expect(schema).toContain(migration019.replaceAll('\r\n', '\n').trim())
    expect(schema).toContain(migration021.replaceAll('\r\n', '\n').trim())
    expect(schema).toContain(migration022.replaceAll('\r\n', '\n').trim())
    expect(schema).toContain(migration023.replaceAll('\r\n', '\n').trim())
    expect(schema).toContain(migration024.replaceAll('\r\n', '\n').trim())
    expect(schema).toContain(migration025.replaceAll('\r\n', '\n').trim())
    expect(schema).toContain(migration026.replaceAll('\r\n', '\n').trim())
    expect(schema).toContain(migration027.replaceAll('\r\n', '\n').trim())
    expect(schema).toContain(migration028.replaceAll('\r\n', '\n').trim())
  })

  it('upgrades v022 while retaining issued client digests and creates no implicit requests', () => {
    testDirectory = mkdtempSync(join(tmpdir(), 'opspilot-requests-v022-'))
    const database = initializeDatabase(testDirectory)
    database
      .prepare('INSERT INTO product_controller VALUES(?,?,?)')
      .run('upgrade-controller', new Date().toISOString(), 'active')
    const auth = new ControllerClientAuth(database, 'upgrade-controller', 'unix:1000')
    auth.enroll({
      request_key: randomUUID(),
      display_name: 'Upgrade unit',
      requested_scopes: ['read']
    })
    const snapshot = database.prepare('SELECT * FROM product_desktop_credential').all()
    database.exec(
      'DROP TABLE IF EXISTS product_environment_revision;DELETE FROM schema_version WHERE version=32;DROP TABLE IF EXISTS desktop_controller_authority_rebind;DELETE FROM schema_version WHERE version=31;DROP TABLE IF EXISTS desktop_controller_upgrade;DELETE FROM schema_version WHERE version=30;DROP TABLE IF EXISTS desktop_controller_installation;DELETE FROM schema_version WHERE version=29;DROP TABLE IF EXISTS desktop_target_setup;DROP TABLE IF EXISTS product_vps_registration;DELETE FROM schema_version WHERE version=28;DROP TABLE IF EXISTS desktop_project_setup;DELETE FROM schema_version WHERE version=27;DROP TABLE IF EXISTS product_project_registration;DELETE FROM schema_version WHERE version=26;DROP TABLE IF EXISTS desktop_controller_command;DELETE FROM schema_version WHERE version=25;DROP TABLE IF EXISTS desktop_controller_binding;DELETE FROM schema_version WHERE version=24;DROP TABLE product_api_request;DROP INDEX idx_product_desktop_client_identity;DELETE FROM schema_version WHERE version=23'
    )
    runMigrations(database)
    expect(database.prepare('SELECT * FROM product_desktop_credential').all()).toEqual(snapshot)
    expect(database.prepare('SELECT count(*) AS n FROM product_api_request').get()).toEqual({
      n: 0
    })
    expect(database.prepare('SELECT MAX(version) AS n FROM schema_version').get()).toEqual({
      n: 32
    })
    runMigrations(database)
    expect(database.prepare('SELECT * FROM product_desktop_credential').all()).toEqual(snapshot)
    expect(database.pragma('foreign_key_check')).toEqual([])
  })

  it('upgrades a populated v021 database without granting clients or changing legacy records', () => {
    testDirectory = mkdtempSync(join(tmpdir(), 'opspilot-clients-v021-'))
    const database = initializeDatabase(testDirectory)
    seedLegacyRows(database)
    const before = snapshotLegacy(database)
    database.exec(`DROP TABLE IF EXISTS product_environment_revision;DELETE FROM schema_version WHERE version=32;DROP TABLE IF EXISTS desktop_controller_authority_rebind;DELETE FROM schema_version WHERE version=31;DROP TABLE IF EXISTS desktop_controller_upgrade;DELETE FROM schema_version WHERE version=30;DROP TABLE IF EXISTS desktop_controller_installation;DELETE FROM schema_version WHERE version=29;DROP TABLE IF EXISTS desktop_target_setup;DROP TABLE IF EXISTS product_vps_registration;DELETE FROM schema_version WHERE version=28;DROP TABLE IF EXISTS desktop_project_setup;DELETE FROM schema_version WHERE version=27;DROP TABLE IF EXISTS product_project_registration;DELETE FROM schema_version WHERE version=26;DROP TABLE IF EXISTS desktop_controller_command;DELETE FROM schema_version WHERE version=25;DROP TABLE IF EXISTS desktop_controller_binding;DELETE FROM schema_version WHERE version=24;DROP TABLE product_api_request;DROP INDEX idx_product_desktop_client_identity;DELETE FROM schema_version WHERE version=23;
      DROP TABLE product_desktop_admin_request;DROP TABLE product_desktop_credential;
      DROP TABLE product_desktop_client;DELETE FROM schema_version WHERE version=22`)
    runMigrations(database)
    expect(snapshotLegacy(database)).toEqual(before)
    for (const table of [
      'product_desktop_client',
      'product_desktop_credential',
      'product_desktop_admin_request'
    ])
      expect(database.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 })
    expect(database.prepare('SELECT MAX(version) AS version FROM schema_version').get()).toEqual({
      version: 32
    })
    runMigrations(database)
    expect(snapshotLegacy(database)).toEqual(before)
    expect(database.pragma('foreign_key_check')).toEqual([])
  })

  it('adds a secret-free monotonic SSH security revision to an existing v018 VPS row', () => {
    testDirectory = mkdtempSync(join(tmpdir(), 'opspilot-vps-security-revision-'))
    const database = initializeDatabase(testDirectory)
    database
      .prepare(
        `INSERT INTO vps (id,name,host,username,auth_type,encrypted_secret)
      VALUES (99,'revision-test','host.example.test','principal-old','key',X'0102')`
      )
      .run()
    database.exec('DROP TRIGGER desktop_authority_rebind_insert')
    database.exec('ALTER TABLE vps DROP COLUMN ssh_security_revision')
    database.prepare('DELETE FROM schema_version WHERE version=19').run()

    runMigrations(database)

    expect(
      database
        .prepare('SELECT host,username,auth_type,ssh_security_revision FROM vps WHERE id=99')
        .get()
    ).toEqual({
      host: 'host.example.test',
      username: 'principal-old',
      auth_type: 'key',
      ssh_security_revision: 1
    })
    expect(database.prepare('SELECT MAX(version) AS version FROM schema_version').get()).toEqual({
      version: 32
    })
    expect(database.pragma('foreign_key_check')).toEqual([])
    runMigrations(database)
    expect(database.prepare('SELECT ssh_security_revision FROM vps WHERE id=99').get()).toEqual({
      ssh_security_revision: 1
    })
  })

  it('upgrades a v015 database without changing legacy rows or enrolling Product data, then reopens idempotently', () => {
    testDirectory = mkdtempSync(join(tmpdir(), 'opspilot-product-migration-'))
    const database = initializeDatabase(testDirectory)
    seedLegacyRows(database)
    const before = snapshotLegacy(database)
    downgradeToV015(database)

    runMigrations(database)
    const after = snapshotLegacy(database)
    expect(after).toEqual(before)
    expect(database.prepare('SELECT COUNT(*) AS n FROM product_target_enrollment').get()).toEqual({
      n: 0
    })
    expect(database.prepare('SELECT MAX(version) AS version FROM schema_version').get()).toEqual({
      version: 32
    })
    expect(database.prepare('SELECT COUNT(*) AS count FROM product_controller').get()).toEqual({
      count: 0
    })
    expect(database.prepare('SELECT COUNT(*) AS count FROM product_app_control').get()).toEqual({
      count: 0
    })
    expect(database.prepare('SELECT COUNT(*) AS count FROM product_desired_branch').get()).toEqual({
      count: 0
    })
    expect(database.prepare('SELECT COUNT(*) AS count FROM product_deploy_job').get()).toEqual({
      count: 0
    })
    expect(database.pragma('foreign_key_check')).toEqual([])

    const tableCount = (
      database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table'").get() as {
        count: number
      }
    ).count
    runMigrations(database)
    expect(database.prepare('SELECT MAX(version) AS version FROM schema_version').get()).toEqual({
      version: 32
    })
    expect(
      (
        database
          .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table'")
          .get() as { count: number }
      ).count
    ).toBe(tableCount)
    expect(snapshotLegacy(database)).toEqual(before)
  })

  it('fails closed on ambiguous v016 generation-bug state and preserves a different app history', () => {
    testDirectory = mkdtempSync(join(tmpdir(), 'opspilot-product-pause-v016-'))
    const database = initializeDatabase(testDirectory)
    seedLegacyRows(database)
    downgradeToV016(database)
    seedAmbiguousPauseHistory(database)

    runMigrations(database)

    expect(
      database
        .prepare(
          `SELECT auto_deploy_paused, pause_reason, pause_policy_provenance
      FROM product_app_control WHERE app_id=7`
        )
        .get()
    ).toEqual({
      auto_deploy_paused: 1,
      pause_reason: 'operator',
      pause_policy_provenance: 'operator_required'
    })
    expect(
      database
        .prepare(
          `SELECT auto_deploy_paused, pause_reason, pause_policy_provenance
      FROM product_app_control WHERE app_id=8`
        )
        .get()
    ).toEqual({
      auto_deploy_paused: 1,
      pause_reason: 'operator',
      pause_policy_provenance: 'legacy_inferred'
    })
    expect(database.prepare('SELECT MAX(version) AS version FROM schema_version').get()).toEqual({
      version: 32
    })
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM product_deploy_job WHERE trigger='branch_poll'")
        .get()
    ).toEqual({ count: 0 })
    expect(database.pragma('foreign_key_check')).toEqual([])
    expect(() =>
      database
        .prepare(
          `UPDATE product_app_control SET auto_deploy_paused=0,
      pause_reason=NULL WHERE app_id=7`
        )
        .run()
    ).toThrow(/explicit pause policy provenance required/)
  })

  it('fails closed upgrading already-v017 ambiguous data and preserves explicit post-018 resume on reopen', () => {
    testDirectory = mkdtempSync(join(tmpdir(), 'opspilot-product-pause-v017-'))
    const database = initializeDatabase(testDirectory)
    seedLegacyRows(database)
    downgradeMigration018ToV017(database)
    seedAmbiguousPauseHistory(database)
    database
      .prepare(
        `UPDATE product_app_control SET auto_deploy_paused=0, pause_reason=NULL WHERE app_id=7`
      )
      .run()

    runMigrations(database)
    expect(
      database
        .prepare(
          `SELECT auto_deploy_paused, pause_reason, pause_policy_provenance
      FROM product_app_control WHERE app_id=7`
        )
        .get()
    ).toEqual({
      auto_deploy_paused: 1,
      pause_reason: 'operator',
      pause_policy_provenance: 'operator_required'
    })

    database
      .prepare(
        `UPDATE product_app_control SET auto_deploy_paused=0, pause_reason=NULL,
      pause_policy_provenance='explicit' WHERE app_id=7`
      )
      .run()
    const policyBefore = database
      .prepare(
        `SELECT auto_deploy_paused, pause_policy_provenance
      FROM product_app_control WHERE app_id=7`
      )
      .get()
    closeDatabase()
    const reopened = initializeDatabase(testDirectory!)
    expect(
      reopened
        .prepare(
          `SELECT auto_deploy_paused, pause_policy_provenance
      FROM product_app_control WHERE app_id=7`
        )
        .get()
    ).toEqual(policyBefore)
    expect(
      reopened
        .prepare(
          `SELECT auto_deploy_paused, pause_policy_provenance
      FROM product_app_control WHERE app_id=8`
        )
        .get()
    ).toEqual({
      auto_deploy_paused: 1,
      pause_policy_provenance: 'operator_required'
    })
    expect(
      reopened
        .prepare("SELECT COUNT(*) AS count FROM product_deploy_job WHERE trigger='branch_poll'")
        .get()
    ).toEqual({ count: 0 })
  })

  it('rolls back the whole v016 DDL and version record when a later statement conflicts', () => {
    testDirectory = mkdtempSync(join(tmpdir(), 'opspilot-product-migration-fail-'))
    const database = initializeDatabase(testDirectory)
    downgradeToV015(database)
    database.exec('CREATE TABLE product_branch_observation (blocker INTEGER)')

    expect(() => runMigrations(database)).toThrow(/already exists/i)
    expect(database.prepare('SELECT MAX(version) AS version FROM schema_version').get()).toEqual({
      version: 15
    })
    for (const table of ['product_controller', 'product_source_config', 'product_app_control']) {
      expect(
        database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
      ).toBeUndefined()
    }
    expect(
      database
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='product_branch_observation'"
        )
        .get()
    ).toBeDefined()
    expect(database.pragma('foreign_key_check')).toEqual([])
  })

  it('enforces checked identities, references and both partial unique active slots without unique app/SHA', () => {
    testDirectory = mkdtempSync(join(tmpdir(), 'opspilot-product-constraints-'))
    const database = initializeDatabase(testDirectory)
    seedLegacyRows(database)
    database.exec(`
      INSERT INTO product_controller VALUES ('controller', 'now', 'active');
      INSERT INTO product_source_config VALUES (7, 1, 'https://example.test/repo.git', 'main', '.', '{}', '${'a'.repeat(64)}', 'now');
      INSERT INTO product_app_control
        (app_id, mode, controller_id, ownership_generation, source_generation, source_config_sha256, changed_at)
      VALUES (7, 'product', 'controller', 1, 1, '${'a'.repeat(64)}', 'now');
      INSERT INTO product_deploy_job (job_id, controller_id, app_id, ownership_generation,
        source_generation, source_config_sha256, trigger, idempotency_key, ref, target_sha,
        state, available_at, created_at, updated_at)
      VALUES ('job1', 'controller', 7, 1, 1, '${'a'.repeat(64)}', 'manual_redeploy', 'request-1', 'main', '${'b'.repeat(40)}', 'queued', 'now', 'now', 'now'),
             ('job2', 'controller', 7, 1, 1, '${'a'.repeat(64)}', 'manual_redeploy', 'request-2', 'main', '${'b'.repeat(40)}', 'queued', 'now', 'now', 'now');
      INSERT INTO product_app_fence (app_id) VALUES (7);
      INSERT INTO product_app_lease (app_id, lease_id, controller_id, ownership_generation, fence, job_id, acquired_at, expires_at, heartbeat_at)
        VALUES (7, 'app-lease-1', 'controller', 1, 1, 'job1', 'now', 'later', 'now');
      INSERT INTO product_worker_lease (slot_name, lease_id, controller_id, fence, job_id, acquired_at, expires_at, heartbeat_at)
        VALUES ('build', 'build-lease-1', 'controller', 1, 'job1', 'now', 'later', 'now');
    `)

    expect(() =>
      database
        .prepare(
          "INSERT INTO product_app_lease (app_id, lease_id, controller_id, ownership_generation, fence, job_id, acquired_at, expires_at, heartbeat_at) VALUES (7, 'app-lease-2', 'controller', 1, 2, 'job2', 'now', 'later', 'now')"
        )
        .run()
    ).toThrow(/one_active_product_lease_per_app|UNIQUE constraint failed/i)
    expect(() =>
      database
        .prepare(
          "INSERT INTO product_worker_lease (slot_name, lease_id, controller_id, fence, job_id, acquired_at, expires_at, heartbeat_at) VALUES ('build', 'build-lease-2', 'controller', 2, 'job2', 'now', 'later', 'now')"
        )
        .run()
    ).toThrow(/one_active_product_build_slot|UNIQUE constraint failed/i)
    expect(() =>
      database.prepare("INSERT INTO product_controller VALUES ('bad', 'now', 'unknown')").run()
    ).toThrow(/CHECK constraint failed/i)
    expect(() =>
      database
        .prepare(
          "INSERT INTO product_source_config VALUES (999, 1, 'x', 'main', '.', '{}', ?, 'now')"
        )
        .run('c'.repeat(64))
    ).toThrow(/FOREIGN KEY constraint failed/i)
    expect(
      database
        .prepare('SELECT COUNT(*) AS count FROM product_deploy_job WHERE target_sha=?')
        .get('b'.repeat(40))
    ).toEqual({ count: 2 })

    database
      .prepare("UPDATE product_app_lease SET released_at='released' WHERE lease_id='app-lease-1'")
      .run()
    database
      .prepare(
        "UPDATE product_worker_lease SET released_at='released' WHERE lease_id='build-lease-1'"
      )
      .run()
    expect(() =>
      database
        .prepare(
          "INSERT INTO product_app_lease (app_id, lease_id, controller_id, ownership_generation, fence, job_id, acquired_at, expires_at, heartbeat_at) VALUES (7, 'app-lease-2', 'controller', 1, 2, 'job2', 'now', 'later', 'now')"
        )
        .run()
    ).not.toThrow()
    expect(() =>
      database
        .prepare(
          "INSERT INTO product_worker_lease (slot_name, lease_id, controller_id, fence, job_id, acquired_at, expires_at, heartbeat_at) VALUES ('build', 'build-lease-2', 'controller', 2, 'job2', 'now', 'later', 'now')"
        )
        .run()
    ).not.toThrow()
    expect(database.pragma('foreign_key_check')).toEqual([])
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name IN ('one_active_product_lease_per_app','one_active_product_build_slot') ORDER BY name"
        )
        .all()
    ).toEqual([
      { name: 'one_active_product_build_slot' },
      { name: 'one_active_product_lease_per_app' }
    ])
  })
})

function downgradeToV015(database: Database.Database): void {
  database.exec(`
    DROP TABLE IF EXISTS product_environment_revision;DELETE FROM schema_version WHERE version=32;DROP TABLE IF EXISTS desktop_controller_authority_rebind;DELETE FROM schema_version WHERE version=31;DROP TABLE IF EXISTS desktop_controller_upgrade;DELETE FROM schema_version WHERE version=30;DROP TABLE IF EXISTS desktop_controller_installation;DELETE FROM schema_version WHERE version=29;DROP TABLE IF EXISTS desktop_target_setup;DROP TABLE IF EXISTS product_vps_registration;DELETE FROM schema_version WHERE version=28;DROP TABLE IF EXISTS desktop_project_setup;DELETE FROM schema_version WHERE version=27;DROP TABLE IF EXISTS product_project_registration;DELETE FROM schema_version WHERE version=26;DROP TABLE IF EXISTS desktop_controller_command;DELETE FROM schema_version WHERE version=25;DROP TABLE IF EXISTS desktop_controller_binding;DELETE FROM schema_version WHERE version=24;DROP TABLE IF EXISTS product_api_request;
    DROP INDEX IF EXISTS idx_product_desktop_client_identity;
    DELETE FROM schema_version WHERE version=23;
    DROP TABLE IF EXISTS product_desktop_admin_request;
    DROP TABLE IF EXISTS product_desktop_credential;
    DROP TABLE IF EXISTS product_desktop_client;
    DELETE FROM schema_version WHERE version=22;
    DROP TABLE IF EXISTS product_target_enrollment;
    DELETE FROM schema_version WHERE version=21;
    DROP TABLE IF EXISTS product_runtime_terminal;
    DROP TABLE IF EXISTS product_runtime_execution;
    DELETE FROM schema_version WHERE version=20;
    ALTER TABLE vps DROP COLUMN ssh_security_revision;
    DELETE FROM schema_version WHERE version=19;
    DROP TRIGGER product_app_control_pause_provenance_insert;
    DROP TRIGGER product_app_control_pause_provenance_update;
    ALTER TABLE product_app_control DROP COLUMN pause_policy_provenance;
    DELETE FROM schema_version WHERE version=18;
    DROP TRIGGER product_app_control_pause_policy_insert;
    DROP TRIGGER product_app_control_pause_policy_update;
    DROP TABLE product_history_event;
    DROP TABLE product_deploy_attempt;
    DROP TABLE product_worker_lease;
    DROP TABLE product_app_lease;
    DROP TABLE product_app_fence;
    DROP TABLE product_desired_branch;
    DROP TABLE product_deploy_job;
    DROP TABLE product_branch_observation;
    DROP TABLE product_app_control;
    DROP TABLE product_source_config;
    DROP TABLE product_controller;
    DELETE FROM schema_version WHERE version=17;
    DELETE FROM schema_version WHERE version=16;
  `)
}

function downgradeToV016(database: Database.Database): void {
  database.exec(`
    DROP TABLE IF EXISTS product_environment_revision;DELETE FROM schema_version WHERE version=32;DROP TABLE IF EXISTS desktop_controller_authority_rebind;DELETE FROM schema_version WHERE version=31;DROP TABLE IF EXISTS desktop_controller_upgrade;DELETE FROM schema_version WHERE version=30;DROP TABLE IF EXISTS desktop_controller_installation;DELETE FROM schema_version WHERE version=29;DROP TABLE IF EXISTS desktop_target_setup;DROP TABLE IF EXISTS product_vps_registration;DELETE FROM schema_version WHERE version=28;DROP TABLE IF EXISTS desktop_project_setup;DELETE FROM schema_version WHERE version=27;DROP TABLE IF EXISTS product_project_registration;DELETE FROM schema_version WHERE version=26;DROP TABLE IF EXISTS desktop_controller_command;DELETE FROM schema_version WHERE version=25;DROP TABLE IF EXISTS desktop_controller_binding;DELETE FROM schema_version WHERE version=24;DROP TABLE IF EXISTS product_api_request;
    DROP INDEX IF EXISTS idx_product_desktop_client_identity;
    DELETE FROM schema_version WHERE version=23;
    DROP TABLE IF EXISTS product_desktop_admin_request;
    DROP TABLE IF EXISTS product_desktop_credential;
    DROP TABLE IF EXISTS product_desktop_client;
    DELETE FROM schema_version WHERE version=22;
    DROP TABLE IF EXISTS product_target_enrollment;
    DELETE FROM schema_version WHERE version=21;
    DROP TABLE IF EXISTS product_runtime_terminal;
    DROP TABLE IF EXISTS product_runtime_execution;
    DELETE FROM schema_version WHERE version=20;
    ALTER TABLE vps DROP COLUMN ssh_security_revision;
    DELETE FROM schema_version WHERE version=19;
    DROP TRIGGER product_app_control_pause_provenance_insert;
    DROP TRIGGER product_app_control_pause_provenance_update;
    ALTER TABLE product_app_control DROP COLUMN pause_policy_provenance;
    DELETE FROM schema_version WHERE version=18;
    DROP TRIGGER product_app_control_pause_policy_insert;
    DROP TRIGGER product_app_control_pause_policy_update;
    ALTER TABLE product_app_control DROP COLUMN pause_reason;
    ALTER TABLE product_app_control DROP COLUMN auto_deploy_paused;
    DELETE FROM schema_version WHERE version=17;
  `)
}

function downgradeMigration018ToV017(database: Database.Database): void {
  database.exec(`
    DROP TABLE IF EXISTS product_environment_revision;DELETE FROM schema_version WHERE version=32;DROP TABLE IF EXISTS desktop_controller_authority_rebind;DELETE FROM schema_version WHERE version=31;DROP TABLE IF EXISTS desktop_controller_upgrade;DELETE FROM schema_version WHERE version=30;DROP TABLE IF EXISTS desktop_controller_installation;DELETE FROM schema_version WHERE version=29;DROP TABLE IF EXISTS desktop_target_setup;DROP TABLE IF EXISTS product_vps_registration;DELETE FROM schema_version WHERE version=28;DROP TABLE IF EXISTS desktop_project_setup;DELETE FROM schema_version WHERE version=27;DROP TABLE IF EXISTS product_project_registration;DELETE FROM schema_version WHERE version=26;DROP TABLE IF EXISTS desktop_controller_command;DELETE FROM schema_version WHERE version=25;DROP TABLE IF EXISTS desktop_controller_binding;DELETE FROM schema_version WHERE version=24;DROP TABLE IF EXISTS product_api_request;
    DROP INDEX IF EXISTS idx_product_desktop_client_identity;
    DELETE FROM schema_version WHERE version=23;
    DROP TABLE IF EXISTS product_desktop_admin_request;
    DROP TABLE IF EXISTS product_desktop_credential;
    DROP TABLE IF EXISTS product_desktop_client;
    DELETE FROM schema_version WHERE version=22;
    DROP TABLE IF EXISTS product_target_enrollment;
    DELETE FROM schema_version WHERE version=21;
    DROP TABLE IF EXISTS product_runtime_terminal;
    DROP TABLE IF EXISTS product_runtime_execution;
    DELETE FROM schema_version WHERE version=20;
    ALTER TABLE vps DROP COLUMN ssh_security_revision;
    DELETE FROM schema_version WHERE version=19;
    DROP TRIGGER product_app_control_pause_provenance_insert;
    DROP TRIGGER product_app_control_pause_provenance_update;
    ALTER TABLE product_app_control DROP COLUMN pause_policy_provenance;
    DELETE FROM schema_version WHERE version=18;
  `)
}

function seedAmbiguousPauseHistory(database: Database.Database): void {
  database.exec(`
    INSERT INTO app (id, vps_id, name, framework, host_port, container_port, source_type,
      git_repo_url, git_ref, git_root)
      VALUES (8, 7, 'second-app', 'express', 30008, 3000, 'git', 'https://example.test/second.git', 'main', '.');
    INSERT INTO product_controller VALUES ('controller', 'now', 'active');
    INSERT INTO product_source_config VALUES
      (7, 1, 'https://example.test/legacy.git', 'main', '.', '{}', '${'a'.repeat(64)}', 'old'),
      (7, 2, 'https://example.test/legacy.git', 'release', '.', '{}', '${'b'.repeat(64)}', 'new'),
      (8, 1, 'https://example.test/second.git', 'main', '.', '{}', '${'c'.repeat(64)}', 'current');
    INSERT INTO product_app_control
      (app_id, mode, controller_id, ownership_generation, source_generation, source_config_sha256, changed_at)
      VALUES (7, 'product', 'controller', 2, 2, '${'b'.repeat(64)}', 'new'),
             (8, 'product', 'controller', 1, 1, '${'c'.repeat(64)}', 'current');
    INSERT INTO product_desired_branch
      (app_id, source_generation, ref, desired_observation_sequence, desired_sha,
       reconcile_epoch, reconciliation_state, auto_paused, pause_reason, updated_at)
      VALUES (7, 1, 'main', 1, '${'1'.repeat(40)}', 0, 'paused', 1, 'manual_action', '2026-01-01'),
             (7, 2, 'release', 1, '${'2'.repeat(40)}', 0, 'queued', 0, NULL, '2026-01-02'),
             (8, 1, 'main', 1, '${'3'.repeat(40)}', 0, 'paused', 1, 'operator', '2026-01-01');
  `)
}

function seedLegacyRows(database: Database.Database): void {
  database.exec(`
    INSERT INTO vps (id, name, host, username, auth_type, encrypted_secret)
      VALUES (7, 'Legacy VPS', 'example.test', 'deploy', 'key', X'00');
    INSERT INTO app (id, vps_id, name, framework, host_port, container_port, source_type,
      git_repo_url, git_ref, git_root) VALUES (7, 7, 'legacy-app', 'express', 30007, 3000,
      'git', 'https://example.test/legacy.git', 'main', '.');
    INSERT INTO deployment (id, app_id, version, image_tag, status, git_commit_sha, git_repo_url)
      VALUES (7, 7, 1, 'legacy:v1', 'running', '${'e'.repeat(40)}', 'https://example.test/legacy.git');
    INSERT INTO monitor_setting (app_id, poll_interval_s) VALUES (7, 30);
  `)
}

function snapshotLegacy(database: Database.Database): unknown {
  return {
    vps: database.prepare('SELECT id, name, host FROM vps WHERE id=7').get(),
    app: database
      .prepare(
        'SELECT id, vps_id, name, source_type, git_repo_url, git_ref, git_root FROM app WHERE id=7'
      )
      .get(),
    deployment: database
      .prepare(
        'SELECT id, app_id, version, image_tag, status, git_commit_sha FROM deployment WHERE id=7'
      )
      .get(),
    monitor: database
      .prepare('SELECT app_id, poll_interval_s FROM monitor_setting WHERE app_id=7')
      .get()
  }
}
