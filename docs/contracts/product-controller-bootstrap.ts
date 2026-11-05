/** CLI quản trị Linux cục bộ; không public endpoint hoặc import credential Desktop. */
export const PRODUCT_CONTROLLER_ENROLLMENT_MAX_INPUT_BYTES = 512 * 1024;
export const PRODUCT_CONTROLLER_ENROLLMENT_MAX_SECRET_BYTES = 256 * 1024;
export const PRODUCT_CONTROLLER_ENROLLMENT_INPUT_TIMEOUT_MS = 30_000;

/** `enroll-vps --data-dir <private initialized directory>` đọc một JSON object tới stdin EOF. */
export interface ProductControllerVpsEnrollmentInput {
  format: 1;
  /** Phải khớp controller đã khởi tạo độc lập, tránh dùng nhầm data directory. */
  controller_id: string;
  profile: {
    name: string;
    host: string;
    port: number;
    username: string;
    auth_type: "key" | "password";
    /** Lấy độc lập từ console nhà cung cấp; không tự học từ kết nối. */
    host_fingerprint: string;
  };
  /** Chỉ memory/stdin; không argv, env, output, log hoặc cột DB plaintext. */
  secret: string;
}

export interface ProductControllerVpsEnrollmentResult {
  state: "enrolled" | "already_enrolled";
  controller_id: string;
  vps_id: number;
  host_fingerprint: string;
}

/**
 * `secrets-init --data-dir <dir>` chỉ tạo protected master key tường minh cho controller đã
 * khởi tạo và chưa có VPS/app ownership/runtime key material. Không overwrite material cũ
 * hoặc hỏng. Enroll/read/run không tự khởi tạo key.
 *
 * Enroll xác thực một SSH session mới có pin, không chạy remote command, rồi lưu credential
 * AES-GCM đã bind trong một IMMEDIATE SQLite transaction. Xung đột tên/endpoint (kể cả archived)
 * bị từ chối; không tự update/restore/rotate. Replay đúng profile + credential đã giải mã trả
 * cùng VPS ID mà không sửa DB, vẫn xác minh lại SSH. Hai enroll giống nhau đồng thời hội tụ;
 * khác nhau thì conflict. Không tạo app ownership/source/history. Runtime mặc định polling-only.
 */
