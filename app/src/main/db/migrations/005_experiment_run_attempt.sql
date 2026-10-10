-- Migration 005: Thêm attempt_index (1..3) và đổi UNIQUE(scenario, repeat_index, attempt_index)
CREATE TABLE new_experiment_run (
  id                INTEGER PRIMARY KEY,
  scenario          TEXT    NOT NULL CHECK (scenario IN
                     ('memory_leak','cpu_spike','error_burst','slow_db','latency_creep')),
  repeat_index      INTEGER NOT NULL,          -- 1..10
  attempt_index     INTEGER NOT NULL DEFAULT 1 CHECK (attempt_index BETWEEN 1 AND 3), -- 1..3
  deployment_id     INTEGER REFERENCES deployment(id) ON DELETE SET NULL,
  vps_id            INTEGER REFERENCES vps(id),

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

  UNIQUE (scenario, repeat_index, attempt_index)
);

INSERT INTO new_experiment_run (
  id, scenario, repeat_index, attempt_index,
  deployment_id, vps_id,
  baseline_start_ts, train_at_ts, fault_start_ts, fault_end_ts, run_end_ts,
  clock_offset_ms, detection_grace_s, train_sample_count,
  fault_params_json, status, abort_reason, notes
)
SELECT
  id, scenario, repeat_index, 1,
  deployment_id, vps_id,
  baseline_start_ts, train_at_ts, fault_start_ts, fault_end_ts, run_end_ts,
  clock_offset_ms, detection_grace_s, train_sample_count,
  fault_params_json, status, abort_reason, notes
FROM experiment_run;

DROP TABLE experiment_run;

ALTER TABLE new_experiment_run RENAME TO experiment_run;
