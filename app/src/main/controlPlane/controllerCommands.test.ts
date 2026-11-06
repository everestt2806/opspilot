import Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { initializeDatabase, closeDatabase } from '../db'
import { ProductDeployRepository } from '../db/productDeployRepository'
import { ControllerClientAuth } from './controllerClientAuth'
import { ControllerCommands } from './controllerCommands'
import type { ProductAutoDeployPolicyRequest } from '../../../../docs/contracts/product-controller-api'

let directory: string,
  db: ReturnType<typeof initializeDatabase>,
  commands: ControllerCommands,
  auth: ControllerClientAuth,
  header: string
const hash = createHash('sha256').update('{}').digest('hex'),
  sha = 'a'.repeat(40)
const body = {
  expected_ownership_generation: 1,
  expected_source_generation: 1,
  target: { kind: 'current_desired' }
}
const policy = (action: 'pause' | 'resume'): ProductAutoDeployPolicyRequest => ({
  expected_ownership_generation: 1,
  expected_source_generation: 1,
  action
})
const identity = {
  controllerId: 'commands-controller',
  appId: 1,
  ownershipGeneration: 1,
  sourceGeneration: 1,
  configSha256: hash,
  ref: 'main'
}
function issue(scopes: string[] = ['read', 'deploy:manual', 'policy:write']): {
  header: string
  client: string
} {
  const issued = auth.enroll({
    request_key: randomUUID(),
    display_name: 'Command unit',
    requested_scopes: scopes
  })
  if (issued.state !== 'issued_once') throw new Error('UNIT_CREDENTIAL_REQUIRED')
  return { header: `Bearer ${issued.credential.access_token}`, client: issued.client.client_id }
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'opspilot-commands-'))
  db = initializeDatabase(directory)
  const now = new Date().toISOString()
  db.prepare('INSERT INTO product_controller VALUES(?,?,?)').run(
    'commands-controller',
    now,
    'active'
  )
  db.prepare('INSERT INTO product_controller VALUES(?,?,?)').run(
    'foreign-controller',
    now,
    'active'
  )
  db.exec(`INSERT INTO vps(id,name,host,host_fingerprint,username,auth_type,encrypted_secret)
  VALUES(1,'unit','target.test','SHA256:${'A'.repeat(43)}','unit','key',X'0102');
  INSERT INTO app(id,vps_id,name,framework,host_port,container_port,source_type,git_repo_url,git_ref,git_root)
  VALUES(1,1,'command-app','express',30000,3000,'git','https://github.com/demo/app.git','main','.')`)
  db.prepare(
    `INSERT INTO product_source_config VALUES(1,1,'https://github.com/demo/app.git','main','.','{}',?,?)`
  ).run(hash, now)
  db.prepare(
    `INSERT INTO product_app_control(app_id,mode,controller_id,ownership_generation,source_generation,source_config_sha256,changed_at,
  auto_deploy_paused,pause_reason,pause_policy_provenance) VALUES(1,'product','commands-controller',1,1,?,?,1,'operator','explicit')`
  ).run(hash, now)
  new ProductDeployRepository(db).observeTip({
    ...identity,
    expectedObservationSequence: null,
    tipSha: sha
  })
  auth = new ControllerClientAuth(db, 'commands-controller', 'unix:1000')
  header = issue().header
  commands = new ControllerCommands(db, 'commands-controller', () => true)
})
afterEach(() => {
  closeDatabase()
  rmSync(directory, { recursive: true })
})
const count = (table: string): number =>
  (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n
describe('Controller durable manual commands', () => {
  it('keeps historical request lookup available after source generation changes while rejecting stale write replay', () => {
    const key = randomUUID()
    commands.redeploy(header, key, 1, body)
    db.prepare(
      `INSERT INTO product_source_config VALUES(1,2,'https://github.com/demo/app.git','main','.','{}',?,?)`
    ).run(hash, new Date().toISOString())
    db.exec('UPDATE product_app_control SET source_generation=2')
    expect(commands.lookup(header, key)).toMatchObject({
      found: true,
      status: { source_generation: 1, ownership_generation: 1, state: 'accepted' }
    })
    expect(() => commands.redeploy(header, key, 1, body)).toThrow('SOURCE_GENERATION_STALE')
    expect(count('product_api_request')).toBe(1)
  })
  it('queues once, pauses auto atomically, and returns original result after desired tip changes', () => {
    db.exec('UPDATE product_app_control SET auto_deploy_paused=0,pause_reason=NULL')
    const key = randomUUID(),
      result = commands.redeploy(header, key, 1, body)
    expect(result).toMatchObject({
      app_id: 1,
      target_sha: sha,
      state: 'queued',
      auto_deploy_paused: true
    })
    expect(
      db.prepare('SELECT auto_deploy_paused,pause_reason FROM product_app_control').get()
    ).toEqual({ auto_deploy_paused: 1, pause_reason: 'manual_action' })
    expect(
      db
        .prepare('SELECT state,trigger,target_sha FROM product_deploy_job WHERE job_id=?')
        .get(result.job_id)
    ).toEqual({ state: 'queued', trigger: 'manual_redeploy', target_sha: sha })
    new ProductDeployRepository(db).observeTip({
      ...identity,
      expectedObservationSequence: 1,
      tipSha: 'b'.repeat(40)
    })
    expect(commands.redeploy(header, key.toUpperCase(), 1, body)).toEqual(result)
    expect(count('product_api_request')).toBe(1)
    expect(
      db
        .prepare("SELECT count(*) AS n FROM product_deploy_job WHERE trigger='manual_redeploy'")
        .get()
    ).toEqual({ n: 1 })
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  })
  it('keeps idempotency across fresh SQLite connection and rejects changed action/body', () => {
    const key = randomUUID(),
      result = commands.redeploy(header, key, 1, body),
      cold = new Database(join(directory, 'opspilot.db'))
    try {
      const restarted = new ControllerCommands(cold, 'commands-controller', () => false)
      expect(restarted.redeploy(header, key, 1, body)).toEqual(result)
      expect(() =>
        restarted.redeploy(header, key, 1, { ...body, target: { kind: 'specific_sha', sha } })
      ).toThrow('IDEMPOTENCY_CONFLICT')
      expect(() => restarted.policy(header, key, 1, policy('pause'))).toThrow(
        'IDEMPOTENCY_CONFLICT'
      )
    } finally {
      cold.close()
    }
  })
  it('uses authenticated client namespace rather than caller actor and rechecks scope/revocation', () => {
    const key = randomUUID(),
      first = commands.redeploy(header, key, 1, body)
    const another = issue(),
      second = commands.redeploy(another.header, key, 1, body)
    expect(second.job_id).not.toBe(first.job_id)
    const readOnly = issue(['read'])
    expect(commands.lookup(readOnly.header, key)).toEqual({ found: false })
    expect(() => commands.redeploy(readOnly.header, key, 1, body)).toThrow('SCOPE_REQUIRED')
    auth.revoke({ request_key: randomUUID(), client_id: another.client })
    expect(() => commands.redeploy(another.header, key, 1, body)).toThrow('CLIENT_REVOKED')
    expect(() => commands.lookup(another.header, key)).toThrow('CLIENT_REVOKED')
    expect(() =>
      commands.redeploy(header, randomUUID(), 1, { ...body, client_id: readOnly.client })
    ).toThrow('REQUEST_INVALID')
  })
  it('checks current ownership/source generation before replay or disclosure', () => {
    const key = randomUUID()
    commands.redeploy(header, key, 1, body)
    expect(() =>
      commands.redeploy(header, randomUUID(), 1, { ...body, expected_ownership_generation: 2 })
    ).toThrow('OWNERSHIP_STALE')
    expect(() =>
      commands.redeploy(header, randomUUID(), 1, { ...body, expected_source_generation: 2 })
    ).toThrow('SOURCE_GENERATION_STALE')
    db.exec(
      "UPDATE product_app_control SET controller_id='foreign-controller',ownership_generation=2"
    )
    expect(() => commands.redeploy(header, key, 1, body)).toThrow('APP_NOT_FOUND')
    expect(() => commands.lookup(header, key)).toThrow('APP_NOT_FOUND')
  })
  it('allows only server-known SHA from matching repository/root, and does not guess absent desired target', () => {
    expect(() =>
      commands.redeploy(header, randomUUID(), 1, {
        ...body,
        target: { kind: 'specific_sha', sha: 'c'.repeat(40) }
      })
    ).toThrow('TARGET_SHA_UNAVAILABLE')
    expect(count('product_deploy_job')).toBe(0)
    const specific = commands.redeploy(header, randomUUID(), 1, {
      ...body,
      target: { kind: 'specific_sha', sha }
    })
    expect(specific.target_sha).toBe(sha)
    db.exec('DELETE FROM product_desired_branch')
    expect(() => commands.redeploy(header, randomUUID(), 1, body)).toThrow('NO_DESIRED_TARGET')
  })
  it('permits pause while readiness is blocked but forbids new deploy/resume until ready', () => {
    const blocked = new ControllerCommands(db, 'commands-controller', () => false)
    expect(() => blocked.redeploy(header, randomUUID(), 1, body)).toThrow('CAPABILITY_BLOCKED')
    const key = randomUUID(),
      paused = blocked.policy(header, key, 1, policy('pause'))
    expect(paused.auto_deploy_paused).toBe(true)
    expect(blocked.policy(header, key, 1, policy('pause'))).toEqual(paused)
    expect(() => blocked.policy(header, randomUUID(), 1, policy('resume'))).toThrow(
      'CAPABILITY_BLOCKED'
    )
    expect(commands.policy(header, randomUUID(), 1, policy('resume'))).toMatchObject({
      auto_deploy_paused: false,
      pause_policy_provenance: 'explicit'
    })
  })
  it('does not resume over queued manual work or dispatch-unknown and preserves leases', () => {
    const key = randomUUID(),
      result = commands.redeploy(header, key, 1, body)
    expect(() => commands.policy(header, randomUUID(), 1, policy('resume'))).toThrow(
      'CAPABILITY_BLOCKED'
    )
    const repository = new ProductDeployRepository(db),
      claimed = repository.claimNextJob('commands-controller')
    expect(claimed.state).toBe('claimed')
    if (claimed.state !== 'claimed') return
    const metadata = {
      repositoryUrl: 'https://github.com/demo/app.git',
      repositoryRoot: '.',
      commitSha: sha,
      sourceConfigSha256: hash
    }
    repository.markGitSnapshotVerified(claimed.claim, metadata)
    expect(repository.beginGitDispatch(claimed.claim, metadata).state).toBe('dispatch_authorized')
    const leases = db.prepare('SELECT * FROM product_app_lease').all()
    expect(() => commands.redeploy(header, randomUUID(), 1, body)).toThrow(
      'RECONCILIATION_REQUIRED'
    )
    expect(() => commands.policy(header, randomUUID(), 1, policy('resume'))).toThrow(
      'RECONCILIATION_REQUIRED'
    )
    expect(commands.policy(header, randomUUID(), 1, policy('pause')).auto_deploy_paused).toBe(true)
    expect(commands.redeploy(header, key, 1, body)).toEqual(result)
    expect(db.prepare('SELECT * FROM product_app_lease').all()).toEqual(leases)
  })
  it('rolls back pause/job/audit together if storing the request result fails, and preserves caller transaction', () => {
    db.exec('UPDATE product_app_control SET auto_deploy_paused=0,pause_reason=NULL')
    const before = count('product_history_event')
    db.exec(
      "CREATE TRIGGER fail_request BEFORE INSERT ON product_api_request BEGIN SELECT RAISE(ABORT,'UNIT_INJECTED_FAILURE');END"
    )
    expect(() => commands.redeploy(header, randomUUID(), 1, body)).toThrow('UNIT_INJECTED_FAILURE')
    expect(count('product_deploy_job')).toBe(0)
    expect(count('product_api_request')).toBe(0)
    expect(count('product_history_event')).toBe(before)
    expect(db.prepare('SELECT auto_deploy_paused FROM product_app_control').get()).toEqual({
      auto_deploy_paused: 0
    })
    db.exec('DROP TRIGGER fail_request;BEGIN IMMEDIATE')
    expect(() => commands.policy(header, randomUUID(), 1, policy('pause'))).toThrow(
      'REQUEST_INVALID'
    )
    expect(db.inTransaction).toBe(true)
    db.exec('ROLLBACK')
  })
  it('keeps request lookup scoped and derives status from its job without recording note or bearer', () => {
    const key = randomUUID(),
      result = commands.redeploy(header, key, 1, body)
    expect(commands.lookup(header, key)).toMatchObject({
      found: true,
      status: { state: 'accepted', job_id: result.job_id }
    })
    db.prepare(
      "UPDATE product_deploy_job SET state='failed',safe_error_code='GIT_UNAVAILABLE',updated_at=? WHERE job_id=?"
    ).run(new Date().toISOString(), result.job_id)
    expect(commands.lookup(header, key)).toMatchObject({
      found: true,
      status: { state: 'completed', reason_code: 'GIT_UNAVAILABLE' }
    })
    commands.policy(header, randomUUID(), 1, {
      ...policy('pause'),
      reason: 'unit-note-not-for-history'
    })
    for (const table of ['product_api_request', 'product_history_event']) {
      const data = JSON.stringify(db.prepare(`SELECT * FROM ${table}`).all())
      expect(data).not.toContain(header.slice(7))
      expect(data).not.toContain('unit-note-not-for-history')
    }
  })
  it('rejects overlong/control notes and malformed request metadata without creating work', () => {
    for (const note of ['🙂'.repeat(51), 'line\nbreak'])
      expect(() =>
        commands.policy(header, randomUUID(), 1, { ...policy('pause'), reason: note })
      ).toThrow('REQUEST_INVALID')
    expect(() => commands.redeploy(header, 'not-uuid', 1, body)).toThrow('REQUEST_INVALID')
    expect(() => commands.redeploy(header, randomUUID(), -1, body)).toThrow('REQUEST_INVALID')
    expect(count('product_api_request')).toBe(0)
    expect(count('product_deploy_job')).toBe(0)
  })
})
