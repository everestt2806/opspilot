-- Proof cài target riêng với deployment; không thay ownership hoặc tự bật policy.
CREATE TABLE product_target_enrollment (
  controller_id TEXT NOT NULL REFERENCES product_controller(controller_id) ON DELETE RESTRICT,
  app_id INTEGER NOT NULL REFERENCES app(id) ON DELETE RESTRICT,
  ownership_generation INTEGER NOT NULL CHECK (ownership_generation >= 1),
  target_binding_json TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL CHECK (length(manifest_sha256)=64),
  target_root TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('prepared','unknown','enrolled')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  receipt_json TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (controller_id,app_id,ownership_generation),
  CHECK (state <> 'enrolled' OR receipt_json IS NOT NULL)
);
