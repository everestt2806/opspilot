import { Agent, request as httpRequest, type ClientRequest } from 'node:http'
import type { Socket } from 'node:net'
import { TextDecoder } from 'node:util'
import { z } from 'zod'
import type {
  ProductExposureView,
  ProductExposureObservationInput
} from '../../../../docs/contracts/product-exposure'
import { exposureInputSchema } from './controllerExposureSchemas'
import { hashH2 } from './productH2Proof'
import type { ClientChannel } from 'ssh2'
import type { SshManager, SshVerifiedConnectionIdentity } from '../ssh/manager'
import type {
  ProductApiErrorCode,
  ProductControllerApiMeta,
  ProductControllerCallResult,
  ProductControllerIdentity,
  ProductControllerStatus,
  ProductControllerCapabilities,
  ProductControllerAppSummary,
  ProductControllerAppDetail,
  ProductControllerJobSummary,
  ProductControllerDeploymentSummary,
  ProductControllerHistoryPage,
  ProductControllerPage,
  ProductControllerRequestLookup,
  ProductManualRedeployRequest,
  ProductManualRedeployAccepted,
  ProductAutoDeployPolicyRequest,
  ProductAutoDeployPolicyResult,
  ProductControllerPageQuery
} from '../../../../docs/contracts/product-controller-api'
import {
  CONTROLLER_HTTP_LIMITS,
  controllerResponseSchemas,
  controllerRequestSchemas,
  controllerErrorSchema,
  controllerErrorStatuses,
  controllerIdSchema,
  controllerPageQuerySchema,
  requestKeySchema,
  positive
} from './controllerHttpSchemas'

export interface ControllerDesktopBinding {
  controllerId: string
  revision: number
  principal: SshVerifiedConnectionIdentity
  /** Main-only short-lived value. Never return from IPC or attach to errors. */
  accessToken: string
}
export type ControllerDesktopBindingResolver = () =>
  ControllerDesktopBinding | Promise<ControllerDesktopBinding>
type ClientErrorCode =
  | ProductApiErrorCode
  | 'BINDING_UNAVAILABLE'
  | 'BINDING_CHANGED'
  | 'TRANSPORT_UNAVAILABLE'
  | 'PROTOCOL_INVALID'
  | 'REQUEST_TIMEOUT'
  | 'REQUEST_ABORTED'
export class ControllerHttpClientError extends Error {
  constructor(
    readonly code: ClientErrorCode,
    readonly httpStatus: number | null = null
  ) {
    super(code)
  }
}
class RemoteRejection extends ControllerHttpClientError {}
type WithMeta<T> = ProductControllerApiMeta & T
interface Operations {
  exposure: { input: { app_id: number }; response: WithMeta<ProductExposureView> }
  observeExposure: {
    input: { app_id: number; request_key: string; body: ProductExposureObservationInput }
    response: WithMeta<ProductExposureView>
  }
  identity: { input: Record<string, never>; response: WithMeta<ProductControllerIdentity> }
  status: { input: Record<string, never>; response: WithMeta<ProductControllerStatus> }
  capabilities: { input: Record<string, never>; response: WithMeta<ProductControllerCapabilities> }
  apps: {
    input: { query?: ProductControllerPageQuery }
    response: WithMeta<ProductControllerPage<ProductControllerAppSummary>>
  }
  app: { input: { app_id: number }; response: WithMeta<ProductControllerAppDetail> }
  jobs: {
    input: { app_id: number; query?: ProductControllerPageQuery }
    response: WithMeta<ProductControllerPage<ProductControllerJobSummary>>
  }
  deployments: {
    input: { app_id: number; query?: ProductControllerPageQuery }
    response: WithMeta<ProductControllerPage<ProductControllerDeploymentSummary>>
  }
  history: {
    input: { app_id: number; query?: ProductControllerPageQuery }
    response: WithMeta<ProductControllerHistoryPage>
  }
  lookup: { input: { request_key: string }; response: WithMeta<ProductControllerRequestLookup> }
  redeploy: {
    input: { app_id: number; request_key: string; body: ProductManualRedeployRequest }
    response: WithMeta<ProductManualRedeployAccepted>
  }
  policy: {
    input: { app_id: number; request_key: string; body: ProductAutoDeployPolicyRequest }
    response: WithMeta<ProductAutoDeployPolicyResult>
  }
}
type Operation = keyof Operations
const responseSchemas = controllerResponseSchemas satisfies {
  [K in Operation]: z.ZodType<Operations[K]['response']>
}
const bindingSchema = z.strictObject({
  controllerId: controllerIdSchema,
  revision: positive,
  principal: z.strictObject({
    vpsId: positive,
    host: z.string().min(1).max(253).refine(noWhitespaceOrControls),
    port: positive.max(65535),
    hostFingerprint: z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/),
    username: z.string().min(1).max(128).refine(noWhitespaceOrControls),
    authType: z.enum(['key', 'password'])
  }),
  accessToken: z.string().regex(/^opspilot_[A-Za-z0-9_-]{43}$/)
})
const inputs = {
  exposure: z.strictObject({ app_id: positive }),
  observeExposure: z.strictObject({
    app_id: positive,
    request_key: requestKeySchema,
    body: exposureInputSchema
  }),
  identity: z.strictObject({}),
  status: z.strictObject({}),
  capabilities: z.strictObject({}),
  apps: z.strictObject({ query: controllerPageQuerySchema.optional() }),
  app: z.strictObject({ app_id: positive }),
  jobs: z.strictObject({ app_id: positive, query: controllerPageQuerySchema.optional() }),
  deployments: z.strictObject({ app_id: positive, query: controllerPageQuerySchema.optional() }),
  history: z.strictObject({ app_id: positive, query: controllerPageQuerySchema.optional() }),
  lookup: z.strictObject({ request_key: requestKeySchema }),
  redeploy: z.strictObject({
    app_id: positive,
    request_key: requestKeySchema,
    body: controllerRequestSchemas.redeploy
  }),
  policy: z.strictObject({
    app_id: positive,
    request_key: requestKeySchema,
    body: controllerRequestSchemas.policy
  })
} satisfies { [K in Operation]: z.ZodType<Operations[K]['input']> }
function sameBinding(first: ControllerDesktopBinding, next: ControllerDesktopBinding): boolean {
  return (
    first.controllerId === next.controllerId &&
    first.revision === next.revision &&
    first.accessToken === next.accessToken &&
    (Object.keys(first.principal) as Array<keyof SshVerifiedConnectionIdentity>).every(
      (key) => first.principal[key] === next.principal[key]
    )
  )
}

/** Không listener/cache/auto retry. Mỗi call lấy credential mới và sở hữu đúng một SSH channel. */
export class ControllerHttpClient {
  constructor(
    private readonly ssh: Pick<SshManager, 'openControllerApiChannel'>,
    private readonly resolveBinding: ControllerDesktopBindingResolver,
    private readonly now: () => number = Date.now
  ) {}

  async call<K extends Operation>(
    operation: K,
    input: Operations[K]['input'],
    options: { signal?: AbortSignal; timeoutMs?: number } = {}
  ): Promise<ProductControllerCallResult<Operations[K]['response']>> {
    const schema = Object.hasOwn(inputs, operation) ? inputs[operation] : null
    const parsed = schema?.safeParse(input)
    const timeout = options.timeoutMs ?? CONTROLLER_HTTP_LIMITS.timeout
    if (
      !parsed?.success ||
      !Number.isSafeInteger(timeout) ||
      timeout < 1 ||
      timeout > CONTROLLER_HTTP_LIMITS.maxTimeout
    )
      throw new ControllerHttpClientError('REQUEST_INVALID')
    if (options.signal?.aborted) throw new ControllerHttpClientError('REQUEST_ABORTED')
    const value = parsed.data,
      write = operation === 'redeploy' || operation === 'policy' || operation === 'observeExposure',
      key = 'request_key' in value ? value.request_key : undefined,
      payload = 'body' in value ? JSON.stringify(value.body) : undefined
    if (payload && Buffer.byteLength(payload) > CONTROLLER_HTTP_LIMITS.request)
      throw new ControllerHttpClientError('REQUEST_INVALID')
    const stop = new AbortController()
    let sent = false,
      expired = false,
      channel: ClientChannel | undefined,
      outgoing: ClientRequest | undefined
    const agent = new Agent({ keepAlive: false })
    const cancel = (): void => stop.abort()
    const timer = setTimeout(() => {
      expired = true
      stop.abort()
    }, timeout)
    options.signal?.addEventListener('abort', cancel, { once: true })
    const abortedError = (): ControllerHttpClientError =>
      new ControllerHttpClientError(expired ? 'REQUEST_TIMEOUT' : 'REQUEST_ABORTED')
    let rejectStopped!: () => void
    const stopped = new Promise<never>((_resolve, reject) => {
      rejectStopped = () => {
        outgoing?.destroy()
        channel?.destroy()
        reject(abortedError())
      }
      stop.signal.addEventListener('abort', rejectStopped, { once: true })
    })
    const assertActive = (): void => {
      if (stop.signal.aborted) throw abortedError()
    }
    const binding = async (): Promise<ControllerDesktopBinding> => {
      let resolved: unknown
      try {
        resolved = await this.resolveBinding()
      } catch {
        throw new ControllerHttpClientError('BINDING_UNAVAILABLE')
      }
      assertActive()
      const current = bindingSchema.safeParse(resolved)
      if (!current.success) throw new ControllerHttpClientError('BINDING_UNAVAILABLE')
      return current.data
    }
    const execute = async (): Promise<Operations[K]['response']> => {
      const pinned = await binding()
      const opened = await this.ssh.openControllerApiChannel(pinned.principal, {
        signal: stop.signal,
        timeoutMs: timeout
      })
      channel = opened.channel
      channel.on('error', ignoreChannelError)
      if (stop.signal.aborted) {
        channel.destroy()
        assertActive()
      }
      assertActive()
      if (
        !sameBinding(pinned, await binding()) ||
        !sameBinding(pinned, { ...pinned, principal: opened.identity })
      )
        throw new ControllerHttpClientError('BINDING_CHANGED')
      const prefix = `/v1/controllers/${pinned.controllerId}`
      let path = operation === 'lookup' ? `${prefix}/requests/${key}` : `${prefix}/${operation}`
      if ('app_id' in value)
        path =
          `${prefix}/apps/${value.app_id}` +
          (operation === 'app'
            ? ''
            : `/${operation === 'policy' ? 'auto-deploy-policy' : operation === 'observeExposure' ? 'exposure' : operation}`)
      if ('query' in value && value.query) {
        const query = new URLSearchParams()
        if (value.query.limit !== undefined) query.set('limit', String(value.query.limit))
        if (value.query.cursor !== undefined) query.set('cursor', value.query.cursor)
        if (query.size) path += '?' + query.toString()
      }
      // Agent riêng cho một request; không dùng global Agent/net connect hoặc local forwarding listener.
      agent.createConnection = () => channel as unknown as Socket
      const received = await new Promise<{ status: number; value: unknown }>((resolve, reject) => {
        let settled = false
        const fail = (): void => {
          if (!settled) {
            settled = true
            reject(new ControllerHttpClientError('PROTOCOL_INVALID'))
          }
          outgoing?.destroy()
          channel?.destroy()
        }
        outgoing = httpRequest(
          {
            host: '127.0.0.1',
            port: 8768,
            method: write ? 'POST' : 'GET',
            path,
            agent,
            maxHeaderSize: CONTROLLER_HTTP_LIMITS.header,
            headers: {
              authorization: `Bearer ${pinned.accessToken}`,
              accept: 'application/json',
              connection: 'close',
              ...(write
                ? {
                    'content-type': 'application/json',
                    'content-length': Buffer.byteLength(payload!),
                    'idempotency-key': key!
                  }
                : {})
            }
          },
          (response) => {
            const media = response.headers['content-type'],
              length = response.headers['content-length']
            if (
              typeof media !== 'string' ||
              !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(media) ||
              response.headers['content-encoding'] !== undefined ||
              (length !== undefined &&
                (!/^[0-9]+$/.test(length) || Number(length) > CONTROLLER_HTTP_LIMITS.response))
            ) {
              response.resume()
              fail()
              return
            }
            const chunks: Buffer[] = []
            let size = 0
            response.on('data', (chunk: Buffer) => {
              size += chunk.length
              if (size > CONTROLLER_HTTP_LIMITS.response) fail()
              else chunks.push(chunk)
            })
            response.once('error', fail)
            response.once('aborted', fail)
            response.once('end', () => {
              if (settled) return
              try {
                if (!response.complete || (length !== undefined && size !== Number(length)))
                  throw new Error()
                const text = new TextDecoder('utf-8', { fatal: true }).decode(
                  Buffer.concat(chunks, size)
                )
                if (text.includes(pinned.accessToken)) throw new Error()
                const decoded: unknown = JSON.parse(text)
                if (JSON.stringify(decoded).includes(pinned.accessToken)) throw new Error()
                settled = true
                resolve({ status: response.statusCode ?? 0, value: decoded })
              } catch {
                fail()
              }
            })
          }
        )
        outgoing.once('error', (error: NodeJS.ErrnoException) => {
          if (!settled) {
            settled = true
            reject(
              new ControllerHttpClientError(
                error.code?.startsWith('HPE_') ? 'PROTOCOL_INVALID' : 'TRANSPORT_UNAVAILABLE'
              )
            )
          }
        })
        assertActive()
        // Sau end(), dù socket chưa flush thì không thể khẳng định server chưa nhận intent.
        sent = write
        outgoing.end(payload)
      })
      if (!sameBinding(pinned, await binding()))
        throw new ControllerHttpClientError('BINDING_CHANGED')
      if (received.status !== (operation === 'redeploy' ? 202 : 200)) {
        const remote = controllerErrorSchema.safeParse(received.value)
        if (
          !remote.success ||
          !controllerErrorStatuses[remote.data.error.code].includes(received.status)
        )
          throw new ControllerHttpClientError('PROTOCOL_INVALID')
        throw new RemoteRejection(remote.data.error.code, received.status)
      }
      const dto = responseSchemas[operation].safeParse(received.value)
      if (!dto.success || dto.data.controller_id !== pinned.controllerId)
        throw new ControllerHttpClientError('PROTOCOL_INVALID')
      const response = dto.data
      if (operation === 'observeExposure' && 'observation' in response) {
        const expected = inputs.observeExposure.parse(input),
          observation = response.observation
        if (
          !observation ||
          observation.observation_id !== expected.request_key ||
          observation.body_sha256 !== hashH2(expected.body) ||
          hashH2(
            Object.fromEntries(
              Object.keys(exposureInputSchema.shape).map((key) => [
                key,
                observation[key as keyof typeof observation]
              ])
            )
          ) !== observation.body_sha256
        )
          throw new ControllerHttpClientError('PROTOCOL_INVALID')
      }
      if (
        'app_id' in value &&
        (('app_id' in response && response.app_id !== value.app_id) ||
          ('items' in response && response.items.some((item) => item.app_id !== value.app_id)))
      )
        throw new ControllerHttpClientError('PROTOCOL_INVALID')
      if ('items' in response) {
        const limit = 'query' in value ? (value.query?.limit ?? 50) : 50
        if (
          response.items.length > limit ||
          response.items.some(
            (item) =>
              'controller_id' in item &&
              (item.controller_id !== pinned.controllerId ||
                ('sampled_at' in item && item.sampled_at !== response.sampled_at))
          )
        )
          throw new ControllerHttpClientError('PROTOCOL_INVALID')
      }
      if (
        operation === 'lookup' &&
        'found' in response &&
        response.found &&
        response.status.request_key !== key
      )
        throw new ControllerHttpClientError('PROTOCOL_INVALID')
      if (operation === 'policy' && 'auto_deploy_paused' in response) {
        const policyInput = inputs.policy.parse(input)
        if (response.auto_deploy_paused !== (policyInput.body.action === 'pause'))
          throw new ControllerHttpClientError('PROTOCOL_INVALID')
      }
      if (operation === 'redeploy' && 'target_sha' in response) {
        const target = inputs.redeploy.parse(input).body.target
        if (target.kind === 'specific_sha' && response.target_sha !== target.sha)
          throw new ControllerHttpClientError('PROTOCOL_INVALID')
      }
      const age = this.now() - Date.parse(response.sampled_at)
      if (!Number.isFinite(age)) throw new ControllerHttpClientError('PROTOCOL_INVALID')
      if (
        response.data_freshness === 'current' &&
        Math.abs(age) > CONTROLLER_HTTP_LIMITS.staleAfter
      )
        response.data_freshness = age > 0 ? 'stale' : 'unknown'
      return response as Operations[K]['response']
    }
    try {
      const response = await Promise.race([execute(), stopped])
      return { state: 'response_received', response }
    } catch (error) {
      if (write && sent && !(error instanceof RemoteRejection && error.httpStatus! < 500))
        return {
          state: 'outcome_unknown',
          idempotency_key: key!,
          may_have_been_accepted: true,
          next_step:
            operation === 'observeExposure' ? 'read_current_exposure' : 'query_same_request_key'
        }
      if (error instanceof ControllerHttpClientError) throw error
      throw new ControllerHttpClientError('TRANSPORT_UNAVAILABLE')
    } finally {
      clearTimeout(timer)
      stop.signal.removeEventListener('abort', rejectStopped)
      options.signal?.removeEventListener('abort', cancel)
      outgoing?.destroy()
      channel?.destroy()
      agent.destroy()
    }
  }
}
function ignoreChannelError(): void {
  /* Agent/request maps transport errors to safe codes. */
}
function noWhitespaceOrControls(value: string): boolean {
  return [...value].every(
    (character) => character.charCodeAt(0) > 32 && character.charCodeAt(0) !== 127
  )
}
