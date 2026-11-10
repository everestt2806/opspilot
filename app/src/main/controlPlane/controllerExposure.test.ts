import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach, expect, it } from 'vitest'
import { initializeDatabase, closeDatabase } from '../db'
import { ControllerExposure } from './controllerExposure'
import { ControllerClientAuth } from './controllerClientAuth'
import { seedExposureFixture } from '../../../scripts/controller-exposure-lab/fixture'
import type {
  ProductExposureContext,
  ProductExposureObservationInput
} from '../../../../docs/contracts/product-exposure'

let db: ReturnType<typeof initializeDatabase>,
  directory: string,
  repository: ControllerExposure,
  auth: ControllerClientAuth,
  header: string,
  controller: string,
  now: number,
  ready: boolean,
  settle: () => void
const issue = (scopes = ['read', 'policy:write']): string => {
  const result = auth.enroll({
    request_key: randomUUID(),
    display_name: 'fixture',
    requested_scopes: scopes
  })
  if (result.state !== 'issued_once') throw Error('FIXTURE_TOKEN_REQUIRED')
  return `Bearer ${result.credential.access_token}`
}
beforeEach(() => {
  now = Date.now()
  ready = true
  directory = mkdtempSync(join(tmpdir(), 'opspilot-exposure-'))
  db = initializeDatabase(directory)
  const fixture = seedExposureFixture(db, now)
  controller = fixture.controllerId
  settle = fixture.settle
  auth = new ControllerClientAuth(db, controller, 'unix:1000', () => now)
  header = issue()
  repository = new ControllerExposure(
    db,
    controller,
    () => ready,
    () => now
  )
})
afterEach(() => {
  closeDatabase()
  rmSync(directory, { recursive: true })
})
const input = (context: ProductExposureContext): ProductExposureObservationInput => ({
  deployment_id: context.deployment_id,
  authority_sha256: context.authority_sha256,
  previous_observation_id: context.previous_observation_id,
  observer: 'desktop_external',
  started_at: new Date(now - 200).toISOString(),
  checked_at: new Date(now).toISOString(),
  outcome: 'reachable',
  http_status: 200,
  reason: 'none'
})
const prepare = (): ProductExposureContext => {
  settle()
  return repository.read(header, 1).context!
}
const raw = (): unknown =>
  db
    .prepare('SELECT exposure_status,exposure_evidence_json,status FROM deployment WHERE id=1')
    .get()
it('requires real H2 settlement; persists only exposure metadata and leaves signed terminal/runtime/policy unchanged', () => {
  expect(repository.read(header, 1)).toMatchObject({
    context: null,
    unavailable_reason: 'runtime_unsettled'
  })
  const context = prepare()
  expect(context.url).toBe('http://203.0.113.10:30000')
  const before = db.prepare('SELECT * FROM product_runtime_terminal').all()
  const view = repository.record(header, randomUUID(), 1, input(context))
  expect(view).toMatchObject({
    status: 'reachable',
    freshness: 'current',
    observation: { observer: 'desktop_external', http_status: 200 }
  })
  expect(raw()).toMatchObject({ exposure_status: 'reachable', status: 'running' })
  expect(db.prepare('SELECT * FROM product_runtime_terminal').all()).toEqual(before)
  expect(db.prepare('SELECT state FROM product_deploy_job').get()).toEqual({ state: 'succeeded' })
  expect(db.prepare('SELECT state FROM deployment_activation').get()).toEqual({ state: 'active' })
})
it('keeps unreachable degraded without changing runtime and represents unsafe/aborted checks as not_checked', () => {
  let context = prepare()
  repository.record(header, randomUUID(), 1, {
    ...input(context),
    outcome: 'unreachable',
    http_status: null,
    reason: 'timeout'
  })
  expect(raw()).toMatchObject({ exposure_status: 'degraded', status: 'running' })
  now += 1000
  context = repository.read(header, 1).context!
  const result = repository.record(header, randomUUID(), 1, {
    ...input(context),
    outcome: 'not_run',
    http_status: null,
    reason: 'unsafe_target'
  })
  expect(result.status).toBe('not_checked')
})
it('expires display evidence without altering history or fabricating a fresh green badge', () => {
  const context = prepare()
  repository.record(header, randomUUID(), 1, input(context))
  const before = raw()
  now += 60001
  expect(repository.read(header, 1)).toMatchObject({
    status: 'not_checked',
    freshness: 'stale',
    observation: { status: 'reachable' }
  })
  expect(raw()).toEqual(before)
})
it('replays only exact latest client/key/body and uses previous-observation CAS for racing requests', () => {
  const context = prepare(),
    body = input(context),
    key = randomUUID()
  repository.record(header, key, 1, body)
  const before = raw()
  now += 100
  expect(repository.record(header, key, 1, body).observation!.observation_id).toBe(key)
  expect(raw()).toEqual(before)
  expect(() => repository.record(header, key, 1, { ...body, http_status: 201 })).toThrow(
    'IDEMPOTENCY_CONFLICT'
  )
  expect(() => repository.record(issue(), key, 1, body)).toThrow('IDEMPOTENCY_CONFLICT')
  expect(() => repository.record(header, randomUUID(), 1, body)).toThrow('EXPOSURE_CONTEXT_CHANGED')
})
it.each(['expired', 'future', 'reversed'] as const)(
  'rejects %s observation clocks without storing evidence',
  (kind) => {
    const context = prepare(),
      body = input(context)
    if (kind === 'expired') body.started_at = new Date(now - 30001).toISOString()
    if (kind === 'future') body.checked_at = new Date(now + 5001).toISOString()
    if (kind === 'reversed') body.checked_at = new Date(now - 201).toISOString()
    expect(() => repository.record(header, randomUUID(), 1, body)).toThrow(
      'EXPOSURE_OBSERVATION_STALE'
    )
    expect(raw()).toMatchObject({ exposure_status: 'not_checked', exposure_evidence_json: null })
  }
)
it.each([
  'ownership',
  'source',
  'target',
  'deployment',
  'port',
  'container_port',
  'health_path',
  'runtime_context'
] as const)('fences changed %s after the network probe', (kind) => {
  const context = prepare(),
    body = input(context)
  if (kind === 'ownership') db.exec('UPDATE product_app_control SET ownership_generation=2')
  if (kind === 'source') db.exec("UPDATE product_app_control SET mode='desktop',controller_id=NULL")
  if (kind === 'target') db.exec('UPDATE vps SET ssh_security_revision=2')
  if (kind === 'deployment') db.exec('UPDATE app SET current_deployment_id=NULL')
  if (kind === 'port') db.exec('UPDATE app SET host_port=30001')
  if (kind === 'container_port') db.exec('UPDATE app SET container_port=4000')
  if (kind === 'health_path') db.exec("UPDATE app SET healthcheck_path='/changed'")
  if (kind === 'runtime_context') db.exec("UPDATE product_runtime_execution SET context_json='{}'")
  expect(() => repository.record(header, randomUUID(), 1, body)).toThrow(
    kind === 'source' ? 'APP_NOT_FOUND' : 'EXPOSURE_CONTEXT_CHANGED'
  )
  expect(raw()).toMatchObject({ exposure_evidence_json: null })
})
it('blocks prepared activation and unknown/active execution; never steals or releases a lease', () => {
  const context = prepare(),
    body = input(context)
  db.exec('UPDATE product_app_lease SET released_at=NULL')
  expect(repository.read(header, 1).unavailable_reason).toBe('execution_active')
  expect(() => repository.record(header, randomUUID(), 1, body)).toThrow('EXPOSURE_CONTEXT_CHANGED')
  expect(db.prepare('SELECT released_at FROM product_app_lease').get()).toEqual({
    released_at: null
  })
})
it('requires write scope and current credential after body reading, including revocation', () => {
  const context = prepare(),
    body = input(context),
    read = issue(['read'])
  expect(repository.read(read, 1).context).toEqual(context)
  expect(() => repository.record(read, randomUUID(), 1, body)).toThrow('SCOPE_REQUIRED')
  db.exec("UPDATE product_desktop_client SET revoked_at='2026-01-01T00:00:00.000Z'")
  expect(() => repository.record(header, randomUUID(), 1, body)).toThrow('CLIENT_REVOKED')
})
it.each(['url', 'secret', 'http_mismatch', 'scope', 'extra'] as const)(
  'rejects injected %s before metadata write',
  (kind) => {
    const context = prepare(),
      body: Record<string, unknown> = { ...input(context) }
    if (kind === 'http_mismatch') body.http_status = 503
    else if (kind === 'scope') body.observer = 'controller_local'
    else body[kind] = 'fixture-redacted'
    expect(() => repository.record(header, randomUUID(), 1, body)).toThrow('REQUEST_INVALID')
  }
)
it('does not accept legacy/corrupt evidence as verified current state and refuses caller-owned transactions', () => {
  const context = prepare()
  db.exec(
    `UPDATE deployment SET exposure_status='reachable',exposure_evidence_json='{"status":"reachable"}'`
  )
  expect(repository.read(header, 1).status).toBe('not_checked')
  db.exec('BEGIN')
  expect(() => repository.record(header, randomUUID(), 1, input(context))).toThrow(
    'REQUEST_INVALID'
  )
  expect(db.inTransaction).toBe(true)
  db.exec('ROLLBACK')
})
