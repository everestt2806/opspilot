-- Desktop-only consent history; never a fabricated registration/selection.
CREATE TABLE desktop_project_reconnection (
  request_key TEXT PRIMARY KEY NOT NULL CHECK(length(request_key)=36),
  provenance TEXT NOT NULL CHECK(provenance='explicit_reconnection_v1'),
  binding_id TEXT NOT NULL REFERENCES desktop_controller_binding(binding_id) ON DELETE RESTRICT,
  binding_revision INTEGER NOT NULL CHECK(binding_revision>=1),
  controller_id TEXT NOT NULL,
  app_id INTEGER NOT NULL CHECK(app_id>=1),
  snapshot_sha256 TEXT NOT NULL CHECK(length(snapshot_sha256)=64 AND snapshot_sha256 NOT GLOB '*[^a-f0-9]*'),
  crypto_scheme TEXT NOT NULL CHECK(crypto_scheme='aes_256_gcm'),
  encrypted_secret BLOB NOT NULL CHECK(typeof(encrypted_secret)='blob' AND length(encrypted_secret) BETWEEN 1 AND 65536),
  iv BLOB NOT NULL CHECK(typeof(iv)='blob' AND length(iv)=12),
  auth_tag BLOB NOT NULL CHECK(typeof(auth_tag)='blob' AND length(auth_tag)=16),
  confirmed_at TEXT NOT NULL,
  UNIQUE(binding_id,binding_revision,controller_id,app_id,snapshot_sha256)
);
CREATE INDEX idx_desktop_reconnection_binding ON desktop_project_reconnection(binding_id,confirmed_at DESC,request_key);
CREATE TRIGGER desktop_project_reconnection_immutable BEFORE UPDATE ON desktop_project_reconnection
BEGIN SELECT RAISE(ABORT,'DESKTOP_PROJECT_RECONNECTION_IMMUTABLE'); END;
CREATE TRIGGER desktop_project_reconnection_retain BEFORE DELETE ON desktop_project_reconnection
BEGIN SELECT RAISE(ABORT,'DESKTOP_PROJECT_RECONNECTION_RETAIN'); END;
