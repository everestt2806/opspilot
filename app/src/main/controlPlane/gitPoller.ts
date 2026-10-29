import { setTimeout as delay } from 'node:timers/promises'

import {
  ProductDeployRepositoryError,
  type ProductGitPollTarget,
  type ProductDeployRepository
} from '../db/productDeployRepository'
import {
  PublicBranchQueryError,
  queryPublicGitHubBranchTip,
  type PublicBranchTip
} from '../git/publicBranch'
import { canonicalizeGitHubUrl, validateRef } from '../git/snapshot'

export const CONTROL_PLANE_POLL_INTERVAL_MS = 30_000
export const CONTROL_PLANE_POLL_JITTER_MAX_MS = 5_000
export const CONTROL_PLANE_POLL_BACKOFF_MAX_MS = 5 * 60_000

export interface ControlPlanePollSummary {
  finishedAt: string
  sourceCount: number
  invalidSourceCount: number
  repositoryRefCount: number
  fetchedCount: number
  missingBranchCount: number
  observedCount: number
  staleCount: number
  errorCount: number
  queuedCount: number
  lastErrorCode: string | null
}

export interface ControlPlanePollerOptions {
  repository: ProductDeployRepository
  controllerId: string
  fetchTip?: (
    repositoryUrl: string,
    branch: string,
    signal: AbortSignal
  ) => Promise<PublicBranchTip>
  now?: () => number
  random?: () => number
  intervalMs?: number
  jitterMaxMs?: number
  maxBackoffMs?: number
}

interface PreparedTarget {
  target: ProductGitPollTarget
  canonicalUrl: string
}

export class ControlPlaneGitPoller {
  private readonly fetchTip: NonNullable<ControlPlanePollerOptions['fetchTip']>
  private readonly now: () => number
  private readonly random: () => number
  private readonly intervalMs: number
  private readonly jitterMaxMs: number
  private readonly maxBackoffMs: number
  private inFlight: Promise<ControlPlanePollSummary> | null = null
  private consecutiveFailures = 0
  private lastSummary: ControlPlanePollSummary | null = null

  constructor(private readonly options: ControlPlanePollerOptions) {
    this.fetchTip =
      options.fetchTip ??
      ((repositoryUrl, branch, signal) =>
        queryPublicGitHubBranchTip({ repositoryUrl, branch, signal }))
    this.now = options.now ?? Date.now
    this.random = options.random ?? Math.random
    this.intervalMs = options.intervalMs ?? CONTROL_PLANE_POLL_INTERVAL_MS
    this.jitterMaxMs = options.jitterMaxMs ?? CONTROL_PLANE_POLL_JITTER_MAX_MS
    this.maxBackoffMs = options.maxBackoffMs ?? CONTROL_PLANE_POLL_BACKOFF_MAX_MS
    if (
      !Number.isSafeInteger(this.intervalMs) ||
      this.intervalMs < 1 ||
      !Number.isSafeInteger(this.jitterMaxMs) ||
      this.jitterMaxMs < 0 ||
      !Number.isSafeInteger(this.maxBackoffMs) ||
      this.maxBackoffMs < this.intervalMs
    ) {
      throw new Error('INVALID_POLLER_CONFIGURATION')
    }
  }

  getLastSummary(): ControlPlanePollSummary | null {
    return this.lastSummary ? { ...this.lastSummary } : null
  }

  pollOnce(signal: AbortSignal): Promise<ControlPlanePollSummary> {
    if (this.inFlight) return this.inFlight
    const operation = this.runCycle(signal)
    const wrapped = operation.finally(() => {
      this.inFlight = null
    })
    this.inFlight = wrapped
    return wrapped
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await this.pollOnce(signal)
      if (signal.aborted) break
      const waitMs = this.nextDelayMs()
      try {
        await delay(waitMs, undefined, { signal })
      } catch (error) {
        if (!signal.aborted) throw error
      }
    }
  }

  private nextDelayMs(): number {
    return calculateControlPlanePollDelay(
      this.intervalMs,
      this.maxBackoffMs,
      this.jitterMaxMs,
      this.consecutiveFailures,
      this.random()
    )
  }

  private async runCycle(signal: AbortSignal): Promise<ControlPlanePollSummary> {
    const summary: ControlPlanePollSummary = {
      finishedAt: new Date(this.now()).toISOString(),
      sourceCount: 0,
      invalidSourceCount: 0,
      repositoryRefCount: 0,
      fetchedCount: 0,
      missingBranchCount: 0,
      observedCount: 0,
      staleCount: 0,
      errorCount: 0,
      queuedCount: 0,
      lastErrorCode: null
    }
    const recordError = (code: string): void => {
      summary.errorCount += 1
      summary.lastErrorCode = code
    }

    const targets = this.options.repository.listGitPollTargets(this.options.controllerId)
    summary.sourceCount = targets.length
    summary.invalidSourceCount = this.options.repository.countInvalidGitPollTargets(
      this.options.controllerId
    )
    for (let index = 0; index < summary.invalidSourceCount; index += 1) {
      recordError('PRODUCT_SOURCE_CONFIG_INVALID')
    }
    const groups = new Map<string, PreparedTarget[]>()
    for (const target of targets) {
      if (signal.aborted) break
      let canonicalUrl: string
      try {
        canonicalUrl = canonicalizeGitHubUrl(target.repositoryUrl)
        validateRef(target.ref)
        if (target.ref.startsWith('refs/')) throw new Error('INVALID_BRANCH')
      } catch {
        summary.invalidSourceCount += 1
        recordError('GIT_INVALID_SOURCE_CONFIG')
        continue
      }

      try {
        this.options.repository.reconcileDesired(target)
      } catch (error) {
        const code =
          error instanceof ProductDeployRepositoryError ? error.code : 'PRODUCT_RECONCILE_FAILED'
        if (code === 'STALE_OBSERVATION' || code === 'PRODUCT_STATE_CONFLICT')
          summary.staleCount += 1
        else recordError(code)
        continue
      }

      const key = `${canonicalUrl}\0${target.ref}`
      const group = groups.get(key) ?? []
      group.push({ target, canonicalUrl })
      groups.set(key, group)
    }
    summary.repositoryRefCount = groups.size

    for (const candidates of groups.values()) {
      if (signal.aborted) break
      const first = candidates[0]
      let tip: PublicBranchTip
      try {
        tip = await this.fetchTip(first.canonicalUrl, first.target.ref, signal)
        summary.fetchedCount += 1
      } catch (error) {
        if (signal.aborted) break
        recordError(error instanceof PublicBranchQueryError ? error.code : 'GIT_REMOTE_ERROR')
        continue
      }
      if (tip.state === 'missing') {
        summary.missingBranchCount += 1
        recordError('GIT_BRANCH_MISSING')
        continue
      }

      for (const { target } of candidates) {
        if (signal.aborted) break
        try {
          const result = this.options.repository.observeTip({
            ...target,
            expectedObservationSequence: target.observationSequence,
            tipSha: tip.sha
          })
          if (result.observationCreated) summary.observedCount += 1
          if (result.reconciliation.state === 'queued') summary.queuedCount += 1
        } catch (error) {
          const code =
            error instanceof ProductDeployRepositoryError
              ? error.code
              : 'PRODUCT_OBSERVATION_FAILED'
          if (code === 'STALE_OBSERVATION' || code === 'PRODUCT_STATE_CONFLICT') {
            summary.staleCount += 1
          } else {
            recordError(code)
          }
        }
      }
    }

    this.consecutiveFailures = summary.errorCount > 0 ? this.consecutiveFailures + 1 : 0
    summary.finishedAt = new Date(this.now()).toISOString()
    this.lastSummary = summary
    return summary
  }
}

export function calculateControlPlanePollDelay(
  intervalMs: number,
  maxBackoffMs: number,
  jitterMaxMs: number,
  consecutiveFailures: number,
  random: number
): number {
  if (
    !Number.isSafeInteger(intervalMs) ||
    intervalMs < 1 ||
    !Number.isSafeInteger(maxBackoffMs) ||
    maxBackoffMs < intervalMs ||
    !Number.isSafeInteger(jitterMaxMs) ||
    jitterMaxMs < 0 ||
    !Number.isSafeInteger(consecutiveFailures) ||
    consecutiveFailures < 0 ||
    !Number.isFinite(random) ||
    random < 0 ||
    random >= 1
  ) {
    throw new Error('INVALID_POLLER_TIMING')
  }
  const backoff = Math.min(maxBackoffMs, intervalMs * 2 ** Math.min(consecutiveFailures, 16))
  return Math.min(maxBackoffMs, backoff + Math.floor(random * (jitterMaxMs + 1)))
}
