-- Nhật ký ý định Desktop; không FK tới binding/VPS để giữ tombstone khi xóa profile.
CREATE TABLE desktop_controller_command (
  request_key TEXT PRIMARY KEY NOT NULL,
  binding_id TEXT NOT NULL,
  controller_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  binding_revision INTEGER NOT NULL CHECK (binding_revision>=1),
  app_id INTEGER NOT NULL CHECK (app_id>=1),
  operation TEXT NOT NULL CHECK (operation IN ('redeploy','policy')),
  body_json TEXT NOT NULL CHECK (length(body_json) BETWEEN 1 AND 2048),
  body_sha256 TEXT NOT NULL CHECK (length(body_sha256)=64),
  state TEXT NOT NULL CHECK (state IN ('prepared','in_flight','outcome_unknown','accepted','rejected','cancelled')),
  reason_code TEXT,
  remote_state TEXT CHECK (remote_state IN ('accepted','completed','blocked','uncertain')),
  job_id TEXT,
  target_sha TEXT CHECK (target_sha IS NULL OR length(target_sha)=40),
  auto_deploy_paused INTEGER CHECK (auto_deploy_paused IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_desktop_command_pending ON desktop_controller_command(controller_id,app_id)
  WHERE state IN ('prepared','in_flight','outcome_unknown');
CREATE INDEX idx_desktop_command_binding ON desktop_controller_command(binding_id,created_at,request_key);
CREATE TRIGGER desktop_command_immutable BEFORE UPDATE ON desktop_controller_command
WHEN NEW.request_key IS NOT OLD.request_key OR NEW.binding_id IS NOT OLD.binding_id
  OR NEW.controller_id IS NOT OLD.controller_id OR NEW.client_id IS NOT OLD.client_id
  OR NEW.binding_revision IS NOT OLD.binding_revision OR NEW.app_id IS NOT OLD.app_id
  OR NEW.operation IS NOT OLD.operation OR NEW.body_json IS NOT OLD.body_json
  OR NEW.body_sha256 IS NOT OLD.body_sha256 OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'DESKTOP_COMMAND_IMMUTABLE'); END;
CREATE TRIGGER desktop_command_transition BEFORE UPDATE OF state ON desktop_controller_command
WHEN NOT (NEW.state=OLD.state
  OR (OLD.state='prepared' AND NEW.state IN ('in_flight','cancelled'))
  OR (OLD.state='in_flight' AND NEW.state IN ('outcome_unknown','accepted','rejected'))
  OR (OLD.state='outcome_unknown' AND NEW.state='accepted'))
BEGIN SELECT RAISE(ABORT,'DESKTOP_COMMAND_TRANSITION_INVALID'); END;
