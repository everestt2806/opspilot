-- Chỉ Desktop: quyền SSH đổi qua review/consent, không sửa core intent của upgrade.
CREATE TABLE desktop_controller_authority_rebind (
  request_key TEXT PRIMARY KEY NOT NULL CHECK(length(request_key)=36),
  installation_request_key TEXT NOT NULL REFERENCES desktop_controller_installation(request_key),
  upgrade_request_key TEXT NOT NULL REFERENCES desktop_controller_upgrade(request_key),
  from_revision INTEGER NOT NULL CHECK(from_revision>=1),
  to_revision INTEGER NOT NULL CHECK(to_revision=from_revision+1),
  previous_authority_json TEXT NOT NULL CHECK(json_valid(previous_authority_json) AND length(previous_authority_json) BETWEEN 1 AND 4096),
  next_authority_json TEXT NOT NULL CHECK(json_valid(next_authority_json) AND length(next_authority_json) BETWEEN 1 AND 4096),
  result_json TEXT NOT NULL CHECK(json_valid(result_json) AND length(result_json) BETWEEN 1 AND 4096),
  created_at TEXT NOT NULL,
  UNIQUE(installation_request_key,to_revision)
);
CREATE TRIGGER desktop_authority_rebind_insert BEFORE INSERT ON desktop_controller_authority_rebind
WHEN NOT EXISTS (
  SELECT 1 FROM desktop_controller_installation i
  JOIN desktop_controller_upgrade u ON u.installation_request_key=i.request_key
  JOIN vps v ON v.id=json_extract(NEW.next_authority_json,'$.vps_id')
  WHERE i.request_key=NEW.installation_request_key AND u.request_key=NEW.upgrade_request_key
    AND i.state='installed' AND u.state NOT IN ('cancelled','in_flight') AND v.archived_at IS NULL
    AND i.authority_revision=NEW.from_revision
    AND json_extract(NEW.previous_authority_json,'$.authority_revision') IS NEW.from_revision
    AND json_extract(NEW.next_authority_json,'$.authority_revision') IS NEW.to_revision
    AND json_extract(NEW.previous_authority_json,'$.installation_request_key') IS i.request_key
    AND json_extract(NEW.previous_authority_json,'$.controller_id') IS i.controller_id
    AND json_extract(NEW.previous_authority_json,'$.vps_id') IS i.vps_id
    AND json_extract(NEW.previous_authority_json,'$.principal') IS i.principal_json
    AND json_extract(NEW.previous_authority_json,'$.credential_digest') IS i.credential_digest
    AND json_extract(NEW.previous_authority_json,'$.ssh_security_revision') IS i.ssh_security_revision
    AND u.installation_authority_json IS NEW.previous_authority_json
    AND json_remove(NEW.previous_authority_json,'$.vps_id','$.authority_revision','$.principal','$.credential_digest','$.ssh_security_revision')
      IS json_remove(NEW.next_authority_json,'$.vps_id','$.authority_revision','$.principal','$.credential_digest','$.ssh_security_revision')
    AND lower(json_extract(NEW.next_authority_json,'$.principal.host')) IS lower(v.host)
    AND json_extract(NEW.next_authority_json,'$.principal.vpsId') IS v.id
    AND json_extract(NEW.next_authority_json,'$.principal.port') IS v.port
    AND json_extract(NEW.next_authority_json,'$.principal.hostFingerprint') IS v.host_fingerprint
    AND json_extract(NEW.next_authority_json,'$.principal.username') IS v.username
    AND json_extract(NEW.next_authority_json,'$.principal.authType') IS v.auth_type
    AND json_extract(NEW.next_authority_json,'$.ssh_security_revision') IS v.ssh_security_revision
    AND lower(json_extract(NEW.previous_authority_json,'$.principal.host')) IS lower(v.host)
    AND json_extract(NEW.previous_authority_json,'$.principal.port') IS v.port
    AND json_extract(NEW.previous_authority_json,'$.principal.hostFingerprint') IS v.host_fingerprint
    AND json_extract(NEW.previous_authority_json,'$.principal.username') IS v.username
    AND json_extract(NEW.result_json,'$.request_key') IS u.request_key
    AND json_extract(NEW.result_json,'$.installation_request_key') IS i.request_key
    AND json_extract(NEW.result_json,'$.controller_id') IS i.controller_id
    AND json_extract(NEW.result_json,'$.release_sha256') IS u.release_sha256
    AND json_extract(NEW.result_json,'$.parent_release_sha256') IS u.parent_release_sha256
    AND json_extract(NEW.result_json,'$.parent_upgrade_key') IS u.parent_upgrade_key
    AND json_extract(NEW.result_json,'$.is_current') IS 1
)
BEGIN SELECT RAISE(ABORT,'DESKTOP_AUTHORITY_REBIND_INVALID'); END;
CREATE TRIGGER desktop_authority_rebind_immutable BEFORE UPDATE ON desktop_controller_authority_rebind
BEGIN SELECT RAISE(ABORT,'DESKTOP_AUTHORITY_REBIND_IMMUTABLE'); END;
CREATE TRIGGER desktop_authority_rebind_retain BEFORE DELETE ON desktop_controller_authority_rebind
BEGIN SELECT RAISE(ABORT,'DESKTOP_AUTHORITY_REBIND_IMMUTABLE'); END;

DROP TRIGGER desktop_controller_installation_authority;
CREATE TRIGGER desktop_controller_installation_authority BEFORE UPDATE ON desktop_controller_installation
WHEN NOT (NEW.authority_revision=OLD.authority_revision
    AND NEW.vps_id=OLD.vps_id AND NEW.ssh_security_revision=OLD.ssh_security_revision
    AND NEW.principal_json=OLD.principal_json AND NEW.credential_digest=OLD.credential_digest)
  AND NOT (NEW.authority_revision=OLD.authority_revision+1 AND NEW.state='outcome_unknown'
    AND NEW.operation_id IS NULL AND NEW.owner_session IS NULL AND OLD.state<>'cancelled'
    AND NOT EXISTS (SELECT 1 FROM desktop_controller_upgrade u WHERE u.installation_request_key=OLD.request_key
      AND u.state<>'cancelled' AND (u.upgrade_attempted=1 OR u.is_current=1)))
  AND NOT (OLD.state='installed' AND NEW.state='installed' AND NEW.operation_id IS NULL AND NEW.owner_session IS NULL
    AND EXISTS (SELECT 1 FROM desktop_controller_authority_rebind a
      WHERE a.installation_request_key=OLD.request_key AND a.from_revision=OLD.authority_revision
        AND a.to_revision=NEW.authority_revision
        AND json_extract(a.next_authority_json,'$.vps_id') IS NEW.vps_id
        AND json_extract(a.next_authority_json,'$.principal') IS NEW.principal_json
        AND json_extract(a.next_authority_json,'$.ssh_security_revision') IS NEW.ssh_security_revision
        AND json_extract(a.next_authority_json,'$.credential_digest') IS NEW.credential_digest))
BEGIN SELECT RAISE(ABORT,'DESKTOP_INSTALL_AUTHORITY_INVALID'); END;

DROP TRIGGER desktop_controller_upgrade_immutable;
CREATE TRIGGER desktop_controller_upgrade_immutable BEFORE UPDATE ON desktop_controller_upgrade
WHEN NEW.sequence IS NOT OLD.sequence OR NEW.request_key IS NOT OLD.request_key
  OR NEW.installation_request_key IS NOT OLD.installation_request_key OR NEW.controller_id IS NOT OLD.controller_id
  OR NEW.parent_upgrade_key IS NOT OLD.parent_upgrade_key OR NEW.parent_release_sha256 IS NOT OLD.parent_release_sha256
  OR NEW.release_id IS NOT OLD.release_id OR NEW.release_sha256 IS NOT OLD.release_sha256
  OR NEW.installer_sha256 IS NOT OLD.installer_sha256 OR NEW.created_at IS NOT OLD.created_at
  OR NEW.ever_dispatched<OLD.ever_dispatched OR NEW.upgrade_attempted<OLD.upgrade_attempted
  OR ((NEW.vps_id IS NOT OLD.vps_id OR NEW.authority_revision IS NOT OLD.authority_revision
    OR NEW.installation_authority_json IS NOT OLD.installation_authority_json)
    AND NOT EXISTS (SELECT 1 FROM desktop_controller_authority_rebind a
      WHERE a.installation_request_key=OLD.installation_request_key AND a.from_revision=OLD.authority_revision
        AND a.to_revision=NEW.authority_revision AND a.previous_authority_json IS OLD.installation_authority_json
        AND a.next_authority_json IS NEW.installation_authority_json
        AND json_extract(a.next_authority_json,'$.vps_id') IS NEW.vps_id))
BEGIN SELECT RAISE(ABORT,'DESKTOP_UPGRADE_IMMUTABLE'); END;
