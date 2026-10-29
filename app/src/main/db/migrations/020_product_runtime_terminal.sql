-- H2: barrier trước mutation và terminal record duy nhất cho cùng attempt.
CREATE TABLE product_runtime_execution (
  attempt_id TEXT PRIMARY KEY REFERENCES product_deploy_attempt(attempt_id) ON DELETE RESTRICT,
  deployment_id INTEGER NOT NULL UNIQUE REFERENCES deployment(id) ON DELETE RESTRICT,
  context_json TEXT NOT NULL,
  context_sha256 TEXT NOT NULL CHECK (length(context_sha256)=64),
  activation_id INTEGER UNIQUE REFERENCES deployment_activation(id) ON DELETE RESTRICT,
  previous_activation_id INTEGER REFERENCES deployment_activation(id) ON DELETE RESTRICT,
  boundary_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE product_runtime_terminal (
  attempt_id TEXT PRIMARY KEY REFERENCES product_runtime_execution(attempt_id) ON DELETE RESTRICT,
  commit_id TEXT NOT NULL UNIQUE,
  receipt_sha256 TEXT NOT NULL CHECK (length(receipt_sha256)=64),
  context_sha256 TEXT NOT NULL CHECK (length(context_sha256)=64),
  envelope_json TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  settled_at TEXT,
  leases_released_at TEXT,
  settlement_json TEXT,
  CHECK ((settled_at IS NULL AND settlement_json IS NULL) OR
         (settled_at IS NOT NULL AND settlement_json IS NOT NULL)),
  CHECK (leases_released_at IS NULL OR settled_at IS NOT NULL)
);
