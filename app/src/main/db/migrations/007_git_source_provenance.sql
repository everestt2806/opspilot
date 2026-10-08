ALTER TABLE app ADD COLUMN source_type TEXT NOT NULL DEFAULT 'local'
  CHECK (source_type IN ('local','git'));
ALTER TABLE app ADD COLUMN git_repo_url TEXT;
ALTER TABLE app ADD COLUMN git_ref TEXT;
ALTER TABLE app ADD COLUMN git_root TEXT;
ALTER TABLE deployment ADD COLUMN git_repo_url TEXT;
ALTER TABLE deployment ADD COLUMN git_commit_sha TEXT;
