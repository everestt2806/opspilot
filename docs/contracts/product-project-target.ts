import type { ProductProjectSourceVerificationInput } from './product-project-source-verification'

/** Fixed Linux admin CLI project-target-state/enroll-project-target, bounded stdin.
 * Main derive generations/config/target revision từ registered setup. Artifact/pin
 * từ current Desktop binding. Không nhận script, key hoặc credential từ renderer.
 */
export type ProductProjectTargetInput = ProductProjectSourceVerificationInput
export type ProductProjectTargetEnrollmentInput = ProductProjectTargetInput & {
  /** Cấu hình admin explicit review, absolute private Linux base, không lấy từ repo. */
  target_root: string
}
export interface ProductProjectTargetState {
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
  /** enrolled chỉ persisted HMAC proof; runtime/remote health vẫn cần kiểm riêng. */
  proof: 'not_available' | 'persisted_verified'
  deployment_started: false
  runtime_preflight: 'required'
  checked_at: string
}
/**
 * project-target-state không SSH, tạo key, enroll hoặc mutate enrollment state.
 * enrolled chỉ khi current target/generation/manifest/root + stored HMAC proof khớp;
 * không chứng minh remote helper hiện online hoặc nguồn đã build/runtime healthy.
 * enroll-project-target reuses enrollProductTarget, current source/config/target
 * fences trong prepare/begin/complete transaction và trước gửi packet. Paused/no
 * pending work bắt buộc. Target identity phải khớp trước SSH authentication.
 * First prepare cài trusted helpers; unknown/enrolled replay chỉ inspect exact old
 * proof, không reinstall/rotate/clear barrier. Target root khác record -> conflict.
 * Default base /var/lib/opspilot-product là gợi ý admin; cần quyền tạo private base
 * và các parent đã tồn tại/an toàn. Không sudo/chmod/adopt path ngầm.
 * Source90s timeout không dùng ở đây: target fixed admin whole90s/helper75s, inner
 * SSH open20s + exchange20s; các lệnh admin khác giữ giới hạn đã chốt.
 */
