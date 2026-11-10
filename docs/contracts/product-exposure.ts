/** Post-settlement observation; never changes a signed H2 runtime receipt. */
export interface ProductExposureContext {
  app_id: number
  deployment_id: number
  authority_sha256: string
  previous_observation_id: string | null
  url: string
}
export type ProductExposureReason =
  | 'none' | 'timeout' | 'connection_error' | 'http_error' | 'redirect' | 'unsafe_target' | 'aborted'
export interface ProductExposureObservationInput {
  deployment_id: number
  authority_sha256: string
  previous_observation_id: string | null
  observer: 'desktop_external'
  started_at: string
  checked_at: string
  outcome: 'reachable' | 'unreachable' | 'not_run'
  http_status: number | null
  reason: ProductExposureReason
}
export interface ProductExposureObservation extends ProductExposureObservationInput {
  format: 1
  observation_id: string
  client_id: string
  body_sha256: string
  app_id: number
  url: string
  status: 'reachable' | 'degraded' | 'not_checked'
  received_at: string
}
export interface ProductExposureView {
  app_id: number
  deployment_id: number | null
  context: ProductExposureContext | null
  status: 'reachable' | 'degraded' | 'not_checked'
  freshness: 'current' | 'stale' | 'not_checked'
  unavailable_reason: 'no_running_deployment' | 'runtime_unsettled' | 'authority_changed' | 'execution_active' | 'invalid_target' | null
  observation: ProductExposureObservation | null
}
/**
 * GET /v1/controllers/:controller/apps/:app/exposure: read scope.
 * POST same route: policy:write scope, Idempotency-Key UUID and observation body.
 * Main derives URL from GET context; renderer never supplies URL/evidence/secret.
 * Server checks current owner/source/target SSH revision/deployment/settlement and
 * previous-observation CAS in IMMEDIATE tx after body read; authenticates client
 * again. Exact latest-ID/body replay is readonly. Superseded ID/body or changed
 * authority rejects. Freshness30s, display TTL60s, future-clock tolerance5s.
 * Failure never changes runtime status, leases, H2 terminal, source or firewall.
 * Existing exposure columns store latest bounded observation plus legacy display
 * fields. No duplicated Product history, new dependency, migration, or H2 change.
 * Old controller unsupported is a version gate; never a root SQL-writer fallback.
 * Latest-observation CAS is separate from command-request tombstones: an unknown
 * POST outcome is resolved by reading current exposure and matching observation
 * ID/body/authority, not GET /requests/:key. A superseding observation can leave
 * the older outcome unknown. Do not automatically resend or infer not accepted.
 * This is an authorized Desktop operator report, not third-party network
 * attestation. The server validates scope/identity/authority/chronology; physical
 * observer independence is enforced by the trusted Main probe, not proven by
 * a JSON string or by the SSH loopback source address alone.
 */
