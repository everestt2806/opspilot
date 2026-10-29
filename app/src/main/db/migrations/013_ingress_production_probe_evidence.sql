ALTER TABLE domain_binding ADD COLUMN route_config_generation TEXT;
ALTER TABLE domain_binding ADD COLUMN route_inventory_revision TEXT;
ALTER TABLE domain_binding ADD COLUMN route_environment TEXT
  CHECK (route_environment IS NULL OR route_environment IN ('production','acme_staging'));
ALTER TABLE domain_binding ADD COLUMN https_probe_peer_ip TEXT;
ALTER TABLE domain_binding ADD COLUMN https_probe_http_status INTEGER
  CHECK (https_probe_http_status IS NULL OR https_probe_http_status BETWEEN 100 AND 599);
ALTER TABLE domain_binding ADD COLUMN https_probe_generation TEXT;
ALTER TABLE domain_binding ADD COLUMN https_probe_inventory_revision TEXT;
ALTER TABLE domain_binding ADD COLUMN https_probe_environment TEXT
  CHECK (https_probe_environment IS NULL OR https_probe_environment IN ('production','acme_staging'));

-- Earlier active rows do not carry production TLS/peer/generation proof, so they must be re-probed.
UPDATE domain_binding
SET route_status='pending', certificate_status='not_requested', https_probe_status='not_run',
    observed_generation=0, route_checked_at=NULL, certificate_checked_at=NULL,
    certificate_hostname=NULL, https_probe_checked_at=NULL, https_probe_hostname=NULL
WHERE route_status='active';

DROP TRIGGER IF EXISTS domain_binding_active_requires_https_insert;
DROP TRIGGER IF EXISTS domain_binding_active_requires_https_update;

CREATE TRIGGER domain_binding_active_requires_https_insert
BEFORE INSERT ON domain_binding
WHEN NEW.route_status = 'active' AND (
  NEW.dns_status <> 'propagated' OR NEW.certificate_status <> 'valid' OR
  NEW.certificate_hostname IS NOT NEW.hostname OR NEW.https_probe_status <> 'passed' OR
  NEW.https_probe_hostname IS NOT NEW.hostname OR
  NEW.desired_generation <> NEW.observed_generation OR
  NEW.route_checked_at IS NULL OR NEW.certificate_checked_at IS NULL OR
  NEW.https_probe_checked_at IS NULL OR NEW.route_environment IS NOT 'production' OR
  NEW.https_probe_environment IS NOT 'production' OR NEW.route_config_generation IS NULL OR
  NEW.route_inventory_revision IS NULL OR
  NEW.https_probe_generation IS NOT NEW.route_config_generation OR
  NEW.https_probe_inventory_revision IS NOT NEW.route_inventory_revision OR
  NEW.https_probe_peer_ip IS NULL OR NEW.https_probe_http_status IS NOT 200
)
BEGIN
  SELECT RAISE(ABORT, 'domain_https_active_requires_production_probe_evidence');
END;

CREATE TRIGGER domain_binding_active_requires_https_update
BEFORE UPDATE OF route_status, dns_status, certificate_status, https_probe_status,
  desired_generation, observed_generation, route_checked_at, certificate_checked_at,
  certificate_hostname, https_probe_checked_at, https_probe_hostname,
  route_environment, https_probe_environment, route_config_generation,
  route_inventory_revision, https_probe_generation, https_probe_inventory_revision,
  https_probe_peer_ip, https_probe_http_status ON domain_binding
WHEN NEW.route_status = 'active' AND (
  NEW.dns_status <> 'propagated' OR NEW.certificate_status <> 'valid' OR
  NEW.certificate_hostname IS NOT NEW.hostname OR NEW.https_probe_status <> 'passed' OR
  NEW.https_probe_hostname IS NOT NEW.hostname OR
  NEW.desired_generation <> NEW.observed_generation OR
  NEW.route_checked_at IS NULL OR NEW.certificate_checked_at IS NULL OR
  NEW.https_probe_checked_at IS NULL OR NEW.route_environment IS NOT 'production' OR
  NEW.https_probe_environment IS NOT 'production' OR NEW.route_config_generation IS NULL OR
  NEW.route_inventory_revision IS NULL OR
  NEW.https_probe_generation IS NOT NEW.route_config_generation OR
  NEW.https_probe_inventory_revision IS NOT NEW.route_inventory_revision OR
  NEW.https_probe_peer_ip IS NULL OR NEW.https_probe_http_status IS NOT 200
)
BEGIN
  SELECT RAISE(ABORT, 'domain_https_active_requires_production_probe_evidence');
END;

DROP TRIGGER IF EXISTS domain_binding_invalidate_changed_route_identity;
CREATE TRIGGER domain_binding_invalidate_changed_route_identity
AFTER UPDATE OF app_id, hostname, mode, target, record_type, record_name,
  ownership_key, route_ownership_key ON domain_binding
WHEN OLD.app_id IS NOT NEW.app_id OR OLD.hostname IS NOT NEW.hostname OR
  OLD.mode IS NOT NEW.mode OR OLD.target IS NOT NEW.target OR
  OLD.record_type IS NOT NEW.record_type OR OLD.record_name IS NOT NEW.record_name OR
  OLD.ownership_key IS NOT NEW.ownership_key OR
  OLD.route_ownership_key IS NOT NEW.route_ownership_key
BEGIN
  UPDATE domain_binding
  SET route_status=CASE WHEN OLD.route_status='not_configured' THEN 'not_configured' ELSE 'pending' END,
      desired_generation=desired_generation+1, observed_generation=0,
      certificate_status='not_requested', https_probe_status='not_run',
      ingress_reason_code=NULL, route_checked_at=NULL, certificate_checked_at=NULL,
      certificate_hostname=NULL, https_probe_checked_at=NULL, https_probe_hostname=NULL,
      route_config_generation=NULL, route_inventory_revision=NULL, route_environment=NULL,
      https_probe_peer_ip=NULL, https_probe_http_status=NULL, https_probe_generation=NULL,
      https_probe_inventory_revision=NULL, https_probe_environment=NULL
  WHERE id=NEW.id;
END;
