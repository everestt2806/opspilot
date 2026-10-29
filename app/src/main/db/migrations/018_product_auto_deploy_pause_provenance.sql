ALTER TABLE product_app_control
  ADD COLUMN pause_policy_provenance TEXT NOT NULL DEFAULT 'legacy_clean'
  CHECK (pause_policy_provenance IN ('legacy_clean','legacy_inferred','operator_required','explicit'));

-- Migration 017 had no provenance to distinguish an explicit resume from the
-- generation-change bug. If any pause history remains beside an unpaused policy,
-- fail closed for that app until an operator writes an explicit policy decision.
UPDATE product_app_control
SET auto_deploy_paused = 1,
    pause_reason = 'operator',
    pause_policy_provenance = 'operator_required'
WHERE auto_deploy_paused = 0
  AND EXISTS (
    SELECT 1 FROM product_desired_branch AS desired
    WHERE desired.app_id = product_app_control.app_id
      AND desired.auto_paused = 1
  );

UPDATE product_app_control
SET pause_policy_provenance = CASE
      WHEN auto_deploy_paused = 1 THEN 'legacy_inferred'
      ELSE 'legacy_clean'
    END
WHERE pause_policy_provenance = 'legacy_clean';

CREATE TRIGGER product_app_control_pause_provenance_insert
BEFORE INSERT ON product_app_control
WHEN (NEW.pause_policy_provenance = 'operator_required'
      AND (NEW.auto_deploy_paused <> 1 OR NEW.pause_reason <> 'operator'))
BEGIN
  SELECT RAISE(ABORT, 'operator confirmation required for legacy pause policy');
END;

CREATE TRIGGER product_app_control_pause_provenance_update
BEFORE UPDATE OF auto_deploy_paused, pause_reason, pause_policy_provenance ON product_app_control
WHEN (NEW.pause_policy_provenance = 'operator_required'
      AND (NEW.auto_deploy_paused <> 1 OR NEW.pause_reason <> 'operator'))
  OR (OLD.auto_deploy_paused = 1 AND NEW.auto_deploy_paused = 0
      AND NEW.pause_policy_provenance <> 'explicit')
BEGIN
  SELECT RAISE(ABORT, 'explicit pause policy provenance required');
END;
