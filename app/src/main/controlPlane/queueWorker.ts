import { setTimeout as delay } from 'node:timers/promises'

import {
  PRODUCT_HEARTBEAT_INTERVAL_MS,
  type ProductClaimToken,
  type ProductPrewritePermanentErrorCode,
  type ProductPrewriteFinishResult,
  type ProductPrewriteTransientErrorCode
} from '../../../../docs/contracts/product-auto-deploy'
import { ProductDeployRepository } from '../db/productDeployRepository'

export const CONTROL_PLANE_WORKER_POLL_INTERVAL_MS = 1_000
export const CONTROL_PLANE_WORKER_STOP_GRACE_MS = 10_000

export type ProductExecutorResult =
  | {
      state: 'prewrite_failure'
      disposition: 'transient_failure'
      safeErrorCode: ProductPrewriteTransientErrorCode
    }
  | {
      state: 'prewrite_failure'
      disposition: 'permanent_failure'
      safeErrorCode: ProductPrewritePermanentErrorCode
    }
  | { state: 'prewrite_obsolete' }
  | { state: 'dispatch_marker_committed' }
  | { state: 'stopped_before_write' }

/** Internal-only executor boundary. It is never exposed through the desktop API. */
export interface ProductJobExecutor {
  execute(claim: ProductClaimToken, signal: AbortSignal): Promise<ProductExecutorResult>
}

export type ProductResourceAdmission =
  { state: 'ready' } | { state: 'deferred'; reason: 'resource_unavailable' | 'resource_unknown' }

/** Must be supplied alongside an executor; no resource readiness is inferred. */
export interface ProductWorkerAdmission {
  check(signal: AbortSignal): Promise<ProductResourceAdmission> | ProductResourceAdmission
}

export interface ControlPlaneJobWorkerOptions {
  repository: ProductDeployRepository
  controllerId: string
  executor?: ProductJobExecutor
  admission?: ProductWorkerAdmission
  /** @internal Short deterministic timing values are for tests only. */
  pollIntervalMs?: number
  /** @internal Short deterministic timing values are for tests only. */
  heartbeatIntervalMs?: number
  /** @internal Short deterministic timing values are for tests only. */
  stopGraceMs?: number
}

export type ControlPlaneWorkerStatus = {
  state:
    | 'polling_only'
    | 'idle'
    | 'admission_blocked'
    | 'claim_blocked'
    | 'executing'
    | 'retry_scheduled'
    | 'failed'
    | 'unsupported_job'
    | 'superseded'
    | 'reconciliation_required'
    | 'task_stop_unconfirmed'
    | 'stopped'
  reason: string | null
  activeJobId: string | null
  activeAttemptId: string | null
  executorConfigured: boolean
}

type NormalizedExecutorResult =
  { kind: 'result'; result: ProductExecutorResult } | { kind: 'threw' }

type HeartbeatResult =
  | { state: 'stopped' }
  | { state: 'lost'; reason: 'heartbeat_rejected' | 'heartbeat_database_error' }

export class ControlPlaneJobWorker {
  private readonly pollIntervalMs: number
  private readonly heartbeatIntervalMs: number
  private readonly stopGraceMs: number
  private status: ControlPlaneWorkerStatus
  private unsafeToClose = false
  private taskMayUseDatabase = false
  private halted = false

  constructor(private readonly options: ControlPlaneJobWorkerOptions) {
    this.pollIntervalMs = options.pollIntervalMs ?? CONTROL_PLANE_WORKER_POLL_INTERVAL_MS
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? PRODUCT_HEARTBEAT_INTERVAL_MS
    this.stopGraceMs = options.stopGraceMs ?? CONTROL_PLANE_WORKER_STOP_GRACE_MS
    if (
      !Number.isSafeInteger(this.pollIntervalMs) ||
      this.pollIntervalMs < 10 ||
      !Number.isSafeInteger(this.heartbeatIntervalMs) ||
      this.heartbeatIntervalMs < 1 ||
      !Number.isSafeInteger(this.stopGraceMs) ||
      this.stopGraceMs < 1
    ) {
      throw new Error('INVALID_WORKER_TIMING')
    }
    this.status = {
      state: options.executor ? 'idle' : 'polling_only',
      reason: options.executor ? null : 'executor_not_configured',
      activeJobId: null,
      activeAttemptId: null,
      executorConfigured: Boolean(options.executor)
    }
  }

  getStatus(): ControlPlaneWorkerStatus {
    return { ...this.status }
  }

  canCloseDatabase(): boolean {
    return !this.unsafeToClose && !this.taskMayUseDatabase
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted && !this.halted) {
      if (!this.options.executor) {
        this.setStatus('polling_only', 'executor_not_configured')
        await this.wait(signal)
        continue
      }
      if (!this.options.admission) {
        this.setStatus('admission_blocked', 'admission_not_configured')
        await this.wait(signal)
        continue
      }

      let admission: ProductResourceAdmission
      try {
        admission = await this.options.admission.check(signal)
      } catch {
        admission = { state: 'deferred', reason: 'resource_unknown' }
      }
      if (signal.aborted) break
      if (admission.state !== 'ready') {
        this.setStatus('admission_blocked', admission.reason)
        await this.wait(signal)
        continue
      }

      const claimResult = this.options.repository.claimNextJob(this.options.controllerId)
      if (claimResult.state === 'none') {
        this.setStatus('idle', claimResult.reason)
        await this.wait(signal)
        continue
      }
      if (claimResult.state === 'blocked') {
        if (claimResult.reason === 'reconciliation_required') {
          this.halted = true
          this.setStatus('reconciliation_required', claimResult.reason)
          continue
        }
        if (claimResult.reason === 'unsupported_trigger') {
          this.halted = true
          this.setStatus('unsupported_job', claimResult.reason)
          continue
        }
        this.setStatus('claim_blocked', claimResult.reason)
        await this.wait(signal)
        continue
      }
      await this.executeClaim(claimResult.claim, signal)
    }
    if (
      this.status.state !== 'task_stop_unconfirmed' &&
      this.status.state !== 'reconciliation_required' &&
      this.status.state !== 'unsupported_job'
    ) {
      this.setStatus('stopped', null)
    }
  }

  private async executeClaim(claim: ProductClaimToken, shutdownSignal: AbortSignal): Promise<void> {
    const executor = this.options.executor
    if (!executor) return
    const taskController = new AbortController()
    const heartbeatController = new AbortController()
    const onShutdown = (): void => taskController.abort()
    shutdownSignal.addEventListener('abort', onShutdown, { once: true })
    if (shutdownSignal.aborted) taskController.abort()
    this.setStatus('executing', null, claim)
    this.taskMayUseDatabase = true

    const execution = Promise.resolve()
      .then(() => executor.execute(claim, taskController.signal))
      .then(
        (result): NormalizedExecutorResult => ({ kind: 'result', result }),
        (): NormalizedExecutorResult => ({ kind: 'threw' })
      )
    const heartbeat = this.monitorHeartbeat(claim, heartbeatController.signal)
    let resolveStop!: (value: { kind: 'stop' }) => void
    const stopRequestedListener = (): void => resolveStop({ kind: 'stop' })
    const stopRequested = new Promise<{ kind: 'stop' }>((resolve) => {
      resolveStop = resolve
      if (shutdownSignal.aborted) resolve({ kind: 'stop' })
      else shutdownSignal.addEventListener('abort', stopRequestedListener, { once: true })
    })
    const heartbeatLost = heartbeat.then((result) =>
      result.state === 'lost' ? { kind: 'heartbeat_lost' as const, reason: result.reason } : null
    )

    const first = await Promise.race([
      execution.then((result) => ({ kind: 'execution' as const, result })),
      stopRequested,
      heartbeatLost
    ])
    // The per-claim shutdown listener must not accumulate across queue items.
    shutdownSignal.removeEventListener('abort', stopRequestedListener)

    if (first?.kind === 'execution') {
      heartbeatController.abort()
      const heartbeatResult = await heartbeat
      shutdownSignal.removeEventListener('abort', onShutdown)
      if (heartbeatResult.state === 'lost') {
        this.taskMayUseDatabase = false
        this.halted = true
        this.setStatus('reconciliation_required', heartbeatResult.reason, claim)
        return
      }
      try {
        await this.handleExecutorResult(claim, first.result)
      } finally {
        this.taskMayUseDatabase = false
      }
      return
    }

    taskController.abort()
    heartbeatController.abort()
    const stopped = await settleWithin(execution, this.stopGraceMs)
    shutdownSignal.removeEventListener('abort', onShutdown)
    if (!stopped) {
      this.unsafeToClose = true
      this.halted = true
      this.setStatus('task_stop_unconfirmed', 'executor_stop_unconfirmed', claim)
      return
    }
    await heartbeat
    try {
      if (first?.kind === 'heartbeat_lost') {
        this.halted = true
        this.setStatus('reconciliation_required', first.reason, claim)
        return
      }
      const outcome = await execution
      if (outcome.kind === 'result' && outcome.result.state === 'prewrite_failure') {
        await this.finishPrewrite(claim, outcome.result)
        return
      }
      this.halted = true
      const state = this.options.repository.readClaimExecutionState(claim)
      this.setStatus(
        'reconciliation_required',
        state === 'dispatch_unknown' ? 'remote_outcome_unknown' : 'worker_stopped_with_claim',
        claim
      )
    } finally {
      this.taskMayUseDatabase = false
    }
  }

  private async handleExecutorResult(
    claim: ProductClaimToken,
    outcome: NormalizedExecutorResult
  ): Promise<void> {
    if (outcome.kind === 'result' && outcome.result.state === 'prewrite_failure') {
      await this.finishPrewrite(claim, outcome.result)
      return
    }
    if (outcome.kind === 'result' && outcome.result.state === 'prewrite_obsolete') {
      await this.finishPrewrite(claim, { state: 'prewrite_obsolete' })
      return
    }

    this.halted = true
    let executionState
    try {
      executionState = this.options.repository.readClaimExecutionState(claim)
    } catch {
      executionState = 'reconciliation_required'
    }
    const reason =
      executionState === 'dispatch_unknown'
        ? 'remote_outcome_unknown'
        : outcome.kind === 'threw'
          ? 'executor_outcome_unknown'
          : 'executor_claim_not_finalized'
    this.setStatus('reconciliation_required', reason, claim)
  }

  private async finishPrewrite(
    claim: ProductClaimToken,
    outcome:
      Extract<ProductExecutorResult, { state: 'prewrite_failure' }> | { state: 'prewrite_obsolete' }
  ): Promise<void> {
    try {
      if (this.options.repository.readClaimExecutionState(claim) !== 'prewrite') {
        this.halted = true
        this.setStatus('reconciliation_required', 'prewrite_state_changed', claim)
        return
      }
      let result: ProductPrewriteFinishResult
      if (outcome.state === 'prewrite_obsolete') {
        result = this.options.repository.finishPrewriteAttempt({
          claim,
          disposition: 'check_obsolete'
        })
      } else {
        result =
          outcome.disposition === 'transient_failure'
            ? this.options.repository.finishPrewriteAttempt({
                claim,
                disposition: 'transient_failure',
                safeErrorCode: outcome.safeErrorCode
              })
            : this.options.repository.finishPrewriteAttempt({
                claim,
                disposition: 'permanent_failure',
                safeErrorCode: outcome.safeErrorCode
              })
      }
      if (result.state === 'retry_scheduled') this.setStatus('retry_scheduled', null)
      else if (result.state === 'failed') this.setStatus('failed', null)
      else if (result.state === 'superseded') this.setStatus('superseded', null)
      else {
        this.halted = true
        this.setStatus('reconciliation_required', `prewrite_${result.reason}`, claim)
      }
    } catch {
      this.halted = true
      this.setStatus('reconciliation_required', 'prewrite_database_error', claim)
    }
  }

  private async monitorHeartbeat(
    claim: ProductClaimToken,
    signal: AbortSignal
  ): Promise<HeartbeatResult> {
    while (!signal.aborted) {
      try {
        await delay(this.heartbeatIntervalMs, undefined, { signal })
      } catch {
        return { state: 'stopped' }
      }
      if (signal.aborted) return { state: 'stopped' }
      try {
        const result = this.options.repository.heartbeatClaim(claim)
        if (result.state !== 'renewed') {
          return { state: 'lost', reason: 'heartbeat_rejected' }
        }
      } catch {
        return { state: 'lost', reason: 'heartbeat_database_error' }
      }
    }
    return { state: 'stopped' }
  }

  private async wait(signal: AbortSignal): Promise<void> {
    try {
      await delay(this.pollIntervalMs, undefined, { signal })
    } catch {
      // Shutdown is the expected way to interrupt a worker wait.
    }
  }

  private setStatus(
    state: ControlPlaneWorkerStatus['state'],
    reason: string | null,
    claim?: ProductClaimToken
  ): void {
    this.status = {
      state,
      reason,
      activeJobId: claim?.job_id ?? null,
      activeAttemptId: claim?.attempt_id ?? null,
      executorConfigured: Boolean(this.options.executor)
    }
  }
}

async function settleWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  const result = await Promise.race([
    promise.then(() => true),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs)
    })
  ])
  if (timer) clearTimeout(timer)
  return result
}
