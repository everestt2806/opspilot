import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { closeDatabase, initializeDatabase } from '../db'
import { ProductDeployRepository } from '../db/productDeployRepository'
import type { ProductClaimToken } from '../../../../docs/contracts/product-auto-deploy'
import {
  ControlPlaneJobWorker,
  type ProductExecutorResult,
  type ProductJobExecutor,
  type ProductResourceAdmission
} from './queueWorker'

const CONTROLLER_ID = 'queue-worker-controller'
const CONFIG_HASH = 'a'.repeat(64)
const TARGET_SHA = 'b'.repeat(40)

let directory: string | null = null
let primary: Database.Database | null = null
const secondaryConnections: Database.Database[] = []

afterEach(() => {
  for (const connection of secondaryConnections) {
    if (connection.open) connection.close()
  }
  secondaryConnections.length = 0
  if (primary?.open) primary.close()
  primary = null
  closeDatabase()
  if (directory) rmSync(directory, { recursive: true, force: true })
  directory = null
})

describe('Product durable queue worker', () => {
  it('keeps runtime polling-only without an executor and defers admission before claim', async () => {
    const fixture = createFixture()
    seedManualJob(fixture.database, 'queued-job')
    const pollingOnly = createWorker(fixture.repository)
    const pollingStop = new AbortController()
    const pollingRun = pollingOnly.run(pollingStop.signal)
    expect(pollingOnly.getStatus()).toMatchObject({
      state: 'polling_only',
      reason: 'executor_not_configured'
    })
    pollingStop.abort()
    await pollingRun
    expect(readJobState(fixture.database, 'queued-job')).toBe('queued')

    const executor = createStoppingExecutor()
    const blocked = createWorker(fixture.repository, executor, {
      check: () => ({ state: 'deferred', reason: 'resource_unknown' })
    })
    const stop = new AbortController()
    const run = blocked.run(stop.signal)
    await waitFor(() => blocked.getStatus().state === 'admission_blocked')
    stop.abort()
    await run
    expect(executor.execute).not.toHaveBeenCalled()
    expect(readJobState(fixture.database, 'queued-job')).toBe('queued')
    expect(count(fixture.database, 'product_deploy_attempt')).toBe(0)
  })

  it('competing workers on separate SQLite connections invoke only one executor and preserve manual priority', async () => {
    const fixture = createFixture()
    seedAutoJob(fixture.database, 'auto-job')
    seedManualJob(fixture.database, 'manual-job')
    const secondDatabase = openSecondConnection()
    const firstRepository = fixture.repository
    const secondRepository = new ProductDeployRepository(secondDatabase)
    const entered = deferred<void>()
    const executor: ProductJobExecutor = {
      execute: vi.fn(
        async (_claim: ProductClaimToken, signal: AbortSignal): Promise<ProductExecutorResult> => {
          entered.resolve()
          await waitForAbort(signal)
          return { state: 'stopped_before_write' }
        }
      )
    }
    const first = createWorker(firstRepository, executor)
    const secondExecutor = createStoppingExecutor()
    const second = createWorker(secondRepository, secondExecutor)
    const stopFirst = new AbortController()
    const stopSecond = new AbortController()
    const firstRun = first.run(stopFirst.signal)
    const secondRun = second.run(stopSecond.signal)

    await entered.promise
    await waitFor(() => second.getStatus().state === 'claim_blocked')
    expect(executor.execute).toHaveBeenCalledTimes(1)
    expect(executor.execute).toHaveBeenCalledWith(
      expect.objectContaining({ job_id: 'manual-job', attempt_number: 1 }),
      expect.any(AbortSignal)
    )

    stopFirst.abort()
    stopSecond.abort()
    await Promise.all([firstRun, secondRun])
    expect(first.getStatus().state).toBe('reconciliation_required')
    expect(secondExecutor.execute).not.toHaveBeenCalled()
    expect(readJobState(fixture.database, 'manual-job')).toBe('claimed')
    expect(countActiveLeases(fixture.database)).toEqual({ app: 1, build: 1 })
  })

  it('renews leases serially at the configured interval and aborts on heartbeat rejection', async () => {
    const fixture = createFixture()
    seedManualJob(fixture.database, 'heartbeat-job')
    const claimSeen = deferred<void>()
    let initialExpiry = ''
    const executor: ProductJobExecutor = {
      execute: vi.fn(
        async (_claim: ProductClaimToken, signal: AbortSignal): Promise<ProductExecutorResult> => {
          initialExpiry = _claim.expires_at
          claimSeen.resolve()
          await waitForAbort(signal)
          return { state: 'stopped_before_write' }
        }
      )
    }
    const heartbeat = vi.spyOn(fixture.repository, 'heartbeatClaim')
    const worker = createWorker(fixture.repository, executor, undefined, {
      heartbeatIntervalMs: 15
    })
    const stop = new AbortController()
    const run = worker.run(stop.signal)
    await claimSeen.promise
    await waitFor(() => heartbeat.mock.calls.length > 0)
    expect(heartbeat.mock.calls.length).toBeGreaterThan(0)
    const currentExpiries = fixture.database
      .prepare('SELECT expires_at FROM product_app_lease WHERE released_at IS NULL')
      .all() as Array<{ expires_at: string }>
    const buildExpiry = fixture.database
      .prepare('SELECT expires_at FROM product_worker_lease WHERE released_at IS NULL')
      .get() as { expires_at: string }
    expect(Date.parse(currentExpiries[0].expires_at)).toBeGreaterThan(Date.parse(initialExpiry))
    expect(Date.parse(buildExpiry.expires_at)).toBeGreaterThan(Date.parse(initialExpiry))
    stop.abort()
    await run
    expect(worker.getStatus().state).toBe('reconciliation_required')
    expect(countActiveLeases(fixture.database)).toEqual({ app: 1, build: 1 })

    const rejectedFixture = createFixture()
    seedManualJob(rejectedFixture.database, 'heartbeat-reject-job')
    const rejectedExecutor = createStoppingExecutor()
    vi.spyOn(rejectedFixture.repository, 'heartbeatClaim').mockReturnValue({
      state: 'rejected',
      reason: 'expired_lease'
    })
    const rejectedWorker = createWorker(rejectedFixture.repository, rejectedExecutor, undefined, {
      heartbeatIntervalMs: 15
    })
    const rejectedRun = rejectedWorker.run(new AbortController().signal)
    await waitFor(() => rejectedWorker.getStatus().state === 'reconciliation_required')
    await rejectedRun
    expect(rejectedExecutor.execute).toHaveBeenCalledTimes(1)
    expect(readJobState(rejectedFixture.database, 'heartbeat-reject-job')).toBe('claimed')
    expect(countActiveLeases(rejectedFixture.database)).toEqual({ app: 1, build: 1 })

    const databaseErrorFixture = createFixture()
    seedManualJob(databaseErrorFixture.database, 'heartbeat-error-job')
    const databaseErrorExecutor = createStoppingExecutor()
    vi.spyOn(databaseErrorFixture.repository, 'heartbeatClaim').mockImplementation(() => {
      throw new Error('TEST_DATABASE_FAILURE')
    })
    const databaseErrorWorker = createWorker(
      databaseErrorFixture.repository,
      databaseErrorExecutor,
      undefined,
      { heartbeatIntervalMs: 15 }
    )
    const databaseErrorRun = databaseErrorWorker.run(new AbortController().signal)
    await waitFor(() => databaseErrorWorker.getStatus().state === 'reconciliation_required')
    await databaseErrorRun
    expect(databaseErrorWorker.getStatus().reason).toBe('heartbeat_database_error')
    expect(databaseErrorExecutor.execute).toHaveBeenCalledTimes(1)
    expect(readJobState(databaseErrorFixture.database, 'heartbeat-error-job')).toBe('claimed')
    expect(countActiveLeases(databaseErrorFixture.database)).toEqual({ app: 1, build: 1 })

    const racingFixture = createFixture()
    seedManualJob(racingFixture.database, 'heartbeat-race-job')
    const completion = deferred<ProductExecutorResult>()
    const racingExecutor: ProductJobExecutor = { execute: vi.fn(() => completion.promise) }
    const finish = vi.spyOn(racingFixture.repository, 'finishPrewriteAttempt')
    vi.spyOn(racingFixture.repository, 'heartbeatClaim').mockImplementation(() => {
      completion.resolve({
        state: 'prewrite_failure',
        disposition: 'transient_failure',
        safeErrorCode: 'GIT_UNAVAILABLE'
      })
      return { state: 'rejected', reason: 'expired_lease' }
    })
    const racingWorker = createWorker(racingFixture.repository, racingExecutor, undefined, {
      heartbeatIntervalMs: 15
    })
    const racingRun = racingWorker.run(new AbortController().signal)
    await waitFor(() => racingWorker.getStatus().state === 'reconciliation_required')
    await racingRun
    expect(racingWorker.getStatus().reason).toBe('heartbeat_rejected')
    expect(finish).not.toHaveBeenCalled()
    expect(readJobState(racingFixture.database, 'heartbeat-race-job')).toBe('claimed')
    expect(countActiveLeases(racingFixture.database)).toEqual({ app: 1, build: 1 })
  })

  it('uses repository pre-write retry/backoff and respects a future available_at', async () => {
    const fixture = createFixture()
    seedManualJob(fixture.database, 'future-job', {
      state: 'retry_wait',
      attemptCount: 1,
      availableAt: new Date(Date.now() + 60_000).toISOString()
    })
    const executor = createStoppingExecutor()
    const worker = createWorker(fixture.repository, executor)
    const stop = new AbortController()
    const run = worker.run(stop.signal)
    await waitFor(() => worker.getStatus().state === 'idle')
    stop.abort()
    await run
    expect(executor.execute).not.toHaveBeenCalled()
    expect(readJobState(fixture.database, 'future-job')).toBe('retry_wait')
    expect(count(fixture.database, 'product_deploy_attempt')).toBe(0)

    const retryFixture = createFixture()
    seedManualJob(retryFixture.database, 'retry-job')
    const retryExecutor: ProductJobExecutor = {
      execute: vi.fn(async (): Promise<ProductExecutorResult> => ({
        state: 'prewrite_failure',
        disposition: 'transient_failure',
        safeErrorCode: 'GIT_UNAVAILABLE'
      }))
    }
    const retryWorker = createWorker(retryFixture.repository, retryExecutor)
    const retryStop = new AbortController()
    const retryRun = retryWorker.run(retryStop.signal)
    await waitFor(() => retryWorker.getStatus().state === 'idle')
    retryStop.abort()
    await retryRun
    expect(retryExecutor.execute).toHaveBeenCalledTimes(1)
    expect(
      retryFixture.database.prepare('SELECT state,attempt_count FROM product_deploy_job').get()
    ).toEqual({
      state: 'retry_wait',
      attempt_count: 1
    })
    expect(
      retryFixture.database
        .prepare('SELECT state,safe_error_code FROM product_deploy_attempt')
        .get()
    ).toEqual({
      state: 'failed',
      safe_error_code: 'GIT_UNAVAILABLE'
    })
    expect(countActiveLeases(retryFixture.database)).toEqual({ app: 0, build: 0 })
  })

  it('does not claim auto work after ownership generation changes or auto deploy is paused', async () => {
    const cases = [
      {
        jobId: 'ownership-changed-auto-job',
        update: (database: Database.Database): void => {
          database
            .prepare('UPDATE product_app_control SET ownership_generation=2 WHERE app_id=1')
            .run()
        }
      },
      {
        jobId: 'paused-auto-job',
        update: (database: Database.Database): void => {
          database
            .prepare(
              "UPDATE product_app_control SET auto_deploy_paused=1, pause_reason='operator', pause_policy_provenance='explicit' WHERE app_id=1"
            )
            .run()
        }
      }
    ]
    for (const scenario of cases) {
      const fixture = createFixture()
      seedAutoJob(fixture.database, scenario.jobId)
      scenario.update(fixture.database)
      const executor = createStoppingExecutor()
      const worker = createWorker(fixture.repository, executor)
      const stop = new AbortController()
      const run = worker.run(stop.signal)
      await waitFor(() => worker.getStatus().state === 'idle')
      stop.abort()
      await run
      expect(executor.execute).not.toHaveBeenCalled()
      expect(readJobState(fixture.database, scenario.jobId)).toBe('queued')
      expect(count(fixture.database, 'product_deploy_attempt')).toBe(0)
      expect(countActiveLeases(fixture.database)).toEqual({ app: 0, build: 0 })
    }
  })

  it('reports unsupported rollback work without claiming or running it as a Git redeploy', async () => {
    const fixture = createFixture()
    const now = new Date().toISOString()
    fixture.database
      .prepare(
        "INSERT INTO deployment(app_id,version,image_tag,status) VALUES(1,1,'worker-app:v1','running')"
      )
      .run()
    const targetId = (fixture.database.prepare('SELECT id FROM deployment').get() as { id: number })
      .id
    fixture.database
      .prepare(
        `INSERT INTO product_deploy_job
         (job_id,controller_id,app_id,ownership_generation,source_generation,source_config_sha256,
          trigger,idempotency_key,ref,target_deployment_id,state,attempt_count,max_attempts,
          available_at,created_at,updated_at)
         VALUES('rollback-job',?,1,1,1,?,'manual_rollback','manual:rollback','main',?,'queued',0,3,?,?,?)`
      )
      .run(CONTROLLER_ID, CONFIG_HASH, targetId, now, now, now)
    const executor = createStoppingExecutor()
    const worker = createWorker(fixture.repository, executor)
    const stop = new AbortController()
    const run = worker.run(stop.signal)
    await waitFor(() => worker.getStatus().reason === 'unsupported_trigger')
    await run
    expect(worker.getStatus()).toMatchObject({
      state: 'unsupported_job',
      reason: 'unsupported_trigger'
    })
    expect(executor.execute).not.toHaveBeenCalled()
    expect(readJobState(fixture.database, 'rollback-job')).toBe('queued')
    expect(count(fixture.database, 'product_deploy_attempt')).toBe(0)
  })

  it('does not act on a late executor completion after the stop deadline', async () => {
    const fixture = createFixture()
    seedManualJob(fixture.database, 'late-job')
    const entered = deferred<void>()
    const release = deferred<void>()
    const executor: ProductJobExecutor = {
      execute: vi.fn(async (): Promise<ProductExecutorResult> => {
        entered.resolve()
        await release.promise
        return {
          state: 'prewrite_failure',
          disposition: 'permanent_failure',
          safeErrorCode: 'INVALID_SOURCE_CONFIG'
        }
      })
    }
    const finish = vi.spyOn(fixture.repository, 'finishPrewriteAttempt')
    const worker = createWorker(fixture.repository, executor, undefined, { stopGraceMs: 35 })
    const stop = new AbortController()
    const run = worker.run(stop.signal)
    await entered.promise
    stop.abort()
    await run
    expect(worker.getStatus().state).toBe('task_stop_unconfirmed')
    expect(worker.canCloseDatabase()).toBe(false)
    expect(readJobState(fixture.database, 'late-job')).toBe('claimed')
    expect(countActiveLeases(fixture.database)).toEqual({ app: 1, build: 1 })

    release.resolve()
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10))
    expect(finish).not.toHaveBeenCalled()
    expect(readJobState(fixture.database, 'late-job')).toBe('claimed')
    expect(countActiveLeases(fixture.database)).toEqual({ app: 1, build: 1 })
  })

  it('keeps dispatch-unknown work non-replayable across a database reopen', async () => {
    const fixture = createFixture()
    seedManualJob(fixture.database, 'dispatch-job')
    const executor: ProductJobExecutor = {
      execute: vi.fn(async (claim: ProductClaimToken): Promise<ProductExecutorResult> => {
        const snapshot = {
          repositoryUrl: 'https://example.test/repository.git',
          repositoryRoot: '.',
          commitSha: TARGET_SHA,
          sourceConfigSha256: CONFIG_HASH
        }
        expect(fixture.repository.markGitSnapshotVerified(claim, snapshot)).toEqual({
          state: 'snapshot_verified'
        })
        expect(fixture.repository.beginGitDispatch(claim, snapshot).state).toBe(
          'dispatch_authorized'
        )
        return { state: 'dispatch_marker_committed' }
      })
    }
    const worker = createWorker(fixture.repository, executor)
    const stop = new AbortController()
    const run = worker.run(stop.signal)
    await waitFor(() => worker.getStatus().state === 'reconciliation_required')
    await run
    expect(worker.getStatus().reason).toBe('remote_outcome_unknown')
    expect(fixture.repository.readClaimExecutionState(readClaim(fixture.database))).toBe(
      'dispatch_unknown'
    )
    expect(count(fixture.database, 'deployment')).toBe(1)
    closeFixtureDatabase()

    const reopened = openSecondConnection()
    const afterRestart = ProductDeployRepository.withClockForTest(
      reopened,
      () => Date.now() + 120_000
    )
    const neverReplay: ProductJobExecutor = { execute: vi.fn() }
    const restartWorker = createWorker(afterRestart, neverReplay)
    const restartStop = new AbortController()
    const restartRun = restartWorker.run(restartStop.signal)
    await waitFor(() => restartWorker.getStatus().state === 'reconciliation_required')
    await restartRun
    expect(neverReplay.execute).not.toHaveBeenCalled()
    expect(restartWorker.getStatus().reason).toBe('reconciliation_required')
    expect(count(reopened, 'deployment')).toBe(1)
    expect(readJobState(reopened, 'dispatch-job')).toBe('deploying')
    expect(countActiveLeases(reopened)).toEqual({ app: 1, build: 1 })
  })
})

function createFixture(): { database: Database.Database; repository: ProductDeployRepository } {
  if (directory) {
    closeFixtureDatabase()
    rmSync(directory, { recursive: true, force: true })
  }
  directory = mkdtempSync(join(tmpdir(), 'opspilot-queue-worker-'))
  primary = initializeDatabase(directory)
  primary.exec(`
    INSERT INTO vps(id,name,host,username,auth_type,encrypted_secret)
      VALUES(1,'fixture-vps','fixture.invalid','worker-test','key',X'00');
    INSERT INTO app(id,vps_id,name,framework,host_port,container_port,source_type,git_repo_url,git_ref,git_root)
      VALUES(1,1,'worker-app','express',30001,3000,'git','https://example.test/repository.git','main','.');
    INSERT INTO product_controller(controller_id,created_at,status)
      VALUES('${CONTROLLER_ID}','created','active');
    INSERT INTO product_source_config
      (app_id,source_generation,repository_url,production_ref,repository_root,deploy_config_json,config_sha256,created_at)
      VALUES(1,1,'https://example.test/repository.git','main','.','{}','${CONFIG_HASH}','created');
    INSERT INTO product_app_control
      (app_id,mode,controller_id,ownership_generation,source_generation,source_config_sha256,changed_at,
       auto_deploy_paused,pause_policy_provenance)
      VALUES(1,'product','${CONTROLLER_ID}',1,1,'${CONFIG_HASH}','created',0,'legacy_clean');
  `)
  return { database: primary, repository: new ProductDeployRepository(primary) }
}

function seedManualJob(
  database: Database.Database,
  jobId: string,
  options: { state?: string; attemptCount?: number; availableAt?: string } = {}
): void {
  const now = new Date().toISOString()
  database
    .prepare(
      `INSERT INTO product_deploy_job
       (job_id,controller_id,app_id,ownership_generation,source_generation,source_config_sha256,
        trigger,idempotency_key,ref,target_sha,state,attempt_count,max_attempts,available_at,created_at,updated_at)
       VALUES(?,?,1,1,1,?,'manual_redeploy',?,'main',?,?,?,?,?,?,?)`
    )
    .run(
      jobId,
      CONTROLLER_ID,
      CONFIG_HASH,
      `manual:${jobId}`,
      TARGET_SHA,
      options.state ?? 'queued',
      options.attemptCount ?? 0,
      3,
      options.availableAt ?? now,
      now,
      now
    )
}

function seedAutoJob(database: Database.Database, jobId: string): void {
  const now = new Date().toISOString()
  database
    .prepare(
      `INSERT INTO product_deploy_job
       (job_id,controller_id,app_id,ownership_generation,source_generation,source_config_sha256,
        trigger,idempotency_key,ref,target_sha,observation_sequence,reconcile_epoch,state,
        attempt_count,max_attempts,available_at,created_at,updated_at)
       VALUES(?,?,1,1,1,?,'branch_poll',?,'main',?,1,0,'queued',0,3,?,?,?)`
    )
    .run(jobId, CONTROLLER_ID, CONFIG_HASH, 'auto:1:1:0', TARGET_SHA, now, now, now)
  database
    .prepare(
      `INSERT INTO product_branch_observation
       (app_id,source_generation,ref,observation_sequence,observed_sha,observed_at)
       VALUES(1,1,'main',1,?,?)`
    )
    .run(TARGET_SHA, now)
  database
    .prepare(
      `INSERT INTO product_desired_branch
       (app_id,source_generation,ref,desired_observation_sequence,desired_sha,reconcile_epoch,
        reconciliation_state,reconciliation_job_id,auto_paused,updated_at)
       VALUES(1,1,'main',1,?,0,'queued',?,0,?)`
    )
    .run(TARGET_SHA, jobId, now)
}

function createWorker(
  repository: ProductDeployRepository,
  executor?: ProductJobExecutor,
  admission: { check(): ProductResourceAdmission } = { check: () => ({ state: 'ready' }) },
  timing: { pollIntervalMs?: number; heartbeatIntervalMs?: number; stopGraceMs?: number } = {}
): ControlPlaneJobWorker {
  return new ControlPlaneJobWorker({
    repository,
    controllerId: CONTROLLER_ID,
    executor,
    admission,
    pollIntervalMs: 10,
    heartbeatIntervalMs: 10_000,
    stopGraceMs: 200,
    ...timing
  })
}

function createStoppingExecutor(): ProductJobExecutor {
  return {
    execute: vi.fn(
      async (_claim: ProductClaimToken, signal: AbortSignal): Promise<ProductExecutorResult> => {
        await waitForAbort(signal)
        return { state: 'stopped_before_write' }
      }
    )
  }
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => (resolve = resolvePromise))
  return { promise, resolve }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('WORKER_TEST_WAIT_TIMEOUT')
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 5))
  }
}

function readJobState(database: Database.Database, jobId: string): string {
  return (
    database.prepare('SELECT state FROM product_deploy_job WHERE job_id=?').get(jobId) as {
      state: string
    }
  ).state
}

function count(database: Database.Database, table: string): number {
  if (!/^product_[a-z_]+$/.test(table) && table !== 'deployment') throw new Error('INVALID_TABLE')
  return (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number })
    .count
}

function countActiveLeases(database: Database.Database): { app: number; build: number } {
  return {
    app: (
      database
        .prepare('SELECT COUNT(*) AS count FROM product_app_lease WHERE released_at IS NULL')
        .get() as {
        count: number
      }
    ).count,
    build: (
      database
        .prepare('SELECT COUNT(*) AS count FROM product_worker_lease WHERE released_at IS NULL')
        .get() as {
        count: number
      }
    ).count
  }
}

function openSecondConnection(): Database.Database {
  const connection = new Database(join(directory!, 'opspilot.db'))
  connection.pragma('foreign_keys = ON')
  secondaryConnections.push(connection)
  return connection
}

function closeFixtureDatabase(): void {
  if (primary?.open) primary.close()
  primary = null
  closeDatabase()
}

function readClaim(database: Database.Database): ProductClaimToken {
  const row = database
    .prepare(
      `SELECT product_deploy_job.controller_id,product_deploy_job.app_id,
              product_deploy_job.job_id,product_deploy_attempt.attempt_id,
              product_deploy_attempt.attempt_number,product_deploy_job.ownership_generation,
              product_deploy_job.source_generation,product_deploy_job.source_config_sha256,
              product_deploy_attempt.lease_id AS app_lease_id,
              product_deploy_attempt.fencing_token AS app_fence,
              product_deploy_attempt.build_slot_lease_id,product_deploy_attempt.build_slot_fence,
              product_app_lease.expires_at
       FROM product_deploy_attempt JOIN product_deploy_job USING(job_id)
       JOIN product_app_lease ON product_app_lease.lease_id=product_deploy_attempt.lease_id
       WHERE product_deploy_job.job_id='dispatch-job'`
    )
    .get()
  if (!row) throw new Error('TEST_CLAIM_NOT_FOUND')
  return row as ProductClaimToken
}
