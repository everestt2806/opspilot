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
