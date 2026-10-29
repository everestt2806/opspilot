-- Split DNS state from shared-ingress route, certificate, and external probe state.
-- Keep legacy `status` and all existing binding fields intact for older readers.
ALTER TABLE domain_binding ADD COLUMN dns_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (dns_status IN ('pending','propagated','conflict','failed','disabled'));
ALTER TABLE domain_binding ADD COLUMN dns_evidence_json TEXT;
UPDATE domain_binding
SET dns_status = CASE status
  WHEN 'active' THEN 'propagated'
  WHEN 'pending' THEN 'pending'
  WHEN 'propagated' THEN 'propagated'
  WHEN 'conflict' THEN 'conflict'
  WHEN 'failed' THEN 'failed'
  WHEN 'disabled' THEN 'disabled'
  ELSE 'pending'
END;

ALTER TABLE domain_binding ADD COLUMN route_status TEXT NOT NULL DEFAULT 'not_configured'
  CHECK (route_status IN ('not_configured','pending','active','degraded','conflict','failed','disabled'));
ALTER TABLE domain_binding ADD COLUMN certificate_status TEXT NOT NULL DEFAULT 'not_requested'
  CHECK (certificate_status IN ('not_requested','pending','valid','failed','expired'));
ALTER TABLE domain_binding ADD COLUMN https_probe_status TEXT NOT NULL DEFAULT 'not_run'
  CHECK (https_probe_status IN ('not_run','passed','failed'));
ALTER TABLE domain_binding ADD COLUMN desired_generation INTEGER NOT NULL DEFAULT 1
  CHECK (desired_generation >= 1);
ALTER TABLE domain_binding ADD COLUMN observed_generation INTEGER NOT NULL DEFAULT 0
  CHECK (observed_generation >= 0);
ALTER TABLE domain_binding ADD COLUMN route_ownership_key TEXT NOT NULL DEFAULT '';
UPDATE domain_binding
SET route_ownership_key = 'opspilot-ingress:' || app_id || ':' || hostname;
ALTER TABLE domain_binding ADD COLUMN ingress_reason_code TEXT
  CHECK (ingress_reason_code IS NULL OR ingress_reason_code IN (
    'DNS_NOT_PROPAGATED','DNS_TARGET_MISMATCH','DNS_IPV6_UNREACHABLE',
    'INGRESS_PORT_CONFLICT','INGRESS_OWNER_UNKNOWN','FIREWALL_80_BLOCKED',
    'FIREWALL_443_BLOCKED','INGRESS_INSTALL_FAILED','INGRESS_CONFIG_INVALID',
    'INGRESS_RELOAD_FAILED','INGRESS_ROLLBACK_FAILED','CERTIFICATE_PENDING',
    'CERTIFICATE_ISSUE_FAILED','HTTPS_PROBE_FAILED','UPSTREAM_UNHEALTHY',
    'DOMAIN_OWNERSHIP_CONFLICT','SSH_UNAVAILABLE','CANCELLED'
  ));
ALTER TABLE domain_binding ADD COLUMN route_checked_at TEXT;
ALTER TABLE domain_binding ADD COLUMN certificate_checked_at TEXT;
ALTER TABLE domain_binding ADD COLUMN certificate_hostname TEXT;
ALTER TABLE domain_binding ADD COLUMN https_probe_checked_at TEXT;
ALTER TABLE domain_binding ADD COLUMN https_probe_hostname TEXT;

CREATE UNIQUE INDEX idx_domain_binding_route_ownership
  ON domain_binding(route_ownership_key) WHERE route_ownership_key <> '';
CREATE INDEX idx_domain_binding_app_dns_status
  ON domain_binding(app_id, dns_status);

CREATE TRIGGER domain_binding_active_requires_https_insert
BEFORE INSERT ON domain_binding
WHEN NEW.route_status = 'active' AND (
  NEW.dns_status <> 'propagated' OR
  NEW.certificate_status <> 'valid' OR
  NEW.certificate_hostname IS NOT NEW.hostname OR
  NEW.https_probe_status <> 'passed' OR
  NEW.https_probe_hostname IS NOT NEW.hostname OR
  NEW.desired_generation <> NEW.observed_generation OR
  NEW.route_checked_at IS NULL OR
  NEW.certificate_checked_at IS NULL OR
  NEW.https_probe_checked_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'domain_https_active_requires_verified_evidence');
END;

CREATE TRIGGER domain_binding_active_requires_https_update
BEFORE UPDATE OF route_status, dns_status, certificate_status, https_probe_status,
  desired_generation, observed_generation, route_checked_at, certificate_checked_at,
  certificate_hostname, https_probe_checked_at, https_probe_hostname ON domain_binding
WHEN NEW.route_status = 'active' AND (
  NEW.dns_status <> 'propagated' OR
  NEW.certificate_status <> 'valid' OR
  NEW.certificate_hostname IS NOT NEW.hostname OR
  NEW.https_probe_status <> 'passed' OR
  NEW.https_probe_hostname IS NOT NEW.hostname OR
  NEW.desired_generation <> NEW.observed_generation OR
  NEW.route_checked_at IS NULL OR
  NEW.certificate_checked_at IS NULL OR
  NEW.https_probe_checked_at IS NULL
)
BEGIN
  SELECT RAISE(ABORT, 'domain_https_active_requires_verified_evidence');
END;
