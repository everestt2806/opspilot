ALTER TABLE app ADD COLUMN imported_from_vps INTEGER NOT NULL DEFAULT 0
  CHECK (imported_from_vps IN (0,1));

CREATE TABLE deployment_new (
  id INTEGER PRIMARY KEY,
  app_id INTEGER NOT NULL REFERENCES app(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  image_tag TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN
    ('building','deploying','running','failed','rolled_back','stopped')),
  failed_step TEXT CHECK (failed_step IN
    ('PRECHECK','UPLOAD','RENDER','BUILD','DEPLOY','HEALTHCHECK','RECORD')),
  env_json TEXT,
  detector_json TEXT,
  build_duration_ms INTEGER,
  total_duration_ms INTEGER,
  is_rollback_of INTEGER REFERENCES deployment_new(id),
  started_at TEXT,
  finished_at TEXT,
  exposure_status TEXT NOT NULL DEFAULT 'not_checked' CHECK (exposure_status IN
    ('reachable','degraded','tunnel_only','not_checked')),
  exposure_evidence_json TEXT,
  git_repo_url TEXT,
  git_commit_sha TEXT,
  origin TEXT NOT NULL DEFAULT 'opspilot' CHECK (origin IN ('opspilot','vps_import')),
  UNIQUE (app_id, version)
);

INSERT INTO deployment_new (
  id, app_id, version, image_tag, status, failed_step, env_json, detector_json,
  build_duration_ms, total_duration_ms, is_rollback_of, started_at, finished_at,
  exposure_status, exposure_evidence_json, git_repo_url, git_commit_sha, origin
)
SELECT
  id, app_id, version, image_tag, status, failed_step, env_json, detector_json,
  build_duration_ms, total_duration_ms, is_rollback_of, started_at, finished_at,
  exposure_status, exposure_evidence_json, git_repo_url, git_commit_sha, 'opspilot'
FROM deployment;

DROP INDEX idx_deployment_app_started;
DROP TABLE deployment;
ALTER TABLE deployment_new RENAME TO deployment;
CREATE INDEX idx_deployment_app_started ON deployment(app_id, started_at DESC);
