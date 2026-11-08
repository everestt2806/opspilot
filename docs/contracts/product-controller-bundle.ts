/** Gói phát hành offline, kiểm bằng digest được admin lấy từ build tin cậy. Không tự activate. */
export type ProductControllerBundleManifest = Readonly<{
  format: 1;
  node_major: 22;
  entrypoint: string;
  files: ReadonlyArray<
    Readonly<{ path: string; size: number; sha256: string }>
  >;
}>;

export const PRODUCT_CONTROLLER_BUNDLE_MANIFEST = "bundle-manifest.json";
export const PRODUCT_CONTROLLER_BUNDLE_MAX_MANIFEST_BYTES = 32 * 1024;
export const PRODUCT_CONTROLLER_BUNDLE_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const PRODUCT_CONTROLLER_BUNDLE_MAX_TOTAL_BYTES = 16 * 1024 * 1024;

/**
 * Internal optional expected-owner UID chỉ từ trusted root installer receipt/account;
 * mặc định vẫn root/current UID, không lấy owner UID từ renderer/request JSON.
 * CLI tin cậy `verify-bundle --artifact <absolute candidate.cjs> --manifest-sha256 <64 lowercase hex>`
 * không cần data-dir/DB/SSH. Candidate chỉ được đọc, không import/execute để tự chứng minh an toàn.
 * Digest phải được truyền tường minh từ build tin cậy; không lấy hash từ manifest để tự trust.
 * Manifest có exact file set: entrypoint + catalog approved tại control-plane-runtime/bundle-files.json.
 * Mỗi file kiểm size/SHA256; từ chối path traversal, symlink/hardlink, duplicate/unknown file và
 * group/world-writable artifact trên Linux. Bundle directory chỉ chứa payload + manifest.
 * Hash không thay chữ ký/xác thực kênh phân phối; verifier không tự bật service hay enroll target.
 */
