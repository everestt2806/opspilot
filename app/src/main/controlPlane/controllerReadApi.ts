import type Database from 'better-sqlite3'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { statfsSync } from 'node:fs'
import {
  PRODUCT_CONTROLLER_API_MAX_RESPONSE_BYTES,
  type ProductApiErrorCode,
  type ProductControllerStatus,
  type ProductControllerApiMeta
} from '../../../../docs/contracts/product-controller-api'
import type {
  ProductApiScope,
  ProductApiCapability
} from '../../../../docs/contracts/product-controller-api'
import { PRODUCT_RESOURCE_MIN_DISK_BYTES } from '../../../../docs/contracts/product-controller-readiness'
import { ControllerClientAuth, ControllerClientAuthError } from './controllerClientAuth'
import { ControllerReadModel } from './controllerReadModel'
import type { ControllerReadCursor } from './controllerReadCursor'
import type { ControllerCommands } from './controllerCommands'
import { ControllerWriteApi } from './controllerWriteApi'
import { ControllerRequestBodyError } from './controllerRequestBody'

export interface ControllerReadApiState {
  service_state: 'ready' | 'degraded' | 'maintenance'
  last_branch_poll_at: string | null
  reason_code: string | null
}
/** Loopback DTO API; writes chỉ bật khi trusted service compose command repository. */
export class ControllerReadApi {
  private readonly auth: ControllerClientAuth
  private readonly model: ControllerReadModel
  private rateWindow = 0
  private rateCount = 0
  private readonly writes: ControllerWriteApi | null
  private stopping = false
  private closeTask: Promise<void> | null = null
  constructor(
    private readonly database: Database.Database,
    private readonly controllerId: string,
    private readonly directory: string,
    cursors: ControllerReadCursor,
    private readonly state: () => ControllerReadApiState,
    options?: { commands: ControllerCommands; signal?: AbortSignal }
  ) {
    this.auth = new ControllerClientAuth(database, controllerId, `unix:${process.getuid?.() ?? 0}`)
    this.model = new ControllerReadModel(database, controllerId, cursors)
    this.writes = options
      ? new ControllerWriteApi(
          options.commands,
          controllerId,
          (response, status, value) => this.send(response, status, value),
          (response, error, requestId) => this.failure(response, error, requestId),
          options.signal
        )
      : null
  }

  close(): Promise<void> {
    this.stopping = true
    this.closeTask ??= this.writes?.close() ?? Promise.resolve()
    return this.closeTask
  }

  handle(request: IncomingMessage, response: ServerResponse): boolean {
    if (!request.url?.startsWith('/v1')) return false
    const requestId = randomUUID()
    let delegated = false
    try {
      if (this.stopping) throw new ControllerClientAuthError('CAPABILITY_BLOCKED')
      const now = Date.now()
      if (now - this.rateWindow >= 60_000 || now < this.rateWindow) {
        this.rateWindow = now
        this.rateCount = 0
      }
      if (++this.rateCount > 120) {
        this.error(response, 429, 'RATE_LIMITED', requestId)
        return true
      }
      const address = request.socket.remoteAddress
      if (address !== '127.0.0.1' && address !== '::ffff:127.0.0.1' && address !== '::1')
        throw new ControllerClientAuthError('AUTH_REQUIRED')
      const url = new URL(request.url, 'http://127.0.0.1')
      const writeRoute = this.writes?.handles(request, url) ?? false
      if (
        request.url.length > 4096 ||
        request.headers.origin !== undefined ||
        (!writeRoute &&
          (request.headers['transfer-encoding'] !== undefined ||
            (request.headers['content-length'] !== undefined &&
              request.headers['content-length'] !== '0')))
      )
        throw new ControllerClientAuthError('REQUEST_INVALID')
      const headers = request.rawHeaders
        .filter((_, index) => index % 2 === 0)
        .map((name) => name.toLowerCase())
      if (headers.filter((name) => name === 'authorization').length !== 1)
        throw new ControllerClientAuthError('AUTH_REQUIRED')
      if ([...url.searchParams.keys()].some((key) => /token|credential|authorization/i.test(key)))
        throw new ControllerClientAuthError('REQUEST_INVALID')
      const result = this.database.transaction(() => {
        const parts = url.pathname.split('/')
        const requiredScope =
          request.method === 'POST' && parts[4] === 'apps'
            ? parts[6] === 'redeploy'
              ? 'deploy:manual'
              : parts[6] === 'auto-deploy-policy'
                ? 'policy:write'
                : 'read'
            : 'read'
        const client = this.auth.authenticate(request.headers.authorization, requiredScope)
        if (parts[1] !== 'v1' || parts[2] !== 'controllers' || parts[3] !== this.controllerId)
          throw new ControllerClientAuthError('CONTROLLER_MISMATCH')
        if (writeRoute) {
          if (!/^[1-9][0-9]*$/.test(parts[5]) || !Number.isSafeInteger(Number(parts[5])))
            throw new ControllerClientAuthError('REQUEST_INVALID')
          this.model.app(Number(parts[5]), new Date().toISOString())
          return undefined
        }
        if (request.method !== 'GET') throw new ControllerClientAuthError('UNSUPPORTED')
        const sampled = new Date().toISOString(),
          meta: ProductControllerApiMeta = {
            controller_id: this.controllerId,
            request_id: requestId,
            sampled_at: sampled,
            data_freshness: 'current'
          }
        if (parts.length === 5 && ['identity', 'status', 'capabilities'].includes(parts[4])) {
          if (url.search) throw new ControllerClientAuthError('REQUEST_INVALID')
          if (parts[4] === 'identity')
            return {
              ...meta,
              api_version: 'v1',
              api_bind_address: '127.0.0.1',
              service_state: this.state().service_state
            }
          if (parts[4] === 'capabilities') {
            const capability = (
              scope: ProductApiScope,
              allowDegraded = false
            ): ProductApiCapability => {
              if (!this.writes) return { state: 'unsupported', reason_code: 'NOT_IMPLEMENTED' }
              if (!client.scopes.includes(scope))
                return { state: 'blocked', reason_code: 'FEATURE_DISABLED' }
              const controller = this.database
                .prepare('SELECT status FROM product_controller WHERE controller_id=?')
                .get(this.controllerId) as { status: string } | undefined
              if (
                controller?.status !== 'active' ||
                (!allowDegraded && this.state().service_state !== 'ready')
              )
                return { state: 'blocked', reason_code: 'CONTROLLER_NOT_READY' }
              return { state: 'available' }
            }
            return {
              ...meta,
              api_version: 'v1',
              read: { state: 'available' },
              manual_redeploy: capability('deploy:manual'),
              pause_auto_deploy: capability('policy:write', true),
              resume_auto_deploy: capability('policy:write')
            }
          }
          return { ...meta, ...this.status(sampled) }
        }
        if (this.writes && parts.length === 6 && parts[4] === 'requests') {
          if (url.search) throw new ControllerClientAuthError('REQUEST_INVALID')
          return { ...meta, ...this.writes.lookup(request.headers.authorization, parts[5]) }
        }
        if (parts[4] === 'apps') {
          if (parts.length === 5) return { ...meta, ...this.model.apps(url.searchParams, sampled) }
          if (!/^[1-9][0-9]*$/.test(parts[5]))
            throw new ControllerClientAuthError('REQUEST_INVALID')
          const id = Number(parts[5])
          if (!Number.isSafeInteger(id)) throw new ControllerClientAuthError('REQUEST_INVALID')
          if (parts.length === 6) {
            if (url.search) throw new ControllerClientAuthError('REQUEST_INVALID')
            return { ...meta, ...this.model.app(id, sampled) }
          }
          if (parts.length === 7 && ['jobs', 'deployments', 'history'].includes(parts[6]))
            return {
              ...meta,
              ...this.model.collection(
                id,
                parts[6] as 'jobs' | 'deployments' | 'history',
                url.searchParams,
                sampled
              )
            }
          this.model.app(id, sampled) // Unsupported app routes still recheck current app authority.
        }
        throw new ControllerClientAuthError('UNSUPPORTED')
      })()
      if (writeRoute) {
        delegated = true
        this.writes!.handle(request, response, url, requestId)
      } else this.send(response, 200, result)
    } catch (error) {
      this.failure(response, error, requestId)
    } finally {
      if (!delegated) request.resume()
    }
    return true
  }

  private failure(response: ServerResponse, error: unknown, requestId: string): void {
    const code = error instanceof ControllerClientAuthError ? error.code : 'INTERNAL_ERROR'
    const status =
      error instanceof ControllerRequestBodyError
        ? error.httpStatus
        : code === 'AUTH_REQUIRED' ||
            code === 'CREDENTIAL_EXPIRED' ||
            code === 'CREDENTIAL_REVOKED' ||
            code === 'CLIENT_REVOKED'
          ? 401
          : code === 'CONTROLLER_MISMATCH' || code === 'SCOPE_REQUIRED'
            ? 403
            : code === 'APP_NOT_FOUND' || code === 'NOT_FOUND'
              ? 404
              : code === 'REQUEST_INVALID'
                ? 400
                : code === 'CAPABILITY_BLOCKED'
                  ? 503
                  : [
                        'OWNERSHIP_STALE',
                        'SOURCE_GENERATION_STALE',
                        'IDEMPOTENCY_CONFLICT',
                        'NO_DESIRED_TARGET',
                        'TARGET_SHA_UNAVAILABLE',
                        'RECONCILIATION_REQUIRED'
                      ].includes(code)
                    ? 409
                    : code === 'UNSUPPORTED'
                      ? 501
                      : 500
    this.error(response, status, code, requestId)
  }

  private status(sampled: string): ProductControllerStatus {
    const count = (states: string[]): number =>
      (
        this.database
          .prepare(
            `SELECT count(*) AS n FROM product_deploy_job WHERE controller_id=? AND state IN (${states.map(() => '?').join(',')})`
          )
          .get(this.controllerId, ...states) as { n: number }
      ).n
    let storage: ProductControllerStatus['storage_state'] = 'unknown'
    try {
      const fs = statfsSync(this.directory, { bigint: true })
      storage = fs.bavail * fs.bsize > BigInt(PRODUCT_RESOURCE_MIN_DISK_BYTES) ? 'ok' : 'low'
    } catch {
      /* No fabricated storage evidence. */
    }
    const state = this.state()
    return {
      controller_id: this.controllerId,
      service_state: state.service_state,
      last_branch_poll_at: state.last_branch_poll_at,
      next_branch_poll_at: null,
      queued_job_count: count(['queued', 'retry_wait']),
      active_job_count: count(['claimed', 'deploying']),
      uncertain_job_count: count(['uncertain']),
      storage_state: storage,
      reason_code: state.reason_code,
      sampled_at: sampled
    }
  }
  private error(
    response: ServerResponse,
    status: number,
    code: ProductApiErrorCode,
    requestId: string
  ): void {
    this.send(response, status, {
      error: {
        code,
        message: code,
        retryable: code === 'RATE_LIMITED' || code === 'CAPABILITY_BLOCKED',
        request_id: requestId,
        ...(code === 'RATE_LIMITED' ? { retry_after_seconds: 60 } : {})
      }
    })
  }
  private send(response: ServerResponse, status: number, value: unknown): void {
    if (response.destroyed || response.writableEnded) return
    let body = JSON.stringify(value)
    if (Buffer.byteLength(body) > PRODUCT_CONTROLLER_API_MAX_RESPONSE_BYTES) {
      status = 500
      body = JSON.stringify({
        error: {
          code: 'INTERNAL_ERROR',
          message: 'INTERNAL_ERROR',
          retryable: false,
          request_id: randomUUID()
        }
      })
    }
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      connection: 'close',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...(status === 401 ? { 'www-authenticate': 'Bearer' } : {}),
      ...(status === 429 ? { 'retry-after': '60' } : {})
    })
    response.end(body)
  }
}
