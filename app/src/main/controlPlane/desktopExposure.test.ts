import { randomBytes, randomUUID } from 'node:crypto'
import { beforeEach, expect, it, vi } from 'vitest'
import { DesktopExposure } from './desktopExposure'
import {
  ControllerHttpClientError,
  type ControllerDesktopBinding,
  type ControllerHttpClient
} from './controllerHttpClient'
import type { DesktopControllerVault } from './desktopControllerVault'
import { hashH2 } from './productH2Proof'
import { probeDesktopExposure } from './desktopExposureProbe'
import { exposureInputSchema } from './controllerExposureSchemas'
import type {
  ProductExposureView,
  ProductExposureContext
} from '../../../../docs/contracts/product-exposure'
import type { ProductControllerApiMeta } from '../../../../docs/contracts/product-controller-api'

let binding: ControllerDesktopBinding,
  call: ReturnType<typeof vi.fn<ControllerHttpClient['call']>>,
  probe: ReturnType<typeof vi.fn<typeof probeDesktopExposure>>,
  service: DesktopExposure,
  clientId: string,
  scopes: Array<'read' | 'policy:write'>,
  current: ReturnType<typeof view>
const input = { binding_id: randomUUID(), app_id: 1 }
const view = (): ProductControllerApiMeta &
  ProductExposureView & { context: ProductExposureContext } => ({
  controller_id: 'fixture',
  request_id: randomUUID(),
  sampled_at: new Date().toISOString(),
  data_freshness: 'current' as const,
  app_id: 1,
  deployment_id: 1,
  context: {
    app_id: 1,
    deployment_id: 1,
    authority_sha256: 'a'.repeat(64),
    previous_observation_id: null,
    url: 'http://167.71.202.116:30000'
  },
  status: 'not_checked' as const,
  freshness: 'not_checked' as const,
  unavailable_reason: null,
  observation: null
})
beforeEach(() => {
  clientId = randomUUID()
  scopes = ['read', 'policy:write']
  current = view()
  binding = {
    controllerId: 'fixture',
    revision: 1,
    accessToken: 'opspilot_' + randomBytes(32).toString('base64url'),
    principal: {
      vpsId: 1,
      host: 'fixture.example',
      port: 22,
      hostFingerprint: 'SHA256:' + 'A'.repeat(43),
      username: 'ops',
      authType: 'key'
    }
  }
  const vault: Pick<DesktopControllerVault, 'resolve' | 'get'> = {
    resolve: () => binding,
    get: () => ({
      binding_id: input.binding_id,
      controller_id: binding.controllerId,
      vps_id: 1,
      revision: binding.revision,
      state: 'active',
      remote_client_id: clientId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      client: {
        client_id: clientId,
        controller_id: binding.controllerId,
        display_name: 'Fixture',
        scopes,
        created_at: new Date().toISOString(),
        revoked_at: null,
        token_expires_at: new Date(Date.now() + 60000).toISOString()
      }
    })
  }
  probe = vi.fn(async () => ({
    outcome: 'reachable' as const,
    reason: 'none' as const,
    http_status: 200,
    started_at: new Date().toISOString(),
    checked_at: new Date().toISOString()
  }))
  call = vi.fn<ControllerHttpClient['call']>(async (operation, value) => {
    if (operation === 'exposure') return { state: 'response_received', response: current } as never
    if (operation === 'observeExposure' && 'body' in value)
      return { state: 'response_received', response: saved(value.request_key, value.body) } as never
    throw Error('UNEXPECTED_FIXTURE_CALL')
  })
  service = new DesktopExposure(
    vault,
    { openControllerApiChannel: vi.fn() },
    () => ({ call }),
    probe
  )
})
function saved(key: string, body: unknown): ReturnType<typeof view> {
  return {
    ...current,
    context: { ...current.context, previous_observation_id: key },
    status: 'reachable',
    freshness: 'current',
    observation: {
      ...exposureInputSchema.parse(body),
      format: 1,
      app_id: 1,
      client_id: clientId,
      observation_id: key,
      body_sha256: hashH2(body),
      url: current.context.url,
      status: 'reachable',
      received_at: new Date().toISOString()
    }
  }
}
it('derives URL in Main and records a correlated observation without passing credentials to probe', async () => {
  const result = await service.run(input, true)
  expect(result.state).toBe('recorded')
  expect(probe).toHaveBeenCalledExactlyOnceWith(current.context.url)
  expect(call.mock.calls.map(([operation]) => operation)).toEqual(['exposure', 'observeExposure'])
  expect(JSON.stringify(result)).not.toContain(binding.accessToken)
})
it('read-only read never probes or writes; read-only check is rejected before IO', async () => {
  scopes = ['read']
  expect((await service.run(input, false)).state).toBe('read')
  expect((await service.run(input, true)).reason_code).toBe('SCOPE_REQUIRED')
  expect(probe).not.toHaveBeenCalled()
  expect(call).toHaveBeenCalledOnce()
})
it('rejects injected URL/body and does not call the client', async () => {
  await expect(
    service.run({ ...input, url: 'http://127.0.0.1' } as typeof input, true)
  ).rejects.toMatchObject({ code: 'REQUEST_INVALID' })
  expect(call).not.toHaveBeenCalled()
})
it('reports old controller unsupported without fallback', async () => {
  call.mockRejectedValue(new ControllerHttpClientError('UNSUPPORTED', 501))
  expect((await service.run(input, true)).reason_code).toBe('UNSUPPORTED')
  expect(probe).not.toHaveBeenCalled()
})
it('fences binding changes during probe before POST', async () => {
  probe.mockImplementationOnce(async () => {
    binding = { ...binding, revision: 2 }
    return {
      outcome: 'reachable',
      reason: 'none',
      http_status: 200,
      started_at: new Date().toISOString(),
      checked_at: new Date().toISOString()
    }
  })
  await expect(service.run(input, true)).rejects.toMatchObject({ code: 'BINDING_CHANGED' })
  expect(call).toHaveBeenCalledOnce()
})
it('resolves a lost reply with one exact read-current and never resends POST', async () => {
  let posted = false
  call.mockImplementation(async (operation, value) => {
    if (operation === 'observeExposure' && 'body' in value) {
      current = saved(value.request_key, value.body) as unknown as typeof current
      posted = true
      return {
        state: 'outcome_unknown',
        idempotency_key: value.request_key,
        may_have_been_accepted: true,
        next_step: 'read_current_exposure'
      } as never
    }
    expect(operation).toBe('exposure')
    return { state: 'response_received', response: current } as never
  })
  expect((await service.run(input, true)).state).toBe('recorded')
  expect(posted).toBe(true)
  expect(call.mock.calls.map(([operation]) => operation)).toEqual([
    'exposure',
    'observeExposure',
    'exposure'
  ])
})
it('leaves outcome unknown when a newer or absent observation cannot prove this write', async () => {
  call.mockImplementation(async (operation) =>
    operation === 'observeExposure'
      ? ({
          state: 'outcome_unknown',
          idempotency_key: randomUUID(),
          may_have_been_accepted: true,
          next_step: 'read_current_exposure'
        } as never)
      : ({ state: 'response_received', response: current } as never)
  )
  const result = await service.run(input, true)
  expect(result).toMatchObject({ state: 'outcome_unknown', view: null })
  expect(call).toHaveBeenCalledTimes(3)
})
it('does not probe a stale context', async () => {
  current.sampled_at = new Date(Date.now() - 60000).toISOString()
  expect((await service.run(input, true)).state).toBe('unavailable')
  expect(probe).not.toHaveBeenCalled()
  expect((await service.run(input, false)).state).toBe('unavailable')
})
it('rejects a successful POST response with another observation ID', async () => {
  call.mockImplementation(async (operation, value) =>
    operation === 'observeExposure' && 'body' in value
      ? ({ state: 'response_received', response: saved(randomUUID(), value.body) } as never)
      : ({ state: 'response_received', response: current } as never)
  )
  await expect(service.run(input, true)).rejects.toMatchObject({ code: 'PROTOCOL_INVALID' })
})
