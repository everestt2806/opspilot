import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { initializeDatabase, closeDatabase } from '../db'
import { ControllerStartupRecovery } from './controllerStartupRecovery'
import type { VerifiedControllerBundle } from './controllerBundle'

let directory: string
let database: ReturnType<typeof initializeDatabase>
let recovery: ControllerStartupRecovery
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'opspilot-startup-unit-'))
  database = initializeDatabase(directory)
  database.exec(`INSERT INTO product_controller VALUES ('unit-controller','2026-11-06T00:00:00Z','active');
    INSERT INTO vps(id,name,host,username,auth_type,encrypted_secret) VALUES(1,'unit','unit.test','unit','key',X'00')`)
  recovery = new ControllerStartupRecovery(
    database,
    directory,
    'unit-controller',
    {} as VerifiedControllerBundle
  )
})
afterEach(() => {
  closeDatabase()
  rmSync(directory, { recursive: true })
})
function owner(id: number, paused: number): void {
  const hash = 'a'.repeat(64)
  database
    .prepare(
      `INSERT INTO app(id,vps_id,name,framework,host_port,container_port) VALUES(?,1,?,'express',?,3000)`
    )
    .run(id, `unit-${id}`, 30000 + id)
  database
    .prepare(
      `INSERT INTO product_source_config VALUES(?,1,'https://github.com/demo/app','main','.','{}',?,'2026-11-06T00:00:00Z')`
    )
    .run(id, hash)
  database
    .prepare(
      `INSERT INTO product_app_control(app_id,mode,controller_id,ownership_generation,source_generation,source_config_sha256,changed_at,auto_deploy_paused,pause_reason,pause_policy_provenance)
    VALUES(?,'product','unit-controller',1,1,?,'2026-11-06T00:00:00Z',?,?,?)`
    )
    .run(id, hash, paused, paused ? 'operator' : null, 'explicit')
}
describe('Cold startup admission barrier', () => {
  it('leaves a never-enrolled paused draft alone, but blocks an enabled app without proof', async () => {
    owner(1, 1)
    expect(await recovery.run(new AbortController().signal)).toMatchObject({
      state: 'ready',
      inspected_enrollments: 0,
      recovered_terminals: 0
    })
    expect(recovery.isReady()).toBe(true)
    owner(2, 0)
    const report = await recovery.run(new AbortController().signal)
    expect(report.state).toBe('reconciliation_required')
    expect(report.blockers).toEqual([
      { app_id: 2, attempt_id: null, reason: 'enrollment_not_ready' }
    ])
    expect(recovery.isReady()).toBe(false)
    expect(database.prepare('SELECT count(*) AS n FROM product_target_enrollment').get()).toEqual({
      n: 0
    })
  })
  it('bounds scanning without creating target material or partial recovery', async () => {
    database.transaction(() => {
      for (let id = 1; id <= 101; id++) owner(id, 1)
    })()
    expect(await recovery.run(new AbortController().signal)).toMatchObject({
      state: 'reconciliation_required',
      inspected_enrollments: 0,
      blockers: [{ app_id: null, attempt_id: null, reason: 'scan_limit' }]
    })
    expect(recovery.isReady()).toBe(false)
  })
  it('keeps admission closed on abort or lost controller authority', async () => {
    const abort = new AbortController()
    abort.abort()
    expect((await recovery.run(abort.signal)).state).toBe('aborted')
    expect(recovery.isReady()).toBe(false)
    database.exec("UPDATE product_controller SET status='revoked'")
    expect(await recovery.run(new AbortController().signal)).toMatchObject({
      state: 'reconciliation_required',
      blockers: [{ reason: 'authority_unavailable' }]
    })
    expect(recovery.isReady()).toBe(false)
  })
})
