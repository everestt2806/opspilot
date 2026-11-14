-- Desktop-only: exact request replay, no environment values in this journal.
CREATE TABLE desktop_environment_selection (
  request_key TEXT PRIMARY KEY NOT NULL CHECK(length(request_key)=36),
  project_request_key TEXT NOT NULL REFERENCES desktop_project_setup(request_key) ON DELETE RESTRICT,
  binding_id TEXT NOT NULL,
  binding_revision INTEGER NOT NULL CHECK(binding_revision>=1),
  controller_id TEXT NOT NULL,
  app_id INTEGER NOT NULL CHECK(app_id>=1),
  context_json TEXT NOT NULL CHECK(json_valid(context_json) AND length(context_json)<=32768),
  crypto_scheme TEXT NOT NULL CHECK(crypto_scheme='aes_256_gcm'),
  encrypted_secret BLOB NOT NULL CHECK(typeof(encrypted_secret)='blob' AND length(encrypted_secret) BETWEEN 1 AND 65536),
  iv BLOB NOT NULL CHECK(typeof(iv)='blob' AND length(iv)=12),
  auth_tag BLOB NOT NULL CHECK(typeof(auth_tag)='blob' AND length(auth_tag)=16),
  state TEXT NOT NULL CHECK(state IN ('prepared','in_flight','outcome_unknown','selected','not_applied','cancelled')),
  result_json TEXT CHECK(result_json IS NULL OR (json_valid(result_json) AND length(result_json)<=32768)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((state='selected' AND result_json IS NOT NULL) OR (state<>'selected' AND result_json IS NULL))
);
CREATE UNIQUE INDEX idx_desktop_environment_selection_pending ON desktop_environment_selection(controller_id,app_id)
  WHERE state IN ('prepared','in_flight','outcome_unknown');
CREATE TRIGGER desktop_environment_selection_immutable BEFORE UPDATE ON desktop_environment_selection
WHEN NEW.request_key IS NOT OLD.request_key OR NEW.project_request_key IS NOT OLD.project_request_key
  OR NEW.binding_id IS NOT OLD.binding_id OR NEW.binding_revision IS NOT OLD.binding_revision
  OR NEW.controller_id IS NOT OLD.controller_id OR NEW.app_id IS NOT OLD.app_id
  OR NEW.context_json IS NOT OLD.context_json OR NEW.crypto_scheme IS NOT OLD.crypto_scheme
  OR NEW.encrypted_secret IS NOT OLD.encrypted_secret OR NEW.iv IS NOT OLD.iv OR NEW.auth_tag IS NOT OLD.auth_tag
  OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'DESKTOP_ENVIRONMENT_SELECTION_IMMUTABLE'); END;
CREATE TRIGGER desktop_environment_selection_transition BEFORE UPDATE ON desktop_environment_selection
WHEN NOT (NEW.state=OLD.state OR (OLD.state='prepared' AND NEW.state IN ('in_flight','not_applied','cancelled'))
  OR (OLD.state='in_flight' AND NEW.state IN ('outcome_unknown','selected','not_applied'))
  OR (OLD.state='outcome_unknown' AND NEW.state IN ('in_flight','selected','not_applied')))
BEGIN SELECT RAISE(ABORT,'DESKTOP_ENVIRONMENT_SELECTION_TRANSITION_INVALID'); END;
