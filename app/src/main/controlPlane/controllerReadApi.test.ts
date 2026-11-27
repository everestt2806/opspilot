import { createServer, request as httpRequest, type Server } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { initializeDatabase, closeDatabase } from '../db'
import { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import { ControllerClientAuth } from './controllerClientAuth'
import { ControllerReadCursor } from './controllerReadCursor'
import { ControllerReadApi } from './controllerReadApi'
import { ProductDeployRepository } from '../db/productDeployRepository'

let directory: string,
  db: ReturnType<typeof initializeDatabase>,
  server: Server,
  url: string,
  token: string,
  clientId: string,
  auth: ControllerClientAuth
const prefix = '/v1/controllers/controller-a'
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'opspilot-read-api-'))
  db = initializeDatabase(directory)
  db.exec(`INSERT INTO product_controller VALUES('controller-a','2026-11-06T00:00:00.000Z','active'),('controller-b','2026-11-06T00:00:00.000Z','active');
  INSERT INTO vps(id,name,host,username,auth_type,encrypted_secret) VALUES(1,'unit','127.0.0.1','unit','key',X'010203')`)
  auth = new ControllerClientAuth(db, 'controller-a', 'unix:1000')
  const issued = auth.enroll({
    request_key: randomUUID(),
    display_name: 'Read API unit',
    requested_scopes: ['read']
  })
  if (issued.state !== 'issued_once') throw new Error('UNIT_ISSUE_REQUIRED')
  token = issued.credential.access_token
  clientId = issued.client.client_id
  const cursor = new ControllerReadCursor(
    new AesGcmCredentialCipher(randomBytes(32)),
    'controller-a'
  )
  const api = new ControllerReadApi(db, 'controller-a', directory, cursor, () => ({
    service_state: 'degraded',
    last_branch_poll_at: null,
    reason_code: 'resource_unknown'
  }))
  server = createServer((req, res) => {
    if (!api.handle(req, res)) {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('UNIT_LISTENER_REQUIRED')
  url = `http://127.0.0.1:${address.port}`
})
afterEach(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
  closeDatabase()
  rmSync(directory, { recursive: true })
})
function app(id: number, controller = 'controller-a'): void {
  const hash = 'a'.repeat(64)
  db.prepare(
    `INSERT INTO app(id,vps_id,name,framework,host_port,container_port,source_type,git_repo_url,git_ref,git_root)
  VALUES(?,1,?,'express',?,3000,'git','https://github.com/demo/app.git','main','.')`
  ).run(id, `read-app-${id}`, 30000 + id)
  db.prepare(
    `INSERT INTO product_source_config VALUES(?,1,'https://github.com/demo/app.git','main','.','{}',?,'2026-11-06T00:00:00.000Z')`
  ).run(id, hash)
  db.prepare(
    `INSERT INTO product_app_control(app_id,mode,controller_id,ownership_generation,source_generation,source_config_sha256,changed_at)
  VALUES(?,'product',?,1,1,?,'2026-11-06T00:00:00.000Z')`
  ).run(id, controller, hash)
}
function job(appId: number, id: string): void {
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO product_deploy_job(job_id,controller_id,app_id,ownership_generation,source_generation,source_config_sha256,trigger,
  idempotency_key,ref,target_sha,state,available_at,created_at,updated_at) VALUES(?,'controller-a',?,1,1,?,'manual_redeploy',?,'main',?,'queued',?,?,?)`
  ).run(id, appId, 'a'.repeat(64), id, 'b'.repeat(40), now, now, now)
}
const get = (
  path: string,
  headers: Record<string, string> = { authorization: `Bearer ${token}` }
): Promise<Response> => fetch(url + path, { headers })
describe('Authenticated loopback controller reads', () => {
  it('reads a canonical prepared Product deployment and nullable rollback target without inventing runtime success', async () => {
    app(1)
    job(1, 'canonical-job')
    db.prepare('UPDATE vps SET host_fingerprint=? WHERE id=1').run(`SHA256:${'A'.repeat(43)}`)
    const repository = new ProductDeployRepository(db),
      claimed = repository.claimNextJob('controller-a')
    expect(claimed.state).toBe('claimed')
    if (claimed.state !== 'claimed') return
    expect(
      repository.markGitSnapshotVerified(claimed.claim, {
        repositoryUrl: 'https://github.com/demo/app.git',
        repositoryRoot: '.',
        commitSha: 'b'.repeat(40),
        sourceConfigSha256: 'a'.repeat(64)
      }).state
    ).toBe('snapshot_verified')
    const dispatched = repository.beginGitDispatch(claimed.claim, {
      repositoryUrl: 'https://github.com/demo/app.git',
      repositoryRoot: '.',
      commitSha: 'b'.repeat(40),
      sourceConfigSha256: 'a'.repeat(64)
    })
    expect(dispatched.state).toBe('dispatch_authorized')
    if (dispatched.state !== 'dispatch_authorized') return
    const list = await (await get(prefix + '/apps/1/deployments')).json()
    expect(list.items).toHaveLength(1)
    expect(list.items[0]).toMatchObject({
      deployment_id: dispatched.deployment_id,
      app_id: 1,
      status: 'building',
      commit_sha: 'b'.repeat(40),
      job_id: 'canonical-job',
      attempt_id: claimed.claim.attempt_id
    })
    const detail = await (await get(prefix + '/apps/1')).json()
    expect(detail.current_deployment_id).toBeNull()
    expect(detail.latest_job_state).toBe('deploying')
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO product_deploy_job(job_id,controller_id,app_id,ownership_generation,source_generation,source_config_sha256,trigger,idempotency_key,ref,target_deployment_id,state,available_at,created_at,updated_at)
      VALUES('null-sha-job','controller-a',1,1,1,?,'manual_rollback','unit-rollback','main',?,'queued',?,?,?)`
    ).run('a'.repeat(64), dispatched.deployment_id, now, now, now)
    const jobs = await (await get(prefix + '/apps/1/jobs')).json()
    expect(jobs.items.find((j) => j.job_id === 'null-sha-job').target_sha).toBeNull()
  })
  it('requires bearer before controller/resource disclosure and fails immediately after revoke', async () => {
    app(1)
    expect((await get(prefix + '/apps', {})).status).toBe(401)
    const foreign = await get('/v1/controllers/controller-b/apps')
    expect(foreign.status).toBe(403)
    expect((await foreign.json()).error.code).toBe('CONTROLLER_MISMATCH')
    expect((await get(prefix + '/apps')).status).toBe(200)
    auth.revoke({ request_key: randomUUID(), client_id: clientId })
    const revoked = await get(prefix + '/apps')
    expect(revoked.status).toBe(401)
    expect((await revoked.json()).error.code).toBe('CLIENT_REVOKED')
  })
  it('rejects repeated authorization, browser origin, URL token, request bodies and malformed queries', async () => {
    const repeated = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(
        url + prefix + '/identity',
        {
          headers: [
            'Host',
            new URL(url).host,
            'Authorization',
            `Bearer ${token}`,
            'Authorization',
            `Bearer ${token}`
          ]
        },
        (res) => {
          res.resume()
          res.once('end', () => resolve(res.statusCode))
        }
      )
      req.once('error', reject)
      req.end()
    })
    expect(repeated).toBe(401)
    expect(
      (
        await get(prefix + '/identity', {
          authorization: `Bearer ${token}`,
          origin: 'https://evil.test'
        })
      ).status
    ).toBe(400)
    expect((await get(prefix + '/apps?access_token=unit')).status).toBe(400)
    for (const query of [
      'limit=0',
      'limit=101',
      'limit=1&limit=2',
      'limit=1.5',
      'limit=',
      'other=1',
      'cursor=garbage'
    ])
      expect((await get(prefix + '/apps?' + query)).status).toBe(400)
    const body = await fetch(url + prefix + '/apps/1/redeploy', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: '{}'
    })
    expect(body.status).toBe(400)
  })
  it('reports real capability/status and never marks unsupported mutation available', async () => {
    app(1)
    job(1, 'job-queued')
    const identity = await (await get(prefix + '/identity')).json()
    expect(identity).toMatchObject({
      controller_id: 'controller-a',
      api_version: 'v1',
      api_bind_address: '127.0.0.1',
      service_state: 'degraded',
      data_freshness: 'current'
    })
    const status = await (await get(prefix + '/status')).json()
    expect(status).toMatchObject({
      service_state: 'degraded',
      queued_job_count: 1,
      active_job_count: 0,
      uncertain_job_count: 0,
      last_branch_poll_at: null,
      next_branch_poll_at: null
    })
    const capabilities = await (await get(prefix + '/capabilities')).json()
    expect(capabilities.read.state).toBe('available')
    for (const key of ['manual_redeploy', 'pause_auto_deploy', 'resume_auto_deploy'])
      expect(capabilities[key]).toEqual({ state: 'unsupported', reason_code: 'NOT_IMPLEMENTED' })
    expect((await get(prefix + '/requests/' + randomUUID())).status).toBe(501)
  })
  it('pages apps by bounded keyset and rechecks current owner on each page', async () => {
    app(1)
    app(2)
    app(4, 'controller-b')
    const first = await (await get(prefix + '/apps?limit=1')).json()
    expect(first.items.map((a) => a.app_id)).toEqual([1])
    expect(first.has_more).toBe(true)
    app(3) // Outside first-page ceiling, cannot enter an existing traversal.
    const second = await (await get(prefix + '/apps?limit=1&cursor=' + first.next_cursor)).json()
    expect(second.items.map((a) => a.app_id)).toEqual([2])
    expect(second.has_more).toBe(false)
    db.exec(
      "UPDATE product_app_control SET controller_id='controller-b',ownership_generation=2 WHERE app_id=2"
    )
    const changed = await (await get(prefix + '/apps?limit=1&cursor=' + first.next_cursor)).json()
    expect(changed.items).toEqual([])
    expect((await get(prefix + '/apps/2')).status).toBe(404)
    const tampered = first.next_cursor.slice(0, -2) + 'AA'
    expect((await get(prefix + '/apps?cursor=' + tampered)).status).toBe(400)
  })
  it('does not fall back to an unrelated deployment and only returns allowlisted fields', async () => {
    app(1)
    app(2)
    db.exec(`INSERT INTO deployment(id,app_id,version,image_tag,status,env_json) VALUES(7,2,1,'unit:v1','running','{"SECRET":"unit-never-expose"}');
    UPDATE app SET current_deployment_id=7 WHERE id=1`)
    const response = await get(prefix + '/apps/1'),
      detail = await response.json()
    expect(detail.current_deployment_id).toBeNull()
    expect(detail.current_deployment_state).toBeNull()
    expect(detail.http_url).toBeNull()
    expect(detail).not.toHaveProperty('env_json')
    expect(detail).not.toHaveProperty('encrypted_secret')
    expect(JSON.stringify(detail)).not.toContain('unit-never-expose')
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
  it('binds collection cursors to app and collection with stable upper bound', async () => {
    app(1)
    app(2)
    job(1, 'job-one')
    job(1, 'job-two')
    const first = await (await get(prefix + '/apps/1/jobs?limit=1')).json()
    expect(first.items.map((j) => j.job_id)).toEqual(['job-two'])
    expect(first.has_more).toBe(true)
    job(1, 'job-new')
    const second = await (
      await get(prefix + '/apps/1/jobs?limit=1&cursor=' + first.next_cursor)
    ).json()
    expect(second.items.map((j) => j.job_id)).toEqual(['job-one'])
    expect(second.has_more).toBe(false)
    expect((await get(prefix + '/apps/2/jobs?cursor=' + first.next_cursor)).status).toBe(400)
    expect((await get(prefix + '/apps/1/history?cursor=' + first.next_cursor)).status).toBe(400)
    db.exec(
      "UPDATE product_app_control SET controller_id='controller-b',ownership_generation=2 WHERE app_id=1"
    )
    expect((await get(prefix + '/apps/1/jobs?cursor=' + first.next_cursor)).status).toBe(404)
  })
  it('returns empty canonical history/deployments without exposing safe-summary payloads', async () => {
    app(1)
    expect((await (await get(prefix + '/apps/1/deployments')).json()).items).toEqual([])
    db.prepare(
      `INSERT INTO product_history_event(controller_id,app_id,kind,created_at,safe_summary_json) VALUES('controller-a',1,'unit_event',?,'{"secret":"private-unit"}')`
    ).run(new Date().toISOString())
    const history = await (await get(prefix + '/apps/1/history')).json()
    expect(history.items).toHaveLength(1)
    expect(history.items[0]).toMatchObject({
      kind: 'unit_event',
      app_id: 1,
      job_id: null,
      deployment_id: null
    })
    expect(JSON.stringify(history)).not.toContain('private-unit')
    expect((await get(prefix + '/apps/1/jobs/missing/logs')).status).toBe(501)
  })
  it('bounds invalid-token traffic without unbounded per-client maps or leaking exception details', async () => {
    for (let i = 0; i < 120; i++) expect((await get(prefix + '/identity', {})).status).toBe(401)
    const limited = await get(prefix + '/identity', {})
    expect(limited.status).toBe(429)
    expect(limited.headers.get('retry-after')).toBe('60')
    const body = await limited.json()
    expect(body.error.code).toBe('RATE_LIMITED')
    expect(body.error).not.toHaveProperty('stack')
  })
})
