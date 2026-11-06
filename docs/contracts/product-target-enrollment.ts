import type { ProductDispatchTargetBinding } from "./product-auto-deploy";

/** Bootstrap quản trị nội bộ, tách khỏi guarded execution/deployment và public API. */
export const PRODUCT_TARGET_ENROLLMENT_DOMAIN = "opspilot-target-enrollment-v1";
export const PRODUCT_TARGET_ENROLLMENT_MAX_INPUT_BYTES = 2 * 1024 * 1024;
export const PRODUCT_TARGET_ENROLLMENT_MAX_OUTPUT_BYTES = 16 * 1024;
export type ProductTargetEnrollmentPayload = Readonly<{
  format: 1;
  purpose: "product-target-enrollment";
  controller_id: string;
  app_id: number;
  ownership_generation: number;
  target: ProductDispatchTargetBinding;
  manifest_sha256: string;
  target_root: string;
  state_root: string;
  helper_path: string;
}>;
export type ProductTargetEnrollmentProof = Readonly<{
  payload: ProductTargetEnrollmentPayload;
  signature: string;
}>;

/** CLI enroll-target --data-dir <dir>, JSON qua bounded stdin; không nhận raw script/key. */
export type ProductTargetEnrollmentInput = Readonly<{
  format: 1;
  controller_id: string;
  app_id: number;
  ownership_generation: number;
  artifact: string;
  manifest_sha256: string;
  /** Trusted admin config; private absolute directory, không lấy từ source repo/app. */
  target_root: string;
}>;

/**
 * Chỉ app Product-owned đúng controller/generation, auto-deploy paused và không công việc active.
 * Không tự promote Desktop ownership hoặc enable auto-deploy; source/ownership setup là bước riêng.
 * SQLite giữ prepared/unknown/enrolled, binding/manifest/receipt; encrypted key store chỉ là material.
 * Explicit prepare mới có thể create-once/load-existing key; pending/read không tạo hoặc rotate key.
 * Commit unknown trước SSH bootstrap; script tin cậy đã pin truyền qua argv, mọi secret chỉ stdin.
 * Target dùng private directories/files và atomic rename-noreplace cho toàn bộ enrollment mới.
 * Không gọi hoặc sửa nhãn lab-only của fixture initializers. Existing foreign/partial state từ chối.
 * Pending/known replay chỉ inspect: exact installed key/marker/helpers/manifest/receipt, không mutation.
 * Missing/unknown sau dispatch không tự clear/reinstall; chỉ positive exact proof mới mark enrolled.
 * Proof HMAC domain riêng, không cấp quyền dispatch/rollback/deployment hoặc thay SQLite authority.
 */
