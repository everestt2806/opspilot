-- Invalidate stale route/certificate/probe evidence whenever route identity or
-- ownership changes, including writes made outside DomainRepository.
CREATE TRIGGER domain_binding_active_requires_shared_ingress_insert
BEFORE INSERT ON domain_binding
WHEN NEW.route_status = 'active' AND NEW.mode <> 'shared_ingress'
BEGIN
  SELECT RAISE(ABORT, 'domain_https_active_requires_shared_ingress');
END;

CREATE TRIGGER domain_binding_active_requires_shared_ingress_update
BEFORE UPDATE OF route_status, mode ON domain_binding
WHEN NEW.route_status = 'active' AND NEW.mode <> 'shared_ingress'
BEGIN
  SELECT RAISE(ABORT, 'domain_https_active_requires_shared_ingress');
END;

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
  SET route_status=CASE WHEN OLD.route_status='not_configured'
                        THEN 'not_configured' ELSE 'pending' END,
      desired_generation=desired_generation+1,
      observed_generation=0,
      certificate_status='not_requested',
      https_probe_status='not_run',
      ingress_reason_code=NULL,
      route_checked_at=NULL,
      certificate_checked_at=NULL,
      certificate_hostname=NULL,
      https_probe_checked_at=NULL,
      https_probe_hostname=NULL
  WHERE id=NEW.id;
END;
