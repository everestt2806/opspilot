-- Monotonic revision for SSH security-sensitive VPS profile changes.
-- Telemetry and operational status fields do not advance this counter.
ALTER TABLE vps ADD COLUMN ssh_security_revision INTEGER NOT NULL DEFAULT 1
  CHECK (ssh_security_revision >= 1);