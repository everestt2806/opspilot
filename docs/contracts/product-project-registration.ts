/** Linux SSH-admin CLI register-project --data-dir <initialized private dir>.
 * JSON bounded stdin, no arbitrary SQL/command, no credential/env/note fields.
 * Source public GitHub only; no SSH/userinfo/query/fragment URLs.
 */
export interface ProductProjectRegistrationInput {
  format: 1
  controller_id: string
  request_key: string
  target_vps_id: number
  app_name: string
  framework: 'express'
  repository_url: string
  production_ref: string
  repository_root: string
  /** null = cấp port DB từ30000–30999; target listener phải preflight riêng. */
  host_port: number | null
  container_port: number
  healthcheck_path: string
}
export interface ProductProjectRegistrationResult {
  state: 'registered' | 'already_registered'
  controller_id: string
  request_key: string
  app_id: number
  target_vps_id: number
  host_port: number
  ownership_generation: 1
  source_generation: 1
  source_config_sha256: string
  auto_deploy_paused: true
  target_enrollment: 'required'
  runtime_preflight: 'required'
  source_verification: 'required'
}
/** Các flag required và auto_deploy_paused phản ánh lúc đăng ký; đọc status riêng
 * để biết trạng thái hiện tại sau replay. Chưa fetch/detect repo ở thao tác này.
 */
/** One SQLite IMMEDIATE transaction: current active controller/target credential
 * binding checks, allocation, app + immutable source + paused Product owner +
 * history + request record. Namespace controller/authenticated unix admin/key.
 * Same key/body rechecks current authority and returns sameapp; changed body or
 * changed app/target/source/owner requires review, never overwrite or new app.
 * New key conflicting name/port rejected. No Git fetch/observation/job or remote
 * SSH write, no target enrollment, no implicit auto-enable. Existing app cannot
 * be imported through this operation. Names canonical lower-case DNSlabel style.
 */
