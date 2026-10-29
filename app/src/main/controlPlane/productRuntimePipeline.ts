import type Database from 'better-sqlite3'
import type {
  H2BuildEvidence,
  H2Context,
  H2TerminalRecord
} from '../../../../docs/contracts/product-h2-runtime'
import type { ProductDeployRepository } from '../db/productDeployRepository'
import type { ProductRuntimeRepository } from '../db/productRuntimeRepository'
import type { SshManager } from '../ssh/manager'
import {
  GuardedSshSessionError,
  openProductGuardedSshRecoverySession,
  openProductGuardedSshSession
} from './guardedSshSession'
import {
  executeProductBuildWithSession,
  stageProductSourceAndRenderWithSession
} from './productPipelineSourceRender'
import type { PreparedProductGitSnapshot } from './productSnapshotPreparation'

export type ProductDeployPipelineResult =
  | {
      state: 'succeeded'
      terminal: H2TerminalRecord
      deployment_id: number
      context: H2Context
    }
  | {
      state: 'failed'
      failed_step: 'BUILD' | 'DEPLOY'
      terminal: H2TerminalRecord
      deployment_id: number
      context: H2Context
    }
  | {
      state: 'rolled_back'
      failed_step: 'DEPLOY'
      terminal: H2TerminalRecord
      deployment_id: number
      context: H2Context
    }

export type ProductDeployPipelineOptions = {
  vps_id: number
  target_helper_path: string
  target_state_root: string
  signal?: AbortSignal
  collector_directory?: string
  build_timeout_ms?: number
  build_poll_interval_ms?: number
  runtime_poll_timeout_ms?: number
  runtime_poll_interval_ms?: number
}

/**
 * End-to-end Product deployment pipeline in one guarded SSH session and target lock:
 * Source -> Render -> Build -> Prepare -> Activate -> Health -> Publish/Rollback -> Seal -> T1 -> Settle -> T2.
 */
export async function executeProductDeployPipeline(
  database: Database.Database,
  runtimeRepository: ProductRuntimeRepository,
  deployRepository: ProductDeployRepository,
  ssh: SshManager,
  snapshot: PreparedProductGitSnapshot,
  options: ProductDeployPipelineOptions
): Promise<ProductDeployPipelineResult> {
  const session = await openProductGuardedSshSession(deployRepository, ssh, snapshot, {
    vps_id: options.vps_id,
    target_helper_path: options.target_helper_path,
    target_state_root: options.target_state_root,
    signal: options.signal
  })

  try {
    // 1. Stage source and render files within the same session
    await stageProductSourceAndRenderWithSession(session, database, snapshot, {
      collector_directory: options.collector_directory,
      signal: options.signal
    })

    // 2. Execute Docker build within the same session
    const buildResult = await executeProductBuildWithSession(session, database, snapshot, {
      timeoutMs: options.build_timeout_ms,
      pollIntervalMs: options.build_poll_interval_ms,
      signal: options.signal
    })

    const buildEvidence: H2BuildEvidence = {
      state: buildResult.state,
      image_tag: buildResult.image_tag,
      target_sha: buildResult.target_sha,
      image_id: buildResult.image_id,
      exit_code: buildResult.exit_code
    }

    // 3. Create context in DB
    let context = runtimeRepository.createContext(
      snapshot.claim,
      session.deploymentId,
      buildEvidence
    )

    if (buildResult.state === 'build_failed_definite') {
      // Build failed: No C0 barrier, verify previous and seal failed BUILD
      await session.runtimeConfigure(context)
      await session.startRuntimeStep('prepare')
      await session.pollRuntimeUntilSettled('prepare', {
        timeoutMs: options.runtime_poll_timeout_ms,
        pollIntervalMs: options.runtime_poll_interval_ms
      })
    } else {
      // Build succeeded:
      // Allocate C0 activation barrier in DB
      context = runtimeRepository.beginActivationBarrier(context)

      await session.runtimeConfigure(context)

      // Step prepare: inspects old containers, stops old collector, computes B0, builds collector image
      await session.startRuntimeStep('prepare')
      const prepareProgress = await session.pollRuntimeUntilSettled('prepare', {
        timeoutMs: options.runtime_poll_timeout_ms,
        pollIntervalMs: options.runtime_poll_interval_ms
      })

      if (!prepareProgress.boundary) {
        session.failClosed('SSH_RUNTIME_FAILED')
        throw new GuardedSshSessionError('SSH_RUNTIME_FAILED')
      }

      // Bind metric boundary B0 in DB
      runtimeRepository.bindActivationBoundary(context, prepareProgress.boundary)

      // Step activate: network + starts candidate app + candidate collector
      await session.startRuntimeStep('activate')
      await session.pollRuntimeUntilSettled('activate', {
        timeoutMs: options.runtime_poll_timeout_ms,
        pollIntervalMs: options.runtime_poll_interval_ms
      })

      // Step health: probe health within exact container
      await session.startRuntimeStep('health')
      const healthProgress = await session.pollRuntimeUntilSettled('health', {
        timeoutMs: options.runtime_poll_timeout_ms,
        pollIntervalMs: options.runtime_poll_interval_ms
      })

      if (
        healthProgress.state === 'step_succeeded' &&
        healthProgress.candidate?.health === 'healthy'
      ) {
        // Candidate healthy -> publish
        await session.startRuntimeStep('publish')
        await session.pollRuntimeUntilSettled('publish', {
          timeoutMs: options.runtime_poll_timeout_ms,
          pollIntervalMs: options.runtime_poll_interval_ms
        })
      } else {
        // Candidate unhealthy:
        if (context.previous) {
          // Restore previous container and collector
          await session.startRuntimeStep('rollback')
          await session.pollRuntimeUntilSettled('rollback', {
            timeoutMs: options.runtime_poll_timeout_ms,
            pollIntervalMs: options.runtime_poll_interval_ms
          })
        }
        // If context.previous is null (first deploy), cannot rollback; proceeds to seal failed DEPLOY
      }
    }

    // 4. Seal runtime on target (atomic receipt signed by target secret)
    const sealedReceipt = await session.sealRuntime()

    // 5. T1: Atomic finalize in DB (commits terminal row and updates canonical app/activations)
    const terminalRecord = runtimeRepository.finalize(sealedReceipt)

    // 6. Sign commit attestation
    const attestation = runtimeRepository.commitAttestation(snapshot.claim.attempt_id)

    // 7. Settle on target (target verifies attestation and marks marker idle)
    const settlementAck = await session.settleRuntime(attestation)

    // 8. T2: Complete settlement and release leases
    runtimeRepository.completeSettlement(context, settlementAck)

    // 9. Clean session close
    await session.close()

    const outcome = sealedReceipt.receipt.outcome
    if (outcome === 'succeeded') {
      return {
        state: 'succeeded',
        terminal: terminalRecord,
        deployment_id: session.deploymentId,
        context
      }
    }
    if (outcome === 'rolled_back') {
      return {
        state: 'rolled_back',
        failed_step: 'DEPLOY',
        terminal: terminalRecord,
        deployment_id: session.deploymentId,
        context
      }
    }
    return {
      state: 'failed',
      failed_step:
        sealedReceipt.receipt.failed_step ??
        (buildResult.state === 'build_failed_definite' ? 'BUILD' : 'DEPLOY'),
      terminal: terminalRecord,
      deployment_id: session.deploymentId,
      context
    }
  } catch (error) {
    if (session.state === 'active') {
      session.failClosed(options.signal?.aborted ? 'SSH_SESSION_ABORTED' : 'SSH_OUTCOME_UNKNOWN')
    }
    throw error
  }
}

/**
 * Recovery pipeline to settle a previously committed terminal attempt across disconnects.
 */
export async function recoverProductRuntimeSession(
  runtimeRepository: ProductRuntimeRepository,
  ssh: SshManager,
  snapshot: PreparedProductGitSnapshot,
  options: {
    vps_id: number
    target_helper_path: string
    target_state_root: string
    signal?: AbortSignal
  }
): Promise<{
  state: 'settled' | 'already_settled'
  terminal: H2TerminalRecord
}> {
  const terminal = runtimeRepository.getTerminal(snapshot.claim.attempt_id)
  if (!terminal) {
    throw new GuardedSshSessionError('SSH_SETTLEMENT_REJECTED')
  }

  if (terminal.settled_at !== null && terminal.leases_released_at !== null) {
    return {
      state: 'already_settled',
      terminal
    }
  }

  const context = terminal.envelope.receipt.context
  const session = await openProductGuardedSshRecoverySession(runtimeRepository, ssh, context, {
    vps_id: options.vps_id,
    target_helper_path: options.target_helper_path,
    target_state_root: options.target_state_root,
    signal: options.signal
  })

  try {
    const attestation = runtimeRepository.commitAttestation(snapshot.claim.attempt_id)
    const settlementAck = await session.settleRuntime(attestation)
    runtimeRepository.completeSettlement(context, settlementAck)
    await session.close()
    return {
      state: 'settled',
      terminal: runtimeRepository.getTerminal(snapshot.claim.attempt_id)!
    }
  } catch (error) {
    if (session.state === 'active') {
      session.failClosed(options.signal?.aborted ? 'SSH_SESSION_ABORTED' : 'SSH_OUTCOME_UNKNOWN')
    }
    throw error
  }
}
