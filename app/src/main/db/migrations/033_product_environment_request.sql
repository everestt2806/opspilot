-- Receipt riêng của staged config: không body JSON/digest chứa secret.
CREATE TABLE product_environment_request (
  controller_id TEXT NOT NULL REFERENCES product_controller(controller_id) ON DELETE RESTRICT,
  administrator_id TEXT NOT NULL CHECK(length(administrator_id) BETWEEN 6 AND 15),
  request_key TEXT NOT NULL CHECK(length(request_key)=36),
  app_id INTEGER NOT NULL,
  ownership_generation INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  crypto_scheme TEXT NOT NULL CHECK(crypto_scheme='aes_256_gcm'),
  encrypted_secret BLOB NOT NULL CHECK(typeof(encrypted_secret)='blob' AND length(encrypted_secret) BETWEEN 1 AND 131072),
  iv BLOB NOT NULL CHECK(typeof(iv)='blob' AND length(iv)=12),
  auth_tag BLOB NOT NULL CHECK(typeof(auth_tag)='blob' AND length(auth_tag)=16),
  created_at TEXT NOT NULL,
  PRIMARY KEY(controller_id,administrator_id,request_key),
  UNIQUE(app_id,ownership_generation,revision),
  FOREIGN KEY(app_id,ownership_generation,revision)
    REFERENCES product_environment_revision(app_id,ownership_generation,revision) ON DELETE RESTRICT
);
CREATE TRIGGER product_environment_request_immutable BEFORE UPDATE ON product_environment_request
BEGIN SELECT RAISE(ABORT,'PRODUCT_ENVIRONMENT_REQUEST_IMMUTABLE'); END;
CREATE TRIGGER product_environment_request_retain BEFORE DELETE ON product_environment_request
BEGIN SELECT RAISE(ABORT,'PRODUCT_ENVIRONMENT_REQUEST_IMMUTABLE'); END;
