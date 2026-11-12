/** Review Main-only60s: candidate SSH phải cùng host/port/fingerprint/username.
 * Renderer chỉ gửi IDs; không nhận pin/path/UID/credential hay authority JSON.
 * Confirm chỉ thay local SSH authority, không tự rebind API token. Vault tiếp tục
 * fail-closed đến fresh runtime-binding review/confirm riêng theo authority chain.
 * Receipt append-only031 giữ previous/next local authority và fresh root evidence;
 * UUID/parent/release/tool/attempted và canonical controller DB không thay đổi.
 */
export type ControllerAuthorityReviewInput = {
  installation_request_key: string
  vps_id: number
}
export type ControllerAuthorityReview = {
  plan_id: string
  expires_at: string
  installation_request_key: string
  upgrade_request_key: string
  controller_id: string
  previous_vps_id: number
  vps_id: number
  host: string
  username: string
  host_fingerprint: string
  from_revision: number
  to_revision: number
}
export type ControllerAuthorityConfirmInput = { plan_id: string; consent: true }
export type ControllerAuthorityResult = {
  request_key: string
  installation_request_key: string
  upgrade_request_key: string
  vps_id: number
  authority_revision: number
  binding_refresh_required: true
}
