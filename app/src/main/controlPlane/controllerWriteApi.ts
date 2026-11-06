import type { IncomingMessage, ServerResponse } from 'node:http'
import { ControllerCommands } from './controllerCommands'
import { ControllerClientAuthError } from './controllerClientAuth'
import { readControllerRequestBody } from './controllerRequestBody'
import type { ProductControllerApiMeta } from '../../../../docs/contracts/product-controller-api'

type Respond = (response: ServerResponse, status: number, value: unknown) => void
type Fail = (response: ServerResponse, error: unknown, requestId: string) => void

/** Handler bất đồng bộ phải được drain trước khi service đóng SQLite. */
export class ControllerWriteApi {
  private readonly abort = new AbortController()
  private readonly pending = new Set<Promise<void>>()
  private readonly onStop = (): void => this.abort.abort()
  constructor(
    private readonly commands: ControllerCommands,
    private readonly controllerId: string,
    private readonly respond: Respond,
    private readonly fail: Fail,
    private readonly signal?: AbortSignal
  ) {
    signal?.addEventListener('abort', this.onStop, { once: true })
    if (signal?.aborted) this.onStop()
  }
  handles(request: IncomingMessage, url: URL): boolean {
    const parts = url.pathname.split('/')
    return (
      request.method === 'POST' &&
      parts.length === 7 &&
      parts[1] === 'v1' &&
      parts[2] === 'controllers' &&
      parts[3] === this.controllerId &&
      parts[4] === 'apps' &&
      ['redeploy', 'auto-deploy-policy'].includes(parts[6])
    )
  }
  handle(request: IncomingMessage, response: ServerResponse, url: URL, requestId: string): void {
    const task = this.process(request, response, url, requestId)
    this.pending.add(task)
    void task.then(
      () => this.pending.delete(task),
      () => this.pending.delete(task)
    )
  }
  lookup(authorization: unknown, key: unknown): ReturnType<ControllerCommands['lookup']> {
    return this.commands.lookup(authorization, key)
  }
  async close(): Promise<void> {
    this.abort.abort()
    await Promise.allSettled([...this.pending])
    this.signal?.removeEventListener('abort', this.onStop)
  }
  private async process(
    request: IncomingMessage,
    response: ServerResponse,
    url: URL,
    requestId: string
  ): Promise<void> {
    try {
      if (this.abort.signal.aborted) throw new ControllerClientAuthError('CAPABILITY_BLOCKED')
      if (url.search) throw new ControllerClientAuthError('REQUEST_INVALID')
      const parts = url.pathname.split('/'),
        appId = Number(parts[5])
      if (!/^[1-9][0-9]*$/.test(parts[5]) || !Number.isSafeInteger(appId))
        throw new ControllerClientAuthError('REQUEST_INVALID')
      const keys = request.rawHeaders
        .filter((_, index) => index % 2 === 0)
        .filter((name) => name.toLowerCase() === 'idempotency-key')
      if (
        keys.length !== 1 ||
        typeof request.headers['idempotency-key'] !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          request.headers['idempotency-key']
        )
      )
        throw new ControllerClientAuthError('REQUEST_INVALID')
      const body = await readControllerRequestBody(request, this.abort.signal)
      if (this.abort.signal.aborted) throw new ControllerClientAuthError('CAPABILITY_BLOCKED')
      const key = request.headers['idempotency-key'],
        header = request.headers.authorization
      const result =
        parts[6] === 'redeploy'
          ? this.commands.redeploy(header, key, appId, body)
          : this.commands.policy(header, key, appId, body)
      const meta: ProductControllerApiMeta = {
        controller_id: this.controllerId,
        request_id: requestId,
        sampled_at: new Date().toISOString(),
        data_freshness: 'current'
      }
      this.respond(response, parts[6] === 'redeploy' ? 202 : 200, { ...meta, ...result })
    } catch (error) {
      this.fail(response, error, requestId)
    } finally {
      request.resume()
    }
  }
}
