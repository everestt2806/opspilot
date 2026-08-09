-- =============================================================================
-- SCHEMA SQLITE — NGUỒN SỰ THẬT DUY NHẤT
-- File đích khi code: app/src/main/db/migrations/001_init.sql (copy y nguyên)
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

  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at      TEXT
);

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

  source_path       TEXT,                      -- đường dẫn local hoặc git URL
  host_port         INTEGER NOT NULL,          -- cấp trong dải 30000-30999, ADR-006
  container_port    INTEGER NOT NULL,
  healthcheck_path  TEXT    NOT NULL DEFAULT '/',
  needs_db          INTEGER NOT NULL DEFAULT 0 CHECK (needs_db IN (0,1)),

  -- Vị trí đọc tiếp trong metrics.jsonl (byte offset, 1-based cho `tail -c +N`)
  metrics_offset    INTEGER NOT NULL DEFAULT 1,

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

  status            TEXT    NOT NULL CHECK (status IN
                      ('building','deploying','running','failed','rolled_back','stopped')),
  failed_step       TEXT    CHECK (failed_step IN
                      ('PRECHECK','UPLOAD','RENDER','BUILD','DEPLOY','HEALTHCHECK','RECORD')),

  env_json          TEXT,                      -- CHỈ env không nhạy cảm; secret nằm ở .env trên VPS
  detector_json     TEXT,                      -- BuildPlan mà detector đã sinh ra, để tra cứu lại

  build_duration_ms INTEGER,
  total_duration_ms INTEGER,                   -- bằng chứng cho NFR-4 (<3 phút)
  is_rollback_of    INTEGER REFERENCES deployment(id),  -- nếu đây là rollback về bản cũ

  started_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  finished_at       TEXT,

  UNIQUE (app_id, version)
);
CREATE INDEX idx_deployment_app_started ON deployment(app_id, started_at DESC);

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

  -- GHI CHÚ RÀ SOÁT 2026-07-28 — đề xuất, chưa áp dụng:
  -- Protocol cho phép retry tối đa 2 lần nhưng unique hiện tại không lưu được từng attempt.
  -- Phương án đề xuất: thêm attempt_index INTEGER NOT NULL DEFAULT 1 và đổi unique thành
  -- UNIQUE (scenario, repeat_index, attempt_index). Giữ nguyên schema v1 cho tới khi chốt.
  UNIQUE (scenario, repeat_index)
);

-- =============================================================================
-- SEED
-- =============================================================================
INSERT INTO schema_version (version) VALUES (1);
