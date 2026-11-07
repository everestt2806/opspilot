/** Linux SSH-admin CLI verify-project-source --data-dir <private controller dir>.
 * JSON bounded stdin; source chỉ lấy từ current SQLite, không URL/ref/SHA/script/
 * env/credential do caller cung cấp. Không mở public endpoint.
 */
export interface ProductProjectSourceVerificationInput {
  format: 1
  controller_id: string
  app_id: number
  expected_ownership_generation: number
  expected_source_generation: number
  expected_source_config_sha256: string
  expected_target_security_revision: number
  /** Trusted admin bundle path/pin; Desktop phải lấy từ binding, không từ source. */
  artifact: string
  manifest_sha256: string
}

export interface ProductProjectSourceVerificationResult {
  state: 'source_verified'
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
  framework: 'express'
  configured_container_port: number
  detected_container_port: number
  source_file_count: number
  source_bytes: number
  auto_deploy_paused: true
  deployment_started: false
  runtime_preflight: 'required'
  verified_at: string
}

/**
 * Chỉ current Product ownership/active controller/unarchived pinned target, paused,
 * không queued/active/uncertain work hoặc lease chưa release. Canonical config hash
 * khớp deploy config thực tế; target pin/principal/revision không đổi sau await.
 * Isolated public GitHub HTTPS/full SHA, không npm install/build/execute source hay
 * SSH target. Dùng chung detector/render/quota của executor: Express/noDB/no required
 * env. Chỉ whitelist metadata, không command/file content/raw Git stderr/secret.
 *
 * IMMEDIATE trước/sau await kiểm authority và expected observation sequence. Commit
 * observeTip + safe history nguyên tử, policy vẫn paused; không job/deployment/key/
 * target enrollment. Stale source/policy/target/poll -> từ chối, không tự retry.
 * Cùng SHA xác minh lại không tạo observation mới. Cleanup mọi snapshot đã nhận.
 * Không persistent ready flag: runtime phải fetch đúng SHA và kiểm lại source,
 * target/resources/health trước deployment; source_verified không phải deployed.
 */
