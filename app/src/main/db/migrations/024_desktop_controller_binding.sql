-- Kho của Desktop; remote controller_id không FK tới product_controller cục bộ.
CREATE TABLE desktop_controller_binding (
  binding_id TEXT PRIMARY KEY NOT NULL,
  controller_id TEXT NOT NULL,
  vps_id INTEGER NOT NULL REFERENCES vps(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision>=1),
  state TEXT NOT NULL CHECK (state IN ('pending','active','delivery_unknown','disabled')),
  intent_json TEXT NOT NULL,
  remote_client_id TEXT,
  client_json TEXT,
  encrypted_secret BLOB,
  iv BLOB,
  auth_tag BLOB,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((state='active' AND remote_client_id IS NOT NULL AND client_json IS NOT NULL AND encrypted_secret IS NOT NULL
    AND typeof(encrypted_secret)='blob' AND length(encrypted_secret) BETWEEN 1 AND 16384
    AND iv IS NOT NULL AND typeof(iv)='blob' AND length(iv)=12
    AND auth_tag IS NOT NULL AND typeof(auth_tag)='blob' AND length(auth_tag)=16)
    OR (state<>'active' AND encrypted_secret IS NULL AND iv IS NULL AND auth_tag IS NULL))
);
CREATE INDEX idx_desktop_controller_binding_vps ON desktop_controller_binding(vps_id,state);
