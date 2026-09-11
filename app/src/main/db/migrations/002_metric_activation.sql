-- C02: persistent runtime episodes for byte-accurate metric routing.
ALTER TABLE app ADD COLUMN metrics_stream_generation TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE app ADD COLUMN metrics_stream_device INTEGER;
ALTER TABLE app ADD COLUMN metrics_stream_inode INTEGER;

CREATE TABLE deployment_activation (
  id              INTEGER PRIMARY KEY,
  app_id          INTEGER NOT NULL REFERENCES app(id) ON DELETE CASCADE,
  deployment_id   INTEGER NOT NULL REFERENCES deployment(id) ON DELETE CASCADE,
  stream_generation TEXT NOT NULL,
  start_offset    INTEGER NOT NULL CHECK (start_offset >= 1),
  end_offset      INTEGER CHECK (end_offset IS NULL OR end_offset >= start_offset),
  reason          TEXT NOT NULL CHECK (reason IN ('deploy','manual_rollback','auto_rollback','rotation','legacy')),
  state           TEXT NOT NULL CHECK (state IN ('prepared','active','closed','aborted')),
  prepared_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  activated_at    TEXT,
  closed_at       TEXT
);
CREATE INDEX idx_activation_app_range
  ON deployment_activation(app_id, stream_generation, start_offset, end_offset);
CREATE INDEX idx_activation_deployment ON deployment_activation(deployment_id, id);
CREATE UNIQUE INDEX one_prepared_activation
  ON deployment_activation(app_id) WHERE state='prepared';
CREATE UNIQUE INDEX one_active_activation
  ON deployment_activation(app_id) WHERE state='active';
