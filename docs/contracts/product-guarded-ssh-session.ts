import type {
  ProductClaimToken,
  ProductDeploymentId,
  ProductGitSnapshotMetadata
} from './product-auto-deploy'
import type {
  TargetGuardIdentity,
  TargetGuardRejectCode,
  TargetWritePhase
} from './product-target-execution-guard'

/** Private main-process protocol. Never expose through IPC or renderer types. */
export const GUARDED_SSH_PROTOCOL_VERSION = 1 as const
export const GUARDED_SSH_MAX_FRAME_BYTES = 16 * 1024
export const GUARDED_SSH_MAX_OUTPUT_BYTES = 1024 * 1024
export const GUARDED_SSH_REQUEST_TIMEOUT_MS = 15_000
export const GUARDED_SSH_MAX_MESSAGES = 32

export type GuardedSshOpenRequest = Readonly<{
  version: typeof GUARDED_SSH_PROTOCOL_VERSION
  request_id: string
  sequence: 1
  operation: 'open'
  identity: TargetGuardIdentity
  state_root: string
  deployment_id: ProductDeploymentId
}>

export type GuardedSshPhaseRequest = Readonly<{
  version: typeof GUARDED_SSH_PROTOCOL_VERSION
  request_id: string
  sequence: number
  operation: 'authorize_phase'
  phase: TargetWritePhase
  deployment_id: ProductDeploymentId
}>

export type GuardedSshCloseRequest = Readonly<{
  version: typeof GUARDED_SSH_PROTOCOL_VERSION
  request_id: string
  sequence: number
  operation: 'close'
  deployment_id: ProductDeploymentId
}>

export type GuardedSshRequest =
  | GuardedSshOpenRequest
  | GuardedSshPhaseRequest
  | GuardedSshCloseRequest

export type GuardedSshResponse = Readonly<{
  version: typeof GUARDED_SSH_PROTOCOL_VERSION
  request_id: string
  sequence: number
  state: 'accepted' | 'rejected'
  deployment_id?: ProductDeploymentId
  error_code?: GuardedSshErrorCode | TargetGuardRejectCode
}>

export type GuardedSshErrorCode =
  | 'SSH_PIN_REJECTED'
  | 'SSH_CONNECT_FAILED'
  | 'SSH_SESSION_TIMEOUT'
  | 'SSH_SESSION_ABORTED'
  | 'SSH_SESSION_DISCONNECTED'
  | 'SSH_PROTOCOL_MALFORMED'
  | 'SSH_PROTOCOL_TRUNCATED'
  | 'SSH_PROTOCOL_DUPLICATE'
  | 'SSH_PROTOCOL_SEQUENCE'
  | 'SSH_PROTOCOL_LIMIT'
  | 'SSH_AUTHORITY_STALE'
  | 'SSH_DISPATCH_RECONCILIATION_REQUIRED'
  | 'SSH_DISPATCH_REJECTED'
  | 'SSH_TARGET_REJECTED'
  | 'SSH_OUTCOME_UNKNOWN'
  | TargetGuardRejectCode

/** Input accepted only inside the main process after snapshot preparation. */
export type GuardedSshSessionInput = Readonly<{
  claim: ProductClaimToken
  snapshot: ProductGitSnapshotMetadata
  /** Expected precondition only; current target VPS is resolved from SQLite authority. */
  vps_id: number
  target_helper_path: string
  target_state_root: string
}>

export type GuardedSshSessionState = 'active' | 'closed' | 'reconciliation_required'

/**
 * Protocol uses unsigned 32-bit big-endian byte length followed by UTF-8 JSON.
 * Exactly one request/response is outstanding; request ID and sequence must
 * match. Duplicate, malformed, truncated, oversized, timed-out or aborted
 * exchanges close the only channel and produce unknown outcome after dispatch.
 *
 * A single fixed helper process owns one GuardedExecution for the entire SSH
 * channel. It accepts only open, allowlisted phase authorization, and close;
 * no arbitrary shell, Git metadata command, or second channel is exposed.
 * Resolve current app.vps_id, endpoint and host-key pin from Product authority
 * before dispatch. The input vps_id is only an expected precondition. A single
 * strict pinned SSH connection reports its verified endpoint/pin; after async
 * channel open, re-read leases, ownership/source, canonical deployment and
 * target identity before sending open. Recheck that binding before every phase.
 * beginGitDispatch must return the canonical deployment ID before open is sent.
 * A repeated call/restart after its marker is reconciliation, never replay.
 */
export type ProductGuardedSshSessionContract = Readonly<{
  framing: 'uint32be_length_prefixed_utf8_json'
  max_request_bytes: typeof GUARDED_SSH_MAX_FRAME_BYTES
  max_response_bytes: typeof GUARDED_SSH_MAX_OUTPUT_BYTES
  max_messages: typeof GUARDED_SSH_MAX_MESSAGES
  one_outstanding_request: true
  channel_scope: 'one_guarded_execution_whole_session'
  reconnect_mutations: false
  arbitrary_shell: false
  dispatch_before_target_fence: true
  canonical_deployment_only: true
  lost_response: 'unknown_reconciliation_required'
}>
