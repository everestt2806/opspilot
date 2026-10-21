import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { closeDatabase, initializeDatabase } from './index'
import { ProductDeployRepository } from './productDeployRepository'

let testDirectory: string | null = null

afterEach(() => {
  closeDatabase()
  if (testDirectory) {
    rmSync(testDirectory, { recursive: true, force: true })
    testDirectory = null
  }
})

describe('ProductDeployRepository', () => {
  it('returns explicit absence and reads records by app and generation identity', () => {
    testDirectory = mkdtempSync(join(tmpdir(), 'opspilot-product-read-'))
    const database = initializeDatabase(testDirectory)
    seedApp(database, 1, 'one')
    seedApp(database, 2, 'two')
    database.exec(`
      INSERT INTO product_controller VALUES ('controller-1', 'now', 'active');
      INSERT INTO product_source_config VALUES
        (1, 1, 'https://example.test/one.git', 'main', '.', '{}', '${'a'.repeat(64)}', 'created-1'),
        (1, 2, 'https://example.test/one.git', 'release', 'sub', '{"build":"two"}', '${'b'.repeat(64)}', 'created-2'),
        (2, 1, 'https://example.test/two.git', 'main', '.', '{}', '${'c'.repeat(64)}', 'created-3');
      INSERT INTO product_app_control VALUES (1, 'product', 'controller-1', 4, 2, '${'b'.repeat(64)}', 'changed');
      INSERT INTO product_branch_observation VALUES (1, 2, 'release', 1, '${'d'.repeat(40)}', 'observed');
      INSERT INTO product_desired_branch (
        app_id, source_generation, ref, desired_observation_sequence, desired_sha,
        reconcile_epoch, reconciliation_state, auto_paused, updated_at
      ) VALUES (1, 2, 'release', 1, '${'d'.repeat(40)}', 3, 'pending', 0, 'updated');
    `)

    const repository = new ProductDeployRepository(database)
    expect(repository.getController('missing')).toEqual({ kind: 'absent' })
    expect(repository.getOwnership(2)).toEqual({ kind: 'absent' })
    expect(repository.getSourceConfig(1, 3)).toEqual({ kind: 'absent' })
    expect(repository.getDesiredState(2, 2, 'release')).toEqual({ kind: 'absent' })
    expect(repository.getOwnership(1)).toMatchObject({
      kind: 'present',
      value: { app_id: 1, mode: 'product', controller_id: 'controller-1', ownership_generation: 4 }
    })
    expect(repository.getSourceConfig(1, 2)).toMatchObject({
      kind: 'present',
      value: {
        app_id: 1,
        source_generation: 2,
        production_ref: 'release',
        config_sha256: 'b'.repeat(64)
      }
    })
    expect(repository.getSourceConfig(1, 1)).toMatchObject({
      kind: 'present',
      value: { source_generation: 1, production_ref: 'main' }
    })
    expect(repository.getDesiredState(1, 2, 'release')).toMatchObject({
      kind: 'present',
      value: {
        app_id: 1,
        desired_sha: 'd'.repeat(40),
        reconciliation_state: 'pending',
        auto_paused: false
      }
    })
    expect(repository.getLatestObservation(1, 2, 'release')).toMatchObject({
      kind: 'present',
      value: { app_id: 1, observation_sequence: 1 }
    })
    expect(repository.getLatestObservation(1, 2, 'main')).toEqual({ kind: 'absent' })

    expect(
      database.prepare('SELECT mode FROM product_app_control WHERE app_id = 2').get()
    ).toBeUndefined()
  })
})

function seedApp(database: ReturnType<typeof initializeDatabase>, id: number, name: string): void {
  database
    .prepare(
      `INSERT INTO vps (id, name, host, username, auth_type, encrypted_secret)
    VALUES (?, ?, ?, 'user', 'key', X'00')`
    )
    .run(id, `vps-${id}`, `host-${id}`)
  database
    .prepare(
      `INSERT INTO app (id, vps_id, name, framework, host_port, container_port)
    VALUES (?, ?, ?, 'express', ?, 3000)`
    )
    .run(id, id, name, 30000 + id)
}
