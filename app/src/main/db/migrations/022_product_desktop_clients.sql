-- Credential giao qua trusted admin CLI một lần; DB chỉ giữ digest, không bearer plaintext.
CREATE TABLE product_desktop_client (
  client_id TEXT PRIMARY KEY,
  controller_id TEXT NOT NULL REFERENCES product_controller(controller_id) ON DELETE RESTRICT,
  display_name TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX idx_product_desktop_client_controller ON product_desktop_client(controller_id,client_id);

CREATE TABLE product_desktop_credential (
  credential_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES product_desktop_client(client_id) ON DELETE RESTRICT,
  token_sha256 TEXT NOT NULL UNIQUE CHECK (length(token_sha256)=64 AND token_sha256 NOT GLOB '*[^0-9a-f]*'),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX idx_product_desktop_credential_client ON product_desktop_credential(client_id);

-- Tombstone giữ theo controller lifetime; cùng key không cấp lại secret sau response loss.
CREATE TABLE product_desktop_admin_request (
  controller_id TEXT NOT NULL REFERENCES product_controller(controller_id) ON DELETE RESTRICT,
  administrator_identity TEXT NOT NULL,
  request_key TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('enroll-desktop-client','revoke-desktop-client')),
  body_sha256 TEXT NOT NULL CHECK (length(body_sha256)=64),
  client_id TEXT NOT NULL REFERENCES product_desktop_client(client_id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  result_json TEXT,
  PRIMARY KEY (controller_id,administrator_identity,request_key)
);
