import { randomUUID } from 'node:crypto'

import type Database from 'better-sqlite3'
import { insertNextDeploymentVersion } from './deploymentRepository'

import {
  PRODUCT_LEASE_TTL_MS,
  PRODUCT_MAX_ATTEMPTS,
  PRODUCT_PREWRITE_ERROR_CODES,
  PRODUCT_RETRY_BACKOFF_MS,
  PRODUCT_RETRY_JITTER_MAX_MS
} from '../../../../docs/contracts/product-auto-deploy'
import type {
  ProductAppOwnership,
  ProductBranchObservation,
  ProductClaimResult,
  ProductClaimToken,
  ProductControllerId,
  ProductDesiredBranchState,
  ProductBeginDispatchResult,
  ProductHeartbeatResult,
  ProductGitSnapshotMetadata,
  ProductJobState,
  ProductPrewriteFinishInput,
  ProductPrewriteFinishResult,
  ProductSnapshotVerificationResult,
  ProductSourceConfigIdentity
} from '../../../../docs/contracts/product-auto-deploy'

export type ProductRecord<T> = { kind: 'present'; value: T } | { kind: 'absent' }

export interface ProductControllerRecord {
  controller_id: ProductControllerId
  created_at: string
  status: 'active' | 'maintenance' | 'revoked'
}

export interface ProductAppOwnershipRecord extends ProductAppOwnership {}
export interface ProductSourceConfigRecord extends ProductSourceConfigIdentity {
  deploy_config_json: string
  created_at: string
}

export interface ProductReconcileIdentity {
  controllerId: ProductControllerId
  appId: number
  ownershipGeneration: number
  sourceGeneration: number
  configSha256: string
  ref: string
}

export interface ProductObserveTipInput extends ProductReconcileIdentity {
  /** Latest sequence observed before the external Git read began; null means no prior tip. */
  expectedObservationSequence: number | null
  tipSha: string
}

export interface ProductReconcileResult {
  state: ProductDesiredBranchState['reconciliation_state']
  reason:
    | 'queued'
    | 'already_queued'
    | 'active_job'
    | 'live_matches'
    | 'manual_pause'
    | 'uncertain_job'
    | 'terminal_failure'
    | 'terminal_success_live_mismatch'
    | 'terminal_job'
    | 'desired_missing'
  jobId: string | null
}

export interface ProductObserveTipResult {
  observationSequence: number
  observationCreated: boolean
  desiredSha: string
  reconciliation: ProductReconcileResult
}

export type ProductRepositoryClock = () => number
export type ProductRetryJitter = () => number

type ProductDesiredBranchRow = Omit<ProductDesiredBranchState, 'auto_paused'> & {
  auto_paused: 0 | 1
}

/** Product persistence access; mutations are transactional and never enroll apps implicitly. */
export class ProductDeployRepository {
  private now: ProductRepositoryClock = Date.now
  private jitter: ProductRetryJitter = Math.random

  constructor(private readonly database: Database.Database) {}

  /** @internal Construct a repository with a deterministic clock in tests only. */
  static withClockForTest(
    database: Database.Database,
    clock: ProductRepositoryClock,
    jitter: ProductRetryJitter = () => 0
  ): ProductDeployRepository {
    const repository = new ProductDeployRepository(database)
    repository.now = clock
    repository.jitter = jitter
    return repository
  }

  /** Claims one eligible Product job and both controller/app leases atomically. */
  claimNextJob(controllerId: ProductControllerId): ProductClaimResult {
    if (typeof controllerId !== 'string' || controllerId.length === 0) {
      throw new ProductDeployRepositoryError('INVALID_CONTROLLER_ID')
    }
    return this.database
      .transaction(() => {
        // Read the clock only after BEGIN IMMEDIATE has acquired SQLite's
        // writer lock; a request may have waited long enough for leases to expire.
        const nowMs = this.readClock()
        const now = new Date(nowMs).toISOString()
        const expiresAt = new Date(nowMs + PRODUCT_LEASE_TTL_MS).toISOString()
        const controller = this.database
          .prepare('SELECT status FROM product_controller WHERE controller_id=?')
          .get(controllerId) as { status: string } | undefined
        if (!controller || controller.status !== 'active') {
          throw new ProductDeployRepositoryError('CONTROLLER_NOT_ACTIVE')
        }

        const activeBuildLease = this.database
          .prepare(
            `SELECT expires_at FROM product_worker_lease
                    WHERE slot_name='build' AND released_at IS NULL LIMIT 1`
          )
          .get() as { expires_at: string } | undefined
        if (activeBuildLease) {
          return {
            state: 'blocked' as const,
            reason:
              activeBuildLease.expires_at <= now
                ? ('reconciliation_required' as const)
                : ('build_slot_busy' as const)
          }
        }

        const jobs = this.database
          .prepare(
            `SELECT j.job_id, j.app_id, j.ownership_generation, j.source_generation,
                      j.source_config_sha256, j.trigger, j.ref, j.target_sha,
                    j.observation_sequence, j.reconcile_epoch,
                    j.target_deployment_id, j.attempt_count, j.max_attempts
             FROM product_deploy_job AS j
             JOIN product_controller AS c ON c.controller_id=j.controller_id AND c.status='active'
             JOIN product_app_control AS owner ON owner.app_id=j.app_id
               AND owner.mode='product' AND owner.controller_id=j.controller_id
               AND owner.ownership_generation=j.ownership_generation
               AND owner.source_generation=j.source_generation
               AND owner.source_config_sha256=j.source_config_sha256
             JOIN product_source_config AS source ON source.app_id=j.app_id
               AND source.source_generation=j.source_generation
               AND source.config_sha256=j.source_config_sha256 AND source.production_ref=j.ref
             JOIN app AS a ON a.id=j.app_id AND a.source_type='git'
               AND a.git_repo_url=source.repository_url
               AND a.git_ref=source.production_ref AND a.git_root=source.repository_root
             JOIN vps AS v ON v.id=a.vps_id AND v.archived_at IS NULL
             WHERE j.controller_id=? AND j.state IN ('queued','retry_wait')
               AND j.available_at<=? AND j.attempt_count<MIN(j.max_attempts, ?)
               AND NOT EXISTS (
                 SELECT 1 FROM product_deploy_job AS active
                 WHERE active.app_id=j.app_id AND active.state IN ('claimed','deploying')
               )
               AND NOT EXISTS (
                 SELECT 1 FROM product_deploy_job AS uncertain
                 WHERE uncertain.app_id=j.app_id AND uncertain.state='uncertain'
               )
               AND NOT EXISTS (
                 SELECT 1 FROM product_deploy_attempt AS uncertain_attempt
                 JOIN product_deploy_job AS uncertain_job ON uncertain_job.job_id=uncertain_attempt.job_id
                 WHERE uncertain_job.app_id=j.app_id AND uncertain_attempt.state='uncertain'
               )
               AND (j.trigger<>'branch_poll' OR (
                 owner.auto_deploy_paused=0
                 AND j.idempotency_key=('auto:' || j.source_generation || ':' ||
                   j.observation_sequence || ':' || j.reconcile_epoch)
                 AND EXISTS (
                   SELECT 1 FROM product_desired_branch AS desired
                   WHERE desired.app_id=j.app_id AND desired.source_generation=j.source_generation
                     AND desired.ref=j.ref AND desired.desired_observation_sequence=j.observation_sequence
                     AND desired.reconcile_epoch=j.reconcile_epoch AND desired.desired_sha=j.target_sha
                     AND desired.auto_paused=0 AND desired.reconciliation_state='queued'
                     AND desired.reconciliation_job_id=j.job_id
                 )
               ))
               AND (j.trigger<>'manual_rollback' OR EXISTS (
                 SELECT 1 FROM deployment AS target
                 WHERE target.id=j.target_deployment_id AND target.app_id=j.app_id
               ))
             ORDER BY CASE WHEN j.trigger='branch_poll' THEN 1 ELSE 0 END,
                      j.created_at, j.job_id`
          )
          .all(controllerId, now, PRODUCT_MAX_ATTEMPTS) as ClaimableJobRow[]

        const candidate = jobs[0]
        if (!candidate) return { state: 'none' as const, reason: 'no_eligible_job' as const }
        if (candidate.trigger === 'manual_rollback') {
          return { state: 'blocked' as const, reason: 'unsupported_trigger' as const }
        }

        const activeAppLease = this.database
          .prepare(
            `SELECT expires_at FROM product_app_lease
                    WHERE app_id=? AND released_at IS NULL LIMIT 1`
          )
          .get(candidate.app_id) as { expires_at: string } | undefined
        if (activeAppLease) {
          return {
            state: 'blocked' as const,
            reason:
              activeAppLease.expires_at <= now
                ? ('reconciliation_required' as const)
                : ('app_lease_busy' as const)
          }
        }

        this.database
          .prepare(
            `INSERT INTO product_app_fence(app_id,last_fence) VALUES(?,1)
                    ON CONFLICT(app_id) DO UPDATE SET last_fence=last_fence+1`
          )
          .run(candidate.app_id)
        const appFence = (
          this.database
            .prepare('SELECT last_fence FROM product_app_fence WHERE app_id=?')
            .get(candidate.app_id) as { last_fence: number }
        ).last_fence
        const buildFence = (
          this.database
            .prepare(
              `SELECT COALESCE(MAX(fence),0)+1 AS next_fence
                                 FROM product_worker_lease WHERE slot_name='build'`
            )
            .get() as {
            next_fence: number
          }
        ).next_fence
        const appLeaseId = `app_lease_${randomUUID()}`
        const buildLeaseId = `build_lease_${randomUUID()}`
        const attemptId = `attempt_${randomUUID()}`
        const attemptNumber = candidate.attempt_count + 1

        this.database
          .prepare(
            `INSERT INTO product_app_lease
            (app_id, lease_id, controller_id, ownership_generation, fence, job_id,
             acquired_at, expires_at, heartbeat_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            candidate.app_id,
            appLeaseId,
            controllerId,
            candidate.ownership_generation,
            appFence,
            candidate.job_id,
            now,
            expiresAt,
            now
          )
        this.database
          .prepare(
            `INSERT INTO product_worker_lease
            (slot_name, lease_id, controller_id, fence, job_id,
             acquired_at, expires_at, heartbeat_at)
            VALUES ('build', ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(buildLeaseId, controllerId, buildFence, candidate.job_id, now, expiresAt, now)
        this.database
          .prepare(
            `INSERT INTO product_deploy_attempt
            (attempt_id, job_id, attempt_number, lease_id, fencing_token,
             build_slot_lease_id, build_slot_fence, state, remote_outcome, started_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'claimed', 'not_started', ?)`
          )
          .run(
            attemptId,
            candidate.job_id,
            attemptNumber,
            appLeaseId,
            appFence,
            buildLeaseId,
            buildFence,
            now
          )
        const update = this.database
          .prepare(
            `UPDATE product_deploy_job
                    SET state='claimed', attempt_count=?, updated_at=?
                    WHERE job_id=? AND controller_id=? AND state IN ('queued','retry_wait')
                      AND available_at<=? AND attempt_count=? AND attempt_count<MIN(max_attempts, ?)`
          )
          .run(
            attemptNumber,
            now,
            candidate.job_id,
            controllerId,
            now,
            candidate.attempt_count,
            PRODUCT_MAX_ATTEMPTS
          )
        if (update.changes !== 1) throw new ProductDeployRepositoryError('CLAIM_CAS_FAILED')

        if (candidate.trigger === 'branch_poll') {
          const desiredUpdate = this.database
            .prepare(
              `UPDATE product_desired_branch
               SET reconciliation_state='in_progress', updated_at=?
               WHERE app_id=? AND source_generation=? AND ref=?
                 AND desired_observation_sequence=? AND reconcile_epoch=? AND desired_sha=?
                 AND auto_paused=0 AND reconciliation_state='queued' AND reconciliation_job_id=?`
            )
            .run(
              now,
              candidate.app_id,
              candidate.source_generation,
              candidate.ref,
              candidate.observation_sequence,
              candidate.reconcile_epoch,
              candidate.target_sha,
              candidate.job_id
            )
          if (desiredUpdate.changes !== 1) {
            throw new ProductDeployRepositoryError('CLAIM_DESIRED_CAS_FAILED')
          }
        }

        return {
          state: 'claimed' as const,
          claim: {
            controller_id: controllerId,
            app_id: candidate.app_id,
            job_id: candidate.job_id,
            attempt_id: attemptId,
            attempt_number: attemptNumber,
            ownership_generation: candidate.ownership_generation,
            source_generation: candidate.source_generation,
            source_config_sha256: candidate.source_config_sha256,
            app_lease_id: appLeaseId,
            app_fence: appFence,
            build_slot_lease_id: buildLeaseId,
            build_slot_fence: buildFence,
            expires_at: expiresAt
          }
        }
      })
      .immediate()
  }

  /** Stores only that supplied Git metadata matched the durable job identity; it does not prove a fetch. */
  markGitSnapshotVerified(
    claim: ProductClaimToken,
    snapshot: ProductGitSnapshotMetadata
  ): ProductSnapshotVerificationResult {
    if (!isValidClaimToken(claim)) return { state: 'rejected', reason: 'invalid_claim' }
    if (!isValidGitSnapshotMetadata(snapshot)) {
      return { state: 'rejected', reason: 'snapshot_mismatch' }
    }
    return this.database
      .transaction(() => {
        const now = new Date(this.readClock()).toISOString()
        const authority = loadDispatchAuthority(this.database, claim)
        if (!authority) return { state: 'rejected' as const, reason: 'stale_claim' as const }
        const failure = validateDispatchAuthority(authority, claim, now)
        if (failure) return { state: 'rejected' as const, reason: failure }
        if (authority.trigger === 'manual_rollback') {
          return { state: 'rejected' as const, reason: 'unsupported_trigger' as const }
        }
        if (authority.trigger !== 'branch_poll' && authority.trigger !== 'manual_redeploy') {
          return { state: 'rejected' as const, reason: 'unsupported_trigger' as const }
        }
        const metadataFailure = validateSnapshotMatchesAuthority(authority, snapshot)
        if (metadataFailure) return { state: 'rejected' as const, reason: metadataFailure }
        if (hasUncertainProductWork(this.database, claim.app_id)) {
          return { state: 'rejected' as const, reason: 'reconciliation_required' as const }
        }
        if (authority.job_state !== 'claimed') {
          if (authority.job_state === 'deploying' || authority.remote_outcome !== 'not_started') {
            return { state: 'rejected' as const, reason: 'reconciliation_required' as const }
          }
          return { state: 'rejected' as const, reason: 'stale_claim' as const }
        }
        if (authority.attempt_state === 'deploying' || authority.remote_outcome !== 'not_started') {
          return { state: 'rejected' as const, reason: 'reconciliation_required' as const }
        }
        if (authority.attempt_state === 'snapshot_verified') {
          return { state: 'snapshot_verified' as const }
        }
        if (authority.attempt_state !== 'claimed' || authority.deployment_id !== null) {
          return { state: 'rejected' as const, reason: 'stale_claim' as const }
        }
        const update = this.database
          .prepare(
            `UPDATE product_deploy_attempt SET state='snapshot_verified'
           WHERE attempt_id=? AND job_id=? AND attempt_number=? AND state='claimed'
             AND remote_outcome='not_started' AND deployment_id IS NULL`
          )
          .run(claim.attempt_id, claim.job_id, claim.attempt_number)
        if (update.changes !== 1)
          throw new ProductDeployRepositoryError('SNAPSHOT_VERIFY_CAS_FAILED')
        this.database
          .prepare(
            `INSERT INTO product_history_event
           (controller_id,app_id,job_id,attempt_id,kind,created_at,safe_summary_json)
           VALUES (?,?,?,?,?,?,?)`
          )
          .run(
            claim.controller_id,
            claim.app_id,
            claim.job_id,
            claim.attempt_id,
            'git_snapshot_metadata_matched',
            now,
            JSON.stringify({
              source_config_sha256: snapshot.sourceConfigSha256,
              repository_root: snapshot.repositoryRoot,
              target_sha: snapshot.commitSha
            })
          )
        return { state: 'snapshot_verified' as const }
      })
      .immediate()
  }

  /** Commits one one-shot dispatch marker and canonical deployment row before any remote write. */
  beginGitDispatch(
    claim: ProductClaimToken,
    snapshot: ProductGitSnapshotMetadata
  ): ProductBeginDispatchResult {
    if (!isValidClaimToken(claim)) return { state: 'rejected', reason: 'invalid_claim' }
    if (!isValidGitSnapshotMetadata(snapshot)) {
      return { state: 'rejected', reason: 'snapshot_mismatch' }
    }
    return this.database
      .transaction(() => {
        const now = new Date(this.readClock()).toISOString()
        const authority = loadDispatchAuthority(this.database, claim)
        if (!authority) return { state: 'rejected' as const, reason: 'stale_claim' as const }
        const failure = validateDispatchAuthority(authority, claim, now)
        if (failure) return { state: 'rejected' as const, reason: failure }
        if (authority.trigger === 'manual_rollback') {
          return { state: 'rejected' as const, reason: 'unsupported_trigger' as const }
        }
        if (authority.trigger !== 'branch_poll' && authority.trigger !== 'manual_redeploy') {
          return { state: 'rejected' as const, reason: 'unsupported_trigger' as const }
        }
        if (
          authority.job_state === 'deploying' ||
          authority.attempt_state === 'deploying' ||
          authority.remote_outcome !== 'not_started' ||
          authority.deployment_id !== null
        ) {
          return {
            state: 'reconciliation_required' as const,
            reason: 'dispatch_marker_exists' as const
          }
        }
        if (hasUncertainProductWork(this.database, claim.app_id)) {
          return { state: 'reconciliation_required' as const, reason: 'uncertain_work' as const }
        }
        const metadataFailure = validateSnapshotMatchesAuthority(authority, snapshot)
        if (metadataFailure) return { state: 'rejected' as const, reason: metadataFailure }
        if (authority.job_state !== 'claimed' || authority.attempt_state !== 'snapshot_verified') {
          return { state: 'rejected' as const, reason: 'snapshot_not_verified' as const }
        }
        if (authority.trigger === 'branch_poll') {
          if (authority.auto_deploy_paused === 1) {
            return { state: 'rejected' as const, reason: 'auto_paused' as const }
          }
          const desired = this.database
            .prepare(
              `SELECT desired_observation_sequence,desired_sha,reconcile_epoch,
                    reconciliation_state,reconciliation_job_id,auto_paused
             FROM product_desired_branch WHERE app_id=? AND source_generation=? AND ref=?`
            )
            .get(claim.app_id, authority.source_generation, authority.job_ref) as
            DispatchDesiredRow | undefined
          if (
            !desired ||
            desired.auto_paused !== 0 ||
            desired.reconciliation_state !== 'in_progress' ||
            desired.reconciliation_job_id !== claim.job_id ||
            desired.desired_observation_sequence !== authority.observation_sequence ||
            desired.desired_sha !== authority.target_sha ||
            desired.reconcile_epoch !== authority.reconcile_epoch
          ) {
            return { state: 'rejected' as const, reason: 'desired_changed' as const }
          }
        }

        const deployment = insertNextDeploymentVersion(this.database, {
          appId: claim.app_id,
          appName: authority.app_name,
          detectorJson: null,
          envJson: null,
          gitProvenance: { repositoryUrl: snapshot.repositoryUrl, commitSha: snapshot.commitSha }
        })
        const attemptUpdate = this.database
          .prepare(
            `UPDATE product_deploy_attempt SET state='deploying',remote_outcome='unknown',deployment_id=?
           WHERE attempt_id=? AND job_id=? AND attempt_number=? AND state='snapshot_verified'
             AND remote_outcome='not_started' AND deployment_id IS NULL`
          )
          .run(deployment.id, claim.attempt_id, claim.job_id, claim.attempt_number)
        if (attemptUpdate.changes !== 1)
          throw new ProductDeployRepositoryError('DISPATCH_ATTEMPT_CAS_FAILED')
        const jobUpdate = this.database
          .prepare(
            `UPDATE product_deploy_job SET state='deploying',updated_at=?,finished_at=NULL
           WHERE job_id=? AND controller_id=? AND app_id=? AND state='claimed' AND attempt_count=?`
          )
          .run(now, claim.job_id, claim.controller_id, claim.app_id, claim.attempt_number)
        if (jobUpdate.changes !== 1)
          throw new ProductDeployRepositoryError('DISPATCH_JOB_CAS_FAILED')
        this.database
          .prepare(
            `INSERT INTO product_history_event
           (controller_id,app_id,job_id,attempt_id,kind,created_at,safe_summary_json)
           VALUES (?,?,?,?,?,?,?)`
          )
          .run(
            claim.controller_id,
            claim.app_id,
            claim.job_id,
            claim.attempt_id,
            'remote_dispatch_marker_committed',
            now,
            JSON.stringify({
              deployment_id: deployment.id,
              version: deployment.version,
              target_sha: snapshot.commitSha
            })
          )
        return {
          state: 'dispatch_authorized' as const,
          deployment_id: deployment.id,
          version: deployment.version,
          image_tag: deployment.imageTag
        }
      })
      .immediate()
  }

  /**
   * Finishes an eligible pre-write attempt and releases its exact leases atomically.
   * Remote-write/deploy/health failures are excluded by durable attempt state.
   */
  finishPrewriteAttempt(input: ProductPrewriteFinishInput): ProductPrewriteFinishResult {
    if (
      !input ||
      typeof input !== 'object' ||
      !isValidClaimToken(input.claim) ||
      (input.disposition !== 'transient_failure' &&
        input.disposition !== 'permanent_failure' &&
        input.disposition !== 'check_obsolete')
    ) {
      return { state: 'rejected', reason: 'invalid_claim' }
    }
    if (input.disposition === 'transient_failure') {
      if (typeof input.safeErrorCode !== 'string') {
        return { state: 'rejected', reason: 'unrecognized_error_code' }
      }
      if (
        !(PRODUCT_PREWRITE_ERROR_CODES.transient as readonly string[]).includes(input.safeErrorCode)
      ) {
        const mismatched = (PRODUCT_PREWRITE_ERROR_CODES.permanent as readonly string[]).includes(
          input.safeErrorCode
        )
        return {
          state: 'rejected',
          reason: mismatched ? 'error_code_disposition_mismatch' : 'unrecognized_error_code'
        }
      }
    } else if (input.disposition === 'permanent_failure') {
      if (typeof input.safeErrorCode !== 'string') {
        return { state: 'rejected', reason: 'unrecognized_error_code' }
      }
      if (
        !(PRODUCT_PREWRITE_ERROR_CODES.permanent as readonly string[]).includes(input.safeErrorCode)
      ) {
        const mismatched = (PRODUCT_PREWRITE_ERROR_CODES.transient as readonly string[]).includes(
          input.safeErrorCode
        )
        return {
          state: 'rejected',
          reason: mismatched ? 'error_code_disposition_mismatch' : 'unrecognized_error_code'
        }
      }
    }
    const { claim } = input
    const safeErrorCode =
      input.disposition === 'check_obsolete' ? 'AUTO_OBSOLETE' : input.safeErrorCode

    return this.database
      .transaction(() => {
        const nowMs = this.readClock()
        const now = new Date(nowMs).toISOString()
        const authority = this.database
          .prepare(
            `SELECT j.state AS job_state, j.controller_id, j.app_id,
                    j.ownership_generation, j.source_generation, j.source_config_sha256,
                    j.trigger, j.ref AS job_ref, j.observation_sequence, j.reconcile_epoch,
                    j.target_sha, j.attempt_count, j.max_attempts,
                    a.source_type, a.git_repo_url, a.git_ref, a.git_root, v.archived_at,
                    owner.mode, owner.controller_id AS owner_controller_id,
                    owner.ownership_generation AS owner_generation,
                    owner.source_generation AS owner_source_generation,
                    owner.source_config_sha256 AS owner_config_sha256, owner.auto_deploy_paused,
                    owner.pause_reason AS owner_pause_reason,
                    source.repository_url, source.production_ref, source.repository_root,
                    c.status AS controller_status,
                    pa.attempt_number, pa.state AS attempt_state, pa.remote_outcome,
                    pa.lease_id AS app_lease_id, pa.fencing_token AS app_fence,
                    pa.build_slot_lease_id, pa.build_slot_fence,
                    app_lease.app_id AS lease_app_id,
                    app_lease.controller_id AS app_lease_controller_id,
                    app_lease.ownership_generation AS lease_ownership_generation,
                    build_lease.controller_id AS build_lease_controller_id,
                    build_lease.slot_name,
                    app_lease.expires_at AS app_expires_at, app_lease.released_at AS app_released_at,
                    build_lease.expires_at AS build_expires_at, build_lease.released_at AS build_released_at
             FROM product_deploy_attempt AS pa
             JOIN product_deploy_job AS j ON j.job_id=pa.job_id
             JOIN product_controller AS c ON c.controller_id=j.controller_id
             JOIN app AS a ON a.id=j.app_id
             JOIN vps AS v ON v.id=a.vps_id
             JOIN product_app_control AS owner ON owner.app_id=j.app_id
             JOIN product_source_config AS source ON source.app_id=j.app_id
               AND source.source_generation=j.source_generation
               AND source.config_sha256=j.source_config_sha256
             JOIN product_app_lease AS app_lease ON app_lease.lease_id=pa.lease_id
               AND app_lease.fence=pa.fencing_token AND app_lease.job_id=j.job_id
             JOIN product_worker_lease AS build_lease ON build_lease.lease_id=pa.build_slot_lease_id
               AND build_lease.fence=pa.build_slot_fence AND build_lease.job_id=j.job_id
             WHERE pa.attempt_id=? AND j.job_id=?`
          )
          .get(claim.attempt_id, claim.job_id) as PrewriteAuthorityRow | undefined
        if (!authority) return { state: 'rejected' as const, reason: 'stale_claim' as const }
        if (authority.controller_status !== 'active') {
          return { state: 'rejected' as const, reason: 'controller_inactive' as const }
        }
        if (
          authority.controller_id !== claim.controller_id ||
          authority.app_id !== claim.app_id ||
          authority.ownership_generation !== claim.ownership_generation ||
          authority.source_generation !== claim.source_generation ||
          authority.source_config_sha256 !== claim.source_config_sha256 ||
          authority.attempt_number !== claim.attempt_number ||
          authority.attempt_count !== claim.attempt_number ||
          authority.lease_app_id !== claim.app_id ||
          authority.app_lease_controller_id !== claim.controller_id ||
          authority.lease_ownership_generation !== claim.ownership_generation ||
          authority.build_lease_controller_id !== claim.controller_id ||
          authority.slot_name !== 'build' ||
          authority.app_lease_id !== claim.app_lease_id ||
          authority.app_fence !== claim.app_fence ||
          authority.build_slot_lease_id !== claim.build_slot_lease_id ||
          authority.build_slot_fence !== claim.build_slot_fence
        )
          return { state: 'rejected' as const, reason: 'stale_claim' as const }
        if (
          authority.mode !== 'product' ||
          authority.owner_controller_id !== claim.controller_id ||
          authority.owner_generation !== claim.ownership_generation ||
          authority.owner_source_generation !== claim.source_generation ||
          authority.owner_config_sha256 !== claim.source_config_sha256 ||
          authority.archived_at !== null ||
          authority.source_type !== 'git' ||
          authority.repository_url !== authority.git_repo_url ||
          authority.production_ref !== authority.git_ref ||
          authority.repository_root !== authority.git_root ||
          authority.production_ref !== authority.job_ref
        )
          return { state: 'rejected' as const, reason: 'ownership_changed' as const }
        if (
          authority.attempt_state === 'deploying' ||
          authority.remote_outcome === 'applied' ||
          authority.remote_outcome === 'unknown'
        )
          return { state: 'rejected' as const, reason: 'reconciliation_required' as const }
        if (authority.job_state !== 'claimed') {
          return { state: 'rejected' as const, reason: 'not_prewrite' as const }
        }
        if (
          (authority.attempt_state !== 'claimed' &&
            authority.attempt_state !== 'snapshot_verified') ||
          authority.remote_outcome !== 'not_started'
        )
          return { state: 'rejected' as const, reason: 'not_prewrite' as const }
        if (authority.app_released_at !== null || authority.build_released_at !== null) {
          return { state: 'rejected' as const, reason: 'stale_claim' as const }
        }
        if (authority.app_expires_at <= now || authority.build_expires_at <= now) {
          return { state: 'rejected' as const, reason: 'expired_lease' as const }
        }

        const desired =
          authority.trigger === 'branch_poll'
            ? (this.database
                .prepare(
                  `SELECT desired_observation_sequence, desired_sha, reconcile_epoch,
                      reconciliation_job_id, auto_paused
               FROM product_desired_branch WHERE app_id=? AND source_generation=? AND ref=?`
                )
                .get(claim.app_id, authority.source_generation, authority.job_ref) as
                PrewriteDesiredRow | undefined)
            : undefined
        const obsolete =
          authority.trigger === 'branch_poll' &&
          (authority.auto_deploy_paused === 1 ||
            !desired ||
            desired.desired_observation_sequence !== authority.observation_sequence ||
            desired.desired_sha !== authority.target_sha ||
            desired.reconcile_epoch !== authority.reconcile_epoch ||
            desired.reconciliation_job_id !== claim.job_id ||
            desired.auto_paused !== 0)
        if (input.disposition === 'check_obsolete' && !obsolete) {
          return { state: 'rejected' as const, reason: 'not_obsolete' as const }
        }

        let finalState: 'retry_wait' | 'failed' | 'superseded'
        let availableAt: string | null = null
        if (obsolete) {
          finalState = 'superseded'
        } else if (
          input.disposition === 'transient_failure' &&
          authority.attempt_count < Math.min(authority.max_attempts, PRODUCT_MAX_ATTEMPTS)
        ) {
          finalState = 'retry_wait'
          const backoff = PRODUCT_RETRY_BACKOFF_MS[claim.attempt_number - 1]
          const random = this.jitter()
          if (!Number.isFinite(random)) throw new ProductDeployRepositoryError('INVALID_JITTER')
          const jitterMs = Math.floor(
            Math.max(0, Math.min(1, random)) * PRODUCT_RETRY_JITTER_MAX_MS
          )
          availableAt = new Date(nowMs + backoff + jitterMs).toISOString()
        } else {
          finalState = 'failed'
        }

        const attemptState = finalState === 'superseded' ? 'abandoned_before_write' : 'failed'
        const attemptUpdate = this.database
          .prepare(
            `UPDATE product_deploy_attempt SET state=?, finished_at=?, failed_step='pre_write', safe_error_code=?
           WHERE attempt_id=? AND job_id=? AND attempt_number=?
             AND state IN ('claimed','snapshot_verified') AND remote_outcome='not_started'`
          )
          .run(
            attemptState,
            now,
            safeErrorCode,
            claim.attempt_id,
            claim.job_id,
            claim.attempt_number
          )
        if (attemptUpdate.changes !== 1)
          throw new ProductDeployRepositoryError('PREWRITE_ATTEMPT_CAS_FAILED')

        const jobUpdate = this.database
          .prepare(
            `UPDATE product_deploy_job SET state=?, available_at=COALESCE(?,available_at),
             updated_at=?, finished_at=?, safe_error_code=?
           WHERE job_id=? AND controller_id=? AND app_id=? AND state='claimed' AND attempt_count=?`
          )
          .run(
            finalState,
            availableAt,
            now,
            finalState === 'retry_wait' ? null : now,
            safeErrorCode,
            claim.job_id,
            claim.controller_id,
            claim.app_id,
            authority.attempt_count
          )
        if (jobUpdate.changes !== 1)
          throw new ProductDeployRepositoryError('PREWRITE_JOB_CAS_FAILED')

        const appRelease = this.database
          .prepare(
            `UPDATE product_app_lease SET released_at=?
           WHERE lease_id=? AND app_id=? AND controller_id=? AND ownership_generation=?
             AND fence=? AND job_id=? AND released_at IS NULL AND expires_at>?`
          )
          .run(
            now,
            claim.app_lease_id,
            claim.app_id,
            claim.controller_id,
            claim.ownership_generation,
            claim.app_fence,
            claim.job_id,
            now
          )
        if (appRelease.changes !== 1)
          throw new ProductDeployRepositoryError('PREWRITE_APP_LEASE_CAS_FAILED')
        const buildRelease = this.database
          .prepare(
            `UPDATE product_worker_lease SET released_at=?
           WHERE lease_id=? AND slot_name='build' AND controller_id=? AND fence=?
             AND job_id=? AND released_at IS NULL AND expires_at>?`
          )
          .run(
            now,
            claim.build_slot_lease_id,
            claim.controller_id,
            claim.build_slot_fence,
            claim.job_id,
            now
          )
        if (buildRelease.changes !== 1)
          throw new ProductDeployRepositoryError('PREWRITE_BUILD_LEASE_CAS_FAILED')

        if (authority.trigger === 'branch_poll' && !obsolete && desired) {
          const desiredState = finalState === 'retry_wait' ? 'queued' : 'failed'
          const desiredUpdate = this.database
            .prepare(
              `UPDATE product_desired_branch SET reconciliation_state=?, updated_at=?
             WHERE app_id=? AND source_generation=? AND ref=?
               AND desired_observation_sequence=? AND desired_sha=? AND reconcile_epoch=?
               AND reconciliation_job_id=? AND auto_paused=0`
            )
            .run(
              desiredState,
              now,
              claim.app_id,
              authority.source_generation,
              authority.job_ref,
              authority.observation_sequence,
              authority.target_sha,
              authority.reconcile_epoch,
              claim.job_id
            )
          if (desiredUpdate.changes !== 1)
            throw new ProductDeployRepositoryError('PREWRITE_DESIRED_CAS_FAILED')
        } else if (
          authority.trigger === 'branch_poll' &&
          obsolete &&
          desired &&
          authority.auto_deploy_paused === 1 &&
          desired.desired_observation_sequence === authority.observation_sequence &&
          desired.desired_sha === authority.target_sha &&
          desired.reconcile_epoch === authority.reconcile_epoch &&
          desired.reconciliation_job_id === claim.job_id
        ) {
          // Reflect the current owner policy only for this exact desired revision.
          const pausedUpdate = this.database
            .prepare(
              `UPDATE product_desired_branch SET reconciliation_state='paused',auto_paused=1,
               pause_reason=?,updated_at=?
             WHERE app_id=? AND source_generation=? AND ref=?
               AND desired_observation_sequence=? AND desired_sha=? AND reconcile_epoch=?
               AND reconciliation_job_id=?`
            )
            .run(
              authority.owner_pause_reason,
              now,
              claim.app_id,
              authority.source_generation,
              authority.job_ref,
              authority.observation_sequence,
              authority.target_sha,
              authority.reconcile_epoch,
              claim.job_id
            )
          if (pausedUpdate.changes !== 1)
            throw new ProductDeployRepositoryError('PREWRITE_PAUSE_CAS_FAILED')
        }

        const kind =
          finalState === 'retry_wait'
            ? 'prewrite_retry_scheduled'
            : finalState === 'superseded'
              ? 'prewrite_auto_superseded'
              : 'prewrite_failed'
        this.database
          .prepare(
            `INSERT INTO product_history_event
           (controller_id,app_id,job_id,attempt_id,kind,created_at,safe_summary_json)
           VALUES (?,?,?,?,?,?,?)`
          )
          .run(
            claim.controller_id,
            claim.app_id,
            claim.job_id,
            claim.attempt_id,
            kind,
            now,
            JSON.stringify({ safe_error_code: safeErrorCode, available_at: availableAt })
          )

        if (finalState === 'retry_wait') {
          return { state: 'retry_scheduled' as const, available_at: availableAt! }
        }
        return { state: finalState as 'failed' | 'superseded' }
      })
      .immediate()
  }

  /** Renews both leases only while this exact, unexpired claim still owns the DB authority. */
  heartbeatClaim(claim: ProductClaimToken): ProductHeartbeatResult {
    if (!isValidClaimToken(claim)) return { state: 'rejected', reason: 'invalid_claim' }

    try {
      return this.database
        .transaction(() => {
          // Expiry and renewal are evaluated against the time at which this
          // transaction actually owns the writer lock, never request start.
          const nowMs = this.readClock()
          const now = new Date(nowMs).toISOString()
          const expiresAt = new Date(nowMs + PRODUCT_LEASE_TTL_MS).toISOString()
          const controller = this.database
            .prepare('SELECT status FROM product_controller WHERE controller_id=?')
            .get(claim.controller_id) as { status: string } | undefined
          if (!controller || controller.status !== 'active') {
            return { state: 'rejected' as const, reason: 'controller_inactive' as const }
          }

          const authority = this.database
            .prepare(
              `SELECT j.state AS job_state, j.controller_id, j.app_id,
                      j.ownership_generation, j.source_generation, j.source_config_sha256,
                      a.source_type, a.git_repo_url, a.git_ref, a.git_root, v.archived_at,
                      owner.mode, owner.controller_id AS owner_controller_id,
                      owner.ownership_generation AS owner_generation,
                      owner.source_generation AS owner_source_generation,
                      owner.source_config_sha256 AS owner_config_sha256,
                      source.repository_url, source.production_ref, source.repository_root,
                      j.ref AS job_ref,
                      pa.attempt_number, pa.state AS attempt_state,
                      pa.lease_id AS app_lease_id, pa.fencing_token AS app_fence,
                      pa.build_slot_lease_id, pa.build_slot_fence,
                      app_lease.expires_at AS app_expires_at, app_lease.released_at AS app_released_at,
                      build_lease.expires_at AS build_expires_at, build_lease.released_at AS build_released_at
               FROM product_deploy_attempt AS pa
               JOIN product_deploy_job AS j ON j.job_id=pa.job_id
               JOIN app AS a ON a.id=j.app_id
               JOIN vps AS v ON v.id=a.vps_id
               JOIN product_app_control AS owner ON owner.app_id=j.app_id
               JOIN product_source_config AS source ON source.app_id=j.app_id
                 AND source.source_generation=j.source_generation
                 AND source.config_sha256=j.source_config_sha256
               JOIN product_app_lease AS app_lease ON app_lease.lease_id=pa.lease_id
                 AND app_lease.fence=pa.fencing_token AND app_lease.job_id=j.job_id
               JOIN product_worker_lease AS build_lease ON build_lease.lease_id=pa.build_slot_lease_id
                 AND build_lease.fence=pa.build_slot_fence AND build_lease.job_id=j.job_id
               WHERE pa.attempt_id=? AND j.job_id=?`
            )
            .get(claim.attempt_id, claim.job_id) as ClaimAuthorityRow | undefined
          if (!authority) return { state: 'rejected' as const, reason: 'stale_claim' as const }
          if (
            authority.controller_id !== claim.controller_id ||
            authority.app_id !== claim.app_id ||
            authority.ownership_generation !== claim.ownership_generation ||
            authority.source_generation !== claim.source_generation ||
            authority.source_config_sha256 !== claim.source_config_sha256 ||
            authority.attempt_number !== claim.attempt_number ||
            authority.app_lease_id !== claim.app_lease_id ||
            authority.app_fence !== claim.app_fence ||
            authority.build_slot_lease_id !== claim.build_slot_lease_id ||
            authority.build_slot_fence !== claim.build_slot_fence ||
            (authority.job_state !== 'claimed' && authority.job_state !== 'deploying') ||
            (authority.attempt_state !== 'claimed' &&
              authority.attempt_state !== 'snapshot_verified' &&
              authority.attempt_state !== 'deploying')
          ) {
            return { state: 'rejected' as const, reason: 'stale_claim' as const }
          }
          if (
            authority.mode !== 'product' ||
            authority.owner_controller_id !== claim.controller_id ||
            authority.owner_generation !== claim.ownership_generation ||
            authority.owner_source_generation !== claim.source_generation ||
            authority.owner_config_sha256 !== claim.source_config_sha256 ||
            authority.archived_at !== null ||
            authority.source_type !== 'git' ||
            authority.repository_url !== authority.git_repo_url ||
            authority.production_ref !== authority.git_ref ||
            authority.repository_root !== authority.git_root ||
            authority.production_ref !== authority.job_ref
          ) {
            return { state: 'rejected' as const, reason: 'ownership_changed' as const }
          }
          if (authority.app_released_at !== null || authority.build_released_at !== null) {
            return { state: 'rejected' as const, reason: 'stale_claim' as const }
          }
          if (authority.app_expires_at <= now || authority.build_expires_at <= now) {
            return { state: 'rejected' as const, reason: 'expired_lease' as const }
          }

          const appUpdate = this.database
            .prepare(
              `UPDATE product_app_lease SET heartbeat_at=?, expires_at=?
                      WHERE lease_id=? AND app_id=? AND controller_id=?
                        AND ownership_generation=? AND fence=? AND job_id=?
                        AND released_at IS NULL AND expires_at>?`
            )
            .run(
              now,
              expiresAt,
              claim.app_lease_id,
              claim.app_id,
              claim.controller_id,
              claim.ownership_generation,
              claim.app_fence,
              claim.job_id,
              now
            )
          if (appUpdate.changes !== 1) {
            return { state: 'rejected' as const, reason: 'expired_lease' as const }
          }
          const buildUpdate = this.database
            .prepare(
              `UPDATE product_worker_lease SET heartbeat_at=?, expires_at=?
                      WHERE lease_id=? AND slot_name='build' AND controller_id=?
                        AND fence=? AND job_id=? AND released_at IS NULL AND expires_at>?`
            )
            .run(
              now,
              expiresAt,
              claim.build_slot_lease_id,
              claim.controller_id,
              claim.build_slot_fence,
              claim.job_id,
              now
            )
          if (buildUpdate.changes !== 1)
            throw new ProductDeployRepositoryError('HEARTBEAT_CAS_LOST')
          return { state: 'renewed' as const, expires_at: expiresAt }
        })
        .immediate()
    } catch (error) {
      if (error instanceof ProductDeployRepositoryError && error.code === 'HEARTBEAT_CAS_LOST') {
        return { state: 'rejected', reason: 'expired_lease' }
      }
      throw error
    }
  }

  private readClock(): number {
    const value = this.now()
    if (!Number.isSafeInteger(value)) throw new ProductDeployRepositoryError('INVALID_CLOCK')
    return value
  }

  observeTip(input: ProductObserveTipInput): ProductObserveTipResult {
    validateTipSha(input.tipSha)
    validateExpectedSequence(input.expectedObservationSequence)
    return this.database
      .transaction(() => {
        const context = loadReconcileContext(this.database, input)
        const latest = this.database
          .prepare(
            `SELECT observation_sequence, observed_sha
             FROM product_branch_observation
             WHERE app_id = ? AND source_generation = ? AND ref = ?
             ORDER BY observation_sequence DESC LIMIT 1`
          )
          .get(input.appId, input.sourceGeneration, input.ref) as
          { observation_sequence: number; observed_sha: string } | undefined

        const actualSequence = latest?.observation_sequence ?? null
        if (actualSequence !== input.expectedObservationSequence) {
          throw new ProductDeployRepositoryError('STALE_OBSERVATION')
        }

        const observationCreated = latest?.observed_sha !== input.tipSha
        let sequence = actualSequence
        if (observationCreated) {
          sequence = (actualSequence ?? 0) + 1
          this.database
            .prepare(
              `INSERT INTO product_branch_observation
               (app_id, source_generation, ref, observation_sequence, observed_sha, observed_at)
               VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
            )
            .run(input.appId, input.sourceGeneration, input.ref, sequence, input.tipSha)
          this.database
            .prepare(
              `INSERT INTO product_desired_branch
               (app_id, source_generation, ref, desired_observation_sequence, desired_sha,
                reconcile_epoch, reconciled_observation_sequence, reconciled_epoch,
                reconciliation_state, reconciliation_job_id, auto_paused, pause_reason, updated_at)
               VALUES (?, ?, ?, ?, ?, 0, NULL, NULL,
                       CASE WHEN ?=1 THEN 'paused' ELSE 'pending' END,
                       NULL, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
               ON CONFLICT(app_id, source_generation, ref) DO UPDATE SET
                 desired_observation_sequence=excluded.desired_observation_sequence,
                 desired_sha=excluded.desired_sha,
                 reconciled_observation_sequence=NULL,
                 reconciled_epoch=NULL,
                 auto_paused=excluded.auto_paused,
                 pause_reason=excluded.pause_reason,
                 reconciliation_state=excluded.reconciliation_state,
                 reconciliation_job_id=NULL,
                 updated_at=excluded.updated_at`
            )
            .run(
              input.appId,
              input.sourceGeneration,
              input.ref,
              sequence,
              input.tipSha,
              context.autoDeployPaused ? 1 : 0,
              context.autoDeployPaused ? 1 : 0,
              context.pauseReason
            )
        } else if (latest && sequence !== null) {
          const desired = this.database
            .prepare(
              `SELECT desired_observation_sequence, desired_sha
               FROM product_desired_branch
               WHERE app_id=? AND source_generation=? AND ref=?`
            )
            .get(input.appId, input.sourceGeneration, input.ref) as
            { desired_observation_sequence: number; desired_sha: string } | undefined
          if (
            desired &&
            (desired.desired_observation_sequence !== sequence ||
              desired.desired_sha !== latest.observed_sha)
          ) {
            throw new ProductDeployRepositoryError('DESIRED_OBSERVATION_MISMATCH')
          }
          if (!desired) {
            this.database
              .prepare(
                `INSERT INTO product_desired_branch
                 (app_id, source_generation, ref, desired_observation_sequence, desired_sha,
                  reconcile_epoch, reconciliation_state, auto_paused, pause_reason, updated_at)
                 VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
              )
              .run(
                input.appId,
                input.sourceGeneration,
                input.ref,
                sequence,
                latest.observed_sha,
                context.autoDeployPaused ? 'paused' : 'pending',
                context.autoDeployPaused ? 1 : 0,
                context.pauseReason
              )
          }
        }

        if (sequence === null) {
          throw new ProductDeployRepositoryError('OBSERVATION_NOT_CREATED')
        }

        let desired = this.loadDesired(input.appId, input.sourceGeneration, input.ref)
        if (!desired) throw new ProductDeployRepositoryError('DESIRED_STATE_NOT_CREATED')
        desired = this.applyCurrentPausePolicy(context, desired)
        this.supersedeObsoleteAutoJobs(input, desired)
        const reconciliation = this.reconcileDesiredInTransaction(context, desired)
        return {
          observationSequence: sequence,
          observationCreated,
          desiredSha: desired.desired_sha,
          reconciliation
        }
      })
      .immediate()
  }

  reconcileDesired(identity: ProductReconcileIdentity): ProductReconcileResult {
    return this.database
      .transaction(() => {
        const context = loadReconcileContext(this.database, identity)
        let desired = this.loadDesired(identity.appId, identity.sourceGeneration, identity.ref)
        if (!desired) {
          return { state: 'pending' as const, reason: 'desired_missing' as const, jobId: null }
        }

        const latest = this.database
          .prepare(
            `SELECT observation_sequence, observed_sha
             FROM product_branch_observation
             WHERE app_id=? AND source_generation=? AND ref=?
             ORDER BY observation_sequence DESC LIMIT 1`
          )
          .get(identity.appId, identity.sourceGeneration, identity.ref) as
          { observation_sequence: number; observed_sha: string } | undefined
        if (
          !latest ||
          latest.observation_sequence !== desired.desired_observation_sequence ||
          latest.observed_sha !== desired.desired_sha
        ) {
          throw new ProductDeployRepositoryError('DESIRED_OBSERVATION_MISMATCH')
        }

        desired = this.applyCurrentPausePolicy(context, desired)
        this.supersedeObsoleteAutoJobs(identity, desired)
        return this.reconcileDesiredInTransaction(context, desired)
      })
      .immediate()
  }

  private loadDesired(
    appId: number,
    sourceGeneration: number,
    ref: string
  ): ProductDesiredBranchState | undefined {
    const row = this.database
      .prepare(
        `SELECT app_id, source_generation, ref, desired_observation_sequence,
                       desired_sha, reconcile_epoch, reconciled_observation_sequence,
                       reconciled_epoch, reconciliation_state, reconciliation_job_id,
                       auto_paused, pause_reason, updated_at
                FROM product_desired_branch
                WHERE app_id=? AND source_generation=? AND ref=?`
      )
      .get(appId, sourceGeneration, ref) as ProductDesiredBranchRow | undefined
    return row ? { ...row, auto_paused: row.auto_paused === 1 } : undefined
  }

  private supersedeObsoleteAutoJobs(
    identity: ProductReconcileIdentity,
    desired: ProductDesiredBranchState
  ): void {
    this.database
      .prepare(
        `UPDATE product_deploy_job
         SET state='superseded', finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             safe_error_code='AUTO_DESIRED_SUPERSEDED'
         WHERE app_id=? AND trigger='branch_poll' AND state IN ('queued','retry_wait')
           AND (source_generation<>? OR ownership_generation<>? OR source_config_sha256<>?
             OR ref<>? OR observation_sequence<>? OR reconcile_epoch<>? OR target_sha<>?)`
      )
      .run(
        identity.appId,
        identity.sourceGeneration,
        identity.ownershipGeneration,
        identity.configSha256,
        identity.ref,
        desired.desired_observation_sequence,
        desired.reconcile_epoch,
        desired.desired_sha
      )
  }

  private applyCurrentPausePolicy(
    context: ReconcileContext,
    desired: ProductDesiredBranchState
  ): ProductDesiredBranchState {
    this.database
      .prepare(
        `UPDATE product_desired_branch
         SET auto_paused=?, pause_reason=?,
             reconciliation_state=CASE WHEN ?=1 THEN 'paused'
                                        WHEN reconciliation_state='paused' THEN 'pending'
                                        ELSE reconciliation_state END,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE app_id=? AND source_generation=? AND ref=?
           AND (auto_paused<>? OR pause_reason IS NOT ? OR
             (?=1 AND reconciliation_state<>'paused') OR
             (?=0 AND reconciliation_state='paused'))`
      )
      .run(
        context.autoDeployPaused ? 1 : 0,
        context.pauseReason,
        context.autoDeployPaused ? 1 : 0,
        desired.app_id,
        desired.source_generation,
        desired.ref,
        context.autoDeployPaused ? 1 : 0,
        context.pauseReason,
        context.autoDeployPaused ? 1 : 0,
        context.autoDeployPaused ? 1 : 0
      )
    const state = context.autoDeployPaused
      ? 'paused'
      : desired.reconciliation_state === 'paused'
        ? 'pending'
        : desired.reconciliation_state
    return {
      ...desired,
      auto_paused: context.autoDeployPaused,
      pause_reason: context.pauseReason,
      reconciliation_state: state
    }
  }

  private reconcileDesiredInTransaction(
    context: ReconcileContext,
    desired: ProductDesiredBranchState
  ): ProductReconcileResult {
    const updateDesired = (
      state: ProductDesiredBranchState['reconciliation_state'],
      jobId: string | null,
      markReconciled: boolean
    ): void => {
      this.database
        .prepare(
          `UPDATE product_desired_branch
           SET reconciliation_state=?, reconciliation_job_id=?,
               reconciled_observation_sequence=?, reconciled_epoch=?,
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE app_id=? AND source_generation=? AND ref=?`
        )
        .run(
          state,
          jobId,
          markReconciled ? desired.desired_observation_sequence : null,
          markReconciled ? desired.reconcile_epoch : null,
          desired.app_id,
          desired.source_generation,
          desired.ref
        )
    }
    const result = (
      state: ProductDesiredBranchState['reconciliation_state'],
      reason: ProductReconcileResult['reason'],
      jobId: string | null
    ): ProductReconcileResult => ({ state, reason, jobId })

    if (desired.auto_paused) {
      updateDesired('paused', desired.reconciliation_job_id, false)
      return result('paused', 'manual_pause', desired.reconciliation_job_id)
    }

    const uncertain = this.database
      .prepare(
        `SELECT job_id FROM product_deploy_job WHERE app_id=? AND state='uncertain'
         UNION ALL
         SELECT job_id FROM product_deploy_attempt WHERE job_id IN
           (SELECT job_id FROM product_deploy_job WHERE app_id=?) AND state='uncertain'
         LIMIT 1`
      )
      .get(desired.app_id, desired.app_id) as { job_id: string } | undefined
    if (uncertain) {
      const matching = this.getAutoJob(context, desired)
      const jobId = matching?.job_id ?? uncertain.job_id
      updateDesired('uncertain', jobId, false)
      return result('uncertain', 'uncertain_job', jobId)
    }

    const active = this.database
      .prepare(
        `SELECT job_id, trigger, source_generation, source_config_sha256,
                ownership_generation, ref, observation_sequence, reconcile_epoch, target_sha, state
         FROM product_deploy_job
         WHERE app_id=? AND state IN ('claimed','deploying')
         ORDER BY created_at, job_id LIMIT 1`
      )
      .get(desired.app_id) as ProductJobRow | undefined
    if (active) {
      const isDesiredAutoJob = isMatchingAutoJob(active, context, desired)
      const state = isDesiredAutoJob ? 'in_progress' : 'pending'
      updateDesired(state, isDesiredAutoJob ? active.job_id : null, false)
      return result(state, 'active_job', isDesiredAutoJob ? active.job_id : null)
    }

    if (this.isCanonicalLiveDesired(context, desired)) {
      updateDesired('satisfied', null, true)
      return result('satisfied', 'live_matches', null)
    }

    const existing = this.getAutoJob(context, desired)
    if (existing) {
      if (existing.state === 'queued' || existing.state === 'retry_wait') {
        updateDesired('queued', existing.job_id, true)
        return result('queued', 'already_queued', existing.job_id)
      }
      if (existing.state === 'failed' || existing.state === 'rolled_back') {
        updateDesired('failed', existing.job_id, true)
        return result('failed', 'terminal_failure', existing.job_id)
      }
      if (existing.state === 'uncertain') {
        updateDesired('uncertain', existing.job_id, false)
        return result('uncertain', 'uncertain_job', existing.job_id)
      }
      if (existing.state === 'succeeded') {
        updateDesired('pending', existing.job_id, false)
        return result('pending', 'terminal_success_live_mismatch', existing.job_id)
      }
      updateDesired('pending', existing.job_id, false)
      return result('pending', 'terminal_job', existing.job_id)
    }

    const idempotencyKey = `auto:${desired.source_generation}:${desired.desired_observation_sequence}:${desired.reconcile_epoch}`
    const jobId = createJobId()
    this.database
      .prepare(
        `INSERT INTO product_deploy_job
         (job_id, controller_id, app_id, ownership_generation, source_generation,
          source_config_sha256, trigger, idempotency_key, ref, target_sha,
          observation_sequence, reconcile_epoch, state, attempt_count, max_attempts,
          available_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'branch_poll', ?, ?, ?, ?, ?, 'queued', 0, 3,
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'),
                 strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
      )
      .run(
        jobId,
        context.controllerId,
        desired.app_id,
        context.ownershipGeneration,
        desired.source_generation,
        context.configSha256,
        idempotencyKey,
        desired.ref,
        desired.desired_sha,
        desired.desired_observation_sequence,
        desired.reconcile_epoch
      )
    updateDesired('queued', jobId, true)
    return result('queued', 'queued', jobId)
  }

  private getAutoJob(
    context: ReconcileContext,
    desired: ProductDesiredBranchState
  ): ProductJobRow | undefined {
    const idempotencyKey = `auto:${desired.source_generation}:${desired.desired_observation_sequence}:${desired.reconcile_epoch}`
    const row = this.database
      .prepare(
        `SELECT job_id, trigger, source_generation, source_config_sha256,
                ownership_generation, ref, observation_sequence, reconcile_epoch,
                target_sha, state
         FROM product_deploy_job
         WHERE controller_id=? AND app_id=? AND idempotency_key=?`
      )
      .get(context.controllerId, desired.app_id, idempotencyKey) as ProductJobRow | undefined
    if (row && !isMatchingAutoJob(row, context, desired)) {
      throw new ProductDeployRepositoryError('IDEMPOTENCY_KEY_COLLISION')
    }
    return row
  }

  private isCanonicalLiveDesired(
    context: ReconcileContext,
    desired: ProductDesiredBranchState
  ): boolean {
    const row = this.database
      .prepare(
        `SELECT d.git_commit_sha
         FROM app a
         JOIN deployment d ON d.id=a.current_deployment_id AND d.app_id=a.id AND d.status='running'
         JOIN product_deploy_attempt pa ON pa.deployment_id=d.id AND pa.state='succeeded'
         JOIN product_deploy_job j ON j.job_id=pa.job_id AND j.app_id=a.id AND j.state='succeeded'
         JOIN product_source_config sc ON sc.app_id=j.app_id
           AND sc.source_generation=j.source_generation
           AND sc.config_sha256=j.source_config_sha256
         WHERE a.id=? AND j.controller_id=? AND j.ownership_generation=?
           AND j.source_generation=? AND j.source_config_sha256=?
           AND j.target_sha=? AND d.git_commit_sha=j.target_sha
         LIMIT 1`
      )
      .get(
        desired.app_id,
        context.controllerId,
        context.ownershipGeneration,
        desired.source_generation,
        context.configSha256,
        desired.desired_sha
      ) as { git_commit_sha: string } | undefined
    return row?.git_commit_sha === desired.desired_sha
  }

  getController(controllerId: ProductControllerId): ProductRecord<ProductControllerRecord> {
    return readOne(
      this.database
        .prepare(
          'SELECT controller_id, created_at, status FROM product_controller WHERE controller_id = ?'
        )
        .get(controllerId) as ProductControllerRecord | undefined
    )
  }

  getOwnership(appId: number): ProductRecord<ProductAppOwnershipRecord> {
    const row = this.database
      .prepare(
        `SELECT app_id, mode, controller_id, ownership_generation, changed_at,
                auto_deploy_paused, pause_reason, pause_policy_provenance
         FROM product_app_control WHERE app_id = ?`
      )
      .get(appId) as
      | (Omit<ProductAppOwnershipRecord, 'auto_deploy_paused'> & { auto_deploy_paused: 0 | 1 })
      | undefined
    if (!row) return { kind: 'absent' }
    return {
      kind: 'present',
      value: { ...row, auto_deploy_paused: row.auto_deploy_paused === 1 }
    }
  }

  getSourceConfig(
    appId: number,
    sourceGeneration: number
  ): ProductRecord<ProductSourceConfigRecord> {
    return readOne(
      this.database
        .prepare(
          `SELECT app_id, source_generation, config_sha256, repository_url,
                         production_ref, repository_root, deploy_config_json, created_at
                  FROM product_source_config WHERE app_id = ? AND source_generation = ?`
        )
        .get(appId, sourceGeneration) as ProductSourceConfigRecord | undefined
    )
  }

  getDesiredState(
    appId: number,
    sourceGeneration: number,
    ref: string
  ): ProductRecord<ProductDesiredBranchState> {
    const row = this.database
      .prepare(
        `SELECT app_id, source_generation, ref, desired_observation_sequence,
                       desired_sha, reconcile_epoch, reconciled_observation_sequence,
                       reconciled_epoch, reconciliation_state, reconciliation_job_id,
                       auto_paused, pause_reason, updated_at
                FROM product_desired_branch
                WHERE app_id = ? AND source_generation = ? AND ref = ?`
      )
      .get(appId, sourceGeneration, ref) as ProductDesiredBranchRow | undefined
    if (row === undefined) return { kind: 'absent' }
    return { kind: 'present', value: { ...row, auto_paused: row.auto_paused === 1 } }
  }

  getLatestObservation(
    appId: number,
    sourceGeneration: number,
    ref: string
  ): ProductRecord<ProductBranchObservation> {
    return readOne(
      this.database
        .prepare(
          `SELECT app_id, source_generation, ref, observation_sequence, observed_sha, observed_at
                  FROM product_branch_observation
                  WHERE app_id = ? AND source_generation = ? AND ref = ?
                  ORDER BY observation_sequence DESC LIMIT 1`
        )
        .get(appId, sourceGeneration, ref) as ProductBranchObservation | undefined
    )
  }
}

function readOne<T>(row: T | undefined): ProductRecord<T> {
  return row === undefined ? { kind: 'absent' } : { kind: 'present', value: row }
}

type ReconcileContext = ProductReconcileIdentity & {
  autoDeployPaused: boolean
  pauseReason: ProductAppOwnership['pause_reason']
}

interface ProductJobRow {
  job_id: string
  trigger: string
  source_generation: number
  source_config_sha256: string
  ownership_generation: number
  ref: string
  observation_sequence: number | null
  reconcile_epoch: number | null
  target_sha: string | null
  state: ProductJobState
}

interface ClaimableJobRow {
  job_id: string
  app_id: number
  ownership_generation: number
  source_generation: number
  source_config_sha256: string
  trigger: string
  ref: string
  target_sha: string | null
  target_deployment_id: number | null
  observation_sequence: number | null
  reconcile_epoch: number | null
  attempt_count: number
  max_attempts: number
}

interface ClaimAuthorityRow {
  job_state: string
  controller_id: string
  app_id: number
  ownership_generation: number
  source_generation: number
  source_config_sha256: string
  source_type: string
  git_repo_url: string | null
  git_ref: string | null
  git_root: string | null
  archived_at: string | null
  mode: string
  owner_controller_id: string | null
  owner_generation: number
  owner_source_generation: number
  owner_config_sha256: string
  repository_url: string
  production_ref: string
  repository_root: string
  job_ref: string
  attempt_number: number
  attempt_state: string
  app_lease_id: string
  app_fence: number
  build_slot_lease_id: string
  build_slot_fence: number
  app_expires_at: string
  app_released_at: string | null
  build_expires_at: string
  build_released_at: string | null
}

interface PrewriteAuthorityRow extends ClaimAuthorityRow {
  trigger: string
  job_ref: string
  observation_sequence: number | null
  reconcile_epoch: number | null
  target_sha: string | null
  attempt_count: number
  max_attempts: number
  controller_status: string
  auto_deploy_paused: number
  owner_pause_reason: 'manual_action' | 'operator' | null
  lease_app_id: number
  app_lease_controller_id: string
  lease_ownership_generation: number
  build_lease_controller_id: string
  slot_name: string
  remote_outcome: string
}

interface PrewriteDesiredRow {
  desired_observation_sequence: number
  desired_sha: string
  reconcile_epoch: number
  reconciliation_job_id: string | null
  auto_paused: 0 | 1
}

interface DispatchDesiredRow {
  desired_observation_sequence: number
  desired_sha: string
  reconcile_epoch: number
  reconciliation_state: string
  reconciliation_job_id: string | null
  auto_paused: 0 | 1
}

interface ClaimDispatchAuthority {
  job_state: string
  controller_id: string
  controller_status: string
  app_id: number
  app_name: string
  ownership_generation: number
  source_generation: number
  source_config_sha256: string
  trigger: string
  job_ref: string
  target_sha: string | null
  observation_sequence: number | null
  reconcile_epoch: number | null
  attempt_count: number
  attempt_number: number
  attempt_state: string
  remote_outcome: string
  deployment_id: number | null
  source_type: string
  app_repo_url: string | null
  app_ref: string | null
  app_root: string | null
  archived_at: string | null
  owner_mode: string
  owner_controller_id: string | null
  owner_generation: number
  owner_source_generation: number
  owner_config_sha256: string
  auto_deploy_paused: number
  repository_url: string
  production_ref: string
  repository_root: string
  app_lease_id: string
  app_fence: number
  lease_app_id: number
  app_lease_controller_id: string
  lease_ownership_generation: number
  app_expires_at: string
  app_released_at: string | null
  build_slot_lease_id: string
  build_slot_fence: number
  build_lease_controller_id: string
  slot_name: string
  build_expires_at: string
  build_released_at: string | null
}

type DispatchAuthorityFailure =
  | 'stale_claim'
  | 'controller_inactive'
  | 'ownership_changed'
  | 'expired_lease'
  | 'unsupported_trigger'

function loadDispatchAuthority(
  database: Database.Database,
  claim: ProductClaimToken
): ClaimDispatchAuthority | undefined {
  return database
    .prepare(
      `SELECT j.state AS job_state,j.controller_id,c.status AS controller_status,j.app_id,a.name AS app_name,
       j.ownership_generation,j.source_generation,j.source_config_sha256,j.trigger,j.ref AS job_ref,
       j.target_sha,j.observation_sequence,j.reconcile_epoch,j.attempt_count,
       pa.attempt_number,pa.state AS attempt_state,pa.remote_outcome,pa.deployment_id,
       a.source_type,a.git_repo_url AS app_repo_url,a.git_ref AS app_ref,a.git_root AS app_root,v.archived_at,
       owner.mode AS owner_mode,owner.controller_id AS owner_controller_id,
       owner.ownership_generation AS owner_generation,owner.source_generation AS owner_source_generation,
       owner.source_config_sha256 AS owner_config_sha256,owner.auto_deploy_paused,
       source.repository_url,source.production_ref,source.repository_root,
       pa.lease_id AS app_lease_id,pa.fencing_token AS app_fence,
       app_lease.app_id AS lease_app_id,app_lease.controller_id AS app_lease_controller_id,
       app_lease.ownership_generation AS lease_ownership_generation,
       app_lease.expires_at AS app_expires_at,app_lease.released_at AS app_released_at,
       pa.build_slot_lease_id,pa.build_slot_fence,build_lease.controller_id AS build_lease_controller_id,
       build_lease.slot_name,build_lease.expires_at AS build_expires_at,
       build_lease.released_at AS build_released_at
     FROM product_deploy_attempt pa
     JOIN product_deploy_job j ON j.job_id=pa.job_id
     JOIN product_controller c ON c.controller_id=j.controller_id
     JOIN app a ON a.id=j.app_id
     JOIN vps v ON v.id=a.vps_id
     JOIN product_app_control owner ON owner.app_id=j.app_id
     JOIN product_source_config source ON source.app_id=j.app_id
       AND source.source_generation=j.source_generation AND source.config_sha256=j.source_config_sha256
     JOIN product_app_lease app_lease ON app_lease.lease_id=pa.lease_id
       AND app_lease.fence=pa.fencing_token AND app_lease.job_id=j.job_id
     JOIN product_worker_lease build_lease ON build_lease.lease_id=pa.build_slot_lease_id
       AND build_lease.fence=pa.build_slot_fence AND build_lease.job_id=j.job_id
     WHERE pa.attempt_id=? AND j.job_id=?`
    )
    .get(claim.attempt_id, claim.job_id) as ClaimDispatchAuthority | undefined
}

function validateDispatchAuthority(
  authority: ClaimDispatchAuthority | undefined,
  claim: ProductClaimToken,
  now: string
): DispatchAuthorityFailure | null {
  if (!authority) return 'stale_claim'
  if (authority.controller_status !== 'active') return 'controller_inactive'
  if (
    authority.controller_id !== claim.controller_id ||
    authority.app_id !== claim.app_id ||
    authority.ownership_generation !== claim.ownership_generation ||
    authority.source_generation !== claim.source_generation ||
    authority.source_config_sha256 !== claim.source_config_sha256 ||
    authority.attempt_number !== claim.attempt_number ||
    authority.attempt_count !== claim.attempt_number ||
    authority.app_lease_id !== claim.app_lease_id ||
    authority.app_fence !== claim.app_fence ||
    authority.build_slot_lease_id !== claim.build_slot_lease_id ||
    authority.build_slot_fence !== claim.build_slot_fence ||
    authority.lease_app_id !== claim.app_id ||
    authority.app_lease_controller_id !== claim.controller_id ||
    authority.lease_ownership_generation !== claim.ownership_generation ||
    authority.build_lease_controller_id !== claim.controller_id ||
    authority.slot_name !== 'build'
  )
    return 'stale_claim'
  if (
    authority.owner_mode !== 'product' ||
    authority.owner_controller_id !== claim.controller_id ||
    authority.owner_generation !== claim.ownership_generation ||
    authority.owner_source_generation !== claim.source_generation ||
    authority.owner_config_sha256 !== claim.source_config_sha256 ||
    authority.archived_at !== null ||
    authority.source_type !== 'git' ||
    authority.app_repo_url !== authority.repository_url ||
    authority.app_ref !== authority.production_ref ||
    authority.app_root !== authority.repository_root ||
    authority.production_ref !== authority.job_ref ||
    authority.repository_url.length === 0 ||
    authority.repository_root.length === 0
  )
    return 'ownership_changed'
  if (
    authority.app_released_at !== null ||
    authority.build_released_at !== null ||
    authority.app_expires_at <= now ||
    authority.build_expires_at <= now
  )
    return 'expired_lease'
  if (authority.trigger === 'manual_rollback') return 'unsupported_trigger'
  return null
}

function isValidGitSnapshotMetadata(value: ProductGitSnapshotMetadata): boolean {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof value.repositoryUrl === 'string' &&
    value.repositoryUrl.length > 0 &&
    typeof value.repositoryRoot === 'string' &&
    value.repositoryRoot.length > 0 &&
    typeof value.commitSha === 'string' &&
    /^[0-9a-f]{40}$/.test(value.commitSha) &&
    typeof value.sourceConfigSha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(value.sourceConfigSha256)
  )
}

function validateSnapshotMatchesAuthority(
  authority: ClaimDispatchAuthority,
  snapshot: ProductGitSnapshotMetadata
): 'snapshot_mismatch' | null {
  return authority.repository_url === snapshot.repositoryUrl &&
    authority.repository_root === snapshot.repositoryRoot &&
    authority.target_sha === snapshot.commitSha &&
    authority.source_config_sha256 === snapshot.sourceConfigSha256
    ? null
    : 'snapshot_mismatch'
}

function hasUncertainProductWork(database: Database.Database, appId: number): boolean {
  return Boolean(
    database
      .prepare(
        `SELECT 1 FROM product_deploy_job j WHERE j.app_id=? AND j.state='uncertain'
     UNION ALL
     SELECT 1 FROM product_deploy_attempt pa JOIN product_deploy_job j ON j.job_id=pa.job_id
       WHERE j.app_id=? AND pa.state='uncertain' LIMIT 1`
      )
      .get(appId, appId)
  )
}

export class ProductDeployRepositoryError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'ProductDeployRepositoryError'
  }
}

function isValidClaimToken(value: ProductClaimToken): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.controller_id === 'string' &&
    value.controller_id.length > 0 &&
    Number.isSafeInteger(value.app_id) &&
    value.app_id > 0 &&
    typeof value.job_id === 'string' &&
    value.job_id.length > 0 &&
    typeof value.attempt_id === 'string' &&
    value.attempt_id.length > 0 &&
    Number.isSafeInteger(value.attempt_number) &&
    value.attempt_number > 0 &&
    Number.isSafeInteger(value.ownership_generation) &&
    value.ownership_generation > 0 &&
    Number.isSafeInteger(value.source_generation) &&
    value.source_generation > 0 &&
    /^[0-9a-f]{64}$/.test(value.source_config_sha256) &&
    typeof value.app_lease_id === 'string' &&
    value.app_lease_id.length > 0 &&
    Number.isSafeInteger(value.app_fence) &&
    value.app_fence > 0 &&
    typeof value.build_slot_lease_id === 'string' &&
    value.build_slot_lease_id.length > 0 &&
    Number.isSafeInteger(value.build_slot_fence) &&
    value.build_slot_fence > 0 &&
    typeof value.expires_at === 'string' &&
    Number.isFinite(Date.parse(value.expires_at))
  )
}

function loadReconcileContext(
  database: Database.Database,
  identity: ProductReconcileIdentity
): ReconcileContext {
  if (
    !Number.isSafeInteger(identity.appId) ||
    identity.appId < 1 ||
    !Number.isSafeInteger(identity.ownershipGeneration) ||
    identity.ownershipGeneration < 1 ||
    !Number.isSafeInteger(identity.sourceGeneration) ||
    identity.sourceGeneration < 1 ||
    !/^[0-9a-f]{64}$/.test(identity.configSha256) ||
    typeof identity.ref !== 'string' ||
    identity.ref.length === 0
  ) {
    throw new ProductDeployRepositoryError('INVALID_PRODUCT_IDENTITY')
  }

  const controller = database
    .prepare('SELECT status FROM product_controller WHERE controller_id=?')
    .get(identity.controllerId) as { status: string } | undefined
  if (!controller || controller.status !== 'active') {
    throw new ProductDeployRepositoryError('CONTROLLER_NOT_ACTIVE')
  }

  const app = database
    .prepare(
      `SELECT a.id, a.source_type, a.git_repo_url, v.archived_at
       FROM app a JOIN vps v ON v.id=a.vps_id WHERE a.id=?`
    )
    .get(identity.appId) as
    | { id: number; source_type: string; git_repo_url: string | null; archived_at: string | null }
    | undefined
  if (!app || app.archived_at !== null || app.source_type !== 'git' || !app.git_repo_url) {
    throw new ProductDeployRepositoryError('PRODUCT_APP_NOT_ELIGIBLE')
  }

  const ownership = database
    .prepare(
      `SELECT mode, controller_id, ownership_generation, source_generation,
              source_config_sha256, auto_deploy_paused, pause_reason
       FROM product_app_control WHERE app_id=?`
    )
    .get(identity.appId) as
    | {
        mode: string
        controller_id: string | null
        ownership_generation: number
        source_generation: number
        source_config_sha256: string
        auto_deploy_paused: 0 | 1
        pause_reason: ProductAppOwnership['pause_reason']
      }
    | undefined
  if (
    !ownership ||
    ownership.mode !== 'product' ||
    ownership.controller_id !== identity.controllerId ||
    ownership.ownership_generation !== identity.ownershipGeneration ||
    ownership.source_generation !== identity.sourceGeneration ||
    ownership.source_config_sha256 !== identity.configSha256
  ) {
    throw new ProductDeployRepositoryError('PRODUCT_STATE_CONFLICT')
  }

  const source = database
    .prepare(
      `SELECT repository_url, production_ref, config_sha256
       FROM product_source_config WHERE app_id=? AND source_generation=?`
    )
    .get(identity.appId, identity.sourceGeneration) as
    { repository_url: string; production_ref: string; config_sha256: string } | undefined
  if (
    !source ||
    source.config_sha256 !== identity.configSha256 ||
    source.production_ref !== identity.ref ||
    source.repository_url !== app.git_repo_url
  ) {
    throw new ProductDeployRepositoryError('PRODUCT_STATE_CONFLICT')
  }

  return {
    ...identity,
    autoDeployPaused: ownership.auto_deploy_paused === 1,
    pauseReason: ownership.pause_reason
  }
}

function isMatchingAutoJob(
  job: ProductJobRow,
  context: ReconcileContext,
  desired: ProductDesiredBranchState
): boolean {
  return (
    job.trigger === 'branch_poll' &&
    job.source_generation === desired.source_generation &&
    job.source_config_sha256 === context.configSha256 &&
    job.ownership_generation === context.ownershipGeneration &&
    job.ref === desired.ref &&
    job.observation_sequence === desired.desired_observation_sequence &&
    job.reconcile_epoch === desired.reconcile_epoch &&
    job.target_sha === desired.desired_sha
  )
}

function validateTipSha(tipSha: string): void {
  if (typeof tipSha !== 'string' || !/^[0-9a-f]{40}$/.test(tipSha)) {
    throw new ProductDeployRepositoryError('INVALID_GIT_TIP')
  }
}

function validateExpectedSequence(sequence: number | null): void {
  if (sequence !== null && (!Number.isSafeInteger(sequence) || sequence < 1)) {
    throw new ProductDeployRepositoryError('INVALID_OBSERVATION_SEQUENCE')
  }
}

function createJobId(): string {
  return `pjob_${randomUUID()}`
}
