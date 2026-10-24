/** Internal P3e target guard contract. This is not a desktop/API contract. */
export type TargetGuardIdentity = Readonly<{
  controller_id: string
  app_id: string
  ownership_generation: number
  claim_id: string
  attempt_id: string
  app_fence: number
}>

/** Created only by explicit enrollment; existing target paths are never adopted. */
export type TargetEnrollmentMarker = Readonly<{
  format: 1
  controller_id: string
  app_id: string
  ownership_generation: number
  highest_accepted_fence: number
  last_claim_id: string | null
  last_attempt_id: string | null
  execution_state: 'idle' | 'unknown'
}>

/** A fixed write phase name; caller supplied shell text is outside this boundary. */
export type TargetWritePhase = 'prepare' | 'build' | 'activate' | 'rollback'

export type TargetGuardResult =
  | { state: 'locked'; identity: TargetGuardIdentity }
  | { state: 'rejected'; code: TargetGuardRejectCode }
  | { state: 'unknown'; code: 'TARGET_OUTCOME_UNKNOWN' }

export type TargetGuardRejectCode =
  | 'TARGET_NOT_ENROLLED'
  | 'TARGET_MARKER_INVALID'
  | 'TARGET_IDENTITY_INVALID'
  | 'TARGET_IDENTITY_MISMATCH'
  | 'TARGET_OWNERSHIP_GENERATION_STALE'
  | 'TARGET_FENCE_STALE'
  | 'TARGET_ATTEMPT_REPLAY'
  | 'TARGET_EXECUTION_UNCERTAIN'
  | 'TARGET_EXECUTION_NOT_ACTIVE'
  | 'TARGET_EXECUTION_ALREADY_ENTERED'
  | 'TARGET_LOCK_BUSY'
  | 'TARGET_LOCK_TIMEOUT_INVALID'
  | 'TARGET_LOCK_RELEASE_FAILED'
  | 'TARGET_PHASE_REJECTED'

/**
 * Execution handles are one-shot: new -> active -> closed. Authorization is
 * valid only while active with the original open flock handle. It never
 * reacquires; nested/repeated enter and authorization after close fail.
 */

/** Fixture initializer errors are outside acquire/authorize execution calls. */
export type TargetEnrollmentFixtureErrorCode = 'TARGET_ALREADY_ENROLLED_OR_PATH_EXISTS'

/**
 * Protocol invariants for future executor integration:
 * - beginGitDispatch commits before the guard accepts a new fence or any write.
 * - one Linux advisory OS lock covers the entire execution, not individual phases;
 * - identity and current marker are checked before every fixed write phase;
 * - the marker is atomically replaced and fsynced before mutation, and records
 *   unknown until a later reconciliation proves a terminal outcome;
 * - an orphan marker-temp file after a crash invalidates the marker and blocks
 *   replay; it is evidence for reconciliation and is never auto-deleted;
 * - no timeout steals the lock or clears unknown state; flock release on process
 *   death is not permission to replay; monotonic fence and attempt identity reject it.
 * The guard cannot revoke an already running command or stop work already handed
 * to Docker. SSH must remain strictly host-pinned and a lost response is unknown.
 */
export type ProductTargetExecutionGuardContract = Readonly<{
  lock_scope: 'controller_app_ownership_generation'
  lock_lifetime: 'whole_execution'
  dispatch_before_mutation: true
  timeout_steal: false
  enrollment: 'explicit_only'
  shell_interpolation: false
  uncertain_replay: false
}>
