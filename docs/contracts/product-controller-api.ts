/**
 * Product controller enrollment and desktop API contract (design checkpoint).
 * Wire protocol: R3c-3 implements local admin client issue/revoke and credential
 * validation; R3c-4 adds loopback read routes in explicit execution service.
 * R3c-5b composes bounded manual/policy writes and request lookup. R3c-6a adds a
 * main-only pinned SSH channel. R3c-6b adds bounded typed main HTTP calls with
 * current binding/freshness checks and ambiguous-write lookup semantics.
 * Vault/enrollment UI/logs/rotation/full Desktop authority remain future work.
 * The controller is the sole Product-mode writer. The desktop is an authenticated
 * client/cache and must never fall back to its local deploy pipeline.
 */

import type {
  ProductAppId,
  ProductAttemptId,
  ProductControllerId,
  ProductDeploymentId,
  ProductFullCommitSha,
  ProductHistoryCursor,
  ProductIsoUtc,
  ProductJobId,
  ProductJobState,
  ProductReconciliationState
} from './product-auto-deploy'

export const PRODUCT_CONTROLLER_API_VERSION = 'v1' as const
export const PRODUCT_CONTROLLER_API_LOOPBACK = '127.0.0.1' as const
export const PRODUCT_CONTROLLER_API_PORT = 8768
export const PRODUCT_CONTROLLER_API_MAX_REQUEST_BYTES = 16 * 1024
export const PRODUCT_CONTROLLER_API_BODY_TIMEOUT_MS = 5_000
/** Main-process client deadline includes binding resolution, SSH open and full HTTP response. */
export const PRODUCT_CONTROLLER_CLIENT_TIMEOUT_MS = 20_000
export const PRODUCT_CONTROLLER_CLIENT_MAX_TIMEOUT_MS = 30_000
export const PRODUCT_CONTROLLER_CLIENT_MAX_HEADER_BYTES = 16 * 1024
export const PRODUCT_CONTROLLER_API_MAX_RESPONSE_BYTES = 1024 * 1024
export const PRODUCT_CONTROLLER_API_MAX_PAGE_SIZE = 100
export const PRODUCT_CONTROLLER_API_DEFAULT_PAGE_SIZE = 50
export const PRODUCT_CONTROLLER_API_MAX_LOG_PAGE_BYTES = 64 * 1024
export const PRODUCT_CONTROLLER_API_MAX_LOG_LINES = 200
export const PRODUCT_CONTROLLER_API_CLIENT_STALE_AFTER_MS = 30_000
export const PRODUCT_CONTROLLER_API_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60

/** R3c-6a main-only SSH channel; no local TCP listener or renderer destination input.
 * Exact expected VPS/endpoint/host SHA256/user/auth type is checked before SSH auth,
 * after handshake and after channel open against current resolver. No auto replay.
 * Returned stream is owned by the caller, which must destroy it after HTTP completion.
 */
export const PRODUCT_CONTROLLER_SSH_CHANNEL = {
  destination_host: PRODUCT_CONTROLLER_API_LOOPBACK,
  destination_port: PRODUCT_CONTROLLER_API_PORT,
  open_timeout_ms: 15_000,
  max_open_timeout_ms: 30_000
} as const

export const PRODUCT_CONTROLLER_HTTP_STATUS = {
  ok: 200,
  accepted: 202,
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  rate_limited: 429,
  internal_error: 500,
  unsupported: 501,
  unavailable: 503
} as const

export type ProductDesktopClientId = string
export type ProductApiRequestId = string
export type ProductApiIdempotencyKey = string
export type ProductControllerCursorToken = string
export type ProductSshOperationKey = string
export type ProductApiScope = 'read' | 'deploy:manual' | 'policy:write'
export type ProductDesktopGrantableScope = ProductApiScope
/** R3c-6c local Desktop state only; these DTOs never contain the API bearer. */
export interface ProductDesktopControllerBindingMetadata {
  binding_id: string
  controller_id: ProductControllerId
  vps_id: number
  revision: number
  state: 'pending' | 'active' | 'delivery_unknown' | 'disabled'
  remote_client_id: ProductDesktopClientId | null
  client: ProductDesktopClientIdentity | null
  created_at: ProductIsoUtc
  updated_at: ProductIsoUtc
}
/** Trusted main input. binding_id is also the durable enrollment request UUID. */
export interface ProductDesktopControllerBindingIntent {
  binding_id: string
  controller_id: ProductControllerId
  vps_id: number
  ssh_security_revision: number
  principal: {
    vpsId: number
    host: string
    port: number
    hostFingerprint: string
    username: string
    authType: 'key' | 'password'
  }
  artifact_path: string
  data_directory: string
  node_path: string
  manifest_sha256: string
  display_name: string
  requested_scopes: readonly ['read', ...ProductDesktopGrantableScope[]]
}
export type ProductApiCapabilityState = 'available' | 'blocked' | 'unsupported'

export interface ProductApiCapability {
  state: ProductApiCapabilityState
  reason_code?:
    | 'NOT_IMPLEMENTED'
    | 'CONTROLLER_NOT_READY'
    | 'OWNERSHIP_REQUIRES_REVIEW'
    | 'RECONCILIATION_REQUIRED'
    | 'FEATURE_DISABLED'
}

/** Stable identity reported by the process and checked against the enrollment pin. */
export interface ProductControllerIdentity {
  controller_id: ProductControllerId
  api_version: typeof PRODUCT_CONTROLLER_API_VERSION
  api_bind_address: typeof PRODUCT_CONTROLLER_API_LOOPBACK
  service_state: 'ready' | 'degraded' | 'maintenance'
  sampled_at: ProductIsoUtc
}

/** API token never appears in this durable/client identity DTO. */
export interface ProductDesktopClientIdentity {
  client_id: ProductDesktopClientId
  controller_id: ProductControllerId
  display_name: string
  scopes: readonly ProductApiScope[]
  created_at: ProductIsoUtc
  revoked_at: ProductIsoUtc | null
  token_expires_at: ProductIsoUtc
}

/**
 * Enrollment data is exchanged only by the main process over an SSH session
 * whose endpoint and host key already match the user's trusted controller pin.
 * Token bytes are a one-time secret: implementations must never log, persist in
 * history, put them in argv/URL, or forward them to renderer IPC.
 */
export interface ProductDesktopEnrollmentRequest {
  request_key: ProductSshOperationKey
  display_name: string
  requested_scopes: readonly ['read', ...ProductDesktopGrantableScope[]]
}

/** R3c-3 trusted Linux CLI `enroll-desktop-client`/`revoke-desktop-client --data-dir ...`
 * nhận exact request DTO qua stdin; administrator identity lấy OS uid, không body/env actor.
 * Token opaque random32bytes prefix opspilot_, SHA256-only trong migration022, TTL30ngày.
 * Replay enrollment không trả lại token; reauth/current admin/controller trước tombstone lookup.
 * Chưa rotation/HTTP/tunnel trong checkpoint credential substrate; không quảng cáo capability đó.
 */

export interface ProductDesktopEnrollmentResponse {
  state: 'issued_once'
  controller_id: ProductControllerId
  client: ProductDesktopClientIdentity
  credential: {
    access_token: string
    token_type: 'Bearer'
    expires_at: ProductIsoUtc
  }
}

export interface ProductDesktopEnrollmentReplay {
  state: 'credential_delivery_unknown'
  controller_id: ProductControllerId
  client_id: ProductDesktopClientId
}

export interface ProductDesktopCredentialRotationResponse {
  state: 'issued_once'
  controller_id: ProductControllerId
  client_id: ProductDesktopClientId
  rotation_id: string
  credential: {
    access_token: string
    token_type: 'Bearer'
    expires_at: ProductIsoUtc
  }
  previous_token_grace_expires_at: ProductIsoUtc
}

export interface ProductDesktopCredentialRotationReplay {
  state: 'credential_delivery_unknown'
  controller_id: ProductControllerId
  client_id: ProductDesktopClientId
  rotation_id: string
}

export interface ProductDesktopCredentialRotationConfirmRequest {
  request_key: ProductSshOperationKey
  rotation_id: string
}

export interface ProductDesktopCredentialRotationRequest {
  request_key: ProductSshOperationKey
  client_id: ProductDesktopClientId
}

/** Enrollment/revocation is an SSH-admin protocol, never an unauthenticated API route. */
export interface ProductControllerSshBootstrapContract {
  'read-controller-identity': {
    transport: 'strict-pinned-ssh'
    request: Record<string, never>
    response: ProductControllerIdentity
  }
  'enroll-desktop-client': {
    transport: 'strict-pinned-ssh-framed-stdio'
    request: ProductDesktopEnrollmentRequest
    response: ProductDesktopEnrollmentResponse | ProductDesktopEnrollmentReplay
  }
  'revoke-desktop-client': {
    transport: 'strict-pinned-ssh-framed-stdio'
    request: { request_key: ProductSshOperationKey; client_id: ProductDesktopClientId }
    response: { client_id: ProductDesktopClientId; revoked_at: ProductIsoUtc }
  }
  'rotate-desktop-client-credential': {
    transport: 'strict-pinned-ssh-framed-stdio'
    request: ProductDesktopCredentialRotationRequest
    response: ProductDesktopCredentialRotationResponse | ProductDesktopCredentialRotationReplay
  }
  'confirm-desktop-client-credential-rotation': {
    transport: 'strict-pinned-ssh-framed-stdio'
    request: ProductDesktopCredentialRotationConfirmRequest
    response: ProductDesktopClientIdentity
  }
  'cancel-desktop-client-credential-rotation': {
    transport: 'strict-pinned-ssh-framed-stdio'
    request: { request_key: ProductSshOperationKey; rotation_id: string }
    response: { rotation_id: string; state: 'cancelled'; old_credential_valid: true }
  }
}

export type ProductApiErrorCode =
  | 'AUTH_REQUIRED'
  | 'CREDENTIAL_EXPIRED'
  | 'CREDENTIAL_REVOKED'
  | 'CONTROLLER_MISMATCH'
  | 'CLIENT_REVOKED'
  | 'SCOPE_REQUIRED'
  | 'APP_NOT_FOUND'
  | 'OWNERSHIP_STALE'
  | 'SOURCE_GENERATION_STALE'
  | 'IDEMPOTENCY_CONFLICT'
  | 'NO_DESIRED_TARGET'
  | 'TARGET_SHA_UNAVAILABLE'
  | 'REQUEST_INVALID'
  | 'NOT_FOUND'
  | 'UNSUPPORTED'
  | 'CAPABILITY_BLOCKED'
  | 'RECONCILIATION_REQUIRED'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'

/** Safe error shape; never contains stdout/stderr, credentials or raw exceptions. */
export interface ProductControllerApiError {
  error: {
    code: ProductApiErrorCode
    message: string
    retryable: boolean
    request_id: ProductApiRequestId
    retry_after_seconds?: number
    current_ownership_generation?: number
    current_source_generation?: number
  }
}

/** Main-process transport result; a timeout after send is deliberately ambiguous.
 * R3c-6b: only fixed declared read/manual/policy operations through pinned SSH;
 * no caller URL/headers/arbitrary forwarding, no automatic retry or Desktop fallback.
 * Fresh controller/principal/credential binding is checked before send and return;
 * response DTOs/media/UTF8/header/body/page sizes are validated. Read errors expose
 * stable local/API codes only, never raw HTTP/SSH message or credential.
 * A write with a lost/malformed/5xx response after send returns outcome_unknown.
 * Query the existing key; do not create a new request key to guess acceptance.
 * Credentials are injected by trusted main for this slice, not persisted in settings.
 */
export type ProductControllerCallResult<T> =
  | { state: 'response_received'; response: T }
  | {
      state: 'outcome_unknown'
      idempotency_key: ProductApiIdempotencyKey
      may_have_been_accepted: true
      next_step: 'query_same_request_key'
    }

export interface ProductControllerApiMeta {
  controller_id: ProductControllerId
  request_id: ProductApiRequestId
  sampled_at: ProductIsoUtc
  data_freshness: 'current' | 'stale' | 'unknown'
}

export interface ProductControllerCapabilities {
  api_version: typeof PRODUCT_CONTROLLER_API_VERSION
  read: ProductApiCapability
  manual_redeploy: ProductApiCapability
  pause_auto_deploy: ProductApiCapability
  resume_auto_deploy: ProductApiCapability
}

export interface ProductControllerStatus {
  controller_id: ProductControllerId
  service_state: 'ready' | 'degraded' | 'maintenance'
  last_branch_poll_at: ProductIsoUtc | null
  next_branch_poll_at: ProductIsoUtc | null
  queued_job_count: number
  active_job_count: number
  uncertain_job_count: number
  storage_state: 'ok' | 'low' | 'unknown'
  reason_code: string | null
  sampled_at: ProductIsoUtc
}

/** Current Product ownership is server-derived, never accepted from a request body. */
export interface ProductControllerAppSummary {
  app_id: ProductAppId
  app_name: string
  controller_id: ProductControllerId
  ownership_generation: number
  source_generation: number
  source_config_sha256: string
  production_ref: string
  auto_deploy_paused: boolean
  pause_reason: 'manual_action' | 'operator' | null
  pause_policy_provenance: 'legacy_clean' | 'legacy_inferred' | 'operator_required' | 'explicit'
  desired_sha: ProductFullCommitSha | null
  reconciliation_state: ProductReconciliationState | null
  observed_at: ProductIsoUtc | null
  sampled_at: ProductIsoUtc
}

export interface ProductControllerAppDetail extends ProductControllerAppSummary {
  current_deployment_id: ProductDeploymentId | null
  current_deployment_sha: ProductFullCommitSha | null
  current_deployment_state: 'building' | 'deploying' | 'running' | 'failed' | 'rolled_back' | 'stopped' | null
  latest_job_id: ProductJobId | null
  latest_job_state: ProductJobState | null
  http_url: string | null
}

export interface ProductControllerJobSummary {
  job_id: ProductJobId
  app_id: ProductAppId
  ownership_generation: number
  source_generation: number
  /** Persisted manual rollback may not yet resolve a source SHA; never fabricate one. */
  target_sha: ProductFullCommitSha | null
  state: ProductJobState
  trigger: 'branch_poll' | 'manual_redeploy' | 'manual_rollback'
  attempt_count: number
  created_at: ProductIsoUtc
  updated_at: ProductIsoUtc
  finished_at: ProductIsoUtc | null
  reason_code: string | null
}

export interface ProductControllerDeploymentSummary {
  deployment_id: ProductDeploymentId
  app_id: ProductAppId
  version: number
  commit_sha: ProductFullCommitSha | null
  status: 'building' | 'deploying' | 'running' | 'failed' | 'rolled_back' | 'stopped'
  started_at: ProductIsoUtc
  finished_at: ProductIsoUtc | null
  job_id: ProductJobId | null
  attempt_id: ProductAttemptId | null
}

export interface ProductControllerHistoryPage {
  items: readonly ProductControllerHistoryItem[]
  next_cursor: ProductControllerCursorToken | null
  has_more: boolean
}

export interface ProductControllerHistoryItem {
  event_id: number
  app_id: ProductAppId
  job_id: ProductJobId | null
  attempt_id: ProductAttemptId | null
  deployment_id: ProductDeploymentId | null
  kind: string
  state: ProductJobState | null
  created_at: ProductIsoUtc
  reason_code: string | null
}

/**
 * Payload encoded inside the opaque base64url page cursor; it is not an auth
 * token or authorization grant. App collection uses keyset continuation by
 * ascending app_id; app-scoped collections retain their app-bound position.
 */
export type ProductControllerCursorPayload =
  | {
      controller_id: ProductControllerId
      collection: 'apps'
      after_app_id: ProductAppId
      upper_bound_app_id: ProductAppId
    }
  | (ProductHistoryCursor & {
      app_id: ProductAppId
      collection: 'jobs' | 'deployments' | 'history' | 'logs'
      offset: number
    })

/** R3c-4 cursor là opaque base64url AES-GCM envelope, purpose-bound với controller.
 * App pages: keyset app_id ASC + first-page upper bound; app collections: stable
 * rowid/event_id upper bound + offset. Mỗi page reauthenticate/current ownership,
 * không nhận cursor như authorization. Request/response theo constants size limits.
 * HTTP writes/logs/request lookup còn 501 UNSUPPORTED; capabilities trả unsupported.
 */

export interface ProductControllerPage<T> {
  items: readonly T[]
  next_cursor: ProductControllerCursorToken | null
  has_more: boolean
}

export interface ProductControllerLogPage {
  job_id: ProductJobId
  lines: readonly string[]
  next_offset: number | null
  has_more: boolean
  truncated: boolean
  sampled_at: ProductIsoUtc
}

/** Request key is a non-secret lookup handle, scoped to the authenticated client. */
export interface ProductControllerRequestStatus {
  request_key: ProductApiIdempotencyKey
  action: 'manual_redeploy' | 'pause_auto_deploy' | 'resume_auto_deploy'
  app_id: ProductAppId
  ownership_generation: number
  source_generation: number
  state: 'accepted' | 'completed' | 'blocked' | 'uncertain'
  job_id: ProductJobId | null
  reason_code: string | null
  updated_at: ProductIsoUtc
}

export type ProductControllerRequestLookup =
  | { found: true; status: ProductControllerRequestStatus }
  | { found: false }

export interface ProductControllerPageQuery {
  /** Defaults to 50; values above PRODUCT_CONTROLLER_API_MAX_PAGE_SIZE are rejected. */
  limit?: number
  cursor?: ProductControllerCursorToken
}

/** Every write carries the generation the user saw; server re-reads current ownership. */
export interface ProductControllerWritePrecondition {
  expected_ownership_generation: number
  expected_source_generation: number
}

export interface ProductControllerWriteHeaders {
  'Idempotency-Key': ProductApiIdempotencyKey
}

export interface ProductManualRedeployRequest extends ProductControllerWritePrecondition {
  target: { kind: 'current_desired' } | { kind: 'specific_sha'; sha: ProductFullCommitSha }
}

export interface ProductManualRedeployAccepted {
  job_id: ProductJobId
  app_id: ProductAppId
  target_sha: ProductFullCommitSha
  state: 'queued' | 'already_requested'
  auto_deploy_paused: true
  retry_with_same_idempotency_key: true
}

export interface ProductAutoDeployPolicyRequest extends ProductControllerWritePrecondition {
  /** Resume is itself an explicit, audited operator action; this is not proof supplied by a client. */
  action: 'pause' | 'resume'
  /** Optional operator note, 200 UTF-8 bytes maximum after validation. */
  reason?: string
}

export interface ProductAutoDeployPolicyResult {
  app_id: ProductAppId
  result: 'updated' | 'already_in_state'
  auto_deploy_paused: boolean
  pause_policy_provenance: 'explicit'
  reconciliation_state: ProductReconciliationState
  updated_at: ProductIsoUtc
}

/**
 * Route inventory. API binds only to loopback; all `/v1` routes require Bearer
 * auth and controller/app authorization. Enrollment and revocation use verified
 * SSH administration, not an unauthenticated HTTP endpoint.
 */
export interface ProductControllerApiRoutes {
  /** R3c: polling-only/startup/shutdown => maintenance; execution blocked => degraded.
   * ready means execution capability, not application/domain health. No public runtime details. */
  'GET /healthz': { response: Pick<ProductControllerIdentity, 'api_version' | 'service_state'> }
  'GET /v1/controllers/{controller_id}/identity': { response: ProductControllerApiMeta & ProductControllerIdentity }
  'GET /v1/controllers/{controller_id}/status': { response: ProductControllerApiMeta & ProductControllerStatus }
  'GET /v1/controllers/{controller_id}/requests/{request_key}': { response: ProductControllerApiMeta & ProductControllerRequestLookup }
  'GET /v1/controllers/{controller_id}/capabilities': { response: ProductControllerApiMeta & ProductControllerCapabilities }
  'GET /v1/controllers/{controller_id}/apps': { query: ProductControllerPageQuery; response: ProductControllerApiMeta & ProductControllerPage<ProductControllerAppSummary> }
  'GET /v1/controllers/{controller_id}/apps/{app_id}': { response: ProductControllerApiMeta & ProductControllerAppDetail }
  'GET /v1/controllers/{controller_id}/apps/{app_id}/jobs': { query: ProductControllerPageQuery; response: ProductControllerApiMeta & ProductControllerPage<ProductControllerJobSummary> }
  'GET /v1/controllers/{controller_id}/apps/{app_id}/deployments': { query: ProductControllerPageQuery; response: ProductControllerApiMeta & ProductControllerPage<ProductControllerDeploymentSummary> }
  'GET /v1/controllers/{controller_id}/apps/{app_id}/history': { query: ProductControllerPageQuery; response: ProductControllerApiMeta & ProductControllerHistoryPage }
  'GET /v1/controllers/{controller_id}/apps/{app_id}/jobs/{job_id}/logs': { query: { offset?: number; limit_bytes?: number }; response: ProductControllerApiMeta & ProductControllerLogPage }
  'POST /v1/controllers/{controller_id}/apps/{app_id}/redeploy': { headers: ProductControllerWriteHeaders; body: ProductManualRedeployRequest; response: ProductControllerApiMeta & ProductManualRedeployAccepted }
  'POST /v1/controllers/{controller_id}/apps/{app_id}/auto-deploy-policy': { headers: ProductControllerWriteHeaders; body: ProductAutoDeployPolicyRequest; response: ProductControllerApiMeta & ProductAutoDeployPolicyResult }
}

/** Per-route auth and success status are part of the contract, not caller hints. */
export interface ProductControllerApiRouteSecurity {
  'GET /healthz': { authentication: 'none'; scope: null; success_status: 200 }
  'GET /v1/controllers/{controller_id}/identity': { authentication: 'bearer'; scope: 'read'; success_status: 200 }
  'GET /v1/controllers/{controller_id}/status': { authentication: 'bearer'; scope: 'read'; success_status: 200 }
  'GET /v1/controllers/{controller_id}/requests/{request_key}': { authentication: 'bearer'; scope: 'read'; success_status: 200 }
  'GET /v1/controllers/{controller_id}/capabilities': { authentication: 'bearer'; scope: 'read'; success_status: 200 }
  'GET /v1/controllers/{controller_id}/apps': { authentication: 'bearer'; scope: 'read'; success_status: 200 }
  'GET /v1/controllers/{controller_id}/apps/{app_id}': { authentication: 'bearer'; scope: 'read'; success_status: 200 }
  'GET /v1/controllers/{controller_id}/apps/{app_id}/jobs': { authentication: 'bearer'; scope: 'read'; success_status: 200 }
  'GET /v1/controllers/{controller_id}/apps/{app_id}/deployments': { authentication: 'bearer'; scope: 'read'; success_status: 200 }
  'GET /v1/controllers/{controller_id}/apps/{app_id}/history': { authentication: 'bearer'; scope: 'read'; success_status: 200 }
  'GET /v1/controllers/{controller_id}/apps/{app_id}/jobs/{job_id}/logs': { authentication: 'bearer'; scope: 'read'; success_status: 200 }
  'POST /v1/controllers/{controller_id}/apps/{app_id}/redeploy': { authentication: 'bearer'; scope: 'deploy:manual'; success_status: 202 }
  'POST /v1/controllers/{controller_id}/apps/{app_id}/auto-deploy-policy': { authentication: 'bearer'; scope: 'policy:write'; success_status: 200 }
}

type ProductControllerAssert<T extends true> = T
type ProductControllerRoutesHaveSecurity = ProductControllerAssert<
  Exclude<keyof ProductControllerApiRoutes, keyof ProductControllerApiRouteSecurity> extends never
    ? Exclude<keyof ProductControllerApiRouteSecurity, keyof ProductControllerApiRoutes> extends never
      ? true
      : false
    : false
>
export type ProductControllerApiRouteSecurityParity = ProductControllerRoutesHaveSecurity

/**
 * Idempotency-Key is a UUID created by the main process. Its unique lookup
 * namespace is (controller_id, authenticated_client_id, request_key). Resource/
 * app, action and RFC 8785 canonical-body SHA-256 are immutable values on that
 * record, not namespace components. Keep a compact mapping/tombstone for the
 * controller lifetime. Same key and content returns the stored outcome; a
 * changed app/action/body conflicts with 409 IDEMPOTENCY_CONFLICT. Every retry
 * reauthenticates and checks current authorization before lookup or disclosure.
 */
export interface ProductControllerIdempotencyContract {
  header: 'Idempotency-Key'
  format: 'UUID'
  unique_namespace: readonly ['controller_id', 'authenticated_client_id', 'request_key']
  immutable_request_fields: readonly ['resource_or_app', 'action', 'canonical_body_sha256']
  duplicate_status: 'original_result'
  changed_request_status: 'IDEMPOTENCY_CONFLICT'
  timeout_status: 'outcome_unknown_query_existing_request'
}

/** R3c-5a command persistence uses migration023, auth/scopes/current generations
 * inside the same IMMEDIATE transaction as pause/queue/policy/request tombstone.
 * Lookup rechecks current Product owner and authenticated client namespace,
 * while returning the original request generations as historical metadata.
 * Specific SHA needs server-recorded repository/root provenance. Pause can be
 * requested while degraded; resume cannot clear unknown/pending settlement or
 * overtake pending manual work. Operator note plaintext is not persisted.
 * HTTP write capability stays unsupported until the separate body/drain gate.
 */

/** SSH-admin operation keys use the authenticated SSH principal, never body actor data. */
export interface ProductControllerSshIdempotencyContract {
  unique_namespace: readonly ['controller_id', 'authenticated_administrator_identity', 'request_key']
  immutable_request_fields: readonly ['resource_or_client', 'operation', 'canonical_body_sha256']
  duplicate_status: 'original_result'
  changed_request_status: 'IDEMPOTENCY_CONFLICT'
  retry_authorization: 'reauthenticate_and_reauthorize_current_admin'
}

/** App listing is keyset-paged by app_id ASC; each page rechecks current ownership. */
export interface ProductControllerAppsPageContract {
  route: 'GET /v1/controllers/{controller_id}/apps'
  query: ProductControllerPageQuery
  response: ProductControllerPage<ProductControllerAppSummary>
  default_limit: typeof PRODUCT_CONTROLLER_API_DEFAULT_PAGE_SIZE
  max_limit: typeof PRODUCT_CONTROLLER_API_MAX_PAGE_SIZE
  order: 'app_id_ascending'
  continuation: 'keyset_after_app_id_bounded_by_first_page_max_app_id'
  cursor_scope: readonly ['controller_id', 'apps_collection']
  authorization: 'current_product_ownership_filtered_on_every_page'
}
