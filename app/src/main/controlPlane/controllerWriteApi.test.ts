import { createServer, request as httpRequest, type IncomingMessage, type Server } from 'node:http'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { initializeDatabase, closeDatabase } from '../db'
import { AesGcmCredentialCipher } from '../crypto/credentialCipher'
import { ProductDeployRepository } from '../db/productDeployRepository'
import { ControllerClientAuth } from './controllerClientAuth'
import { ControllerCommands } from './controllerCommands'
import { ControllerReadApi } from './controllerReadApi'
import { ControllerReadCursor } from './controllerReadCursor'

let directory: string,
  db: ReturnType<typeof initializeDatabase>,
  api: ControllerReadApi,
  server: Server,
  url: string,
  auth: ControllerClientAuth,
  header: string,
  client: string,
  ready: boolean,
  onRequest: ((request: IncomingMessage) => void) | undefined
const controller = 'write-controller',
  prefix = `/v1/controllers/${controller}`,
  hash = createHash('sha256').update('{}').digest('hex'),
  body = {
    expected_ownership_generation: 1,
    expected_source_generation: 1,
    target: { kind: 'current_desired' }
  }
function issue(scopes = ['read', 'deploy:manual', 'policy:write']): {
  header: string
  client: string
} {
  const issued = auth.enroll({
    request_key: randomUUID(),
    display_name: 'HTTP unit',
    requested_scopes: scopes
  })
  if (issued.state !== 'issued_once') throw new Error('UNIT_CREDENTIAL_REQUIRED')
  return { header: `Bearer ${issued.credential.access_token}`, client: issued.client.client_id }
}
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'opspilot-write-api-'))
  db = initializeDatabase(directory)
  const now = new Date().toISOString()
  db.prepare('INSERT INTO product_controller VALUES(?,?,?)').run(controller, now, 'active')
  db.exec(`INSERT INTO vps(id,name,host,username,auth_type,encrypted_secret)
    VALUES(1,'unit','target.test','unit','key',X'0102');
    INSERT INTO app(id,vps_id,name,framework,host_port,container_port,source_type,git_repo_url,git_ref,git_root)
    VALUES(1,1,'http-app','express',30000,3000,'git','https://github.com/demo/app.git','main','.')`)
  db.prepare(
    "INSERT INTO product_source_config VALUES(1,1,'https://github.com/demo/app.git','main','.','{}',?,?)"
  ).run(hash, now)
  db.prepare(
    `INSERT INTO product_app_control(app_id,mode,controller_id,ownership_generation,source_generation,source_config_sha256,changed_at,
    auto_deploy_paused,pause_reason,pause_policy_provenance) VALUES(1,'product',?,1,1,?,?,1,'operator','explicit')`
  ).run(controller, hash, now)
  new ProductDeployRepository(db).observeTip({
    controllerId: controller,
    appId: 1,
    ownershipGeneration: 1,
    sourceGeneration: 1,
    configSha256: hash,
    ref: 'main',
    expectedObservationSequence: null,
    tipSha: 'a'.repeat(40)
  })
  auth = new ControllerClientAuth(db, controller, 'unix:1000')
  ;({ header, client } = issue())
  ready = true
  onRequest = undefined
  api = new ControllerReadApi(
    db,
    controller,
    directory,
    new ControllerReadCursor(new AesGcmCredentialCipher(randomBytes(32)), controller),
    () => ({
      service_state: ready ? 'ready' : 'degraded',
      last_branch_poll_at: null,
      reason_code: null
    }),
    { commands: new ControllerCommands(db, controller, () => ready) }
  )
  server = createServer((req, res) => {
    onRequest?.(req)
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
  await api.close()
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
  closeDatabase()
  rmSync(directory, { recursive: true })
})
const post = (
  value: unknown = body,
  key: string | undefined = randomUUID(),
  path = '/apps/1/redeploy',
  authorization = header
): Promise<Response> =>
  fetch(url + prefix + path, {
    method: 'POST',
    headers: {
      authorization,
      'content-type': 'application/json',
      ...(key ? { 'idempotency-key': key } : {})
    },
    body: JSON.stringify(value)
  })
const count = (table: string): number =>
  (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n
function raw(bytes: Buffer | string, headers: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      url + prefix + '/apps/1/redeploy',
      {
        method: 'POST',
        headers: {
          authorization: header,
          'content-type': 'application/json',
          'idempotency-key': randomUUID(),
          ...headers
        }
      },
      (response) => {
        response.resume()
        response.once('end', () => {
          resolve(response.statusCode ?? 0)
          request.destroy()
        })
      }
    )
    request.once('error', reject)
    request.end(bytes)
  })
}
async function delayed(): Promise<{
  finish: () => void
  result: Promise<number>
}> {
  let requestSeen!: () => void
  const seen = new Promise<void>((resolve) => {
    requestSeen = resolve
  })
  onRequest = requestSeen
  let finish!: () => void
  const result = new Promise<number>((resolve, reject) => {
    const text = JSON.stringify(body)
    const request = httpRequest(
      url + prefix + '/apps/1/redeploy',
      {
        method: 'POST',
        headers: {
          authorization: header,
          'content-type': 'application/json',
          'idempotency-key': randomUUID(),
          'content-length': Buffer.byteLength(text)
        }
      },
      (response) => {
        response.resume()
        response.once('end', () => {
          resolve(response.statusCode ?? 0)
          request.destroy()
        })
      }
    )
    request.once('error', reject)
    request.write(text.slice(0, 5))
    finish = () => request.end(text.slice(5))
  })
  await seen
  return { finish, result }
}
describe('Authenticated command HTTP', () => {
  it('accepts exactly one durable job for concurrent duplicates and exposes lookup after response loss', async () => {
    const key = randomUUID()
    const responses = await Promise.all([post(body, key), post(body, key)])
    expect(responses.map((r) => r.status)).toEqual([202, 202])
    const results = await Promise.all(responses.map((r) => r.json()))
    expect(results[0].job_id).toBe(results[1].job_id)
    expect(count('product_api_request')).toBe(1)
    expect(count('product_deploy_job')).toBe(1)
    const lookup = await fetch(url + prefix + '/requests/' + key, {
      headers: { authorization: header }
    })
    expect(lookup.status).toBe(200)
    expect(await lookup.json()).toMatchObject({
      found: true,
      status: { state: 'accepted', job_id: results[0].job_id }
    })
    expect(
      (await post({ ...body, target: { kind: 'specific_sha', sha: 'a'.repeat(40) } }, key)).status
    ).toBe(409)
    const other = issue(['read'])
    expect(
      await (
        await fetch(url + prefix + '/requests/' + key, { headers: { authorization: other.header } })
      ).json()
    ).toMatchObject({ found: false })
  })
  it('rejects missing key, stale epochs, unknown target, foreign owner and read-only credentials', async () => {
    expect((await post(body, '')).status).toBe(400)
    expect((await post({ ...body, expected_source_generation: 2 })).status).toBe(409)
    expect(
      (await post({ ...body, target: { kind: 'specific_sha', sha: 'b'.repeat(40) } })).status
    ).toBe(409)
    expect(
      (await post(body, randomUUID(), '/apps/1/redeploy', issue(['read']).header)).status
    ).toBe(403)
    db.exec("UPDATE product_app_control SET mode='desktop',controller_id=NULL")
    expect((await post()).status).toBe(404)
    expect(count('product_api_request')).toBe(0)
  })
  it('bounds declared and chunked bodies and rejects malformed JSON, UTF8 and media without leaking content', async () => {
    expect(await raw('x'.repeat(16 * 1024 + 1), { 'content-length': String(16 * 1024 + 1) })).toBe(
      413
    )
    expect(await raw('x'.repeat(16 * 1024 + 1), { 'transfer-encoding': 'chunked' })).toBe(413)
    expect(await raw('{"secret":"unit-only",')).toBe(400)
    expect(await raw(Buffer.from([0x22, 0xc3, 0x28, 0x22]))).toBe(400)
    expect(await raw('{}', { 'content-type': 'text/plain' })).toBe(400)
    expect(await raw('{}', { 'content-encoding': 'gzip' })).toBe(400)
    expect(count('product_api_request')).toBe(0)
  })
  it('reauthenticates after body receipt so a revoked client cannot enqueue', async () => {
    const pending = await delayed()
    auth.revoke({ request_key: randomUUID(), client_id: client })
    pending.finish()
    expect(await pending.result).toBe(401)
    expect(count('product_api_request')).toBe(0)
    expect(count('product_deploy_job')).toBe(0)
  })
  it('does not include rejected input or credentials in error responses or durable requests', async () => {
    const response = await post({ ...body, secret: 'unit-only-rejected-value' })
    expect(response.status).toBe(400)
    const text = await response.text()
    expect(text).not.toContain('unit-only-rejected-value')
    expect(text).not.toContain(header)
    expect(count('product_api_request')).toBe(0)
  })
  it('does not accept an incomplete request after its client disconnects', async () => {
    let received!: () => void, disconnected!: () => void
    const seen = new Promise<void>((resolve) => {
      received = resolve
    })
    const gone = new Promise<void>((resolve) => {
      disconnected = resolve
    })
    onRequest = (request) => {
      request.once('aborted', disconnected)
      received()
    }
    const request = httpRequest(url + prefix + '/apps/1/redeploy', {
      method: 'POST',
      headers: {
        authorization: header,
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
        'content-length': '1000'
      }
    })
    request.on('error', () => {
      /* Expected local disconnect; never inspect raw error. */
    })
    request.write('{')
    await seen
    request.destroy()
    await gone
    await api.close()
    expect(count('product_api_request')).toBe(0)
    expect(count('product_deploy_job')).toBe(0)
  })
  it('rechecks current ownership after body receipt', async () => {
    const pending = await delayed()
    db.exec('UPDATE product_app_control SET ownership_generation=2')
    pending.finish()
    expect(await pending.result).toBe(409)
    expect(count('product_api_request')).toBe(0)
  })
  it('aborts incomplete requests and drains before database close without late writes', async () => {
    const pending = await delayed()
    await api.close()
    expect(await pending.result).toBe(503)
    expect(count('product_api_request')).toBe(0)
    expect((await post()).status).toBe(503)
    expect(count('product_deploy_job')).toBe(0)
  })
  it('times out an incomplete body without accepting a request', async () => {
    const pending = await delayed()
    expect(await pending.result).toBe(400)
    expect(count('product_api_request')).toBe(0)
  }, 8000)
  it('advertises writes by scope/readiness and permits pause while degraded but blocks resume', async () => {
    const capabilities = (authorization = header): Promise<Response> =>
      fetch(url + prefix + '/capabilities', { headers: { authorization } })
    expect(await (await capabilities()).json()).toMatchObject({
      manual_redeploy: { state: 'available' },
      pause_auto_deploy: { state: 'available' }
    })
    expect(await (await capabilities(issue(['read']).header)).json()).toMatchObject({
      manual_redeploy: { state: 'blocked', reason_code: 'FEATURE_DISABLED' }
    })
    ready = false
    expect(await (await capabilities()).json()).toMatchObject({
      manual_redeploy: { state: 'blocked' },
      pause_auto_deploy: { state: 'available' },
      resume_auto_deploy: { state: 'blocked' }
    })
    expect((await post()).status).toBe(503)
    const policy = {
      expected_ownership_generation: 1,
      expected_source_generation: 1,
      action: 'pause'
    }
    const key = randomUUID()
    expect((await post(policy, key, '/apps/1/auto-deploy-policy')).status).toBe(200)
    expect((await post(policy, key, '/apps/1/auto-deploy-policy')).status).toBe(200)
    expect(count('product_api_request')).toBe(1)
    expect(
      (await post({ ...policy, action: 'resume' }, randomUUID(), '/apps/1/auto-deploy-policy'))
        .status
    ).toBe(503)
    db.exec("UPDATE product_controller SET status='maintenance'")
    expect(await (await capabilities()).json()).toMatchObject({
      pause_auto_deploy: { state: 'blocked' }
    })
  })
})
