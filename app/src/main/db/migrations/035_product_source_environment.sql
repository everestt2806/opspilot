-- Source identity chỉ reference revision, không value/key list/digest secret.
CREATE TABLE product_source_environment (
  app_id INTEGER NOT NULL,
  source_generation INTEGER NOT NULL CHECK(source_generation BETWEEN 1 AND 9007199254740991),
  source_config_sha256 TEXT NOT NULL CHECK(length(source_config_sha256)=64),
  controller_id TEXT NOT NULL REFERENCES product_controller(controller_id) ON DELETE RESTRICT,
  ownership_generation INTEGER NOT NULL CHECK(ownership_generation BETWEEN 1 AND 9007199254740991),
  environment_revision INTEGER NOT NULL CHECK(environment_revision BETWEEN 1 AND 9007199254740991),
  target_binding_json TEXT NOT NULL CHECK(json_valid(target_binding_json)),
  administrator_id TEXT NOT NULL CHECK(length(administrator_id) BETWEEN 6 AND 15),
  request_key TEXT NOT NULL CHECK(length(request_key)=36),
  request_json TEXT NOT NULL CHECK(json_valid(request_json) AND length(request_json)<=8192),
  previous_source_generation INTEGER NOT NULL CHECK(previous_source_generation BETWEEN 1 AND 9007199254740991),
  previous_source_config_sha256 TEXT NOT NULL CHECK(length(previous_source_config_sha256)=64),
  created_at TEXT NOT NULL,
  PRIMARY KEY(app_id,source_generation),
  UNIQUE(controller_id,administrator_id,request_key),
  FOREIGN KEY(app_id,source_generation,source_config_sha256)
    REFERENCES product_source_config(app_id,source_generation,config_sha256) ON DELETE RESTRICT,
  FOREIGN KEY(app_id,previous_source_generation,previous_source_config_sha256)
    REFERENCES product_source_config(app_id,source_generation,config_sha256) ON DELETE RESTRICT,
  FOREIGN KEY(app_id,ownership_generation,environment_revision)
    REFERENCES product_environment_revision(app_id,ownership_generation,revision) ON DELETE RESTRICT
);
CREATE TRIGGER product_source_environment_immutable BEFORE UPDATE ON product_source_environment
BEGIN SELECT RAISE(ABORT,'PRODUCT_SOURCE_ENVIRONMENT_IMMUTABLE'); END;
CREATE TRIGGER product_source_environment_retain BEFORE DELETE ON product_source_environment
BEGIN SELECT RAISE(ABORT,'PRODUCT_SOURCE_ENVIRONMENT_IMMUTABLE'); END;
