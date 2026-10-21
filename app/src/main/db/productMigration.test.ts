import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import { closeDatabase, initializeDatabase, runMigrations } from './index'
import migration016 from './migrations/016_product_auto_deploy_persistence.sql?raw'

let testDirectory: string | null = null

afterEach(() => {
  closeDatabase()
  if (testDirectory) {
    rmSync(testDirectory, { recursive: true, force: true })
    testDirectory = null
  }
})

describe('Product persistence migration 016', () => {
  it('keeps the cumulative schema contract synchronized with migration 016', () => {
    const schema = readFileSync(
      new URL('../../../../docs/contracts/schema.sql', import.meta.url),
      'utf8'
    ).replaceAll('\r\n', '\n')
    expect(schema).toContain(migration016.replaceAll('\r\n', '\n').trim())
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
    expect(database.prepare('SELECT MAX(version) AS version FROM schema_version').get()).toEqual({
      version: 16
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
      version: 16
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
      INSERT INTO product_app_control VALUES (7, 'product', 'controller', 1, 1, '${'a'.repeat(64)}', 'now');
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
    DELETE FROM schema_version WHERE version=16;
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
