import type Database from 'better-sqlite3'
import type {
  ProductClaimToken,
  ProductRuntimeSettledResult
} from '../../../../docs/contracts/product-auto-deploy'
import { ProductDeployRepository } from '../db/productDeployRepository'
import { ProductRuntimeRepository } from '../db/productRuntimeRepository'
import type { SshManager } from '../ssh/manager'
import { canonicalH2Json } from './productH2Proof'
import {
  validatePreflightSourceAndPlan,
  ProductSourceRenderError
} from './productPipelineSourceRender'
import {
  executeProductDeployPipeline,
  recoverProductRuntimeSession,
  type ProductDeployPipelineOptions
} from './productRuntimePipeline'
import {
  prepareProductGitSnapshot,
  ProductSnapshotPreparationError,
  type PreparedProductGitSnapshot
} from './productSnapshotPreparation'
import type { ProductExecutorResult, ProductJobExecutor } from './queueWorker'

export interface ProductRuntimeExecutorOptions {
  database: Database.Database
  repository: ProductDeployRepository
  runtimeRepository: ProductRuntimeRepository
  ssh: SshManager
  /** Trusted controller configuration; never a renderer-supplied shell command. */
  targetOptions: (
    claim: ProductClaimToken
  ) => ProductDeployPipelineOptions | Promise<ProductDeployPipelineOptions>
  /** @internal Immutable local fixture transport may be supplied by integration tests. */
  prepareSnapshot?: typeof prepareProductGitSnapshot
}

/** Production adapter, deliberately not installed into the default service composition yet. */
export class ProductRuntimeExecutor implements ProductJobExecutor {
  constructor(private readonly options: ProductRuntimeExecutorOptions) {}

  async execute(claim: ProductClaimToken, signal: AbortSignal): Promise<ProductExecutorResult> {
    let snapshot: PreparedProductGitSnapshot | undefined
    let target: ProductDeployPipelineOptions | undefined
    try {
      if (signal.aborted) return { state: 'stopped_before_write' }
      snapshot = await (this.options.prepareSnapshot ?? prepareProductGitSnapshot)(
        this.options.repository,
        claim,
        { signal }
      )
      target = { ...(await this.options.targetOptions(claim)), signal }
      validatePreflightSourceAndPlan(this.options.database, snapshot, target.collector_directory)
      await executeProductDeployPipeline(
        this.options.database,
        this.options.runtimeRepository,
        this.options.repository,
        this.options.ssh,
        snapshot,
        target
      )
      return this.completion(claim)
    } catch (error) {
      const terminal = this.options.runtimeRepository.getTerminal(claim.attempt_id)
      if (terminal && snapshot && target && !signal.aborted) {
        try {
          await recoverProductRuntimeSession(
            this.options.runtimeRepository,
            this.options.ssh,
            snapshot,
            target
          )
          return this.completion(claim)
        } catch {
          return { state: 'dispatch_marker_committed' }
        }
      }
      if (this.options.repository.readClaimExecutionState(claim) !== 'prewrite')
        return { state: 'dispatch_marker_committed' }
      if (signal.aborted) return { state: 'stopped_before_write' }
      if (error instanceof ProductSourceRenderError)
        return {
          state: 'prewrite_failure',
          disposition: 'permanent_failure',
          safeErrorCode: 'UNSUPPORTED_SOURCE_CONFIG'
        }
      if (error instanceof ProductSnapshotPreparationError) {
        if (
          [
            'snapshot_authority_rejected',
            'snapshot_source_changed',
            'snapshot_verification_rejected'
          ].includes(error.code)
        )
          return { state: 'prewrite_obsolete' }
        if (['snapshot_timeout', 'snapshot_git_failed'].includes(error.code))
          return {
            state: 'prewrite_failure',
            disposition: 'transient_failure',
            safeErrorCode: 'GIT_UNAVAILABLE'
          }
      }
      return {
        state: 'prewrite_failure',
        disposition: 'permanent_failure',
        safeErrorCode: 'INVALID_SOURCE_CONFIG'
      }
    } finally {
      snapshot?.cleanup()
    }
  }

  verifyCompletion(claim: ProductClaimToken, result: ProductRuntimeSettledResult): boolean {
    try {
      const record = this.options.runtimeRepository.getTerminal(claim.attempt_id)
      if (
        !record ||
        result.attempt_id !== claim.attempt_id ||
        record.commit_id !== result.commit_id ||
        record.envelope.receipt.outcome !== result.outcome ||
        !record.settled_at ||
        !record.leases_released_at
      )
        return false
      const context = record.envelope.receipt.context
      return (
        canonicalH2Json(context.claim) === canonicalH2Json(claim) &&
        this.options.runtimeRepository.readSettlementAuthority(context) === 'ready'
      )
    } catch {
      return false
    }
  }

  private completion(claim: ProductClaimToken): ProductRuntimeSettledResult {
    const record = this.options.runtimeRepository.getTerminal(claim.attempt_id)
    if (!record) throw new Error('RUNTIME_COMPLETION_UNVERIFIED')
    const result: ProductRuntimeSettledResult = {
      state: 'runtime_settled',
      attempt_id: claim.attempt_id,
      commit_id: record.commit_id,
      outcome: record.envelope.receipt.outcome
    }
    if (!this.verifyCompletion(claim, result)) throw new Error('RUNTIME_COMPLETION_UNVERIFIED')
    return result
  }
}
