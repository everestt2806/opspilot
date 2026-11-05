-- Last Caddy config generation/hash observed after a successful DB transaction.
-- This lets a later reconcile detect a remote writer that advanced independently.
CREATE TABLE IF NOT EXISTS ingress_reconcile_observation (
  vps_id INTEGER PRIMARY KEY REFERENCES vps(id) ON DELETE CASCADE,
  inventory_revision TEXT NOT NULL CHECK (length(inventory_revision) = 64),
  environment TEXT NOT NULL CHECK (environment IN ('production', 'acme_staging')),
  generation TEXT NOT NULL CHECK (length(generation) = 64),
  config_sha256 TEXT NOT NULL CHECK (length(config_sha256) = 64),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
