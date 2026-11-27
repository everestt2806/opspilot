import type { ControllerInstallationResult } from "./product-controller-installation";

export const CONTROLLER_SSH_BOOTSTRAP_LIMITS = {
  frame: 4096,
  manifest: 2 * 1024 * 1024,
  installer: 1024 * 1024,
  total: 260 * 1024 * 1024,
  chunk: 64 * 1024,
  timeout_ms: 20 * 60 * 1000,
  installer_timeout_ms: 90000,
} as const;
export type ControllerBootstrapLocator = {
  request_key: string;
  release_sha256: string;
  installer_sha256: string;
};
export type ControllerBootstrapOperation =
  "transfer" | "status" | "install" | "inspect" | "recover" | "discover" | "discover-current" | "admin" | "upgrade-call";
/** Untrusted hint: match both hashes to a protected Main catalog before using it. */
export type ControllerBootstrapDiscovery =
  | { state: "absent" }
  | (ControllerBootstrapLocator & { state: "discovered" });
export type ControllerBootstrapStatus = ControllerBootstrapLocator & {
  state: "absent" | "uploading" | "verified";
  completed_files: number;
  total_files: number;
};
export type ControllerBootstrapResult =
  | ControllerBootstrapStatus
  | {
      state: "installation_result";
      request_key: string;
      installation: ControllerInstallationResult;
    };
export type ControllerBootstrapErrorCode =
  | "BOOTSTRAP_INPUT_INVALID"
  | "BOOTSTRAP_ROOT_REQUIRED"
  | "BOOTSTRAP_HOST_UNSUPPORTED"
  | "BOOTSTRAP_PIN_MISMATCH"
  | "BOOTSTRAP_CONFLICT"
  | "BOOTSTRAP_BUSY"
  | "BOOTSTRAP_UNAVAILABLE"
  | "BOOTSTRAP_LIMIT"
  | "BOOTSTRAP_ABORTED"
  | "BOOTSTRAP_OUTCOME_UNKNOWN"
  | "BOOTSTRAP_AUTHORITY_CHANGED"
  | "BOOTSTRAP_ARTIFACT_CHANGED"
  | "BOOTSTRAP_NOT_FOUND"
  | "BOOTSTRAP_INSTALLER_FAILED";

/**
 * Fixed Python qua SshManager expected identity + current-authority callback, no reconnect/replay.
 * uint32be JSON <=4096; request format1/op/locator, consent:true cho transfer/install/recover.
 * transfer thêm manifest_size/installer_size, chờ {state:'send_manifest'} rồi raw manifest bytes.
 * Server kiểm independent pin,
 * strict approved lock/package/catalog/path/caps trước root-owned singleton namespace
 * /var/lib/opspilot-controller-transfer. UUID/pins immutable; khác namespace không overwrite.
 * Mỗi file server gửi {state:'send_file',index,needed:boolean}; client ACK byte0x01 để giữ
 * một outstanding message cả khi reuse. Nếu needed client gửi đúng raw
 * size từ manifest; SSH backpressure, không từng-chunk round trip. Thứ tự sorted manifest.files,
 * rồi installer.cjs. Chỉ file tạm của request được bỏ khi resume; committed mismatch = conflict.
 * Client EOF sau file cuối/command header. Server trả status/result hoặc {state:'error',code}.
 * status không tạo namespace/lock/file. Python independently verifies exact file set/hash/ELF/
 * mode/root owner/lock/catalog và trusted installer hash trước exec packaged Node (không PATH Node).
 * install/inspect/recover chỉ fixed installer CLI, stdin derived request, no paths/commands/env override.
 * Root flock inherited by child; timeout/disconnect sau dispatch là unknown, chỉ explicit inspect/
 * same-key recover. Không raw stderr/credential, public API, apt/npm/curl hoặc tự init/reset DB/key.
 * discover chỉ nhận {format:1,operation:'discover'}, không tạo state/lock hoặc exec Node.
 * discover-current chỉ nhận {format:1,operation:'discover-current'}: readonly root
 * installation flock + immutable original staging/receipt + current journal metadata.
 * Không tạo namespace/lock, exec Node hoặc đọc secret. DTO desktop-controller-adoption.ts;
 * Main phải match protected catalogs, inspect current bằng pinned updater rồi repeat
 * discovery dưới current SSH fence. Hint này không tự cấp quyền adoption/enrollment.
 * admin header có locator + request_size; raw JSON InstalledControllerAdminRequest <=512KiB
 * sau header rồi EOF. Root Python verify pins/catalog trước trusted installer admin/drop UID.
 * Reply admin_result/request_key/result là raw JSON bytes có framing riêng <=64KiB;
 * secret-bearing enrollment response chỉ Main vault tiêu thụ, không renderer/log.
 * Namespace absent nhưng installation paths có sẵn => conflict, không nhận là VPS trống.
 * Main durable journal theo desktop-controller-installation.ts; root-admin bridge/IPC/wizard riêng.
 * c-2a: transfer/status có optional purpose:'upgrade', và upgrade-call bắt buộc purpose:'upgrade'
 * + request_size<=4096, raw fixed upgrade request rồi EOF. Namespace riêng
 * /var/lib/opspilot-controller-upgrades/<UUID>, không thay singleton install transfer.
 * Receiver derive release_directory, không nhận path/UID/service từ request; upgrade/recover/rollback
 * cần consent:true, inspect-upgrade readonly. Reply upgrade_result/request_key/result strict DTO.
 * c-2b1: purpose:'upgrade' also permits admin; header locator must match revision
 * authority. recover derives verified staging release_directory for missing-journal
 * explicit recovery, no caller paths. Original singleton admin unchanged.
 */
