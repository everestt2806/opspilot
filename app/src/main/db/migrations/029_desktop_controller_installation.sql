-- Local coordination only. Retain the remote request identity after deleting a VPS.
CREATE TABLE desktop_controller_installation (
  request_key TEXT PRIMARY KEY NOT NULL CHECK(length(request_key)=36),
  vps_id INTEGER NOT NULL CHECK(vps_id>=1),
  authority_revision INTEGER NOT NULL CHECK(authority_revision>=1),
  ssh_security_revision INTEGER NOT NULL CHECK(ssh_security_revision>=1),
  principal_json TEXT NOT NULL CHECK(length(principal_json) BETWEEN 1 AND 2048),
  identity_key TEXT NOT NULL CHECK(length(identity_key)=64),
  credential_digest TEXT NOT NULL CHECK(length(credential_digest)=64),
  release_id TEXT NOT NULL CHECK(length(release_id) BETWEEN 1 AND 128),
  release_sha256 TEXT NOT NULL CHECK(length(release_sha256)=64),
  installer_sha256 TEXT NOT NULL CHECK(length(installer_sha256)=64),
  state TEXT NOT NULL CHECK(state IN ('prepared','in_flight','outcome_unknown','transferred','installed','cancelled')),
  last_operation TEXT NOT NULL CHECK(last_operation IN ('none','transfer','install','recover','inspect')),
  operation_id TEXT,
  owner_session TEXT,
  ever_dispatched INTEGER NOT NULL DEFAULT 0 CHECK(ever_dispatched IN (0,1)),
  install_attempted INTEGER NOT NULL DEFAULT 0 CHECK(install_attempted IN (0,1)),
  discovery_existing INTEGER NOT NULL CHECK(discovery_existing IN (0,1)),
  controller_id TEXT,
  result_json TEXT CHECK(result_json IS NULL OR length(result_json) BETWEEN 1 AND 4096),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(state<>'in_flight' OR (operation_id IS NOT NULL AND owner_session IS NOT NULL)),
  CHECK(state<>'installed' OR (controller_id IS NOT NULL AND result_json IS NOT NULL)),
  CHECK(state<>'cancelled' OR (ever_dispatched=0 AND discovery_existing=0))
);
CREATE UNIQUE INDEX idx_desktop_install_identity ON desktop_controller_installation(identity_key)
  WHERE state<>'cancelled';
CREATE INDEX idx_desktop_install_vps ON desktop_controller_installation(vps_id,created_at);
CREATE TRIGGER desktop_controller_installation_immutable BEFORE UPDATE ON desktop_controller_installation
WHEN NEW.request_key IS NOT OLD.request_key OR NEW.identity_key IS NOT OLD.identity_key
  OR NEW.release_id IS NOT OLD.release_id OR NEW.release_sha256 IS NOT OLD.release_sha256
  OR NEW.installer_sha256 IS NOT OLD.installer_sha256 OR NEW.discovery_existing IS NOT OLD.discovery_existing
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.ever_dispatched<OLD.ever_dispatched OR NEW.install_attempted<OLD.install_attempted
  OR (OLD.controller_id IS NOT NULL AND NEW.controller_id IS NOT OLD.controller_id)
BEGIN SELECT RAISE(ABORT,'DESKTOP_INSTALL_IMMUTABLE'); END;
CREATE TRIGGER desktop_controller_installation_authority BEFORE UPDATE ON desktop_controller_installation
WHEN NOT (NEW.authority_revision=OLD.authority_revision
    AND NEW.vps_id=OLD.vps_id AND NEW.ssh_security_revision=OLD.ssh_security_revision
    AND NEW.principal_json=OLD.principal_json AND NEW.credential_digest=OLD.credential_digest)
  AND NOT (NEW.authority_revision=OLD.authority_revision+1 AND NEW.state='outcome_unknown'
    AND NEW.operation_id IS NULL AND NEW.owner_session IS NULL AND OLD.state<>'cancelled')
BEGIN SELECT RAISE(ABORT,'DESKTOP_INSTALL_AUTHORITY_INVALID'); END;
CREATE TRIGGER desktop_controller_installation_transition BEFORE UPDATE OF state ON desktop_controller_installation
WHEN NOT (NEW.state=OLD.state
  OR (OLD.state='prepared' AND NEW.state IN ('in_flight','cancelled','outcome_unknown'))
  OR (OLD.state='transferred' AND NEW.state IN ('in_flight','outcome_unknown'))
  OR (OLD.state='installed' AND NEW.state IN ('in_flight','outcome_unknown'))
  OR (OLD.state='outcome_unknown' AND NEW.state='in_flight')
  OR (OLD.state='in_flight' AND NEW.state IN ('outcome_unknown','transferred','installed')))
BEGIN SELECT RAISE(ABORT,'DESKTOP_INSTALL_TRANSITION_INVALID'); END;
