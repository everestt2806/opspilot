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
export const GUARDED_SSH_MAX_FRAME_BYTES = 40 * 1024
export const GUARDED_SSH_MAX_OUTPUT_BYTES = 64 * 1024
export const GUARDED_SSH_MAX_SESSION_OUTPUT_BYTES = 4 * 1024 * 1024
export const GUARDED_SSH_REQUEST_TIMEOUT_MS = 15_000
export const GUARDED_SSH_MAX_MESSAGES = 12_288
export const GUARDED_SSH_TRANSFER_CHUNK_BYTES = 24 * 1024
export const GUARDED_SSH_TRANSFER_MAX_FILE_BYTES = 8 * 1024 * 1024
export const GUARDED_SSH_TRANSFER_MAX_TOTAL_BYTES = 64 * 1024 * 1024
export const GUARDED_SSH_TRANSFER_MAX_FILES = 1_024
export const GUARDED_SSH_TRANSFER_MAX_PATH_BYTES = 1_024

export type GuardedSshTransferScope = 'source' | 'render'
export type GuardedSshRenderFile = 'Dockerfile' | 'docker-compose.yml' | '.env'

export type GuardedSshBeginScopeRequest = Readonly<{
  version: typeof GUARDED_SSH_PROTOCOL_VERSION
  request_id: string
  sequence: number
  operation: 'begin_scope'
  deployment_id: ProductDeploymentId
  scope: GuardedSshTransferScope
  file_count: number
  total_bytes: number
  manifest_sha256: string
}>

export type GuardedSshBeginFileRequest = Readonly<{
  version: typeof GUARDED_SSH_PROTOCOL_VERSION
  request_id: string
  sequence: number
  operation: 'begin_file'
  deployment_id: ProductDeploymentId
  scope: GuardedSshTransferScope
  path: string
  size: number
  mode: number
  sha256: string
}>

export type GuardedSshFileChunkRequest = Readonly<{
  version: typeof GUARDED_SSH_PROTOCOL_VERSION
  request_id: string
  sequence: number
  operation: 'file_chunk'
  deployment_id: ProductDeploymentId
  chunk_index: number
  data_base64: string
}>

export type GuardedSshFinishFileRequest = Readonly<{
  version: typeof GUARDED_SSH_PROTOCOL_VERSION
  request_id: string
  sequence: number
  operation: 'finish_file'
  deployment_id: ProductDeploymentId
}>

export type GuardedSshCompleteScopeRequest = Readonly<{
  version: typeof GUARDED_SSH_PROTOCOL_VERSION
  request_id: string
  sequence: number
  operation: 'complete_scope'
  deployment_id: ProductDeploymentId
  scope: GuardedSshTransferScope
  file_count: number
  total_bytes: number
  manifest_sha256: string
}>

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
  | GuardedSshBeginScopeRequest
  | GuardedSshBeginFileRequest
  | GuardedSshFileChunkRequest
  | GuardedSshFinishFileRequest
  | GuardedSshCompleteScopeRequest
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
  | 'SSH_TRANSFER_REJECTED'
  | 'SSH_TRANSFER_INCOMPLETE'
  | 'SSH_TRANSFER_CHECKSUM'
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
 * match. Request IDs contain 1..128 ASCII letters, digits, underscores or hyphens;
 * malformed identifiers are rejected before guard/filesystem operations. Temporary
 * filenames are generated by the target and never include wire identifiers.
 * Duplicate, malformed, truncated, oversized, timed-out or aborted
 * exchanges close the only channel and produce unknown outcome after dispatch.
 *
 * A single fixed helper process owns one GuardedExecution for the entire SSH
 * channel. After open it accepts fixed phase authorization and bounded source/
 * render file operations only; no arbitrary shell or second channel is exposed.
 * Transfer uses 24 KiB raw chunks, stop-and-wait ACK backpressure, per-file
 * SHA-256 and a UTF-8-byte-sorted manifest digest. The helper enforces 8 MiB/file, 64 MiB
 * total, 1,024 files, 1,024-byte relative paths and the 12,288-message session
 * budget.
 * The helper checks cumulative file sizes before creating each file and checks
 * scope/session actual bytes (including the current file) before every write.
 * The staging directory is derived from the opened app identity and
 * canonical deployment ID; transfer requests never carry an absolute path.
 * Source/render scope completion requires every declared file and both byte
 * totals and manifest digest to match. Incomplete scope data is execution-owned
 * and removed on helper exit; completed staging stays bound to this deployment
 * for the later build checkpoint. Render filenames are allowlisted and `.env`
 * is mode 0600 with contents never logged.
 * Resolve current app.vps_id, endpoint, host-key pin, SSH principal/auth method
 * and monotonic SSH security revision from Product authority
 * before dispatch. The input vps_id is only an expected precondition. A single
 * strict pinned SSH connection reports its verified endpoint/pin/principal; after async
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
