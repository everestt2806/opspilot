-- =============================================================================
-- SCHEMA SQLITE — NGUỒN SỰ THẬT DUY NHẤT
-- Phản ánh trạng thái schema tích lũy qua các file migration:
--   - 001_init.sql (khung ban đầu)
--   - 002_metric_activation.sql (byte-boundary activation)
--   - 003_migration_error_message.sql (thông điệp lỗi migrate)
--   - 004_publish_doctor_domain.sql (exposure, doctor, domain)
--   - 005_experiment_run_attempt.sql (attempt_index, unique 3 trường cho experiment_run)
--   - 006_vps_host_fingerprint.sql (pin fingerprint SSH của VPS)
--   - 007_git_source_provenance.sql (nguồn Git và commit deploy)
--   - 008_vps_archive.sql (gỡ VPS an toàn và nối lại app/lịch sử)
--
-- QUY ƯỚC BẮT BUỘC:
--   * Mọi cột thời gian: TEXT, ISO-8601 UTC, dạng '2026-07-27T10:00:00Z'
--   * Tên bảng/cột: snake_case, số ít (deployment, không phải deployments)
--   * Đơn vị nằm trong tên cột: _ms, _mb, _pct, _s
--   * Không dùng BOOLEAN — dùng INTEGER 0/1
--   * Mọi khoá ngoại đều khai báo, PRAGMA foreign_keys phải ON
-- =============================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;      -- bắt buộc: poller ghi trong khi UI đọc

-- Phiên bản schema, để migration biết cần chạy file nào
CREATE TABLE IF NOT EXISTS schema_version (
  version    INTEGER NOT NULL,
  applied_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- =============================================================================
-- A. VPS  (FR-A1, FR-A2, FR-A3)
-- =============================================================================
CREATE TABLE vps (
  id              INTEGER PRIMARY KEY,
  name            TEXT    NOT NULL UNIQUE,
  host            TEXT    NOT NULL,
  port            INTEGER NOT NULL DEFAULT 22,
  -- NULL only for legacy records; these VPS must be pinned before SSH can connect.
  host_fingerprint TEXT,
  username        TEXT    NOT NULL,

  auth_type       TEXT    NOT NULL CHECK (auth_type IN ('key','password')),
  -- Bí mật (private key hoặc password) đã mã hoá. Xem M2 / ADR-002.
  crypto_scheme   TEXT    NOT NULL DEFAULT 'safe_storage'
                          CHECK (crypto_scheme IN ('safe_storage','aes_256_gcm')),
  encrypted_secret BLOB   NOT NULL,
  iv              BLOB,           -- chỉ dùng khi crypto_scheme='aes_256_gcm'
  auth_tag        BLOB,           -- chỉ dùng khi crypto_scheme='aes_256_gcm'

  -- Metadata phục vụ thí nghiệm: 2 VPS phải cùng provider/region (xem docs/07)
  provider        TEXT,
  region          TEXT,
  specs_json      TEXT,           -- {"vcpu":2,"ram_mb":4096,"disk_gb":40}

  docker_version  TEXT,
  last_status     TEXT    NOT NULL DEFAULT 'unknown'
                          CHECK (last_status IN ('online','offline','unknown')),
  last_seen_at    TEXT,
  -- Lệch đồng hồ VPS so với máy user, ms (dương = VPS nhanh hơn). Đo bởi run_experiment.py
  clock_offset_ms INTEGER NOT NULL DEFAULT 0,

  -- Migration 008: gỡ VPS khỏi danh sách nhưng giữ app/deployment và dữ liệu vận hành.
  archived_at     TEXT,
  archived_name   TEXT,

  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at      TEXT
);
CREATE INDEX idx_vps_archived_identity ON vps(host, port, host_fingerprint, archived_at);

-- =============================================================================
-- B. APP & DEPLOYMENT  (FR-B5, FR-B7)
-- Một "app" = một ứng dụng cụ thể đang sống trên một VPS cụ thể.
-- Mỗi lần deploy sinh một "deployment" mới với version tăng dần.
-- =============================================================================
CREATE TABLE app (
  id                INTEGER PRIMARY KEY,
  vps_id            INTEGER NOT NULL REFERENCES vps(id) ON DELETE CASCADE,
  name              TEXT    NOT NULL,          -- slug: ^[a-z0-9][a-z0-9-]{1,30}$
  framework         TEXT    NOT NULL CHECK (framework IN ('nextjs','express','static-spa','flask')),

  -- Source provenance: old rows migrate as local and retain their original path.
  source_type       TEXT    NOT NULL DEFAULT 'local' CHECK (source_type IN ('local','git')),
  source_path       TEXT,                      -- chỉ dùng cho nguồn local; không ghi đè bằng URL Git
  git_repo_url      TEXT,                      -- URL GitHub HTTPS canonical, không credential
  git_ref           TEXT,                      -- branch/tag/SHA được chọn; không xem là provenance immutable
  git_root          TEXT,                      -- thư mục tương đối bên trong repository
  host_port         INTEGER NOT NULL,          -- cấp trong dải 30000-30999, ADR-006
  container_port    INTEGER NOT NULL,
  healthcheck_path  TEXT    NOT NULL DEFAULT '/',
  healthcheck_response_type TEXT NOT NULL DEFAULT 'status_2xx'
                      CHECK (healthcheck_response_type IN ('status_2xx','json')),
  needs_db          INTEGER NOT NULL DEFAULT 0 CHECK (needs_db IN (0,1)),
  imported_from_vps INTEGER NOT NULL DEFAULT 0 CHECK (imported_from_vps IN (0,1)),

  -- Vị trí đọc tiếp trong metrics.jsonl (byte offset, 1-based cho `tail -c +N`)
  metrics_offset    INTEGER NOT NULL DEFAULT 1,
  metrics_stream_generation TEXT NOT NULL DEFAULT 'legacy',
  metrics_stream_device INTEGER,
  metrics_stream_inode INTEGER,

  current_deployment_id INTEGER,               -- FK mềm tới deployment(id), tránh vòng lặp
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),

  UNIQUE (vps_id, name),
  UNIQUE (vps_id, host_port)
);

CREATE TABLE deployment (
  id                INTEGER PRIMARY KEY,
  app_id            INTEGER NOT NULL REFERENCES app(id) ON DELETE CASCADE,
  version           INTEGER NOT NULL,          -- tăng dần trong phạm vi app
  image_tag         TEXT    NOT NULL,          -- vd 'myapp:v3'
  git_repo_url      TEXT,                      -- provenance của snapshot; NULL với deployment local
  git_commit_sha    TEXT,                      -- full immutable commit SHA; NULL với deployment local

  status            TEXT    NOT NULL CHECK (status IN
                      ('building','deploying','running','failed','rolled_back','stopped')),
  failed_step       TEXT    CHECK (failed_step IN
                      ('PRECHECK','UPLOAD','RENDER','BUILD','DEPLOY','HEALTHCHECK','RECORD')),

  env_json          TEXT,                      -- CHỈ env không nhạy cảm; secret nằm ở .env trên VPS
  detector_json     TEXT,                      -- BuildPlan mà detector đã sinh ra, để tra cứu lại

  build_duration_ms INTEGER,
  total_duration_ms INTEGER,                   -- bằng chứng cho NFR-4 (<3 phút)
  is_rollback_of    INTEGER REFERENCES deployment(id),  -- nếu đây là rollback về bản cũ

  -- Publish / reachability (migration 004)
  exposure_status   TEXT    NOT NULL DEFAULT 'not_checked'
                            CHECK (exposure_status IN ('reachable','degraded','tunnel_only','not_checked')),
  exposure_evidence_json TEXT,

  -- Nullable for a VPS-import baseline, whose original deploy time is unknown.
  started_at        TEXT,
  finished_at       TEXT,
  origin            TEXT    NOT NULL DEFAULT 'opspilot' CHECK (origin IN ('opspilot','vps_import')),

  UNIQUE (app_id, version)
);
CREATE INDEX idx_deployment_app_started ON deployment(app_id, started_at DESC);

CREATE TABLE deployment_activation (
  id INTEGER PRIMARY KEY,
  app_id INTEGER NOT NULL REFERENCES app(id) ON DELETE CASCADE,
  deployment_id INTEGER NOT NULL REFERENCES deployment(id) ON DELETE CASCADE,
  stream_generation TEXT NOT NULL,
  start_offset INTEGER NOT NULL CHECK (start_offset >= 1),
  end_offset INTEGER CHECK (end_offset IS NULL OR end_offset >= start_offset),
  reason TEXT NOT NULL CHECK (reason IN ('deploy','manual_rollback','auto_rollback','rotation','legacy')),
  state TEXT NOT NULL CHECK (state IN ('prepared','active','closed','aborted')),
  prepared_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  activated_at TEXT,
  closed_at TEXT
);
CREATE INDEX idx_activation_app_range ON deployment_activation(app_id, stream_generation, start_offset, end_offset);
CREATE INDEX idx_activation_deployment ON deployment_activation(deployment_id, id);
CREATE UNIQUE INDEX one_prepared_activation ON deployment_activation(app_id) WHERE state='prepared';
CREATE UNIQUE INDEX one_active_activation ON deployment_activation(app_id) WHERE state='active';

-- =============================================================================
-- C. CẤU HÌNH GIÁM SÁT  (FR-D3, FR-E2 — M6, M8)
-- =============================================================================
CREATE TABLE monitor_setting (
  app_id               INTEGER PRIMARY KEY REFERENCES app(id) ON DELETE CASCADE,

  collector_interval_s INTEGER NOT NULL DEFAULT 10,   -- collector ghi 1 dòng / N giây
  poll_interval_s      INTEGER NOT NULL DEFAULT 30,   -- poller kéo qua SSH / N giây

  -- Ngưỡng rule-based (FR-D3)
  rule_cpu_pct         REAL    NOT NULL DEFAULT 90,
  rule_mem_pct         REAL    NOT NULL DEFAULT 90,
  rule_latency_ms      REAL    NOT NULL DEFAULT 2000,
  rule_error_rate      REAL    NOT NULL DEFAULT 0.5,
  rule_consecutive     INTEGER NOT NULL DEFAULT 3,

  -- Ngưỡng cho 4 phương pháp ML
  ml_score_threshold   REAL    NOT NULL DEFAULT 0.7,
  ml_consecutive       INTEGER NOT NULL DEFAULT 2,

  -- Auto-rollback (M8)
  auto_rollback        INTEGER NOT NULL DEFAULT 0 CHECK (auto_rollback IN (0,1)),
  trusted_method       TEXT    NOT NULL DEFAULT 'ensemble' CHECK (trusted_method IN
                         ('rule','zscore_ewma','iforest','ocsvm','ensemble')),
  rollback_consecutive INTEGER NOT NULL DEFAULT 3,
  cooldown_minutes     INTEGER NOT NULL DEFAULT 10,
  last_rollback_at     TEXT,

  updated_at           TEXT
);

-- =============================================================================
-- D. METRIC  (FR-D1, FR-D2)
-- ts_vps là mốc thời gian CHUẨN cho mọi phân tích. ts_local chỉ để debug.
-- =============================================================================
CREATE TABLE metric_sample (
  id              INTEGER PRIMARY KEY,
  deployment_id   INTEGER NOT NULL REFERENCES deployment(id) ON DELETE CASCADE,
  seq             INTEGER NOT NULL,      -- số thứ tự dòng trong metrics.jsonl, do collector cấp
  ts_vps          TEXT    NOT NULL,      -- đồng hồ VPS  <-- DÙNG CÁI NÀY
  ts_local        TEXT    NOT NULL,      -- lúc poller nạp vào DB

  cpu_pct         REAL,
  mem_mb          REAL,
  mem_pct         REAL,
  mem_limit_mb    REAL,
  latency_ms      REAL,                  -- NULL khi probe lỗi
  http_error_rate REAL,                  -- 0..1, tỷ lệ 5xx trong cửa sổ 60s
  db_response_ms  REAL,                  -- NULL khi app không có DB
  container_up    INTEGER NOT NULL DEFAULT 1 CHECK (container_up IN (0,1)),
  host_cpu_pct    REAL,
  host_mem_pct    REAL,

  raw_json        TEXT,                  -- nguyên văn dòng JSON, phòng khi cần trích thêm

  UNIQUE (deployment_id, seq)            -- chống ghi trùng khi poller retry
);
CREATE INDEX idx_metric_dep_ts ON metric_sample(deployment_id, ts_vps);

-- =============================================================================
-- E. SCORE THÔ  (nền tảng cho threshold sweep + ablation chạy OFFLINE)
-- Ghi score của CẢ 5 PHƯƠNG PHÁP ở MỌI MẪU, kể cả khi không vượt ngưỡng.
-- Nhờ bảng này, 3 phân tích ở docs/07 không tốn thêm một giờ máy nào.
-- score = NULL nghĩa là model chưa train đủ mẫu (KHÁC với score = 0).
-- =============================================================================
CREATE TABLE score_sample (
  id               INTEGER PRIMARY KEY,
  metric_sample_id INTEGER NOT NULL REFERENCES metric_sample(id) ON DELETE CASCADE,
  deployment_id    INTEGER NOT NULL REFERENCES deployment(id) ON DELETE CASCADE,
  ts_vps           TEXT    NOT NULL,     -- lặp lại từ metric_sample để query nhanh
  method           TEXT    NOT NULL CHECK (method IN
                     ('rule','zscore_ewma','iforest','ocsvm','ensemble')),
  score            REAL,                 -- 0..1 đã chuẩn hoá; NULL = chưa sẵn sàng
  above_threshold  INTEGER NOT NULL DEFAULT 0 CHECK (above_threshold IN (0,1)),
  detail_json      TEXT,                 -- {"top_metric":"mem_mb","z":4.2,...}

  UNIQUE (metric_sample_id, method)
);
CREATE INDEX idx_score_dep_method_ts ON score_sample(deployment_id, method, ts_vps);

-- =============================================================================
-- F. ALERT  (FR-D4, FR-D5, UC-08)
-- CHỈ ghi khi đã triggered thật (đủ ml_consecutive/rule_consecutive mẫu liên tiếp).
-- Một chuỗi bất thường liên tục = MỘT alert, không phải mỗi mẫu một alert.
-- =============================================================================
CREATE TABLE alert (
  id                INTEGER PRIMARY KEY,
  deployment_id     INTEGER NOT NULL REFERENCES deployment(id) ON DELETE CASCADE,
  metric_sample_id  INTEGER REFERENCES metric_sample(id) ON DELETE SET NULL,  -- mẫu kích hoạt
  method            TEXT    NOT NULL CHECK (method IN
                      ('rule','zscore_ewma','iforest','ocsvm','ensemble')),

  ts_vps            TEXT    NOT NULL,    -- thời điểm alert bật (mẫu đầu tiên của chuỗi)
  ts_resolved       TEXT,                -- khi score xuống dưới ngưỡng 3 mẫu liền
  peak_score        REAL    NOT NULL,
  detail_json       TEXT,                -- metric nào bất thường, giá trị bao nhiêu

  -- Nhãn người dùng (UC-08 / FR-D5) — nguồn để tính Precision khi không có ground truth
  label             TEXT    CHECK (label IN ('true_positive','false_positive')),
  labeled_at        TEXT,

  -- Hành động hệ thống đã thực hiện (M8)
  acted             TEXT    NOT NULL DEFAULT 'none'
                            CHECK (acted IN ('none','rollback_auto','rollback_suppressed_cooldown')),

  experiment_run_id INTEGER REFERENCES experiment_run(id) ON DELETE SET NULL
);
CREATE INDEX idx_alert_dep_ts     ON alert(deployment_id, ts_vps DESC);
CREATE INDEX idx_alert_run_method ON alert(experiment_run_id, method);

-- =============================================================================
-- G. MIGRATE  (FR-C1..C5)
-- =============================================================================
CREATE TABLE migration_job (
  id             INTEGER PRIMARY KEY,
  app_id         INTEGER NOT NULL REFERENCES app(id) ON DELETE CASCADE,
  source_vps_id  INTEGER NOT NULL REFERENCES vps(id),
  target_vps_id  INTEGER NOT NULL REFERENCES vps(id),

  status         TEXT NOT NULL CHECK (status IN
                   ('preparing','backing_up','transferring','restoring','verifying',
                    'awaiting_confirm','completed','failed','rolled_back')),
  failed_step    TEXT,
  downtime_ms    INTEGER,               -- từ FREEZE đến healthcheck đích OK — số liệu báo cáo
  bytes_transferred INTEGER,
  verify_json    TEXT,                  -- {"checksums":[...],"table_counts":[...],"health":true}
  source_kept    INTEGER CHECK (source_kept IN (0,1)),

  -- migration 003: lưu lý do lỗi để hiển thị lại sau khi mở lại app
  error_message  TEXT,

  started_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  finished_at    TEXT
);

-- =============================================================================
-- H. NHẬT KÝ HÀNH ĐỘNG  (FR-E3)
-- =============================================================================
CREATE TABLE action_log (
  id            INTEGER PRIMARY KEY,
  ts            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  action        TEXT NOT NULL CHECK (action IN (
                  'vps_add','vps_update','vps_delete','docker_install',
                  'deploy','redeploy','rollback_manual','rollback_auto',
                  'migrate_start','migrate_confirm','migrate_abort',
                  'alert_raised','alert_labeled','config_change',
                  'experiment_start','experiment_end','ssh_error','ml_service_restart')),
  status        TEXT CHECK (status IN ('success','failed','cancelled')),
  vps_id        INTEGER,
  app_id        INTEGER,
  deployment_id INTEGER,
  detail_json   TEXT,
  message       TEXT              -- câu tiếng Việt hiển thị thẳng trên UI Lịch sử
);
CREATE INDEX idx_action_log_ts ON action_log(ts DESC);

-- =============================================================================
-- I. THÍ NGHIỆM  (NFR-8) — xem docs/07-giao-thuc-thi-nghiem.md
-- =============================================================================
CREATE TABLE experiment_run (
  id               INTEGER PRIMARY KEY,
  scenario         TEXT    NOT NULL CHECK (scenario IN
                     ('memory_leak','cpu_spike','error_burst','slow_db','latency_creep')),
  repeat_index     INTEGER NOT NULL,          -- 1..10
  attempt_index    INTEGER NOT NULL DEFAULT 1 CHECK (attempt_index BETWEEN 1 AND 3), -- 1..3
  deployment_id    INTEGER REFERENCES deployment(id) ON DELETE SET NULL,
  vps_id           INTEGER REFERENCES vps(id),

  -- Các mốc thời gian, TẤT CẢ quy về đồng hồ VPS
  baseline_start_ts TEXT,
  train_at_ts       TEXT,                     -- lúc gọi POST /train
  fault_start_ts    TEXT,
  fault_end_ts      TEXT,
  run_end_ts        TEXT,

  clock_offset_ms   INTEGER NOT NULL DEFAULT 0,   -- đo tại thời điểm bắt đầu run
  detection_grace_s INTEGER NOT NULL DEFAULT 60,  -- độ trễ hợp lý sau fault_start, xem docs/07
  train_sample_count INTEGER,

  fault_params_json TEXT,                     -- {"rate_mb_per_min":5,...} để tái lập
  status            TEXT NOT NULL DEFAULT 'running'
                         CHECK (status IN ('running','completed','aborted')),
  abort_reason      TEXT,
  notes             TEXT,

  -- GHI CHÚ RÀ SOÁT 2026-10-01 (P2b-1, migration 005):
  -- Bổ sung attempt_index (1..3) và đổi UNIQUE thành (scenario, repeat_index, attempt_index).
  UNIQUE (scenario, repeat_index, attempt_index)
);

-- =============================================================================
-- J. DOCTOR RUN & ACTION  (migration 004)
-- =============================================================================
CREATE TABLE doctor_run (
  id              INTEGER PRIMARY KEY,
  deployment_id   INTEGER REFERENCES deployment(id) ON DELETE CASCADE,
  trigger         TEXT    NOT NULL CHECK (trigger IN ('deploy','manual','monitor','domain')),
  evidence_json   TEXT    NOT NULL,
  diagnosis_code  TEXT    NOT NULL,
  confidence      TEXT    NOT NULL CHECK (confidence IN ('high','medium','low')),
  selected_fix    TEXT,
  outcome         TEXT    NOT NULL DEFAULT 'pending'
                          CHECK (outcome IN ('pending','fixed','verified','failed','abstained')),
  started_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  finished_at     TEXT
);
CREATE INDEX idx_doctor_run_deployment ON doctor_run(deployment_id, started_at DESC);

CREATE TABLE doctor_action (
  id              INTEGER PRIMARY KEY,
  doctor_run_id   INTEGER NOT NULL REFERENCES doctor_run(id) ON DELETE CASCADE,
  action_type     TEXT    NOT NULL,
  precondition_json TEXT,
  result_json     TEXT,
  verify_json     TEXT,
  rollback_json   TEXT,
  status          TEXT    NOT NULL CHECK (status IN ('planned','running','success','failed','skipped')),
  started_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  finished_at     TEXT
);
CREATE INDEX idx_doctor_action_run ON doctor_action(doctor_run_id, id);

-- =============================================================================
-- K. DOMAIN BINDING  (migration 004)
-- =============================================================================
CREATE TABLE domain_binding (
  id              INTEGER PRIMARY KEY,
  app_id          INTEGER NOT NULL REFERENCES app(id) ON DELETE CASCADE,
  hostname        TEXT    NOT NULL UNIQUE,
  mode            TEXT    NOT NULL CHECK (mode IN ('direct_port','shared_ingress','named_tunnel')),
  provider        TEXT,
  zone_id         TEXT,
  record_type     TEXT    CHECK (record_type IN ('A','AAAA','CNAME')),
  record_name     TEXT,
  target          TEXT,
  ownership_key   TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','propagated','active','conflict','failed','disabled')),
  last_check_at   TEXT,
  evidence_json   TEXT,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at      TEXT,
  -- Migration 010: status is retained as a legacy mirror; new code reads/writes dns_status.
  -- Legacy status='active' is backfilled as DNS propagated, never as HTTPS route activation.
  dns_status      TEXT    NOT NULL DEFAULT 'pending'
                          CHECK (dns_status IN ('pending','propagated','conflict','failed','disabled')),
  dns_evidence_json TEXT,             -- sanitized DNS result only; never provider token
  route_status    TEXT    NOT NULL DEFAULT 'not_configured'
                          CHECK (route_status IN ('not_configured','pending','active','degraded','conflict','failed','disabled')),
  certificate_status TEXT NOT NULL DEFAULT 'not_requested'
                          CHECK (certificate_status IN ('not_requested','pending','valid','failed','expired')),
  https_probe_status TEXT NOT NULL DEFAULT 'not_run'
                          CHECK (https_probe_status IN ('not_run','passed','failed')),
  desired_generation INTEGER NOT NULL DEFAULT 1 CHECK (desired_generation >= 1),
  observed_generation INTEGER NOT NULL DEFAULT 0 CHECK (observed_generation >= 0),
  route_ownership_key TEXT NOT NULL DEFAULT '', -- OpsPilot route identity, separate from DNS ownership
  ingress_reason_code TEXT CHECK (ingress_reason_code IS NULL OR ingress_reason_code IN (
    'DNS_NOT_PROPAGATED','DNS_TARGET_MISMATCH','DNS_IPV6_UNREACHABLE',
    'INGRESS_PORT_CONFLICT','INGRESS_OWNER_UNKNOWN','FIREWALL_80_BLOCKED',
    'FIREWALL_443_BLOCKED','INGRESS_INSTALL_FAILED','INGRESS_CONFIG_INVALID',
    'INGRESS_RELOAD_FAILED','INGRESS_ROLLBACK_FAILED','CERTIFICATE_PENDING',
    'CERTIFICATE_ISSUE_FAILED','HTTPS_PROBE_FAILED','UPSTREAM_UNHEALTHY',
    'DOMAIN_OWNERSHIP_CONFLICT','SSH_UNAVAILABLE','CANCELLED'
  )),
  route_checked_at TEXT,
  certificate_checked_at TEXT,
  certificate_hostname TEXT,
  https_probe_checked_at TEXT,
  https_probe_hostname TEXT,
  -- Migration 013 binds route and external proof to the same managed Caddy generation.
  route_config_generation TEXT,
  route_inventory_revision TEXT,
  route_environment TEXT CHECK (route_environment IS NULL OR route_environment IN ('production','acme_staging')),
  https_probe_peer_ip TEXT,
  https_probe_peer_ips_json TEXT CHECK (https_probe_peer_ips_json IS NULL OR json_valid(https_probe_peer_ips_json)),
  https_probe_http_status INTEGER CHECK (https_probe_http_status IS NULL OR https_probe_http_status BETWEEN 100 AND 599),
  https_probe_generation TEXT,
  https_probe_inventory_revision TEXT,
  https_probe_environment TEXT CHECK (https_probe_environment IS NULL OR https_probe_environment IN ('production','acme_staging'))
);
CREATE INDEX idx_domain_binding_app ON domain_binding(app_id, status);
CREATE INDEX idx_domain_binding_app_dns_status ON domain_binding(app_id, dns_status);
CREATE UNIQUE INDEX idx_domain_binding_route_ownership ON domain_binding(route_ownership_key)
  WHERE route_ownership_key <> '';

CREATE TRIGGER app_healthcheck_policy_invalidates_https
AFTER UPDATE OF healthcheck_path, healthcheck_response_type ON app
WHEN OLD.healthcheck_path IS NOT NEW.healthcheck_path OR
  OLD.healthcheck_response_type IS NOT NEW.healthcheck_response_type
BEGIN
  UPDATE domain_binding
  SET route_status=CASE WHEN route_status='not_configured' THEN 'not_configured' ELSE 'pending' END,
      observed_generation=0, https_probe_status='not_run', ingress_reason_code=NULL,
      https_probe_checked_at=NULL, https_probe_hostname=NULL,
      https_probe_peer_ip=NULL, https_probe_peer_ips_json=NULL, https_probe_http_status=NULL,
      https_probe_generation=NULL, https_probe_inventory_revision=NULL,
      https_probe_environment=NULL
  WHERE app_id=NEW.id;
END;

-- Migration 010 requires route, certificate and current-generation external probe evidence
-- before route_status can be active. These guards also protect against direct SQL writes.
-- Migration 015 demotes active bindings lacking the verified peer set; it never
-- synthesizes checked peers from the older single-peer field.
CREATE TRIGGER domain_binding_active_requires_https_insert
BEFORE INSERT ON domain_binding
WHEN NEW.route_status = 'active' AND (
  NEW.dns_status <> 'propagated' OR NEW.certificate_status <> 'valid' OR
  NEW.certificate_hostname IS NOT NEW.hostname OR NEW.https_probe_status <> 'passed' OR
  NEW.https_probe_hostname IS NOT NEW.hostname OR
  NEW.desired_generation <> NEW.observed_generation OR
  NEW.route_checked_at IS NULL OR NEW.certificate_checked_at IS NULL OR
  NEW.https_probe_checked_at IS NULL OR NEW.route_environment IS NOT 'production' OR
  NEW.https_probe_environment IS NOT 'production' OR NEW.route_config_generation IS NULL OR
  NEW.route_inventory_revision IS NULL OR
  NEW.https_probe_generation IS NOT NEW.route_config_generation OR
  NEW.https_probe_inventory_revision IS NOT NEW.route_inventory_revision OR
  NEW.https_probe_peer_ip IS NULL OR NEW.https_probe_peer_ips_json IS NULL OR
  json_type(NEW.https_probe_peer_ips_json) <> 'array' OR json_array_length(NEW.https_probe_peer_ips_json) < 1 OR
  NEW.https_probe_http_status IS NULL OR NEW.https_probe_http_status NOT BETWEEN 200 AND 299
)
BEGIN
  SELECT RAISE(ABORT, 'domain_https_active_requires_production_probe_evidence');
END;
CREATE TRIGGER domain_binding_active_requires_https_update
BEFORE UPDATE OF route_status, dns_status, certificate_status, https_probe_status,
  desired_generation, observed_generation, route_checked_at, certificate_checked_at,
  certificate_hostname, https_probe_checked_at, https_probe_hostname,
  route_environment, https_probe_environment, route_config_generation,
  route_inventory_revision, https_probe_generation, https_probe_inventory_revision,
  https_probe_peer_ip, https_probe_peer_ips_json, https_probe_http_status ON domain_binding
WHEN NEW.route_status = 'active' AND (
  NEW.dns_status <> 'propagated' OR NEW.certificate_status <> 'valid' OR
  NEW.certificate_hostname IS NOT NEW.hostname OR NEW.https_probe_status <> 'passed' OR
  NEW.https_probe_hostname IS NOT NEW.hostname OR
  NEW.desired_generation <> NEW.observed_generation OR
  NEW.route_checked_at IS NULL OR NEW.certificate_checked_at IS NULL OR
  NEW.https_probe_checked_at IS NULL OR NEW.route_environment IS NOT 'production' OR
  NEW.https_probe_environment IS NOT 'production' OR NEW.route_config_generation IS NULL OR
  NEW.route_inventory_revision IS NULL OR
  NEW.https_probe_generation IS NOT NEW.route_config_generation OR
  NEW.https_probe_inventory_revision IS NOT NEW.route_inventory_revision OR
  NEW.https_probe_peer_ip IS NULL OR NEW.https_probe_peer_ips_json IS NULL OR
  json_type(NEW.https_probe_peer_ips_json) <> 'array' OR json_array_length(NEW.https_probe_peer_ips_json) < 1 OR
  NEW.https_probe_http_status IS NULL OR NEW.https_probe_http_status NOT BETWEEN 200 AND 299
)
BEGIN
  SELECT RAISE(ABORT, 'domain_https_active_requires_production_probe_evidence');
END;

CREATE TRIGGER domain_binding_active_requires_shared_ingress_insert
BEFORE INSERT ON domain_binding
WHEN NEW.route_status = 'active' AND NEW.mode <> 'shared_ingress'
BEGIN
  SELECT RAISE(ABORT, 'domain_https_active_requires_shared_ingress');
END;
CREATE TRIGGER domain_binding_active_requires_shared_ingress_update
BEFORE UPDATE OF route_status, mode ON domain_binding
WHEN NEW.route_status = 'active' AND NEW.mode <> 'shared_ingress'
BEGIN
  SELECT RAISE(ABORT, 'domain_https_active_requires_shared_ingress');
END;

-- Any route identity/ownership change invalidates the previous route, certificate,
-- and external probe evidence, including direct SQL writes.
CREATE TRIGGER domain_binding_invalidate_changed_route_identity
AFTER UPDATE OF app_id, hostname, mode, target, record_type, record_name,
  ownership_key, route_ownership_key ON domain_binding
WHEN OLD.app_id IS NOT NEW.app_id OR OLD.hostname IS NOT NEW.hostname OR
  OLD.mode IS NOT NEW.mode OR OLD.target IS NOT NEW.target OR
  OLD.record_type IS NOT NEW.record_type OR OLD.record_name IS NOT NEW.record_name OR
  OLD.ownership_key IS NOT NEW.ownership_key OR
  OLD.route_ownership_key IS NOT NEW.route_ownership_key
BEGIN
  UPDATE domain_binding
  SET route_status=CASE WHEN OLD.route_status='not_configured'
                        THEN 'not_configured' ELSE 'pending' END,
      desired_generation=desired_generation+1,
      observed_generation=0,
      certificate_status='not_requested',
      https_probe_status='not_run',
      ingress_reason_code=NULL,
      route_checked_at=NULL,
      certificate_checked_at=NULL,
      certificate_hostname=NULL,
      https_probe_checked_at=NULL,
      https_probe_hostname=NULL,
      route_config_generation=NULL,
      route_inventory_revision=NULL,
      route_environment=NULL,
      https_probe_peer_ip=NULL,
      https_probe_peer_ips_json=NULL,
      https_probe_http_status=NULL,
      https_probe_generation=NULL,
      https_probe_inventory_revision=NULL,
      https_probe_environment=NULL
  WHERE id=NEW.id;
END;

-- Last Caddy config generation/hash observed after a successful DB transaction.
-- No private key, certificate, token, or other secret is persisted here.
CREATE TABLE IF NOT EXISTS ingress_reconcile_observation (
  vps_id INTEGER PRIMARY KEY REFERENCES vps(id) ON DELETE CASCADE,
  inventory_revision TEXT NOT NULL CHECK (length(inventory_revision) = 64),
  environment TEXT NOT NULL CHECK (environment IN ('production', 'acme_staging')),
  generation TEXT NOT NULL CHECK (length(generation) = 64),
  config_sha256 TEXT NOT NULL CHECK (length(config_sha256) = 64),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- =============================================================================
-- SEED
-- =============================================================================
INSERT INTO schema_version (version) VALUES (1);

-- P3b Product-mode auto-deploy persistence (migration 016). Empty until explicit enrollment.
CREATE TABLE product_controller (
  controller_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','maintenance','revoked'))
);

CREATE TABLE product_source_config (
  app_id INTEGER NOT NULL REFERENCES app(id) ON DELETE RESTRICT,
  source_generation INTEGER NOT NULL CHECK (source_generation >= 1),
  repository_url TEXT NOT NULL,
  production_ref TEXT NOT NULL,
  repository_root TEXT NOT NULL,
  deploy_config_json TEXT NOT NULL, -- allowlisted non-secret build/deploy settings only
  config_sha256 TEXT NOT NULL CHECK (length(config_sha256) = 64),
  created_at TEXT NOT NULL,
  PRIMARY KEY (app_id, source_generation),
  UNIQUE (app_id, source_generation, config_sha256)
);

CREATE TABLE product_app_control (
  app_id INTEGER PRIMARY KEY REFERENCES app(id) ON DELETE RESTRICT,
  mode TEXT NOT NULL CHECK (mode IN ('desktop','product')),
  controller_id TEXT REFERENCES product_controller(controller_id) ON DELETE RESTRICT,
  ownership_generation INTEGER NOT NULL CHECK (ownership_generation >= 1),
  source_generation INTEGER NOT NULL CHECK (source_generation >= 1),
  source_config_sha256 TEXT NOT NULL CHECK (length(source_config_sha256) = 64),
  changed_at TEXT NOT NULL,
  CHECK ((mode = 'desktop' AND controller_id IS NULL) OR
         (mode = 'product' AND controller_id IS NOT NULL)),
  FOREIGN KEY (app_id, source_generation)
    REFERENCES product_source_config(app_id, source_generation) ON DELETE RESTRICT,
  FOREIGN KEY (app_id, source_generation, source_config_sha256)
    REFERENCES product_source_config(app_id, source_generation, config_sha256) ON DELETE RESTRICT
);

CREATE TABLE product_branch_observation (
  app_id INTEGER NOT NULL REFERENCES app(id) ON DELETE RESTRICT,
  source_generation INTEGER NOT NULL CHECK (source_generation >= 1),
  ref TEXT NOT NULL,
  observation_sequence INTEGER NOT NULL CHECK (observation_sequence >= 1),
  observed_sha TEXT NOT NULL CHECK (length(observed_sha) = 40 AND observed_sha NOT GLOB '*[^0-9a-f]*'),
  observed_at TEXT NOT NULL,
  PRIMARY KEY (app_id, source_generation, ref, observation_sequence),
  FOREIGN KEY (app_id, source_generation)
    REFERENCES product_source_config(app_id, source_generation) ON DELETE RESTRICT
);
CREATE INDEX idx_product_observation_tip
  ON product_branch_observation(app_id, source_generation, ref, observation_sequence DESC);

CREATE TABLE product_deploy_job (
  job_id TEXT PRIMARY KEY,
  controller_id TEXT NOT NULL REFERENCES product_controller(controller_id) ON DELETE RESTRICT,
  app_id INTEGER NOT NULL REFERENCES app(id) ON DELETE RESTRICT,
  ownership_generation INTEGER NOT NULL CHECK (ownership_generation >= 1),
  source_generation INTEGER NOT NULL CHECK (source_generation >= 1),
  source_config_sha256 TEXT NOT NULL CHECK (length(source_config_sha256) = 64),
  trigger TEXT NOT NULL CHECK (trigger IN ('branch_poll','manual_redeploy','manual_rollback')),
  idempotency_key TEXT NOT NULL,
  ref TEXT NOT NULL,
  target_sha TEXT CHECK (target_sha IS NULL OR
    (length(target_sha) = 40 AND target_sha NOT GLOB '*[^0-9a-f]*')),
  target_deployment_id INTEGER REFERENCES deployment(id) ON DELETE RESTRICT,
  observation_sequence INTEGER,
  reconcile_epoch INTEGER,
  state TEXT NOT NULL CHECK (state IN ('queued','claimed','deploying','retry_wait',
    'succeeded','failed','rolled_back','uncertain','superseded','cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 3),
  available_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT,
  supersedes_job_id TEXT REFERENCES product_deploy_job(job_id) ON DELETE RESTRICT,
  safe_error_code TEXT,
  CHECK (attempt_count <= max_attempts),
  CHECK (length(idempotency_key) > 0),
  UNIQUE (controller_id, app_id, idempotency_key),
  CHECK ((trigger = 'branch_poll' AND observation_sequence IS NOT NULL) OR
         (trigger <> 'branch_poll' AND observation_sequence IS NULL)),
  CHECK ((trigger = 'branch_poll' AND reconcile_epoch IS NOT NULL AND reconcile_epoch >= 0) OR
         (trigger <> 'branch_poll' AND reconcile_epoch IS NULL)),
  FOREIGN KEY (app_id, source_generation)
    REFERENCES product_source_config(app_id, source_generation) ON DELETE RESTRICT,
  FOREIGN KEY (app_id, source_generation, source_config_sha256)
    REFERENCES product_source_config(app_id, source_generation, config_sha256) ON DELETE RESTRICT,
  CHECK ((trigger IN ('branch_poll','manual_redeploy') AND target_sha IS NOT NULL AND
          target_deployment_id IS NULL) OR
         (trigger = 'manual_rollback' AND target_deployment_id IS NOT NULL))
);
CREATE INDEX idx_product_job_claim
  ON product_deploy_job(state, available_at, created_at);
CREATE INDEX idx_product_job_app_history
  ON product_deploy_job(controller_id, app_id, created_at DESC);
CREATE INDEX idx_product_job_target
  ON product_deploy_job(app_id, source_generation, target_sha);
-- Deliberately no UNIQUE(app_id, target_sha).

CREATE TABLE product_desired_branch (
  app_id INTEGER NOT NULL REFERENCES app(id) ON DELETE RESTRICT,
  source_generation INTEGER NOT NULL CHECK (source_generation >= 1),
  ref TEXT NOT NULL,
  desired_observation_sequence INTEGER NOT NULL CHECK (desired_observation_sequence >= 1),
  desired_sha TEXT NOT NULL CHECK (length(desired_sha) = 40 AND desired_sha NOT GLOB '*[^0-9a-f]*'),
  reconcile_epoch INTEGER NOT NULL DEFAULT 0 CHECK (reconcile_epoch >= 0),
  reconciled_observation_sequence INTEGER,
  reconciled_epoch INTEGER,
  reconciliation_state TEXT NOT NULL CHECK (reconciliation_state IN
    ('pending','queued','in_progress','satisfied','paused','failed','uncertain')),
  reconciliation_job_id TEXT REFERENCES product_deploy_job(job_id) ON DELETE RESTRICT,
  auto_paused INTEGER NOT NULL DEFAULT 0 CHECK (auto_paused IN (0,1)),
  pause_reason TEXT CHECK (pause_reason IS NULL OR pause_reason IN ('manual_action','operator')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (app_id, source_generation, ref),
  FOREIGN KEY (app_id, source_generation)
    REFERENCES product_source_config(app_id, source_generation) ON DELETE RESTRICT,
  CHECK ((auto_paused = 0 AND pause_reason IS NULL) OR
         (auto_paused = 1 AND pause_reason IS NOT NULL)),
  CHECK ((reconciled_observation_sequence IS NULL AND reconciled_epoch IS NULL) OR
         (reconciled_observation_sequence IS NOT NULL AND reconciled_epoch IS NOT NULL))
);
CREATE INDEX idx_product_desired_pending
  ON product_desired_branch(reconciliation_state, updated_at);

CREATE TABLE product_app_fence (
  app_id INTEGER PRIMARY KEY REFERENCES app(id) ON DELETE RESTRICT,
  last_fence INTEGER NOT NULL DEFAULT 0 CHECK (last_fence >= 0)
);
CREATE TABLE product_app_lease (
  app_id INTEGER NOT NULL REFERENCES app(id) ON DELETE RESTRICT,
  lease_id TEXT NOT NULL UNIQUE,
  controller_id TEXT NOT NULL REFERENCES product_controller(controller_id) ON DELETE RESTRICT,
  ownership_generation INTEGER NOT NULL CHECK (ownership_generation >= 1),
  fence INTEGER NOT NULL CHECK (fence >= 1),
  job_id TEXT NOT NULL REFERENCES product_deploy_job(job_id) ON DELETE RESTRICT,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  released_at TEXT,
  UNIQUE (app_id, fence),
  UNIQUE (lease_id, fence, job_id),
  FOREIGN KEY (app_id) REFERENCES product_app_fence(app_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX one_active_product_lease_per_app
  ON product_app_lease(app_id) WHERE released_at IS NULL;

CREATE TABLE product_worker_lease (
  slot_name TEXT NOT NULL CHECK (slot_name = 'build'),
  lease_id TEXT NOT NULL UNIQUE,
  controller_id TEXT NOT NULL REFERENCES product_controller(controller_id) ON DELETE RESTRICT,
  fence INTEGER NOT NULL CHECK (fence >= 1),
  job_id TEXT NOT NULL REFERENCES product_deploy_job(job_id) ON DELETE RESTRICT,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  released_at TEXT,
  PRIMARY KEY (slot_name, fence),
  UNIQUE (lease_id, fence, job_id)
);
CREATE UNIQUE INDEX one_active_product_build_slot
  ON product_worker_lease(slot_name) WHERE released_at IS NULL;

CREATE TABLE product_deploy_attempt (
  attempt_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES product_deploy_job(job_id) ON DELETE RESTRICT,
  attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
  lease_id TEXT NOT NULL,
  fencing_token INTEGER NOT NULL CHECK (fencing_token >= 1),
  build_slot_lease_id TEXT NOT NULL,
  build_slot_fence INTEGER NOT NULL CHECK (build_slot_fence >= 1),
  state TEXT NOT NULL CHECK (state IN ('claimed','snapshot_verified','deploying','succeeded',
    'failed','abandoned_before_write','rolled_back','uncertain')),
  deployment_id INTEGER UNIQUE REFERENCES deployment(id) ON DELETE RESTRICT,
  remote_outcome TEXT NOT NULL CHECK (remote_outcome IN ('not_started','applied','unknown')),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  failed_step TEXT,
  safe_error_code TEXT,
  UNIQUE (job_id, attempt_number),
  FOREIGN KEY (lease_id, fencing_token, job_id)
    REFERENCES product_app_lease(lease_id, fence, job_id) ON DELETE RESTRICT,
  FOREIGN KEY (build_slot_lease_id, build_slot_fence, job_id)
    REFERENCES product_worker_lease(lease_id, fence, job_id) ON DELETE RESTRICT
);
CREATE INDEX idx_product_attempt_job ON product_deploy_attempt(job_id, attempt_number);
CREATE INDEX idx_product_attempt_deployment ON product_deploy_attempt(deployment_id);

CREATE TABLE product_history_event (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  controller_id TEXT NOT NULL REFERENCES product_controller(controller_id) ON DELETE RESTRICT,
  app_id INTEGER NOT NULL REFERENCES app(id) ON DELETE RESTRICT,
  job_id TEXT REFERENCES product_deploy_job(job_id) ON DELETE RESTRICT,
  attempt_id TEXT REFERENCES product_deploy_attempt(attempt_id) ON DELETE RESTRICT,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL,
  safe_summary_json TEXT NOT NULL
);
CREATE INDEX idx_product_history_app_cursor
  ON product_history_event(controller_id, app_id, event_id);
