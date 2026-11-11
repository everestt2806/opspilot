import { createServer, type IncomingMessage, type Server } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach, expect, it } from 'vitest'
import { initializeDatabase, closeDatabase } from '../db'
import { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import { ControllerReadApi } from './controllerReadApi'
import { ControllerReadCursor } from './controllerReadCursor'
import { ControllerCommands } from './controllerCommands'
import { ControllerClientAuth } from './controllerClientAuth'
import { seedExposureFixture } from '../../../scripts/controller-exposure-lab/fixture'
import type { ProductExposureView } from '../../../../docs/contracts/product-exposure'

let directory: string,
  db: ReturnType<typeof initializeDatabase>,
  server: Server,
  api: ControllerReadApi,
  auth: ControllerClientAuth,
  header: string,
  url: string,
  ready: boolean,
  allowWrites: boolean,
  beforeBody: ((request: IncomingMessage) => void) | undefined
function issue(scopes: string[] = ['read', 'policy:write']): string {
  const issued = auth.enroll({
    request_key: randomUUID(),
    display_name: 'HTTP fixture',
    requested_scopes: scopes
  })
  if (issued.state !== 'issued_once') throw Error('FIXTURE_TOKEN_REQUIRED')
  return `Bearer ${issued.credential.access_token}`
}
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'opspilot-exposure-http-'))
  db = initializeDatabase(directory)
  const seed = seedExposureFixture(db, Date.now())
  seed.settle()
  auth = new ControllerClientAuth(db, seed.controllerId, 'unix:1000')
  header = issue()
  ready = true
  allowWrites = true
  beforeBody = undefined
  api = new ControllerReadApi(
    db,
    seed.controllerId,
    directory,
    new ControllerReadCursor(new AesGcmCredentialCipher(randomBytes(32)), seed.controllerId),
    () => ({
      service_state: ready ? 'ready' : 'degraded',
      last_branch_poll_at: null,
      reason_code: null
    }),
    {
      commands: new ControllerCommands(db, seed.controllerId, () => ready),
      acceptWrites: () => allowWrites
    }
  )
  server = createServer((req, res) => {
    beforeBody?.(req)
    if (!api.handle(req, res)) {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw Error('FIXTURE_PORT_REQUIRED')
  url = `http://127.0.0.1:${address.port}/v1/controllers/${seed.controllerId}/apps/1/exposure`
})
afterEach(async () => {
  await api.close()
  server.closeAllConnections()
  await new Promise<void>((done, fail) => server.close((error) => (error ? fail(error) : done())))
  closeDatabase()
  rmSync(directory, { recursive: true })
})
const read = async (): Promise<ProductExposureView> => {
  const response = await fetch(url, { headers: { authorization: header } })
  expect(response.status).toBe(200)
  return (await response.json()) as ProductExposureView
}
it('root upgrade gate blocks policy writes and advertises blocked capabilities before app lookup or body dispatch', async () => {
  allowWrites = false
  const before = db.prepare('SELECT * FROM product_app_control').all()
  const denied = await fetch(url.replace(/\/exposure$/, '/auto-deploy-policy'), {
    method: 'POST',
    headers: {
      authorization: header,
      'content-type': 'application/json',
      'idempotency-key': randomUUID()
    },
    body: JSON.stringify({
      expected_ownership_generation: 1,
      expected_source_generation: 1,
      action: 'pause'
    })
  })
  expect(denied.status).toBe(503)
  expect((await denied.json()).error.code).toBe('CAPABILITY_BLOCKED')
  expect(db.prepare('SELECT * FROM product_app_control').all()).toEqual(before)
  expect(db.prepare('SELECT count(*) n FROM product_api_request').get()).toEqual({ n: 0 })
  const capabilities = await fetch(url.replace('/apps/1/exposure', '/capabilities'), {
    headers: { authorization: header }
  })
  expect((await capabilities.json()).pause_auto_deploy).toEqual({
    state: 'blocked',
    reason_code: 'CONTROLLER_NOT_READY'
  })
})
const body = (view: ProductExposureView): Record<string, unknown> => ({
  deployment_id: view.context!.deployment_id,
  authority_sha256: view.context!.authority_sha256,
  previous_observation_id: view.context!.previous_observation_id,
  observer: 'desktop_external',
  started_at: new Date().toISOString(),
  checked_at: new Date().toISOString(),
  outcome: 'reachable',
  http_status: 200,
  reason: 'none'
})
const post = (input: unknown, authorization = header, key = randomUUID()): Promise<Response> =>
  fetch(url, {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify(input)
  })
it('serves authenticated canonical context and persists a bounded observation through actual HTTP/SQLite', async () => {
  const before = await read(),
    key = randomUUID(),
    input = body(before)
  expect(before.status).toBe('not_checked')
  const response = await post(input, header, key)
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  const after = await response.json()
  expect(after).toMatchObject({
    controller_id: 'exposure-fixture',
    app_id: 1,
    status: 'reachable',
    observation: { observation_id: key }
  })
  expect(await read()).toMatchObject({ status: 'reachable' })
  expect(db.prepare('SELECT exposure_status,status FROM deployment').get()).toEqual({
    exposure_status: 'reachable',
    status: 'running'
  })
  expect((await post(input, header, key)).status).toBe(200)
})
it('keeps read scopes unable to write and rejects missing auth before reading the body', async () => {
  const input = body(await read())
  expect((await post(input, issue(['read']))).status).toBe(403)
  expect((await post(input, '')).status).toBe(401)
  expect(db.prepare('SELECT exposure_evidence_json FROM deployment').get()).toEqual({
    exposure_evidence_json: null
  })
})
it('rechecks credential revocation after an asynchronous body read', async () => {
  const input = body(await read())
  beforeBody = (req) => {
    if (req.method === 'POST')
      queueMicrotask(() =>
        db.exec("UPDATE product_desktop_client SET revoked_at='2026-01-01T00:00:00.000Z'")
      )
  }
  const response = await post(input)
  expect(response.status).toBe(401)
  expect(await response.json()).toMatchObject({ error: { code: 'CLIENT_REVOKED' } })
})
it('rejects changed current authority and simultaneous CAS without returning credential material', async () => {
  const input = body(await read())
  expect((await post(input)).status).toBe(200)
  const rejected = await post(input)
  expect(rejected.status).toBe(409)
  expect(JSON.stringify(await rejected.json())).not.toContain(header.slice(7))
  db.exec('UPDATE vps SET ssh_security_revision=2')
  const changed = await post(input)
  expect(changed.status).toBe(409)
  expect(await changed.json()).toMatchObject({ error: { code: 'EXPOSURE_CONTEXT_CHANGED' } })
})
it('blocks injection, stale clocks and degraded controller writes through existing safe error DTOs', async () => {
  const input = body(await read())
  const injected = await post({ ...input, url: 'http://127.0.0.1/private' })
  expect(injected.status).toBe(400)
  const stale = await post({ ...input, started_at: '2000-01-01T00:00:00.000Z' })
  expect(stale.status).toBe(409)
  expect(await stale.json()).toMatchObject({ error: { code: 'EXPOSURE_OBSERVATION_STALE' } })
  ready = false
  expect((await post(input)).status).toBe(503)
})
it('rejects browser-origin and oversize bodies without storing or running a deployment', async () => {
  const input = body(await read())
  expect(
    (
      await fetch(url, {
        method: 'POST',
        headers: {
          authorization: header,
          origin: 'https://fixture.test',
          'content-type': 'application/json',
          'idempotency-key': randomUUID()
        },
        body: JSON.stringify(input)
      })
    ).status
  ).toBe(400)
  expect((await post({ ...input, padding: 'X'.repeat(20000) })).status).toBe(413)
  expect(db.prepare('SELECT count(*) n FROM product_deploy_job').get()).toEqual({ n: 1 })
})
