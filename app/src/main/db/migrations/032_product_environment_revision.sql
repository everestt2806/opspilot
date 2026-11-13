-- R7h-1: staged configuration only. No activation/source/job/policy mutation.
CREATE TABLE product_environment_revision (
  controller_id TEXT NOT NULL REFERENCES product_controller(controller_id) ON DELETE RESTRICT,
  app_id INTEGER NOT NULL REFERENCES app(id) ON DELETE RESTRICT,
  ownership_generation INTEGER NOT NULL CHECK(ownership_generation BETWEEN 1 AND 9007199254740991),
  revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
  basis_source_generation INTEGER NOT NULL CHECK(basis_source_generation BETWEEN 1 AND 9007199254740991),
  basis_source_config_sha256 TEXT NOT NULL CHECK(length(basis_source_config_sha256)=64),
  target_binding_json TEXT NOT NULL CHECK(json_valid(target_binding_json)),
  framework TEXT NOT NULL CHECK(framework IN ('express','static-spa','nextjs')),
  runtime_keys_json TEXT NOT NULL CHECK(json_valid(runtime_keys_json) AND json_type(runtime_keys_json)='array'),
  public_build_keys_json TEXT NOT NULL CHECK(json_valid(public_build_keys_json) AND json_type(public_build_keys_json)='array'),
  crypto_scheme TEXT NOT NULL CHECK(crypto_scheme='aes_256_gcm'),
  encrypted_secret BLOB NOT NULL CHECK(typeof(encrypted_secret)='blob' AND length(encrypted_secret) BETWEEN 1 AND 131072),
  iv BLOB NOT NULL CHECK(typeof(iv)='blob' AND length(iv)=12),
  auth_tag BLOB NOT NULL CHECK(typeof(auth_tag)='blob' AND length(auth_tag)=16),
  created_at TEXT NOT NULL,
  PRIMARY KEY(app_id,ownership_generation,revision),
  FOREIGN KEY(app_id,basis_source_generation,basis_source_config_sha256)
    REFERENCES product_source_config(app_id,source_generation,config_sha256) ON DELETE RESTRICT
);
CREATE TRIGGER product_environment_revision_immutable BEFORE UPDATE ON product_environment_revision
BEGIN SELECT RAISE(ABORT,'PRODUCT_ENVIRONMENT_IMMUTABLE'); END;
CREATE TRIGGER product_environment_revision_retain BEFORE DELETE ON product_environment_revision
BEGIN SELECT RAISE(ABORT,'PRODUCT_ENVIRONMENT_IMMUTABLE'); END;
