# C02 review 04 — recovery and rotation analysis

## Reviewed payload

- Review base `044cc0f`; code `fa72a6e`; submitted HEAD `85f4810`.
- Ancestry is valid. The implementation diff changes 16 files and the GitNexus change surface is
  CRITICAL because it affects deployment, rollback, monitoring, SSH and database flows.
- Worker exact focused suite passed 88/88. Reviewer also confirmed ML-service 19/19, collector
  26/26 and all scoped static/build checks.

## Recovery findings

`prepareActivationFor()` stops the current collector before taking `metricSnapshot()`. If that
snapshot throws, or if the following activation preparation fails, control goes directly to the
outer deployment/rollback catch. No code restarts the collector. The application remains current
and may remain healthy, but its metric production is disabled. The reviewer regression confirmed
that no compose start/up followed the successful stop.

After a candidate partially starts, `stepDeploy()` invokes `restorePreviousOrDown()`. That helper
does not check the exit code returned by its restore `compose up`; it logs that the previous version
was restored even when the command returned nonzero. The outer catch then sees
`runtimeStarted=true`, activates the candidate interval, takes another boundary, and opens a new
activation for the previous deployment. In the reproduced failure, restore returned nonzero but
the final active episode pointed to deployment 1 instead of candidate deployment 2. This permits
candidate runtime bytes to be assigned to the previous deployment.

The same ownership problem applies to manual rollback failure paths: image validation occurs only
after the collector was stopped, and a failed/partially started rollback has no verified restoration
of the original runtime before activation and collector state are finalized.

## Generation and rotation findings

First deploy uses the sentinel generation `pending-first-generation`. On the first real poll, the
normal rotation branch sees a generation mismatch, cannot find `.1`, and writes a failed data-gap
action. No bytes existed before the first generation, so this is a false loss signal. The reviewer
regression observed one data-gap row where zero was expected.

For a matching `.1`, the poller sets `oldEndOffset=rotatedSize+1` before it knows how many complete
bytes the recursive poll committed. It sets `recovered=true` whenever identity matches, even when
the suffix ends with an incomplete line and the recursive poll consumes zero bytes. It then closes
the old episode past the unread suffix and emits no gap. The reviewer regression reproduced this
silent loss condition.

## Live evidence issue

Before rollback attempt 17, deployment 16 was current. Attempt 17 failed and the evidence says 16
remained current. On retry, the helper computes `currentBefore` only when a running row also has the
maximum ID across every status. Because failed deployment 17 now has the maximum ID,
`currentBefore` becomes undefined. The target filter then chooses the highest running row,
deployment 16 itself. Deployment 18 therefore has `is_rollback_of=16` and runs image v16, exactly
as the evidence records. The successful retry redeployed the current version; it did not prove a
manual rollback to a prior runtime.

Attempt 17 is retained as a real failure, but its evidence gives only “SSH error” and no exact
step/error/output. That is insufficient to determine whether the collector was stopped before the
failure and explains why recovery state must be recorded explicitly.

## Coverage and provenance

The submitted production fix added six tests: two pipeline tests, three rotation tests and one
migration test. It did not add the required snapshot-after-stop recovery, restore-nonzero,
manual-rollback recovery, first-generation adoption or partial `.1` cases. The four temporary
reviewer regressions all failed and were removed after their runs.

The handoff header says docs HEAD `1f128ed`, while commits `1daa899` and `85f4810` follow it. The
handoff also labels the 19-test `ml-service` suite as “collector venv”; these are separate suites.
Reviewer ran both: ML service 19/19 and collector 26/26.

Review 04 did not mutate the persisted OpsPilot SQLite database or any VPS. Existing live evidence
was inspected but not rerun or claimed as reviewer evidence.
