/**
 * HỢP ĐỒNG: IPC giữa Electron main và renderer.
 *
 * Đích khi code: app/src/shared/ipc.ts (copy y nguyên), import ở cả hai phía.
 * Renderer KHÔNG BAO GIỜ gọi ssh2/sqlite trực tiếp — mọi thứ đi qua các kênh dưới đây.
 *
 * Quy ước tên kênh: '<miền>:<hành động>'  (kebab-case cho hành động nhiều từ)
 * Quy ước tên trường: snake_case cho dữ liệu đến từ DB (khớp schema.sql),
 *                     camelCase cho tham số điều khiển thuần UI.
 * Lý do: dữ liệu DB đi thẳng ra UI không phải map lại tên -> ít bug hơn nhiều.
 */

/* =============================================================================
 * 1. KIỂU DỮ LIỆU (khớp 1-1 với bảng trong contracts/schema.sql)
 * ========================================================================== */

export type FrameworkId = 'nextjs' | 'express' | 'static-spa' | 'flask';
export type DetectionMethod = 'rule' | 'zscore_ewma' | 'iforest' | 'ocsvm' | 'ensemble';
export type DeployStep =
  | 'PRECHECK' | 'UPLOAD' | 'RENDER' | 'BUILD' | 'DEPLOY' | 'HEALTHCHECK' | 'RECORD';
export type MigrateStep =
  | 'PREPARE' | 'FREEZE' | 'BACKUP' | 'TRANSFER' | 'RESTORE' | 'VERIFY' | 'AWAITING_CONFIRM';

export interface Vps {
  id: number;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: 'key' | 'password';
  provider: string | null;
  region: string | null;
  docker_version: string | null;
  last_status: 'online' | 'offline' | 'unknown';
  last_seen_at: string | null;
  created_at: string;
}

/** Tài nguyên khả dụng, đọc bằng SSH khi mở màn VPS (FR-A3) */
export interface VpsResources {
  ram_total_mb: number;
  ram_free_mb: number;
  disk_total_gb: number;
  disk_free_gb: number;
  cpu_count: number;
  load_avg_1m: number;
}

export interface App {
  id: number;
  vps_id: number;
  name: string;
  framework: FrameworkId;
  host_port: number;
  container_port: number;
  healthcheck_path: string;
  needs_db: 0 | 1;
  current_deployment_id: number | null;
  /** Suy ra: `http://${vps.host}:${host_port}` — main tính sẵn để UI không phải ghép */
  url: string;
}

export interface Deployment {
  id: number;
  app_id: number;
  version: number;
  image_tag: string;
  status: 'building' | 'deploying' | 'running' | 'failed' | 'rolled_back' | 'stopped';
  failed_step: DeployStep | null;
  build_duration_ms: number | null;
  total_duration_ms: number | null;
  is_rollback_of: number | null;
  started_at: string;
  finished_at: string | null;
}

export interface MetricSample {
  id: number;
  deployment_id: number;
  seq: number;
  ts_vps: string;
  cpu_pct: number | null;
  mem_mb: number | null;
  mem_pct: number | null;
  latency_ms: number | null;
  http_error_rate: number | null;
  db_response_ms: number | null;
  container_up: 0 | 1;
}

export interface ScoreSet {
  /** null = model chưa train đủ mẫu. KHÁC với 0. */
  rule: number | null;
  zscore_ewma: number | null;
  iforest: number | null;
  ocsvm: number | null;
  ensemble: number | null;
}

export interface Alert {
  id: number;
  deployment_id: number;
  method: DetectionMethod;
  ts_vps: string;
  ts_resolved: string | null;
  peak_score: number;
  detail_json: string | null;
  label: 'true_positive' | 'false_positive' | null;
  acted: 'none' | 'rollback_auto' | 'rollback_suppressed_cooldown';
}

export interface MonitorSetting {
  app_id: number;
  collector_interval_s: number;
  poll_interval_s: number;
  rule_cpu_pct: number;
  rule_mem_pct: number;
  rule_latency_ms: number;
  rule_error_rate: number;
  rule_consecutive: number;
  ml_score_threshold: number;
  ml_consecutive: number;
  auto_rollback: 0 | 1;
  trusted_method: DetectionMethod;
  rollback_consecutive: number;
  cooldown_minutes: number;
}

/* =============================================================================
 * 2. INVOKE — renderer gọi, main trả Promise
 *    Mọi handler trả về IpcResult; KHÔNG throw qua ranh giới IPC (stack trace vô nghĩa
 *    ở phía renderer). Lỗi luôn có 3 phần theo quy tắc UX #3 của docs/02.
 * ========================================================================== */

export interface IpcError {
  /** Mã máy đọc được, dùng cho logic retry */
  code:
    | 'SSH_AUTH_FAILED' | 'SSH_TIMEOUT' | 'SSH_HOST_UNREACHABLE'
    | 'DOCKER_MISSING' | 'DOCKER_BUILD_FAILED'
    | 'PRECHECK_FAILED' | 'HEALTHCHECK_FAILED'
    | 'DETECT_FAILED' | 'PORT_EXHAUSTED'
    | 'ML_SERVICE_DOWN' | 'DB_ERROR' | 'VALIDATION' | 'UNKNOWN';
  /** Câu tiếng Việt hiện thẳng cho người dùng: chuyện gì + ở bước nào + làm gì tiếp */
  message: string;
  /** Message thô của thư viện, để trong mục "Chi tiết kỹ thuật" thu gọn được */
  technical?: string;
  step?: DeployStep | MigrateStep;
}

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcError };

export interface IpcInvokeMap {
  // ── VPS (UC-01) ────────────────────────────────────────────────────────────
  'vps:list':           () => IpcResult<Vps[]>;
  'vps:get-resources':  (vpsId: number) => IpcResult<VpsResources>;
  'vps:test-connection': (input: VpsInput) => IpcResult<VpsConnectionCheck>;
  'vps:create':         (input: VpsInput) => IpcResult<Vps>;
  'vps:update':         (id: number, input: Partial<VpsInput>) => IpcResult<Vps>;
  'vps:delete':         (id: number) => IpcResult<void>;
  'vps:install-docker': (vpsId: number) => IpcResult<{ docker_version: string }>;

  // ── Detect & Deploy (UC-02, UC-03) ─────────────────────────────────────────
  'deploy:detect':   (sourcePath: string) => IpcResult<DetectionResultDto>;
  'deploy:precheck': (input: DeployInput) => IpcResult<PrecheckResult>;
  /** Trả về ngay khi pipeline khởi động; tiến độ theo dõi qua kênh 'deploy:event' */
  'deploy:start':    (input: DeployInput) => IpcResult<{ deployment_id: number }>;
  'deploy:cancel':   (deploymentId: number) => IpcResult<void>;

  // ── App & version (UC-03, UC-04) ───────────────────────────────────────────
  'app:list':        (vpsId?: number) => IpcResult<App[]>;
  'app:get':         (appId: number) => IpcResult<App>;
  'app:versions':    (appId: number) => IpcResult<Deployment[]>;
  'app:rollback':    (appId: number, targetDeploymentId: number) => IpcResult<{ deployment_id: number }>;
  'app:stop':        (appId: number) => IpcResult<void>;
  'app:start':       (appId: number) => IpcResult<void>;

  // ── Giám sát (UC-06, UC-07, UC-08) ─────────────────────────────────────────
  'monitor:samples': (deploymentId: number, fromTs: string) => IpcResult<MetricSample[]>;
  'monitor:scores':  (deploymentId: number, fromTs: string)
                       => IpcResult<Array<{ ts_vps: string } & ScoreSet>>;
  'monitor:alerts':  (deploymentId: number, limit: number) => IpcResult<Alert[]>;
  'monitor:label-alert': (alertId: number, label: 'true_positive' | 'false_positive' | null)
                       => IpcResult<void>;
  'monitor:get-setting': (appId: number) => IpcResult<MonitorSetting>;
  'monitor:set-setting': (appId: number, patch: Partial<MonitorSetting>) => IpcResult<MonitorSetting>;
  'monitor:train-now':   (deploymentId: number) => IpcResult<{ train_sample_count: number }>;

  // ── Migrate (UC-05) ────────────────────────────────────────────────────────
  'migrate:start':   (input: MigrateInput) => IpcResult<{ job_id: number }>;
  'migrate:confirm': (jobId: number, keepSource: boolean) => IpcResult<void>;
  'migrate:abort':   (jobId: number) => IpcResult<void>;

  // ── Lịch sử (UC-09) ────────────────────────────────────────────────────────
  'history:list':    (filter: HistoryFilter) => IpcResult<ActionLogEntry[]>;

  // ── Hệ thống ───────────────────────────────────────────────────────────────
  'system:ml-status':   () => IpcResult<{ running: boolean; version?: string; uptime_s?: number }>;
  'system:ml-restart':  () => IpcResult<void>;
  'system:open-external': (url: string) => IpcResult<void>;
  'system:pick-folder': () => IpcResult<{ path: string | null }>;
}

export interface VpsInput {
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: 'key' | 'password';
  /** Private key hoặc password bản rõ — main mã hoá NGAY, không log, không ghi tạm ra đĩa */
  secret: string;
  provider?: string;
  region?: string;
}

export interface VpsConnectionCheck {
  ssh_ok: boolean;
  docker_installed: boolean;
  docker_version: string | null;
  workdir_writable: boolean;
  /** Từng bước để UI hiện tuần tự: "✓ SSH OK → ✓ Docker 27.1 → ✓ Ghi được /opt/opspilot" */
  steps: Array<{ label: string; ok: boolean; detail?: string }>;
}

export interface DeployInput {
  vps_id: number;
  /** Thiếu -> tạo app mới; có -> redeploy app đã tồn tại */
  app_id?: number;
  app_name: string;
  source_path: string;
  /** Env do người dùng điền ở bước 3 của wizard, gồm cả secret */
  env: Record<string, string>;
}

export interface PrecheckResult {
  passed: boolean;
  checks: Array<{
    label: string;            // 'RAM trống'
    required: string;         // '> 512 MB'
    actual: string;           // '2048 MB'
    ok: boolean;
  }>;
  assigned_host_port: number;
  app_url: string;
}

export type DetectionResultDto =
  | { matched: true; framework: FrameworkId; display_name: string;
      build_command: string; container_port: number; healthcheck_path: string;
      dockerfile_template: string; required_env: string[]; optional_env: string[];
      needs_db: boolean; manual_steps: string[]; detected_version?: string;
      file_tree_preview: string[] }
  | { matched: false; hint: string;
      signals: Array<{ framework: FrameworkId; description: string; passed: boolean; found?: string }> };

export interface MigrateInput {
  app_id: number;
  target_vps_id: number;
}

export interface HistoryFilter {
  actions?: string[];
  vps_id?: number;
  from_ts?: string;
  to_ts?: string;
  limit: number;
  offset: number;
}

export interface ActionLogEntry {
  id: number;
  ts: string;
  action: string;
  status: 'success' | 'failed' | 'cancelled' | null;
  message: string | null;
  vps_id: number | null;
  app_id: number | null;
  deployment_id: number | null;
  detail_json: string | null;
}

/* =============================================================================
 * 3. EVENT — main đẩy sang renderer (một chiều, main -> renderer)
 * ========================================================================== */

export interface IpcEventMap {
  /** Tiến độ deploy, xem contracts/deploy-events.md */
  'deploy:event': DeployEvent;
  /** Tiến độ migrate */
  'migrate:event': MigrateEvent;
  /** Mỗi lần poller nạp xong một mẻ mẫu (thường 3 mẫu / 30 giây) */
  'monitor:tick': {
    deployment_id: number;
    samples: MetricSample[];
    scores: Array<{ ts_vps: string } & ScoreSet>;
    new_alerts: Alert[];
  };
  /** ML service sống/chết — dot ở topbar */
  'system:ml-status': { running: boolean; reason?: string };
  /** Kết nối SSH của một VPS đổi trạng thái — dot ở topbar */
  'system:ssh-status': { vps_id: number; status: 'online' | 'offline' };
  /** Auto-rollback vừa xảy ra — hiện notification nổi bật */
  'system:auto-rollback': {
    app_id: number; from_version: number; to_version: number;
    method: DetectionMethod; alert_id: number;
  };
}

export type DeployEvent =
  | { type: 'step-start'; deployment_id: number; step: DeployStep; ts: string }
  | { type: 'log'; deployment_id: number; step: DeployStep; chunk: string; stream: 'stdout' | 'stderr' }
  | { type: 'step-done'; deployment_id: number; step: DeployStep; duration_ms: number }
  | { type: 'step-failed'; deployment_id: number; step: DeployStep; error: IpcError; last_log_lines: string[] }
  | { type: 'finished'; deployment_id: number; status: 'running' | 'failed' | 'rolled_back';
      total_duration_ms: number; app_url?: string };

export type MigrateEvent =
  | { type: 'step-start'; job_id: number; step: MigrateStep; ts: string }
  | { type: 'progress'; job_id: number; step: MigrateStep; percent: number; detail?: string }
  | { type: 'log'; job_id: number; step: MigrateStep; chunk: string }
  | { type: 'step-done'; job_id: number; step: MigrateStep; duration_ms: number }
  | { type: 'verify-result'; job_id: number;
      rows: Array<{ label: string; source: string; target: string; ok: boolean }> }
  | { type: 'awaiting-confirm'; job_id: number; downtime_ms: number }
  | { type: 'finished'; job_id: number; status: 'completed' | 'failed' | 'rolled_back'; downtime_ms: number };
