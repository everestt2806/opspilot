ALTER TABLE product_app_control
  ADD COLUMN auto_deploy_paused INTEGER NOT NULL DEFAULT 0 CHECK (auto_deploy_paused IN (0,1));
ALTER TABLE product_app_control
  ADD COLUMN pause_reason TEXT CHECK (pause_reason IS NULL OR pause_reason IN ('manual_action','operator'));

CREATE TRIGGER product_app_control_pause_policy_insert
BEFORE INSERT ON product_app_control
WHEN (NEW.auto_deploy_paused = 0 AND NEW.pause_reason IS NOT NULL)
  OR (NEW.auto_deploy_paused = 1 AND NEW.pause_reason IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'invalid Product auto-deploy pause policy');
END;

CREATE TRIGGER product_app_control_pause_policy_update
BEFORE UPDATE OF auto_deploy_paused, pause_reason ON product_app_control
WHEN (NEW.auto_deploy_paused = 0 AND NEW.pause_reason IS NOT NULL)
  OR (NEW.auto_deploy_paused = 1 AND NEW.pause_reason IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'invalid Product auto-deploy pause policy');
END;

-- Migration 016 stored pause snapshots per desired branch. Seed the app policy from
-- the latest durable snapshot; subsequent readers use only this app/ownership field.
UPDATE product_app_control
SET auto_deploy_paused = COALESCE((
      SELECT desired.auto_paused
      FROM product_desired_branch AS desired
      WHERE desired.app_id = product_app_control.app_id
      ORDER BY desired.updated_at DESC, desired.source_generation DESC, desired.ref DESC
      LIMIT 1
    ), 0),
    pause_reason = CASE WHEN COALESCE((
      SELECT desired.auto_paused
      FROM product_desired_branch AS desired
      WHERE desired.app_id = product_app_control.app_id
      ORDER BY desired.updated_at DESC, desired.source_generation DESC, desired.ref DESC
      LIMIT 1
    ), 0) = 1 THEN (
      SELECT desired.pause_reason
      FROM product_desired_branch AS desired
      WHERE desired.app_id = product_app_control.app_id
      ORDER BY desired.updated_at DESC, desired.source_generation DESC, desired.ref DESC
      LIMIT 1
    ) ELSE NULL END
WHERE mode = 'product';
