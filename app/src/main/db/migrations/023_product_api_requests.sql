-- Client phải thuộc controller của request; token không nằm trong bảng này.
CREATE UNIQUE INDEX idx_product_desktop_client_identity ON product_desktop_client(controller_id,client_id);
CREATE TABLE product_api_request (
  controller_id TEXT NOT NULL REFERENCES product_controller(controller_id) ON DELETE RESTRICT,
  client_id TEXT NOT NULL,
  request_key TEXT NOT NULL,
  app_id INTEGER NOT NULL REFERENCES app(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('manual_redeploy','pause_auto_deploy','resume_auto_deploy')),
  ownership_generation INTEGER NOT NULL CHECK (ownership_generation>=1),
  source_generation INTEGER NOT NULL CHECK (source_generation>=1),
  body_sha256 TEXT NOT NULL CHECK (length(body_sha256)=64 AND body_sha256 NOT GLOB '*[^0-9a-f]*'),
  job_id TEXT REFERENCES product_deploy_job(job_id) ON DELETE RESTRICT,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (controller_id,client_id,request_key),
  FOREIGN KEY(controller_id,client_id) REFERENCES product_desktop_client(controller_id,client_id) ON DELETE RESTRICT,
  CHECK ((action='manual_redeploy' AND job_id IS NOT NULL) OR (action<>'manual_redeploy' AND job_id IS NULL))
);
