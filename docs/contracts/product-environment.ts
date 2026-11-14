import type { ProductDispatchTargetBinding } from './product-auto-deploy'

/** Main/controller-only; không IPC/HTTP/renderer readback hoặc command tùy ý.
 * R7h-1 chỉ kho revision staged. Append không chọn active revision, không thay
 * source generation/ownership/policy, không tạo job hoặc ghi target.
 * Product exception: encrypted controller SQLite, key riêng đã init explicit;
 * Desktop .env một chiều/không lưu plaintext SQLite vẫn giữ nguyên.
 */
export interface ProductEnvironmentScope {
  controller_id: string
  app_id: number
  ownership_generation: number
  target: ProductDispatchTargetBinding
}
export interface ProductEnvironmentValues {
  /** Runtime secret: chỉ decrypt trong Main/controller khi execution cần. */
  runtime_env: Record<string, string>
  /** Explicit public: Next NEXT_PUBLIC_* hoặc SPA VITE_*, Express không có build args.
   * Có thể xuất hiện trong client bundle; không tự chuyển runtime secret sang đây.
   */
  public_build_args: Record<string, string>
}
export interface ProductEnvironmentWriteInput {
  scope: ProductEnvironmentScope
  /** CAS theo app+ownership generation; null chỉ khi namespace chưa có revision. */
  expected_latest_revision: number | null
  expected_source_generation: number
  expected_source_config_sha256: string
  values: ProductEnvironmentValues
}
export interface ProductEnvironmentMetadata {
  controller_id: string
  app_id: number
  ownership_generation: number
  revision: number
  basis_source_generation: number
  basis_source_config_sha256: string
  framework: 'express' | 'static-spa' | 'nextjs'
  runtime_keys: string[]
  public_build_keys: string[]
  created_at: string
  activation: 'staged'
}

/** CLI cùng UID đã được xác thực; administrator lấy từ OS, không nhận qua stdin.
 * request_key giữ nguyên khi retry mất reply. Body có secret chỉ được lưu mã hóa,
 * không plaintext digest. Lưu revision và receipt nguyên tử, không active deploy.
 */
export interface ProductEnvironmentStageInput extends ProductEnvironmentWriteInput {
  format: 1
  request_key: string
}
export interface ProductEnvironmentStateInput {
  format: 1
  scope: ProductEnvironmentScope
  expected_source_generation: number
  expected_source_config_sha256: string
  /** null chỉ đọc latest; UUID tra receipt của chính administrator hiện hành. */
  request_key: string | null
}
export interface ProductEnvironmentStageResult {
  state: 'staged' | 'already_staged'
  request_key: string
  metadata: ProductEnvironmentMetadata
}
export interface ProductEnvironmentState {
  scope: ProductEnvironmentScope
  source_generation: number
  source_config_sha256: string
  latest: ProductEnvironmentMetadata | null
  request_key: string | null
  requested: ProductEnvironmentMetadata | null
}
/** Read-only context derived from registered app; no caller target/credential. */
export interface ProductEnvironmentContextInput {
  format: 1
  controller_id: string
  app_id: number
  expected_ownership_generation: number
  expected_source_generation: number
  expected_source_config_sha256: string
  expected_target_security_revision: number
}
/** Desired-source selection only, chưa runtime activate. CLI administrator từ OS.
 * Giữ pause, current deployment và mọi job/lease/terminal nguyên vẹn.
 * Chỉ khi app quiescent: không queued/active/unknown job, unreleased lease hoặc
 * runtime terminal chưa settled. Hai CAS: current source và latest vault revision.
 * Selection có thể chọn retained revision cũ trong cùng owner/target/framework.
 * New source JSON chỉ giữ environment identity, tuyệt đối không value/digest secret.
 */
export interface ProductEnvironmentSelectionInput {
  format: 1
  request_key: string
  scope: ProductEnvironmentScope
  expected_source_generation: number
  expected_source_config_sha256: string
  expected_latest_revision: number
  environment_revision: number
}
export interface ProductEnvironmentReference {
  controller_id: string
  ownership_generation: number
  revision: number
}
export interface ProductEnvironmentSelectionResult {
  state: 'selected' | 'already_selected'
  request_key: string
  controller_id: string
  app_id: number
  ownership_generation: number
  source_generation: number
  source_config_sha256: string
  environment: ProductEnvironmentReference
  auto_deploy_paused: true
  deployment_started: false
  execution: 'requires_environment_runtime'
}

/** Whole snapshot, không merge PATCH/implicit inherited env. Tối đa128keys tổng,
 * key uppercase1..128bytes, value<=8192UTF8bytes, values JSON<=64KiB; empty value
 * hợp lệ, không NUL/CR/LF/control chars. NODE_ENV/PORT, NODE_OPTIONS, PATH/HOME,
 * LD_, NPM_CONFIG_, OPSPILOT_, DOCKER_, COMPOSE_, POSTGRES_ prefixes
 * và DATABASE_URL thuộc system/managed DB lifecycle, chưa nhận user override.
 * Public prefixes bị từ chối trong runtime map; public build map chỉ đúng
 * framework prefix, không được hiểu là nơi giữ secret. Không dotenv parsing hoặc
 * shell interpolation ở kho; serialization target phải được gate riêng.
 *
 * append: BEGIN IMMEDIATE, current active Product controller/owner, pinned target
 * identity/revision/unarchived + expected current source identity; CAS revision,
 * AES-GCM purpose+scope+revision+basis+framework+keys authenticated inside envelope,
 * insert immutable row atomically. Cipher/key unavailable không init/rotate ngầm.
 *
 * metadata/readValues đều recheck current controller/owner/target và authenticated
 * envelope/row binding; historical revision không yêu cầu basis source vẫn active
 * (rollback cần revision cũ), nhưng caller execution phải có claim-bound source
 * config reference đúng revision trước/sau decrypt. Kho tự nó không cấp quyền
 * deploy. Metadata chỉ keys/revision/basis/framework/time/staged, không value,
 * plaintext digest, cipher, iv/tag hoặc secret trong errors/logs/history.
 *
 * Revisions retained: không update/delete/cascade hoặc thay khóa để mất cấu hình
 * rollback. Đổi ownership/target không tự giải mã lại/rebind/import revision cũ.
 * Source activation/CLI/UI/executor/managed PostgreSQL là gate R7h-2..4 riêng.
 */
