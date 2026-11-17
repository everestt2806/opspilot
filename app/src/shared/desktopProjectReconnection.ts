import type { ProductProjectReconnectionContext } from './productProjectReconnection'

/** E3 IPC: caller supplies identifiers and explicit consent;
 * never controller identity, source/target fields, credential or journal rows.
 */
export interface DesktopProjectReconnectionReviewInput {
  binding_id: string
  app_id: number
}
export interface DesktopProjectReconnectionReview {
  plan_id: string
  expires_at: string
  binding_id: string
  binding_revision: number
  context: ProductProjectReconnectionContext
  /** Consent cũ khớp snapshot hiện tại; phải current/recheck trước khi dùng. */
  matching_confirmation_key?: string | null
}
export interface DesktopProjectReconnectionConfirmInput {
  plan_id: string
  consent: true
}
/** Authenticated local consent history, not a registration/selection receipt or
 * runtime/deploy capability. Every later use must recheck remote current context.
 */
export interface DesktopProjectReconnection {
  request_key: string
  provenance: 'explicit_reconnection_v1'
  binding_id: string
  binding_revision: number
  controller_id: string
  app_id: number
  snapshot_sha256: string
  context: ProductProjectReconnectionContext
  confirmed_at: string
  execution: 'fresh_review_required'
}
