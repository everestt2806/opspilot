/** Metadata-only IPC, main creates setup UUID and remote request key. */
export interface DesktopProjectSetupInput {
  binding_id: string
  target_vps_id: number
  app_name: string
  framework: 'express' | 'static-spa'
  repository_url: string
  production_ref: string
  repository_root: string
  host_port: number | null
  container_port: number
  healthcheck_path: string
}
export interface DesktopProjectSetup {
  framework: 'express' | 'static-spa'
  request_key: string
  binding_id: string
  binding_revision: number
  controller_id: string
  target_vps_id: number
  target_security_revision: number
  app_name: string
  repository_url: string
  production_ref: string
  repository_root: string
  host_port: number | null
  container_port: number
  healthcheck_path: string
  state: 'prepared' | 'in_flight' | 'outcome_unknown' | 'registered' | 'cancelled'
  app_id: number | null
  created_at: string
  updated_at: string
}
export interface DesktopProjectTargets {
  binding_id: string
  binding_revision: number
  controller_id: string
  items: Array<{
    id: number
    name: string
    host: string
    port: number
    username: string
    host_fingerprint: string
    ssh_security_revision: number
  }>
  next_after_id: number | null
  has_more: boolean
}
export interface DesktopProjectTargetInput {
  request_key: string
  target_root: string
}
/** Current controller metadata; enrolled chỉ stored proof, không runtime readiness. */
export interface DesktopProjectTargetState {
  binding_id: string
  binding_revision: number
  request_key: string
  controller_id: string
  app_id: number
  ownership_generation: number
  source_generation: number
  source_config_sha256: string
  target_vps_id: number
  target_security_revision: number
  target_host: string
  target_port: number
  target_username: string
  target_fingerprint: string
  target_root: string
  state: 'not_prepared' | 'prepared' | 'unknown' | 'enrolled' | 'conflict'
  proof: 'not_available' | 'persisted_verified'
  deployment_started: false
  runtime_preflight: 'required'
  checked_at: string
}
/** IPC controller:verify-project-source nhận request_key của registered setup.
 * Main derive app/generations/config/target từ journal, artifact/pin từ binding.
 * Chỉ explicit thao tác trên write-consent binding; không nhận remote command,
 * URL/ref/SHA/path/env/credential từ renderer. Result là snapshot, không ready flag.
 * Refresh/đổi binding/unmount loại kết quả UI cũ; lỗi/lostreply được kiểm tra lại
 * bằng cùng setup key, không tạo app/job/deployment hoặc tự bật auto-deploy.
 */
export interface DesktopProjectSourceVerification {
  binding_id: string
  binding_revision: number
  request_key: string
  controller_id: string
  app_id: number
  ownership_generation: number
  source_generation: number
  source_config_sha256: string
  target_vps_id: number
  target_security_revision: number
  repository_url: string
  production_ref: string
  repository_root: string
  commit_sha: string
  observation_sequence: number
  framework: 'express' | 'static-spa'
  configured_container_port: number
  detected_container_port: number
  source_file_count: number
  source_bytes: number
  auto_deploy_paused: true
  deployment_started: false
  runtime_preflight: 'required'
  verified_at: string
  state: 'source_verified'
}
/** Retry setup through same SSH-admin principal/key can repeat register-project:
 * controller transaction is idempotent; never create new UUID after ambiguous
 * reply. Binding/target revision checks before+after await; no implicit rebind.
 * Registered means app/source paused, not target enrollment or deployment.
 */
