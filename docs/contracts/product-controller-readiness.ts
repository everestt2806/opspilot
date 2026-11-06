/** Internal readiness/recovery trước khi service được quyền claim công việc mới. */
export const PRODUCT_RESOURCE_MIN_RAM_BYTES = 512 * 1024 * 1024;
export const PRODUCT_RESOURCE_MIN_DISK_BYTES = 2 * 1024 * 1024 * 1024;
export const PRODUCT_STARTUP_MAX_RECORDS = 100;

export type ProductResourceEvidence = Readonly<{
  cpu_count: number;
  available_ram_bytes: number;
  workspace_available_bytes: number;
  docker_ready?: boolean;
  port_ready?: boolean;
}>;
export type ProductAdmissionDecision = Readonly<{
  state: "ready" | "deferred";
  reason: "resource_unavailable" | "resource_unknown" | null;
}>;
export type ProductStartupRecoveryReport = Readonly<{
  state: "ready" | "reconciliation_required" | "aborted";
  inspected_enrollments: number;
  recovered_terminals: number;
  blockers: ReadonlyArray<
    Readonly<{
      app_id: number | null;
      attempt_id: string | null;
      reason:
        | "enrollment_not_ready"
        | "terminal_not_settled"
        | "preterminal_unknown"
        | "scan_limit"
        | "authority_unavailable";
    }>
  >;
}>;

/**
 * CLI `recover-runtime --data-dir <private controller directory>` nhận JSON stdin
 * {format:1,artifact:<absolute approved bundle entrypoint>,manifest_sha256:<independent pin>}.
 * Chỉ inspect/settle; JSON state phải là ready, exit 0 không tự chứng minh đã sẵn sàng.
 * Lệnh không bật worker hay unpause ứng dụng. Không credential trong argv/stdout.
 *
 * Management host: Linux MemAvailable + data filesystem available, cpu_count>=1.
 * Target: SSH principal/profile đối chiếu current SQLite trước/sau read-only probe;
 * workspace và /opt/opspilot filesystem, Docker response, port trống hoặc owned current container.
 * RAM/disk phải lớn hơn ngưỡng; malformed/missing/cancelled observation không nhận ready.
 * Đây là snapshot admission, không reservation tài nguyên và không đo mọi Docker storage mount.
 * Startup đóng admission tới khi reconcile enrollment và pending T1 bằng exact historical key/proof.
 * Pre-T1 unknown không tự replay/clear; không renew lease, rotate key, reinstall hoặc fetch source.
 * Read-only inspect được phép khi có pending runtime; tuyệt đối không dùng đường first-install.
 * Historical manifest phải khớp SQL pin và actual runtime helpers khớp current approved helper hashes.
 * Không dùng management bundle SHA mới thay identity của receipt/installed release cũ.
 */
