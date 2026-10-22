import { createServer, type Server } from 'node:http'

import { ProductDeployRepository } from '../db/productDeployRepository'
import { openControllerDatabase } from './controllerDatabase'
import { ControlPlaneGitPoller } from './gitPoller'
import { ControlPlaneJobWorker, type ControlPlaneWorkerStatus } from './queueWorker'

export const CONTROL_PLANE_HEALTH_HOST = '127.0.0.1'
export const CONTROL_PLANE_HEALTH_PORT = 8768

export interface ControllerServiceOptions {
  dataDirectory: string
  poller?: ControlPlaneGitPoller
  worker?: ControlPlaneJobWorker
}

export class ControllerService {
  private readonly opened: ReturnType<typeof openControllerDatabase>
  private readonly poller: ControlPlaneGitPoller
  private readonly worker: ControlPlaneJobWorker
  private readonly stopController = new AbortController()
  private server: Server | null = null
  private listening = false
  private runtimeTask: Promise<void> | null = null
  private fatal = false
  private closed = false

  constructor(options: ControllerServiceOptions) {
    this.opened = openControllerDatabase(options.dataDirectory)
    const repository = new ProductDeployRepository(this.opened.database)
    this.poller =
      options.poller ??
      new ControlPlaneGitPoller({ repository, controllerId: this.opened.controllerId })
    this.worker =
      options.worker ??
      new ControlPlaneJobWorker({ repository, controllerId: this.opened.controllerId })
  }

  get controllerId(): string {
    return this.opened.controllerId
  }

  get workerStatus(): ControlPlaneWorkerStatus {
    return this.worker.getStatus()
  }

  requestStop(): void {
    this.stopController.abort()
  }

  async start(): Promise<void> {
    if (this.server) throw new Error('CONTROLLER_ALREADY_STARTED')
    const server = createServer((request, response) => {
      if (request.method === 'GET' && request.url === '/healthz') {
        const body = JSON.stringify({
          api_version: 'v1',
          service_state:
            this.poller.getLastSummary()?.errorCount ||
            ['reconciliation_required', 'task_stop_unconfirmed', 'unsupported_job'].includes(
              this.worker.getStatus().state
            )
              ? 'degraded'
              : 'ready'
        })
        response.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(body),
          connection: 'close'
        })
        response.end(body)
        return
      }
      response.writeHead(404, { 'content-length': '0', connection: 'close' })
      response.end()
    })
    this.server = server

    try {
      await new Promise<void>((resolve, reject) => {
        server.on('error', () => {
          if (!this.listening) reject(new Error('CONTROL_PLANE_BIND_FAILED'))
          else {
            this.fatal = true
            this.stopController.abort()
          }
        })
        server.listen(CONTROL_PLANE_HEALTH_PORT, CONTROL_PLANE_HEALTH_HOST, () => {
          this.listening = true
          resolve()
        })
      })
    } catch (error) {
      await this.close()
      throw error
    }

    this.runtimeTask = Promise.all([
      this.poller.run(this.stopController.signal),
      this.worker.run(this.stopController.signal)
    ]).then(
      () => undefined,
      () => {
        this.fatal = true
        this.stopController.abort()
      }
    )
  }

  async waitForStop(): Promise<void> {
    if (!this.runtimeTask) throw new Error('CONTROLLER_NOT_STARTED')
    await this.runtimeTask
    if (this.fatal) throw new Error('CONTROL_PLANE_RUNTIME_FAILED')
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.stopController.abort()
    if (this.server && this.listening) {
      await new Promise<void>((resolve) => this.server?.close(() => resolve()))
      this.listening = false
    }
    await this.runtimeTask
    if (!this.worker.canCloseDatabase()) {
      throw new Error('WORKER_TASK_STOP_UNCONFIRMED')
    }
    this.opened.database.close()
  }
}
