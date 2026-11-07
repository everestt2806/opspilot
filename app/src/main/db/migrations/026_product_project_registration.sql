-- Tombstone quản trị cục bộ; không xóa theo app/target để giữ request namespace.
CREATE TABLE product_project_registration (
  controller_id TEXT NOT NULL,
  administrator_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  body_json TEXT NOT NULL CHECK (length(body_json) BETWEEN 1 AND 8192),
  body_sha256 TEXT NOT NULL CHECK (length(body_sha256)=64),
  app_id INTEGER NOT NULL CHECK (app_id>=1),
  target_vps_id INTEGER NOT NULL CHECK (target_vps_id>=1),
  target_security_revision INTEGER NOT NULL CHECK (target_security_revision>=1),
  result_json TEXT NOT NULL CHECK (length(result_json) BETWEEN 1 AND 4096),
  created_at TEXT NOT NULL,
  PRIMARY KEY(controller_id,administrator_id,request_key)
);
CREATE TRIGGER product_project_registration_immutable BEFORE UPDATE ON product_project_registration
BEGIN SELECT RAISE(ABORT,'PRODUCT_PROJECT_REGISTRATION_IMMUTABLE'); END;
