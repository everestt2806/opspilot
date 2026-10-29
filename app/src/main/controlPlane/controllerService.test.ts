import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import { closeDatabase } from '../db'
import { ProductDeployRepository } from '../db/productDeployRepository'
import type { ProductClaimToken } from '../../../../docs/contracts/product-auto-deploy'
import { initializeController, openControllerDatabase } from './controllerDatabase'
import { ControllerService } from './controllerService'
import { ControlPlaneJobWorker, type ProductExecutorResult } from './queueWorker'
import type { ControlPlaneGitPoller } from './gitPoller'

let directory: string | null = null
let service: ControllerService | null = null

afterEach(async () => {
  await service?.close().catch(() => undefined)
  service = null
  closeDatabase()
  if (directory) rmSync(directory, { recursive: true, force: true })
  directory = null
})

describe('independent Product controller service', () => {
  it('serves only minimal loopback health, then cancels polling and closes cleanly', async () => {
    directory = mkdtempSync(join(tmpdir(), 'opspilot-controller-service-'))
    initializeController(directory)
    service = new ControllerService({ dataDirectory: directory })
    await service.start()
    expect(service.workerStatus).toMatchObject({
      state: 'polling_only',
      reason: 'executor_not_configured',
      executorConfigured: false
    })

    const health = await fetch('http://127.0.0.1:8768/healthz')
    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({ api_version: 'v1', service_state: 'ready' })
    const hiddenApi = await fetch('http://127.0.0.1:8768/v1/controllers/controller/apps')
    expect(hiddenApi.status).toBe(404)
    expect(await hiddenApi.text()).toBe('')

    service.requestStop()
    await service.waitForStop()
    await service.close()
    service = null
    const closed = await fetch('http://127.0.0.1:8768/healthz').catch(() => null)
    expect(closed).toBeNull()
  })

  it('aborts the active worker on poller failure and waits for its slow stop before closing SQLite', async () => {
    directory = createControllerFixture('service-slow-stop-job')
    const executorStarted = deferred<void>()
    const pollerFailed = deferred<void>()
    const executorStopped = deferred<void>()
    let repository: ProductDeployRepository | null = null
    let claim: ProductClaimToken | null = null
    let worker: ControlPlaneJobWorker | null = null
    const poller = {
      getLastSummary: () => null,
      run: async (): Promise<void> => {
        await executorStarted.promise
        pollerFailed.resolve()
        throw new Error('TEST_POLL_FAILURE')
      }
    } as unknown as ControlPlaneGitPoller
    service = new ControllerService({
      dataDirectory: directory,
      poller,
      workerFactory: (candidateRepository, controllerId) => {
        repository = candidateRepository
        const createdWorker = new ControlPlaneJobWorker({
          repository,
          controllerId,
          pollIntervalMs: 10,
          heartbeatIntervalMs: 10_000,
          stopGraceMs: 500,
          admission: { check: () => ({ state: 'ready' }) },
          executor: {
            execute: async (activeClaim, signal): Promise<ProductExecutorResult> => {
              claim = activeClaim
              executorStarted.resolve()
              await waitForAbort(signal)
              await delay(150)
              executorStopped.resolve()
              return { state: 'stopped_before_write' }
            }
          }
        })
        worker = createdWorker
        return createdWorker
      }
    })
    await service.start()
    await pollerFailed.promise
    expect(service.workerStatus.state).toBe('executing')
    expect(worker!.canCloseDatabase()).toBe(false)
    expect(repository).not.toBeNull()
    expect(claim).not.toBeNull()
    expect(repository!.readClaimExecutionState(claim!)).toBe('prewrite')

    const stopping = service.waitForStop()
    const close = service.close()
    const concurrentClose = service.close()
    expect(close).toBe(concurrentClose)
    let closeSettled = false
    void close.then(
      () => {
        closeSettled = true
      },
      () => {
        closeSettled = true
      }
    )
    await delay(30)
    expect(closeSettled).toBe(false)
    expect(repository!.readClaimExecutionState(claim!)).toBe('prewrite')

    await executorStopped.promise
    await expect(stopping).rejects.toThrow('CONTROL_PLANE_RUNTIME_FAILED')
    await expect(close).rejects.toThrow('CONTROL_PLANE_RUNTIME_FAILED')
    expect(service.workerStatus.state).toBe('reconciliation_required')
    expect(() => repository!.readClaimExecutionState(claim!)).toThrow()
    service = null
    expect(readJobAndLeaseState(directory, 'service-slow-stop-job')).toEqual({
      state: 'claimed',
      app_leases: 1,
      build_leases: 1,
      deployments: 0
    })
  })

  it('waits for poller cleanup when the worker fails, then preserves SQLite state', async () => {
    directory = createControllerFixture('service-worker-failure-job')
    const pollerCleanupRead = deferred<void>()
    const workerFailed = deferred<void>()
    let repository: ProductDeployRepository | null = null
    let capturedControllerId = ''
    const poller = {
      getLastSummary: () => null,
      run: (signal: AbortSignal): Promise<void> =>
        new Promise((resolve) => {
          const cleanup = async (): Promise<void> => {
            await delay(120)
            repository!.listGitPollTargets(capturedControllerId)
            pollerCleanupRead.resolve()
            resolve()
          }
          if (signal.aborted) void cleanup()
          else signal.addEventListener('abort', () => void cleanup(), { once: true })
        })
    } as unknown as ControlPlaneGitPoller
    service = new ControllerService({
      dataDirectory: directory,
      poller,
      workerFactory: (candidateRepository, controllerId) => {
        repository = candidateRepository
        capturedControllerId = controllerId
        const failingRepository = new Proxy(candidateRepository, {
          get(target, property, receiver) {
            if (property === 'claimNextJob') {
              return (): never => {
                workerFailed.resolve()
                throw new Error('TEST_WORKER_FAILURE')
              }
            }
            const value = Reflect.get(target, property, receiver) as unknown
            return typeof value === 'function' ? value.bind(target) : value
          }
        })
        return new ControlPlaneJobWorker({
          repository: failingRepository,
          controllerId,
          pollIntervalMs: 10,
          admission: { check: () => ({ state: 'ready' }) },
          executor: { execute: async () => ({ state: 'stopped_before_write' }) }
        })
      }
    })
    await service.start()
    await workerFailed.promise
    const stopping = service.waitForStop()
    const close = service.close()
    const concurrentClose = service.close()
    expect(close).toBe(concurrentClose)
    await pollerCleanupRead.promise
    expect(repository).not.toBeNull()
    await expect(stopping).rejects.toThrow('CONTROL_PLANE_RUNTIME_FAILED')
    await expect(close).rejects.toThrow('CONTROL_PLANE_RUNTIME_FAILED')
    expect(() => repository!.listGitPollTargets(capturedControllerId)).toThrow()
    service = null
    expect(readJobAndLeaseState(directory, 'service-worker-failure-job')).toEqual({
      state: 'queued',
      app_leases: 0,
      build_leases: 0,
      deployments: 0
    })
  })

  it('keeps DB open and claim durable when executor does not confirm stop before deadline', async () => {
    directory = createControllerFixture('service-unconfirmed-stop-job')
    const executorStarted = deferred<void>()
    const releaseExecutor = deferred<void>()
    let repository: ProductDeployRepository | null = null
    let claim: ProductClaimToken | null = null
    let worker: ControlPlaneJobWorker | null = null
    const poller = {
      getLastSummary: () => null,
      run: (signal: AbortSignal): Promise<void> =>
        new Promise((resolve) => {
          if (signal.aborted) resolve()
          else signal.addEventListener('abort', () => resolve(), { once: true })
        })
    } as unknown as ControlPlaneGitPoller
    service = new ControllerService({
      dataDirectory: directory,
      poller,
      workerFactory: (candidateRepository, controllerId) => {
        repository = candidateRepository
        const createdWorker = new ControlPlaneJobWorker({
          repository,
          controllerId,
          pollIntervalMs: 10,
          heartbeatIntervalMs: 10_000,
          stopGraceMs: 35,
          admission: { check: () => ({ state: 'ready' }) },
          executor: {
            execute: async (activeClaim): Promise<ProductExecutorResult> => {
              claim = activeClaim
              executorStarted.resolve()
              await releaseExecutor.promise
              return {
                state: 'prewrite_failure',
                disposition: 'transient_failure',
                safeErrorCode: 'GIT_UNAVAILABLE'
              }
            }
          }
        })
        worker = createdWorker
        return createdWorker
      }
    })
    await service.start()
    await executorStarted.promise
    expect(service.workerStatus.state).toBe('executing')
    expect(worker!.canCloseDatabase()).toBe(false)
    const close = service.close()
    const concurrentClose = service.close()
    expect(close).toBe(concurrentClose)
    await expect(close).rejects.toThrow('WORKER_TASK_STOP_UNCONFIRMED')
    expect(service.workerStatus.state).toBe('task_stop_unconfirmed')
    expect(repository!.readClaimExecutionState(claim!)).toBe('prewrite')

    releaseExecutor.resolve()
    await delay(25)
    expect(repository!.readClaimExecutionState(claim!)).toBe('prewrite')
    expect(readJobAndLeaseState(directory, 'service-unconfirmed-stop-job')).toEqual({
      state: 'claimed',
      app_leases: 1,
      build_leases: 1,
      deployments: 0
    })
    const database = (service as unknown as { opened: { database: Database.Database } }).opened
      .database
    database.close()
    service = null
  })
})

const CONFIG_HASH = 'a'.repeat(64)
const TARGET_SHA = 'b'.repeat(40)

function createControllerFixture(jobId: string): string {
  const path = mkdtempSync(join(tmpdir(), 'opspilot-controller-lifecycle-'))
  initializeController(path)
  const opened = openControllerDatabase(path)
  const now = new Date().toISOString()
  opened.database.exec(`
    INSERT INTO vps(id,name,host,username,auth_type,encrypted_secret)
      VALUES(1,'fixture-vps','fixture.invalid','worker-test','key',X'00');
    INSERT INTO app(id,vps_id,name,framework,host_port,container_port,source_type,git_repo_url,git_ref,git_root)
      VALUES(1,1,'worker-app','express',30001,3000,'git','https://example.test/repository.git','main','.');
    INSERT INTO product_source_config
      (app_id,source_generation,repository_url,production_ref,repository_root,deploy_config_json,config_sha256,created_at)
      VALUES(1,1,'https://example.test/repository.git','main','.','{}','${CONFIG_HASH}','${now}');
    INSERT INTO product_app_control
      (app_id,mode,controller_id,ownership_generation,source_generation,source_config_sha256,changed_at,
       auto_deploy_paused,pause_policy_provenance)
      VALUES(1,'product','${opened.controllerId}',1,1,'${CONFIG_HASH}','${now}',0,'legacy_clean');
    INSERT INTO product_deploy_job
      (job_id,controller_id,app_id,ownership_generation,source_generation,source_config_sha256,
       trigger,idempotency_key,ref,target_sha,state,attempt_count,max_attempts,available_at,created_at,updated_at)
      VALUES('${jobId}','${opened.controllerId}',1,1,1,'${CONFIG_HASH}',
       'manual_redeploy','manual:${jobId}','main','${TARGET_SHA}','queued',0,3,
       '${now}','${now}','${now}');
  `)
  opened.database.close()
  return path
}

function readJobAndLeaseState(
  path: string,
  jobId: string
): { state: string; app_leases: number; build_leases: number; deployments: number } {
  const opened = openControllerDatabase(path)
  try {
    const row = opened.database
      .prepare(
        `SELECT j.state,
                (SELECT COUNT(*) FROM product_app_lease WHERE job_id=j.job_id AND released_at IS NULL) AS app_leases,
                (SELECT COUNT(*) FROM product_worker_lease WHERE job_id=j.job_id AND released_at IS NULL) AS build_leases,
                (SELECT COUNT(*) FROM deployment WHERE app_id=j.app_id) AS deployments
         FROM product_deploy_job j WHERE j.job_id=?`
      )
      .get(jobId) as {
      state: string
      app_leases: number
      build_leases: number
      deployments: number
    }
    return row
  } finally {
    opened.database.close()
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
}
