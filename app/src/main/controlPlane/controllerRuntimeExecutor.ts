import type Database from 'better-sqlite3'
import type {
  ProductClaimToken,
  ProductRuntimeSettledResult
} from '../../../../docs/contracts/product-auto-deploy'
import { ProductRuntimeRepository } from '../db/productRuntimeRepository'
import { loadControllerRuntimeKey } from './controllerRuntimeKeys'
import {
  ProductRuntimeExecutor,
  type ProductRuntimeExecutorOptions
} from './productRuntimeExecutor'
import type { ProductExecutorResult, ProductJobExecutor } from './queueWorker'

export interface ControllerRuntimeExecutorOptions extends Omit<
  ProductRuntimeExecutorOptions,
  'runtimeRepository'
> {
  secretDirectory: string
}

/** Read the exact app/generation key, including retained generations during cold recovery. */
export function openControllerRuntimeRepository(
  database: Database.Database,
  directory: string,
  claim: Pick<ProductClaimToken, 'controller_id' | 'app_id' | 'ownership_generation'>
): ProductRuntimeRepository {
  const key = loadControllerRuntimeKey(directory, claim)
  try {
    return new ProductRuntimeRepository(database, { secret: key })
  } finally {
    key.fill(0)
  }
}

/** Trusted service composition seam; no key cache or default service activation. */
export class ControllerRuntimeExecutorRouter implements ProductJobExecutor {
  constructor(private readonly options: ControllerRuntimeExecutorOptions) {}

  async execute(claim: ProductClaimToken, signal: AbortSignal): Promise<ProductExecutorResult> {
    if (signal.aborted) return { state: 'stopped_before_write' }
    let executor: ProductRuntimeExecutor
    try {
      executor = this.openExecutor(claim)
    } catch {
      try {
        if (this.options.repository.readClaimExecutionState(claim) === 'prewrite')
          return {
            state: 'prewrite_failure',
            disposition: 'permanent_failure',
            safeErrorCode: 'INVALID_SOURCE_CONFIG'
          }
      } catch {
        /* Unknown DB authority never enters a retry path. */
      }
      return { state: 'dispatch_marker_committed' }
    }
    return executor.execute(claim, signal)
  }

  verifyCompletion(claim: ProductClaimToken, result: ProductRuntimeSettledResult): boolean {
    if (result.attempt_id !== claim.attempt_id) return false
    try {
      return this.openExecutor(claim).verifyCompletion(claim, result)
    } catch {
      return false
    }
  }

  private openExecutor(claim: ProductClaimToken): ProductRuntimeExecutor {
    return new ProductRuntimeExecutor({
      ...this.options,
      runtimeRepository: openControllerRuntimeRepository(
        this.options.database,
        this.options.secretDirectory,
        claim
      )
    })
  }
}
