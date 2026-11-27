CREATE TABLE product_vps_registration (
  controller_id TEXT NOT NULL,
  administrator_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  profile_json TEXT NOT NULL CHECK(length(profile_json) BETWEEN 1 AND 4096),
  profile_sha256 TEXT NOT NULL CHECK(length(profile_sha256)=64),
  vps_id INTEGER NOT NULL CHECK(vps_id>=1),
  ssh_security_revision INTEGER NOT NULL CHECK(ssh_security_revision>=1),
  result_json TEXT NOT NULL CHECK(length(result_json) BETWEEN 1 AND 4096),
  created_at TEXT NOT NULL,
  PRIMARY KEY(controller_id,administrator_id,request_key)
);
CREATE TRIGGER product_vps_registration_immutable BEFORE UPDATE ON product_vps_registration
BEGIN SELECT RAISE(ABORT,'PRODUCT_VPS_REGISTRATION_IMMUTABLE'); END;

CREATE TABLE desktop_target_setup (
  request_key TEXT PRIMARY KEY NOT NULL,
  binding_id TEXT NOT NULL,
  binding_revision INTEGER NOT NULL CHECK(binding_revision>=1),
  controller_id TEXT NOT NULL,
  local_vps_id INTEGER NOT NULL CHECK(local_vps_id>=1),
  local_security_revision INTEGER NOT NULL CHECK(local_security_revision>=1),
  profile_json TEXT NOT NULL CHECK(length(profile_json) BETWEEN 1 AND 4096),
  credential_digest TEXT NOT NULL CHECK(length(credential_digest)=64),
  state TEXT NOT NULL CHECK(state IN ('prepared','in_flight','outcome_unknown','registered','cancelled')),
  remote_vps_id INTEGER CHECK(remote_vps_id>=1),
  remote_security_revision INTEGER CHECK(remote_security_revision>=1),
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK((state='registered' AND remote_vps_id IS NOT NULL AND remote_security_revision IS NOT NULL AND result_json IS NOT NULL)
    OR (state<>'registered' AND remote_vps_id IS NULL AND remote_security_revision IS NULL AND result_json IS NULL))
);
CREATE UNIQUE INDEX idx_desktop_target_pending ON desktop_target_setup(controller_id,local_vps_id)
  WHERE state IN ('prepared','in_flight','outcome_unknown');
CREATE INDEX idx_desktop_target_binding ON desktop_target_setup(binding_id,created_at);
CREATE TRIGGER desktop_target_setup_immutable BEFORE UPDATE ON desktop_target_setup
WHEN NEW.request_key IS NOT OLD.request_key OR NEW.binding_id IS NOT OLD.binding_id
  OR NEW.binding_revision IS NOT OLD.binding_revision OR NEW.controller_id IS NOT OLD.controller_id
  OR NEW.local_vps_id IS NOT OLD.local_vps_id OR NEW.local_security_revision IS NOT OLD.local_security_revision
  OR NEW.profile_json IS NOT OLD.profile_json OR NEW.credential_digest IS NOT OLD.credential_digest
  OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'DESKTOP_TARGET_SETUP_IMMUTABLE'); END;
CREATE TRIGGER desktop_target_setup_transition BEFORE UPDATE OF state ON desktop_target_setup
WHEN NOT (NEW.state=OLD.state OR (OLD.state='prepared' AND NEW.state IN ('in_flight','cancelled'))
  OR (OLD.state='in_flight' AND NEW.state IN ('outcome_unknown','registered'))
  OR (OLD.state='outcome_unknown' AND NEW.state IN ('in_flight','registered')))
BEGIN SELECT RAISE(ABORT,'DESKTOP_TARGET_SETUP_TRANSITION_INVALID'); END;
