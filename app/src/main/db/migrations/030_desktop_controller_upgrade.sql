-- Chỉ Desktop: không chạy migration này trên controller.
CREATE TABLE desktop_controller_upgrade (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  request_key TEXT NOT NULL UNIQUE CHECK(length(request_key)=36),
  installation_request_key TEXT NOT NULL REFERENCES desktop_controller_installation(request_key),
  controller_id TEXT NOT NULL CHECK(length(controller_id)=36),
  vps_id INTEGER NOT NULL CHECK(vps_id>=1),
  authority_revision INTEGER NOT NULL CHECK(authority_revision>=1),
  installation_authority_json TEXT NOT NULL CHECK(length(installation_authority_json) BETWEEN 1 AND 4096),
  parent_upgrade_key TEXT,
  parent_release_sha256 TEXT NOT NULL CHECK(length(parent_release_sha256)=64),
  release_id TEXT NOT NULL CHECK(length(release_id) BETWEEN 1 AND 128),
  release_sha256 TEXT NOT NULL CHECK(length(release_sha256)=64),
  installer_sha256 TEXT NOT NULL CHECK(length(installer_sha256)=64),
  state TEXT NOT NULL CHECK(state IN ('prepared','transferred','in_flight','outcome_unknown','active','rolled_back','cancelled')),
  last_operation TEXT NOT NULL CHECK(last_operation IN ('none','transfer','upgrade','inspect','recover','rollback')),
  operation_id TEXT,
  owner_session TEXT,
  ever_dispatched INTEGER NOT NULL DEFAULT 0 CHECK(ever_dispatched IN (0,1)),
  upgrade_attempted INTEGER NOT NULL DEFAULT 0 CHECK(upgrade_attempted IN (0,1)),
  is_current INTEGER NOT NULL DEFAULT 0 CHECK(is_current IN (0,1)),
  result_json TEXT CHECK(result_json IS NULL OR length(result_json) BETWEEN 1 AND 4096),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(state<>'in_flight' OR (operation_id IS NOT NULL AND owner_session IS NOT NULL)),
  CHECK(state NOT IN ('active','rolled_back') OR result_json IS NOT NULL),
  CHECK(state<>'cancelled' OR (ever_dispatched=0 AND upgrade_attempted=0 AND is_current=0))
);
CREATE UNIQUE INDEX idx_desktop_upgrade_pending ON desktop_controller_upgrade(installation_request_key)
  WHERE state IN ('prepared','transferred','in_flight','outcome_unknown');
CREATE UNIQUE INDEX idx_desktop_upgrade_current ON desktop_controller_upgrade(installation_request_key)
  WHERE is_current=1;
CREATE TRIGGER desktop_controller_upgrade_immutable BEFORE UPDATE ON desktop_controller_upgrade
WHEN NEW.sequence IS NOT OLD.sequence OR NEW.request_key IS NOT OLD.request_key
  OR NEW.installation_request_key IS NOT OLD.installation_request_key OR NEW.controller_id IS NOT OLD.controller_id
  OR NEW.vps_id IS NOT OLD.vps_id OR NEW.authority_revision IS NOT OLD.authority_revision
  OR NEW.installation_authority_json IS NOT OLD.installation_authority_json
  OR NEW.parent_upgrade_key IS NOT OLD.parent_upgrade_key OR NEW.parent_release_sha256 IS NOT OLD.parent_release_sha256
  OR NEW.release_id IS NOT OLD.release_id OR NEW.release_sha256 IS NOT OLD.release_sha256
  OR NEW.installer_sha256 IS NOT OLD.installer_sha256 OR NEW.created_at IS NOT OLD.created_at
  OR NEW.ever_dispatched<OLD.ever_dispatched OR NEW.upgrade_attempted<OLD.upgrade_attempted
BEGIN SELECT RAISE(ABORT,'DESKTOP_UPGRADE_IMMUTABLE'); END;
