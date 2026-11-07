CREATE TABLE desktop_project_setup (
  request_key TEXT PRIMARY KEY NOT NULL,
  binding_id TEXT NOT NULL,
  binding_revision INTEGER NOT NULL CHECK (binding_revision>=1),
  controller_id TEXT NOT NULL,
  target_vps_id INTEGER NOT NULL CHECK (target_vps_id>=1),
  target_security_revision INTEGER NOT NULL CHECK (target_security_revision>=1),
  app_name TEXT NOT NULL,
  body_json TEXT NOT NULL CHECK(length(body_json) BETWEEN 1 AND 8192),
  body_sha256 TEXT NOT NULL CHECK(length(body_sha256)=64),
  state TEXT NOT NULL CHECK(state IN ('prepared','in_flight','outcome_unknown','registered','cancelled')),
  app_id INTEGER CHECK(app_id>=1),
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((state='registered' AND app_id IS NOT NULL AND result_json IS NOT NULL) OR
    (state<>'registered' AND app_id IS NULL AND result_json IS NULL))
);
CREATE UNIQUE INDEX idx_desktop_setup_name ON desktop_project_setup(controller_id,target_vps_id,app_name) WHERE state<>'cancelled';
CREATE INDEX idx_desktop_setup_binding ON desktop_project_setup(binding_id,created_at);
CREATE TRIGGER desktop_setup_immutable BEFORE UPDATE ON desktop_project_setup
WHEN NEW.request_key IS NOT OLD.request_key OR NEW.binding_id IS NOT OLD.binding_id
  OR NEW.binding_revision IS NOT OLD.binding_revision OR NEW.controller_id IS NOT OLD.controller_id
  OR NEW.target_vps_id IS NOT OLD.target_vps_id OR NEW.target_security_revision IS NOT OLD.target_security_revision
  OR NEW.app_name IS NOT OLD.app_name OR NEW.body_json IS NOT OLD.body_json
  OR NEW.body_sha256 IS NOT OLD.body_sha256 OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'DESKTOP_SETUP_IMMUTABLE'); END;
CREATE TRIGGER desktop_setup_transition BEFORE UPDATE OF state ON desktop_project_setup
WHEN NOT (NEW.state=OLD.state OR (OLD.state='prepared' AND NEW.state IN ('in_flight','cancelled'))
  OR (OLD.state='in_flight' AND NEW.state IN ('outcome_unknown','registered'))
  OR (OLD.state='outcome_unknown' AND NEW.state IN ('in_flight','registered')))
BEGIN SELECT RAISE(ABORT,'DESKTOP_SETUP_TRANSITION_INVALID'); END;
