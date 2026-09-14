# TK-A17/C02 review-08 implementation analysis

Reviewed `1b2f150..65d85ac`; submitted documentation HEAD was `2503c12`.

The runtime lineage and mixed-invalid fixes are correct for the two review-07 regressions. The
repository resolver follows `is_rollback_of` to a terminal deployment and rejects cycles or missing
rows. Rotation now closes the old episode at `drained.nextOffset` and forwards every warning range.
The committed focused suite confirms the multi-level rollback and multiple-invalid-line cases.

Two recovery invariants remain open:

1. `MonitorService.reconcilePrepared()` does not select the prepared episode's `start_offset` and
   only compares the snapshot generation. A candidate runtime with generation `1:1`, prepared
   boundary `100`, and current source size `20` was activated. Expected behavior is to retain the
   prepared barrier because bytes through boundary `99` cannot be verified.
2. Candidate reconciliation calls `ActivationRepository.activate()` and then updates
   `app.current_deployment_id` separately. A SQLite trigger injected a failure into the pointer
   update. The activation transaction had already committed, so the prepared barrier was lost while
   the pointer remained on the previous deployment. Both state changes must commit or roll back
   together.

The Worker evidence also says the restart test runs a second idempotent tick, but the committed test
only calls `pollAll()` once. The requested previous-owner/down/unknown/reconnect/new-deploy recovery
matrix is not present in `service.test.ts`.

No deploy, rollback, ML train/score, database mutation, or app B mutation was performed by the
reviewer. The temporary reviewer test was removed after execution. The three pre-existing untracked
paths were preserved.
