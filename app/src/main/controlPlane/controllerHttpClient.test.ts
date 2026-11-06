import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { connect, type Socket } from 'node:net'
import { once } from 'node:events'
import { randomBytes, randomUUID } from 'node:crypto'
import type { ClientChannel } from 'ssh2'
import type { SshManager } from '../ssh/manager'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { ControllerHttpClient, type ControllerDesktopBinding } from './controllerHttpClient'
import { CONTROLLER_HTTP_LIMITS } from './controllerHttpSchemas'
import {
  PRODUCT_CONTROLLER_API_MAX_REQUEST_BYTES,
  PRODUCT_CONTROLLER_API_MAX_RESPONSE_BYTES,
  PRODUCT_CONTROLLER_API_MAX_PAGE_SIZE,
  PRODUCT_CONTROLLER_CLIENT_TIMEOUT_MS,
  PRODUCT_CONTROLLER_CLIENT_MAX_TIMEOUT_MS,
  PRODUCT_CONTROLLER_CLIENT_MAX_HEADER_BYTES,
  PRODUCT_CONTROLLER_API_CLIENT_STALE_AFTER_MS
} from '../../../../docs/contracts/product-controller-api'

let server: Server,
  port: number,
  binding: ControllerDesktopBinding,
  sockets: Socket[],
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  resolveBinding: ReturnType<
    typeof vi.fn<() => ControllerDesktopBinding | Promise<ControllerDesktopBinding>>
  >,
  open: ReturnType<typeof vi.fn<SshManager['openControllerApiChannel']>>,
  client: ControllerHttpClient,
  received: number
const meta = (): Record<string, unknown> => ({
  controller_id: 'controller-a',
  request_id: randomUUID(),
  sampled_at: new Date().toISOString(),
  data_freshness: 'current'
})
const identity = (): Record<string, unknown> => ({
  ...meta(),
  api_version: 'v1',
  api_bind_address: '127.0.0.1',
  service_state: 'ready'
})
const send = (res: ServerResponse, value: unknown, status = 200): void => {
  res.writeHead(status, { 'content-type': 'application/json', connection: 'close' })
  res.end(JSON.stringify(value))
}
const redeploy = (): {
  app_id: number
  request_key: string
  body: {
    expected_ownership_generation: number
    expected_source_generation: number
    target: { kind: 'current_desired' }
  }
} => ({
  app_id: 1,
  request_key: randomUUID(),
  body: {
    expected_ownership_generation: 1,
    expected_source_generation: 1,
    target: { kind: 'current_desired' }
  }
})
const summary = (id: number): Record<string, unknown> => ({
  app_id: id,
  app_name: 'unit-app',
  controller_id: 'controller-a',
  ownership_generation: 1,
  source_generation: 1,
  source_config_sha256: 'a'.repeat(64),
  production_ref: 'main',
  auto_deploy_paused: false,
  pause_reason: null,
  pause_policy_provenance: 'explicit',
  desired_sha: null,
  reconciliation_state: null,
  observed_at: null,
  sampled_at: new Date().toISOString()
})
beforeEach(async () => {
  sockets = []
  received = 0
  binding = {
    controllerId: 'controller-a',
    revision: 1,
    accessToken: 'opspilot_' + randomBytes(32).toString('base64url'),
    principal: {
      vpsId: 1,
      host: 'controller.test',
      port: 22,
      hostFingerprint: 'SHA256:' + 'A'.repeat(43),
      username: 'operator',
      authType: 'key'
    }
  }
  resolveBinding = vi.fn(() => binding)
  handler = (_req, res) => send(res, identity())
  server = createServer((req, res) => {
    received++
    handler(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('UNIT_SERVER_REQUIRED')
  port = address.port
  open = vi.fn<SshManager['openControllerApiChannel']>(async () => {
    const channel = connect({ host: '127.0.0.1', port })
    sockets.push(channel)
    await once(channel, 'connect')
    return { channel: channel as unknown as ClientChannel, identity: { ...binding.principal } }
  })
  client = new ControllerHttpClient({ openControllerApiChannel: open }, resolveBinding)
})
afterEach(async () => {
  for (const socket of sockets) socket.destroy()
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  )
})
describe('Bounded main-process controller HTTP client', () => {
  it('keeps runtime limits equal to contract and only sends a bearer over the pinned channel', async () => {
    expect(CONTROLLER_HTTP_LIMITS).toEqual({
      timeout: PRODUCT_CONTROLLER_CLIENT_TIMEOUT_MS,
      maxTimeout: PRODUCT_CONTROLLER_CLIENT_MAX_TIMEOUT_MS,
      header: PRODUCT_CONTROLLER_CLIENT_MAX_HEADER_BYTES,
      request: PRODUCT_CONTROLLER_API_MAX_REQUEST_BYTES,
      response: PRODUCT_CONTROLLER_API_MAX_RESPONSE_BYTES,
      page: PRODUCT_CONTROLLER_API_MAX_PAGE_SIZE,
      staleAfter: PRODUCT_CONTROLLER_API_CLIENT_STALE_AFTER_MS
    })
    handler = (req, res) => {
      expect(req.url).toBe('/v1/controllers/controller-a/identity')
      expect(req.headers.authorization).toBe('Bearer ' + binding.accessToken)
      send(res, identity())
    }
    const result = await client.call('identity', {})
    expect(result).toMatchObject({
      state: 'response_received',
      response: { controller_id: 'controller-a', service_state: 'ready' }
    })
    expect(JSON.stringify(result)).not.toContain(binding.accessToken)
    expect(open).toHaveBeenCalledOnce()
    expect(open.mock.calls[0][0]).toEqual(binding.principal)
    expect(sockets.every((socket) => socket.destroyed)).toBe(true)
  })
  it('rejects invalid route, query, missing idempotency key and injected fields before opening a channel', async () => {
    await expect(client.call('apps', { query: { limit: 101 } })).rejects.toMatchObject({
      code: 'REQUEST_INVALID'
    })
    await expect(client.call('redeploy', { ...redeploy(), request_key: '' })).rejects.toMatchObject(
      { code: 'REQUEST_INVALID' }
    )
    await expect(client.call('__proto__' as 'identity', {})).rejects.toMatchObject({
      code: 'REQUEST_INVALID'
    })
    await expect(
      client.call('identity', { url: 'http://foreign.test/' } as unknown as Record<string, never>)
    ).rejects.toMatchObject({ code: 'REQUEST_INVALID' })
    expect(open).not.toHaveBeenCalled()
  })
  it('does not open or send without a current valid binding, and rejects a different opened principal before HTTP', async () => {
    binding.accessToken = 'invalid'
    await expect(client.call('identity', {})).rejects.toMatchObject({ code: 'BINDING_UNAVAILABLE' })
    expect(open).not.toHaveBeenCalled()
    binding.accessToken = 'opspilot_' + randomBytes(32).toString('base64url')
    const actual = open.getMockImplementation()!
    open.mockImplementation(async () => ({
      ...(await actual(binding.principal)),
      identity: { ...binding.principal, username: 'foreign' }
    }))
    await expect(client.call('identity', {})).rejects.toMatchObject({ code: 'BINDING_CHANGED' })
    expect(received).toBe(0)
  })
  it('does not expose response data after the binding is changed or revoked during the request', async () => {
    handler = (_req, res) => {
      binding.revision++
      send(res, identity())
    }
    await expect(client.call('identity', {})).rejects.toMatchObject({ code: 'BINDING_CHANGED' })
    handler = (_req, res) => {
      resolveBinding.mockImplementation(() => {
        throw new Error('unit-only-sensitive-error')
      })
      send(res, identity())
    }
    await expect(client.call('identity', {})).rejects.toThrow('BINDING_UNAVAILABLE')
  })
  it('bounds resolution and destroys a channel delivered after the deadline', async () => {
    let release!: (value: ControllerDesktopBinding) => void
    resolveBinding.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    await expect(client.call('identity', {}, { timeoutMs: 30 })).rejects.toMatchObject({
      code: 'REQUEST_TIMEOUT'
    })
    release(binding)
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(open).not.toHaveBeenCalled()
    resolveBinding.mockImplementation(() => binding)
    let giveChannel!: () => void
    open.mockImplementation(
      () =>
        new Promise((resolve) => {
          giveChannel = () => {
            const channel = connect({ host: '127.0.0.1', port })
            sockets.push(channel)
            resolve({ channel: channel as unknown as ClientChannel, identity: binding.principal })
          }
        })
    )
    await expect(client.call('identity', {}, { timeoutMs: 30 })).rejects.toMatchObject({
      code: 'REQUEST_TIMEOUT'
    })
    giveChannel()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(sockets.at(-1)?.destroyed).toBe(true)
    expect(received).toBe(0)
  })
  it('rejects malformed media/UTF8/JSON, oversized bodies, raw credentials and DTO extras without reflecting input', async () => {
    const bad = [
      (res: ServerResponse): void => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('unit-sensitive-content')
      },
      (res: ServerResponse): void => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(Buffer.from([0x22, 0xc3, 0x28, 0x22]))
      },
      (res: ServerResponse): void => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{')
      },
      (res: ServerResponse): void => {
        res.writeHead(200, {
          'content-type': 'application/json',
          'content-length': String(1024 * 1024 + 1)
        })
        res.end('{}')
      },
      (res: ServerResponse): void => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(' '.repeat(1024 * 1024 + 1))
      },
      (res: ServerResponse): void =>
        send(res, { ...identity(), access_token: binding.accessToken }),
      (res: ServerResponse): void => send(res, { ...identity(), extra: 'unit-sensitive-content' })
    ]
    for (const invalid of bad) {
      handler = (_req, res) => invalid(res)
      const task = client.call('identity', {})
      await expect(task).rejects.toMatchObject({ code: 'PROTOCOL_INVALID' })
      await expect(task).rejects.not.toThrow('unit-sensitive-content')
      await expect(task).rejects.not.toThrow(binding.accessToken)
    }
  })
  it('does not follow redirects or accept identity from a different controller', async () => {
    handler = (_req, res) => {
      res.writeHead(302, { location: 'http://foreign.test/', 'content-type': 'application/json' })
      res.end('{}')
    }
    await expect(client.call('identity', {})).rejects.toMatchObject({ code: 'PROTOCOL_INVALID' })
    expect(received).toBe(1)
    handler = (_req, res) => send(res, { ...identity(), controller_id: 'controller-b' })
    await expect(client.call('identity', {})).rejects.toMatchObject({ code: 'PROTOCOL_INVALID' })
  })
  it('rejects an escaped bearer even inside an otherwise allowed DTO field', async () => {
    handler = (_req, res) => {
      const current = meta()
      const text = JSON.stringify({
        ...current,
        items: [{ ...summary(1), app_name: binding.accessToken, sampled_at: current.sampled_at }],
        has_more: false,
        next_cursor: null
      })
      const escaped = [...binding.accessToken]
        .map((character) => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0'))
        .join('')
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(text.replace(binding.accessToken, escaped))
    }
    const task = client.call('apps', {})
    await expect(task).rejects.toMatchObject({ code: 'PROTOCOL_INVALID' })
    await expect(task).rejects.not.toThrow(binding.accessToken)
  })
  it('enforces response header limit and rejects encoded payloads', async () => {
    handler = (_req, res) => {
      res.writeHead(200, {
        'content-type': 'application/json',
        'x-unit-padding': 'x'.repeat(20 * 1024)
      })
      res.end(JSON.stringify(identity()))
    }
    await expect(client.call('identity', {})).rejects.toMatchObject({ code: 'PROTOCOL_INVALID' })
    handler = (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' })
      res.end('{}')
    }
    await expect(client.call('identity', {})).rejects.toMatchObject({ code: 'PROTOCOL_INVALID' })
  })
  it('returns unknown with the same UUID after send when the response is dropped, without automatic retry', async () => {
    handler = (req) => {
      req.resume()
      req.once('end', () => req.socket.destroy())
    }
    const input = redeploy(),
      result = await client.call('redeploy', input)
    expect(result).toEqual({
      state: 'outcome_unknown',
      idempotency_key: input.request_key,
      may_have_been_accepted: true,
      next_step: 'query_same_request_key'
    })
    expect(open).toHaveBeenCalledOnce()
    expect(received).toBe(1)
    handler = (req, res) => {
      expect(req.url).toBe('/v1/controllers/controller-a/requests/' + input.request_key)
      send(res, { ...meta(), found: false })
    }
    expect(await client.call('lookup', { request_key: input.request_key })).toMatchObject({
      state: 'response_received',
      response: { found: false }
    })
    expect(open).toHaveBeenCalledTimes(2)
  })
  it('treats timeout/abort after send as unknown and pre-send abort as definitely unsent', async () => {
    handler = (req) => req.resume()
    const input = redeploy()
    expect(await client.call('redeploy', input, { timeoutMs: 100 })).toMatchObject({
      state: 'outcome_unknown',
      idempotency_key: input.request_key
    })
    const stop = new AbortController()
    handler = (req) => {
      req.resume()
      stop.abort()
    }
    expect(await client.call('redeploy', input, { signal: stop.signal })).toMatchObject({
      state: 'outcome_unknown'
    })
    const before = received
    await expect(client.call('redeploy', input, { signal: stop.signal })).rejects.toMatchObject({
      code: 'REQUEST_ABORTED'
    })
    expect(received).toBe(before)
  })
  it('propagates a validated rejection code with no raw server message, but a 5xx write stays unknown', async () => {
    const rejection = (code: string): Record<string, unknown> => ({
      error: {
        code,
        message: 'unit-only-secret-message',
        retryable: false,
        request_id: randomUUID()
      }
    })
    handler = (_req, res) => send(res, rejection('SOURCE_GENERATION_STALE'), 409)
    const task = client.call('redeploy', redeploy())
    await expect(task).rejects.toMatchObject({ code: 'SOURCE_GENERATION_STALE', httpStatus: 409 })
    await expect(task).rejects.not.toThrow('unit-only-secret-message')
    handler = (_req, res) => send(res, rejection('INTERNAL_ERROR'), 500)
    expect(await client.call('redeploy', redeploy())).toMatchObject({ state: 'outcome_unknown' })
  })
  it('never reports a malformed success or a changed binding as a definite write failure', async () => {
    handler = (_req, res) => send(res, { ...meta(), fake_job: 'unit' }, 202)
    expect(await client.call('redeploy', redeploy())).toMatchObject({ state: 'outcome_unknown' })
    handler = (_req, res) => {
      binding.revision++
      send(
        res,
        {
          ...meta(),
          job_id: 'pjob-unit',
          app_id: 1,
          target_sha: 'a'.repeat(40),
          state: 'queued',
          auto_deploy_paused: true,
          retry_with_same_idempotency_key: true
        },
        202
      )
    }
    expect(await client.call('redeploy', redeploy())).toMatchObject({ state: 'outcome_unknown' })
  })
  it('does not accept policy/target results inconsistent with the sent write', async () => {
    handler = (_req, res) =>
      send(res, {
        ...meta(),
        app_id: 1,
        result: 'updated',
        auto_deploy_paused: false,
        pause_policy_provenance: 'explicit',
        reconciliation_state: 'satisfied',
        updated_at: new Date().toISOString()
      })
    expect(
      await client.call('policy', {
        app_id: 1,
        request_key: randomUUID(),
        body: { expected_ownership_generation: 1, expected_source_generation: 1, action: 'pause' }
      })
    ).toMatchObject({ state: 'outcome_unknown' })
    handler = (_req, res) =>
      send(
        res,
        {
          ...meta(),
          job_id: 'unit-job',
          app_id: 1,
          target_sha: 'b'.repeat(40),
          state: 'queued',
          auto_deploy_paused: true,
          retry_with_same_idempotency_key: true
        },
        202
      )
    const input = redeploy()
    expect(
      await client.call('redeploy', {
        ...input,
        body: { ...input.body, target: { kind: 'specific_sha', sha: 'a'.repeat(40) } }
      })
    ).toMatchObject({ state: 'outcome_unknown' })
  })
  it('marks old/future data without upgrading server stale or unknown and accepts a safe lowercase status reason', async () => {
    const now = Date.now()
    client = new ControllerHttpClient({ openControllerApiChannel: open }, resolveBinding, () => now)
    for (const [age, expected] of [
      [65000, 'stale'],
      [-65000, 'unknown']
    ] as const) {
      handler = (_req, res) =>
        send(res, { ...identity(), sampled_at: new Date(now - age).toISOString() })
      expect(await client.call('identity', {})).toMatchObject({
        response: { data_freshness: expected }
      })
    }
    handler = (_req, res) =>
      send(res, {
        ...meta(),
        service_state: 'degraded',
        last_branch_poll_at: null,
        next_branch_poll_at: null,
        queued_job_count: 0,
        active_job_count: 0,
        uncertain_job_count: 0,
        storage_state: 'unknown',
        reason_code: 'resource_unknown',
        data_freshness: 'unknown'
      })
    expect(await client.call('status', {})).toMatchObject({
      response: { data_freshness: 'unknown', reason_code: 'resource_unknown' }
    })
  })
  it('enforces page limit/current controller, app route identity and lookup key binding', async () => {
    handler = (_req, res) =>
      send(res, {
        ...summary(2),
        ...meta(),
        current_deployment_id: null,
        current_deployment_sha: null,
        current_deployment_state: null,
        latest_job_id: null,
        latest_job_state: null,
        http_url: null
      })
    await expect(client.call('app', { app_id: 1 })).rejects.toMatchObject({
      code: 'PROTOCOL_INVALID'
    })
    handler = (_req, res) => {
      const current = meta()
      send(res, {
        ...current,
        items: [summary(1), summary(2)].map((item) => ({
          ...item,
          sampled_at: current.sampled_at
        })),
        has_more: false,
        next_cursor: null
      })
    }
    await expect(client.call('apps', { query: { limit: 1 } })).rejects.toMatchObject({
      code: 'PROTOCOL_INVALID'
    })
    handler = (_req, res) => {
      const current = meta()
      send(res, {
        ...current,
        items: [{ ...summary(1), controller_id: 'controller-b', sampled_at: current.sampled_at }],
        has_more: false,
        next_cursor: null
      })
    }
    await expect(client.call('apps', {})).rejects.toMatchObject({ code: 'PROTOCOL_INVALID' })
    handler = (_req, res) =>
      send(res, {
        ...meta(),
        found: true,
        status: {
          request_key: randomUUID(),
          action: 'manual_redeploy',
          app_id: 1,
          ownership_generation: 1,
          source_generation: 1,
          state: 'accepted',
          job_id: 'unit-job',
          reason_code: null,
          updated_at: new Date().toISOString()
        }
      })
    await expect(client.call('lookup', { request_key: randomUUID() })).rejects.toMatchObject({
      code: 'PROTOCOL_INVALID'
    })
  })
})
