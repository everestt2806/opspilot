import type { ProductClaimToken, ProductDispatchTargetBinding } from './product-auto-deploy'

/** Internal main-process/lab contract. No IPC, public API, raw shell or production enrollment. */
export type H2PreviousExpectation = Readonly<{
  deployment_id: number
  image_tag: string
  source_sha: string
}>
export type H2Context = Readonly<{
  version: 1
  execution_nonce: string
  /** Historical token expires_at is signed for identity, never used instead of live DB lease expiry. */
  claim: ProductClaimToken
  target: ProductDispatchTargetBinding
  deployment_id: number
  source_sha: string
  app_name: string
  host_port: number
  container_port: number
  healthcheck_path: string
  candidate_image_tag: string
  candidate_image_id: string | null
  build_state: 'build_succeeded' | 'build_failed_definite'
  previous: H2PreviousExpectation | null
  /** C0 allocates this before remote prepare can stop collector/change runtime. Null for build failure. */
  activation_id: number | null
  health_timeout_ms: number
  exposure_policy: 'not_checked'
}>
export type H2MetricBoundary = Readonly<{
  generation: string
  device: number
  inode: number
  next_offset: number
}>
export type H2RuntimeIdentity = Readonly<{
  deployment_id: number
  image_tag: string
  image_id: string
  source_sha: string
  container_id: string
  collector_container_id: string | null
  collector_image_id: string | null
  config_sha256: string
  health: 'healthy' | 'unhealthy' | 'unknown'
  http_status: number | null
}>
export type H2RuntimeStep = 'prepare' | 'activate' | 'health' | 'rollback' | 'publish'
export type H2RuntimeProgress = Readonly<{
  state: 'idle' | 'running' | 'step_succeeded' | 'step_failed' | 'unknown'
  step?: H2RuntimeStep
  boundary?: H2MetricBoundary
  previous?: H2RuntimeIdentity | null
  candidate?: H2RuntimeIdentity | null
  exposure_status?: 'not_checked' | 'degraded'
  safe_error_code?: string
  remote_quiescent: boolean
}>
export type H2TerminalReceipt = Readonly<{
  version: 1
  context: H2Context
  outcome: 'succeeded' | 'failed' | 'rolled_back'
  failed_step: 'BUILD' | 'DEPLOY' | null
  active_runtime: H2RuntimeIdentity | null
  candidate_runtime: H2RuntimeIdentity | null
  previous_runtime: H2RuntimeIdentity | null
  boundary: H2MetricBoundary | null
  exposure_status: 'not_checked' | 'degraded'
  remote_quiescent: true
  sealed_at: string
}>
export type H2SealedReceipt = Readonly<{
  receipt: H2TerminalReceipt
  receipt_sha256: string
  signature: string
}>
export type H2CommitPayload = Readonly<{
  version: 1
  kind: 'product-h2-commit'
  commit_id: string
  receipt_sha256: string
  context_sha256: string
  execution_nonce: string
  attempt_id: string
  deployment_id: number
  outcome: H2TerminalReceipt['outcome']
}>
export type H2CommitAttestation = Readonly<{ payload: H2CommitPayload; signature: string }>
export type H2SettlementPayload = Readonly<{
  version: 1
  kind: 'product-h2-settlement'
  commit_id: string
  receipt_sha256: string
  context_sha256: string
  execution_nonce: string
  attempt_id: string
  deployment_id: number
  settled_at: string
}>
export type H2SettlementAck = Readonly<{ payload: H2SettlementPayload; signature: string }>
export type H2TerminalRecord = Readonly<{
  commit_id: string
  envelope: H2SealedReceipt
  committed_at: string
  settled_at: string | null
  leases_released_at: string | null
}>
export type H2BuildEvidence = Readonly<{
  state: 'build_succeeded' | 'build_failed_definite'
  image_tag: string
  image_id?: string
  target_sha: string
  exit_code?: number
}>
type H2RequestBase = Readonly<{
  version: 1
  request_id: string
  sequence: number
  deployment_id: number
}>
export type H2Request = H2RequestBase &
  (
    | { operation: 'runtime_configure'; context: H2Context }
    | { operation: 'start_runtime_step'; step: H2RuntimeStep }
    | { operation: 'poll_runtime' }
    | { operation: 'seal_runtime' }
    | { operation: 'settle_runtime'; attestation: H2CommitAttestation }
    | {
        operation: 'open_recovery'
        context: H2Context
        state_root: string
        attestation: H2CommitAttestation
      }
  )

/**
 * FROZEN v1 27/10/2026 — producer/consumer changes require Leader coordination.
 *
 * DB class ProductRuntimeRepository(database, { secret: Buffer, clock?: () => number }):
 * createContext(claim, deploymentId, build: H2BuildEvidence): H2Context
 * beginActivationBarrier(context): H2Context   // returns context with activation_id
 * bindActivationBoundary(context, boundary): void
 * finalize(envelope: H2SealedReceipt): H2TerminalRecord // T1, validates signature/live authority/CAS
 * commitAttestation(attemptId: string): H2CommitAttestation // ONLY re-read committed terminal row
 * readSettlementAuthority(context): 'ready' | 'rejected' // terminal authority, no mutable runtime operations
 * completeSettlement(context, ack: H2SettlementAck): void // T2 idempotent, exact lease IDs/fences
 * getTerminal(attemptId: string): H2TerminalRecord | null
 *
 * Python target_product_runtime.ProductRuntime(execution, transfer_directory, deployment_id,
 *   build_state, build_image_tag, build_source_sha) owns one worker, no concurrent command.
 * configure(context), start_step(step), poll()->H2RuntimeProgress, seal()->H2SealedReceipt,
 * settle(attestation)->H2SettlementAck, close() (wait bounded worker; unknown never seal).
 * Helper maps these typed ops, includes runtime/terminal/settlement on accepted responses.
 * Python RecoveryRuntime(state_root,context,attestation) separate lock-only read/settle handle;
 * normal acquire_execution keeps its unknown/replay rejection, never a bypass flag.
 * initialize_runtime_enrollment(root, controller_id, app_id, generation, secret: bytes)
 * explicit LAB/test provision only; 32-byte secret, private regular 0600 file.
 *
 * Canonical JSON: recursively sorted ASCII keys, compact separators, UTF-8, no floats/undefined.
 * SHA256 is lowercase hex over canonical JSON. HMAC-SHA256 secret length32 bytes:
 * domain + '\n' + canonicalJSON(payload), domains 'product-h2:receipt', 'product-h2:commit',
 * 'product-h2:settlement'. Envelope signature signs receipt (not envelope); commit/ack sign payload.
 * Source/target/context identity bind entire signed payload; hash/JSON alone is not auth.
 * Root provides productH2Proof.ts canonicalH2Json, hashH2, signH2, verifyH2, strict Zod schemas.
 *
 * Runtime prepare requires C0 activation_id on successful build; quiesce previous collector,
 * capture canonical metric file inode/dev/generation + size+1, then return boundary. Adapter
 * binds it in C0 before activate. Old app/collector exact CID/config preserved for rollback.
 * Prepare boundary B0 is candidate start; success receipt boundary=B0. On rollback,
 * quiesce candidate collector and capture R0>=B0 (same stream) before restart previous
 * collector; receipt.boundary=R0. DB closes old episode at B0 and opens restored previous
 * at R0, quarantining all failed candidate metrics in [B0,R0).
 * Build failure: no activation barrier or collector stop, verify previous health and seal failed BUILD.
 * Candidate first deploy failed stays for diagnostics; no volume/data prune. Unknown Docker CLI
 * timeout or disconnected/in-flight child -> no seal, reconcile; never assume daemon stopped.
 * Health probes run inside exact CID and verify image/labels before+after. Publish policy only
 * not_checked (degraded exposure allowed); no firewall/DNS/external Desktop SSH writer.
 * Prepared activation barrier rechecked by poller inside every commit after async reads.
 * T1 keeps leases; target verifies committed attestation+receipt/quiescence before unknown→idle;
 * T2 releases exact committed+settled leases (even expired), never steals a new lease.
 * Recovery automatic only sealed + committed same owner/source/pin/security identity; only
 * read/settle same existing attempt. Before seal or identity change => reconciliation/operator.
 */
export const PRODUCT_H2_CONTRACT_VERSION = 1 as const
