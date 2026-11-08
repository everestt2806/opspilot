/** Release directory chỉ được tin khi digest manifest lấy độc lập từ build tin cậy. */
export const CONTROLLER_RELEASE_MANIFEST = "release-manifest.json";
export const CONTROLLER_RELEASE_LIMITS = {
  manifest: 2 * 1024 * 1024,
  file: 32 * 1024 * 1024,
  node: 128 * 1024 * 1024,
  total: 256 * 1024 * 1024,
  files: 10000,
} as const;

export type ControllerReleaseManifest = Readonly<{
  format: 1;
  platform: "linux-x64-glibc";
  node_version: string;
  node_abi: string;
  minimum_glibc: string;
  payload_sha256: string;
  lock_sha256: string;
  packages: ReadonlyArray<
    Readonly<{ path: string; name: string; version: string }>
  >;
  files: ReadonlyArray<
    Readonly<{ path: string; size: number; sha256: string; mode: 384 | 448 }>
  >;
}>;

/**
 * Internal expected-owner UID cho installed runtime lấy từ root receipt + Unix account;
 * default owner policy giữ nguyên. Không public owner override qua IPC/CLI JSON.
 * node + payload/{control-plane.cjs,bundle-manifest.json,approved assets} + node_modules
 * + runtime-lock.json. Builder chỉ chạy Linux x64 Node22; dependency versions lấy đúng
 * approved runtime lock, loại dev/test và native prebuild khác platform. Không download Node,
 * không chạy npm lifecycle hoặc lấy DB/key từ máy build. Không commit binary vào Git.
 * Verifier đọc candidate như dữ liệu, exact file/directory set + size/hash/ELF64 x86_64;
 * không import/execute candidate. Pin không thay xác thực kênh phân phối/chữ ký.
 * Private owned directory; không symlink/hardlink/special file hoặc group/world write.
 * minimum_glibc lấy từ máy build (bảo thủ), không hứa tương thích distro cũ hơn.
 * Chưa transport/extract, init production DB, cài service hoặc UI wizard.
 */

export type ControllerHostFacts = Readonly<{
  format: 1;
  system: string;
  architecture: string;
  libc: string;
  libc_version: string;
  uid: number;
  available_memory_bytes: number;
  free_disk_bytes: number;
  systemd_system: boolean;
  systemd_user_bus: boolean;
  user_linger: boolean;
  installation_conflict: boolean;
}>;

export type ControllerHostPreflight = Readonly<{
  state: "compatible_snapshot" | "blocked";
  service_mode: "system" | "user";
  reasons: ReadonlyArray<
    | "PLATFORM"
    | "LIBC"
    | "MEMORY"
    | "DISK"
    | "SYSTEMD"
    | "EXISTING_INSTALLATION"
  >;
  facts: ControllerHostFacts;
}>;
/** Fixed readonly Python qua host-pinned SshManager, expected identity bắt buộc.
 * Không nhận command/path tùy ý; không apt/curl/npm, init/enroll/start/useradd hoặc ghi file.
 * Kiểm default paths và system/user systemd; user service cần bus + linger có sẵn.
 * Snapshot không cấp quyền install/reserve tài nguyên hay chứng minh runtime/deployment.
 */
