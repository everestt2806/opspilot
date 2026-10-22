/**
 * Shared data contract for Product-mode Git auto deploy.
 * Persistence migrations 016-018 create empty tables/policy fields only; they do not enroll apps.
 */

export type ProductControllerId = string;
export type ProductAppId = number;
export type ProductJobId = string;
export type ProductAttemptId = string;
export type ProductLeaseId = string;
export type ProductDeploymentId = number;
export type ProductFullCommitSha = string;
export type ProductIsoUtc = string;

/** Lease timing policy for the first Product claim repository. */
export const PRODUCT_LEASE_TTL_MS = 60_000;
export const PRODUCT_HEARTBEAT_INTERVAL_MS = 15_000;
/** A job may be claimed at most three times total (two retries). */
export const PRODUCT_MAX_ATTEMPTS = 3;
export const PRODUCT_RETRY_BACKOFF_MS = [30_000, 120_000] as const;
/** Additive jitter is capped so retries remain within a bounded delay. */
export const PRODUCT_RETRY_JITTER_MAX_MS = 15_000;

export type ProductAppMode = 'desktop' | 'product';
export type ProductJobTrigger = 'branch_poll' | 'manual_redeploy' | 'manual_rollback';

/**
 * `product_app_control.auto_deploy_paused` is the current policy source.
 * Desired-branch pause fields are snapshots and never override this value.
 */
/** Incremented by CAS whenever Product ownership is switched or re-enrolled. */
export interface ProductAppOwnership {
  app_id: ProductAppId;
  mode: ProductAppMode;
  controller_id: ProductControllerId | null;
  ownership_generation: number;
  changed_at: ProductIsoUtc;
  /** App-level Product policy; source/config generation changes do not clear it. */
  auto_deploy_paused: boolean;
  pause_reason: 'manual_action' | 'operator' | null;
  /** Legacy ambiguous policy requires an explicit operator confirmation to resume. */
  pause_policy_provenance:
    | 'legacy_clean'
    | 'legacy_inferred'
    | 'operator_required'
    | 'explicit';
}

/** Deploy-relevant source/build config is snapshotted and hashed at enqueue. */
export interface ProductSourceConfigIdentity {
  app_id: ProductAppId;
  source_generation: number;
  config_sha256: string;
  repository_url: string;
  production_ref: string;
  repository_root: string;
}

/** A durable row is emitted only when the production ref's full SHA changes. */
export interface ProductBranchObservation {
  app_id: ProductAppId;
  source_generation: number;
  ref: string;
  observation_sequence: number;
  observed_sha: ProductFullCommitSha;
  observed_at: ProductIsoUtc;
}

export type ProductReconciliationState =
  | 'pending'
  | 'queued'
  | 'in_progress'
  | 'satisfied'
  | 'paused'
  | 'failed'
  | 'uncertain';

/** Durable desired tip is separate from jobs so restart cannot lose intent. */
export interface ProductDesiredBranchState {
  app_id: ProductAppId;
  source_generation: number;
  ref: string;
  desired_observation_sequence: number;
  desired_sha: ProductFullCommitSha;
  reconcile_epoch: number;
  reconciled_observation_sequence: number | null;
  reconciled_epoch: number | null;
  reconciliation_state: ProductReconciliationState;
  reconciliation_job_id: ProductJobId | null;
  /** Snapshot of ProductAppOwnership policy when this desired row was reconciled. */
  auto_paused: boolean;
  pause_reason: 'manual_action' | 'operator' | null;
  updated_at: ProductIsoUtc;
}

export type ProductJobState =
  | 'queued'
  | 'claimed'
  | 'deploying'
  | 'retry_wait'
  | 'succeeded'
  | 'failed'
  | 'rolled_back'
  | 'uncertain'
  | 'superseded'
  | 'cancelled';

/**
 * Safe pre-write transient failures retry the same job, with a new attempt only
 * after available_at. The total claim budget is three attempts; retry delays
 * are 30s then 120s plus bounded additive jitter. Build/health failures are
 * post-dispatch and never enter this retry path.
 */

export interface ProductDeployJob {
  job_id: ProductJobId;
  controller_id: ProductControllerId;
  app_id: ProductAppId;
  ownership_generation: number;
  source_generation: number;
  source_config_sha256: string;
  trigger: ProductJobTrigger;
  /**
   * Auto key: `auto:<source_generation>:<observation_sequence>:<reconcile_epoch>`.
   * Manual key: caller-generated UUID, stable across transport retries.
   * This key is unique per app/controller; commit SHA is deliberately not unique.
   */
  idempotency_key: string;
  branch_ref: string;
  target_sha: ProductFullCommitSha | null;
  target_deployment_id: ProductDeploymentId | null;
  observation_sequence: number | null;
  reconcile_epoch: number | null;
  state: ProductJobState;
  attempt_count: number;
  max_attempts: number;
  created_at: ProductIsoUtc;
  updated_at: ProductIsoUtc;
  finished_at: ProductIsoUtc | null;
  supersedes_job_id: ProductJobId | null;
  safe_error_code: string | null;
}

export type ProductAttemptState =
  | 'claimed'
  | 'snapshot_verified'
  | 'deploying'
  | 'succeeded'
  | 'failed'
  | 'abandoned_before_write'
  | 'rolled_back'
  | 'uncertain';

export interface ProductDeployAttempt {
  attempt_id: ProductAttemptId;
  job_id: ProductJobId;
  attempt_number: number;
  lease_id: ProductLeaseId;
  fencing_token: number;
  build_slot_lease_id: ProductLeaseId;
  build_slot_fence: number;
  state: ProductAttemptState;
  deployment_id: ProductDeploymentId | null;
  started_at: ProductIsoUtc;
  finished_at: ProductIsoUtc | null;
  failed_step: string | null;
  safe_error_code: string | null;
  remote_outcome: 'not_started' | 'applied' | 'unknown';
}

/** Current lease plus a monotonic per-app fence counter retained after release. */
export interface ProductAppLease {
  app_id: ProductAppId;
  lease_id: ProductLeaseId;
  holder_controller_id: ProductControllerId;
  ownership_generation: number;
  job_id: ProductJobId;
  fence: number;
  expires_at: ProductIsoUtc;
  heartbeat_at: ProductIsoUtc;
}

/** Host-wide slot; the first controller implementation has one build slot. */
export interface ProductBuildSlotLease {
  slot_name: 'build';
  lease_id: ProductLeaseId;
  controller_id: ProductControllerId;
  fence: number;
  job_id: ProductJobId;
  expires_at: ProductIsoUtc;
  heartbeat_at: ProductIsoUtc;
}

/** Capability returned only after one atomic DB claim transaction succeeds. */
export interface ProductClaimToken {
  controller_id: ProductControllerId;
  app_id: ProductAppId;
  job_id: ProductJobId;
  attempt_id: ProductAttemptId;
  attempt_number: number;
  ownership_generation: number;
  source_generation: number;
  source_config_sha256: string;
  app_lease_id: ProductLeaseId;
  app_fence: number;
  build_slot_lease_id: ProductLeaseId;
  build_slot_fence: number;
  expires_at: ProductIsoUtc;
}

export type ProductClaimResult =
  | { state: 'claimed'; claim: ProductClaimToken }
  | { state: 'none'; reason: 'no_eligible_job' }
  | {
      state: 'blocked';
      reason:
        | 'build_slot_busy'
        | 'app_lease_busy'
        | 'reconciliation_required';
    };

export type ProductHeartbeatResult =
  | { state: 'renewed'; expires_at: ProductIsoUtc }
  | {
      state: 'rejected';
      reason:
        | 'invalid_claim'
        | 'stale_claim'
        | 'controller_inactive'
        | 'ownership_changed'
        | 'expired_lease';
    };

export type ProductPrewriteFinishInput =
  | {
      claim: ProductClaimToken;
      disposition: 'transient_failure' | 'permanent_failure';
      /** A safe allowlisted code only; raw output and caller-supplied step names are not accepted. */
      safeErrorCode: string;
    }
  | { claim: ProductClaimToken; disposition: 'check_obsolete' };

export type ProductPrewriteFinishResult =
  | { state: 'retry_scheduled'; available_at: ProductIsoUtc }
  | { state: 'failed' }
  | { state: 'superseded' }
  | {
      state: 'rejected';
      reason:
        | 'invalid_claim'
        | 'stale_claim'
        | 'controller_inactive'
        | 'ownership_changed'
        | 'expired_lease'
        | 'not_prewrite'
        | 'not_obsolete'
        | 'reconciliation_required';
    };

/**
 * This persistence operation can only finish an attempt while no remote write
 * has begun. Before any executor dispatches a remote mutation, it must durably
 * transition the attempt to `deploying` and remote_outcome to `unknown` in a
 * separate transaction. That marker is intentionally outside this checkpoint.
 */

/** Opaque existing deployment-history link; deployment rows remain canonical. */
export interface ProductDeploymentLink {
  job_id: ProductJobId;
  attempt_id: ProductAttemptId;
  deployment_id: ProductDeploymentId;
  app_id: ProductAppId;
  target_sha: ProductFullCommitSha;
}

/** Cursor is scoped to one controller; a desktop must reject a foreign cursor. */
export interface ProductHistoryCursor {
  controller_id: ProductControllerId;
  event_id: number;
}

export interface ProductHistoryEvent {
  event_id: number;
  controller_id: ProductControllerId;
  app_id: ProductAppId;
  job_id: ProductJobId | null;
  attempt_id: ProductAttemptId | null;
  kind: string;
  created_at: ProductIsoUtc;
}
