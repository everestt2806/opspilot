-- Chưa tự đăng ký vào initializer: chỉ bật cùng protected35→37 rollout gate.
CREATE TABLE product_managed_postgres (
  database_id TEXT PRIMARY KEY,
  controller_id TEXT NOT NULL REFERENCES product_controller(controller_id),
  app_id INTEGER NOT NULL REFERENCES app(id),
  ownership_generation INTEGER NOT NULL CHECK (ownership_generation > 0),
  target_binding_json TEXT NOT NULL,
  framework TEXT NOT NULL CHECK (framework IN ('express','nextjs')),
  image TEXT NOT NULL,
  crypto_scheme TEXT NOT NULL CHECK (crypto_scheme = 'aes_256_gcm'),
  encrypted_secret BLOB NOT NULL CHECK (length(encrypted_secret) BETWEEN 1 AND 8192),
  iv BLOB NOT NULL CHECK (length(iv) = 12),
  auth_tag BLOB NOT NULL CHECK (length(auth_tag) = 16),
  created_at TEXT NOT NULL,
  UNIQUE (controller_id, app_id, ownership_generation),
  UNIQUE (database_id, controller_id, app_id, ownership_generation)
);

CREATE TABLE product_managed_postgres_request (
  controller_id TEXT NOT NULL REFERENCES product_controller(controller_id),
  administrator_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  request_json TEXT NOT NULL,
  database_id TEXT NOT NULL REFERENCES product_managed_postgres(database_id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (controller_id, administrator_id, request_key)
);

CREATE TRIGGER product_managed_postgres_immutable
BEFORE UPDATE ON product_managed_postgres
BEGIN
  SELECT RAISE(ABORT, 'managed PostgreSQL identity is immutable');
END;

CREATE TRIGGER product_managed_postgres_request_immutable
BEFORE UPDATE ON product_managed_postgres_request
BEGIN
  SELECT RAISE(ABORT, 'managed PostgreSQL request is immutable');
END;

CREATE TRIGGER product_managed_postgres_retain
BEFORE DELETE ON product_managed_postgres
BEGIN
  SELECT RAISE(ABORT, 'managed PostgreSQL identity must be retained');
END;

CREATE TRIGGER product_managed_postgres_request_retain
BEFORE DELETE ON product_managed_postgres_request
BEGIN
  SELECT RAISE(ABORT, 'managed PostgreSQL request must be retained');
END;

CREATE TABLE product_source_postgres (
  app_id INTEGER NOT NULL REFERENCES app(id),
  source_generation INTEGER NOT NULL CHECK (source_generation > 0),
  controller_id TEXT NOT NULL REFERENCES product_controller(controller_id),
  ownership_generation INTEGER NOT NULL CHECK (ownership_generation > 0),
  database_id TEXT NOT NULL REFERENCES product_managed_postgres(database_id),
  source_config_sha256 TEXT NOT NULL,
  target_binding_json TEXT NOT NULL,
  environment_source_generation INTEGER,
  created_at TEXT NOT NULL,
  PRIMARY KEY (app_id, source_generation),
  FOREIGN KEY (app_id, source_generation, source_config_sha256) REFERENCES product_source_config(app_id, source_generation, config_sha256),
  FOREIGN KEY (database_id, controller_id, app_id, ownership_generation) REFERENCES product_managed_postgres(database_id, controller_id, app_id, ownership_generation),
  FOREIGN KEY (app_id, environment_source_generation) REFERENCES product_source_environment(app_id, source_generation)
);
CREATE TABLE product_postgres_selection_request (
  controller_id TEXT NOT NULL REFERENCES product_controller(controller_id),
  administrator_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  request_json TEXT NOT NULL,
  app_id INTEGER NOT NULL,
  source_generation INTEGER NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (controller_id, administrator_id, request_key),
  FOREIGN KEY (app_id, source_generation) REFERENCES product_source_postgres(app_id, source_generation)
);
CREATE TRIGGER product_source_postgres_immutable BEFORE UPDATE ON product_source_postgres
BEGIN SELECT RAISE(ABORT,'Product database source binding is immutable'); END;
CREATE TRIGGER product_source_postgres_retain BEFORE DELETE ON product_source_postgres
BEGIN SELECT RAISE(ABORT,'Product database source binding must be retained'); END;
CREATE TRIGGER product_postgres_selection_request_immutable BEFORE UPDATE ON product_postgres_selection_request
BEGIN SELECT RAISE(ABORT,'Product database selection request is immutable'); END;
CREATE TRIGGER product_postgres_selection_request_retain BEFORE DELETE ON product_postgres_selection_request
BEGIN SELECT RAISE(ABORT,'Product database selection request must be retained'); END;
