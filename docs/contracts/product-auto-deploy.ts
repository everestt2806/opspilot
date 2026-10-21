/**
 * P3b-1 design contract for Product-mode Git auto deploy.
 * Documentation-only: this file defines shapes and state names; it is not
 * imported by runtime code and does not imply a database migration exists.
 */

export type ProductControllerId = string;
export type ProductAppId = number;
export type ProductJobId = string;
export type ProductAttemptId = string;
export type ProductLeaseId = string;
export type ProductDeploymentId = number;
export type ProductFullCommitSha = string;
export type ProductIsoUtc = string;

export type ProductAppMode = 'desktop' | 'product';
export type ProductJobTrigger = 'branch_poll' | 'manual_redeploy' | 'manual_rollback';

/** Incremented by CAS whenever Product ownership is switched or re-enrolled. */
export interface ProductAppOwnership {
  app_id: ProductAppId;
  mode: ProductAppMode;
  controller_id: ProductControllerId | null;
  ownership_generation: number;
  changed_at: ProductIsoUtc;
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

export interface ProductDeployJob {
  job_id: ProductJobId;
  controller_id: ProductControllerId;
  app_id: ProductAppId;
  ownership_generation: number;
  source_generation: number;
  source_config_sha256: string;
  trigger: ProductJobTrigger;
  /**
   * Poll key: `poll:<source_generation>:<observation_sequence>`.
   * Manual key: caller-generated UUID, stable across transport retries.
   * This key is unique per app/controller; commit SHA is deliberately not unique.
   */
  idempotency_key: string;
  branch_ref: string;
  target_sha: ProductFullCommitSha | null;
  target_deployment_id: ProductDeploymentId | null;
  observation_sequence: number | null;
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

