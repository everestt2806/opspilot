-- Publish/exposure, Doctor và domain desired-state.
ALTER TABLE deployment ADD COLUMN exposure_status TEXT NOT NULL DEFAULT 'not_checked'
  CHECK (exposure_status IN ('reachable','degraded','tunnel_only','not_checked'));
ALTER TABLE deployment ADD COLUMN exposure_evidence_json TEXT;

CREATE TABLE doctor_run (
  id INTEGER PRIMARY KEY,
  deployment_id INTEGER REFERENCES deployment(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL CHECK (trigger IN ('deploy','manual','monitor','domain')),
  evidence_json TEXT NOT NULL,
  diagnosis_code TEXT NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('high','medium','low')),
  selected_fix TEXT,
  outcome TEXT NOT NULL DEFAULT 'pending'
    CHECK (outcome IN ('pending','fixed','verified','failed','abstained')),
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  finished_at TEXT
);
CREATE INDEX idx_doctor_run_deployment ON doctor_run(deployment_id, started_at DESC);

CREATE TABLE doctor_action (
  id INTEGER PRIMARY KEY,
  doctor_run_id INTEGER NOT NULL REFERENCES doctor_run(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  precondition_json TEXT,
  result_json TEXT,
  verify_json TEXT,
  rollback_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('planned','running','success','failed','skipped')),
  started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  finished_at TEXT
);
CREATE INDEX idx_doctor_action_run ON doctor_action(doctor_run_id, id);

CREATE TABLE domain_binding (
  id INTEGER PRIMARY KEY,
  app_id INTEGER NOT NULL REFERENCES app(id) ON DELETE CASCADE,
  hostname TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL CHECK (mode IN ('direct_port','shared_ingress','named_tunnel')),
  provider TEXT,
  zone_id TEXT,
  record_type TEXT CHECK (record_type IN ('A','AAAA','CNAME')),
  record_name TEXT,
  target TEXT,
  ownership_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','propagated','active','conflict','failed','disabled')),
  last_check_at TEXT,
  evidence_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at TEXT
);
CREATE INDEX idx_domain_binding_app ON domain_binding(app_id, status);
