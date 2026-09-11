# C02 review 05 — recovery, rotation and live-target analysis

## Reviewed payload

- Review base `e80a0f9`; code `c6c728c`; submitted HEAD `018cb70`.
- Ancestry is valid. Worker exact focused 90/90, ML-service 19/19, collector 26/26 and all
  typecheck/lint/format/build gates passed independently.
- GitNexus analyze passed. The submission changes 39 symbols and affects 80 execution flows at
  CRITICAL risk across deploy, rollback, monitor, SSH and database paths.

## Recovery findings

Normal snapshot/preparation exceptions now call `resumeCollector()`, and restore now checks the
compose exit plus app image/state. The cancellation path remains unsafe. `resumeCollector()` calls
both `execStream()` and the verification `ssh.exec()` with `ctx.signal`. When cancellation caused
the catch, that signal is already aborted; production `SshManager.awaitChannelResult()` rejects it
immediately. The reviewer regression reproduced the rejected cleanup and warning. Recovery needs a
bounded cleanup signal independent from the user-operation signal, plus an asserted collector
running state.

The restore result is also not consumed on the branch that actually attempted restore. A failed
candidate leaves `runtimeStarted=false`; if restore returns success but image/state verification is
wrong or unavailable, `restoreStatus` remains `unknown`. The outer catch follows the
`runtimeStarted=false` arm, aborts the candidate activation and leaves the previous episode active.
Polling is therefore open even though runtime ownership is unknown. The `restoreStatus` check is
only inside the opposite `runtimeStarted=true` arm, which skips `restorePreviousOrDown()` in
`stepDeploy()`. Unknown restore must preserve a reconciliation barrier; it cannot silently return to
the old active episode.

## Rotation findings

For a matching `.1`, `recovered` starts false and is only changed inside
`rotatedSize + 1 > offset`. When the old file was already consumed exactly, there are no missing
bytes, but the code records a false data gap. The reviewer regression received one failed data-gap
row instead of zero.

Before draining unread bytes, the code sets `oldEndOffset` to `rotatedSize + 1`. If `size()`,
`tail()`, parsing/DB work or the post-commit callback throws, the broad catch keeps that EOF value,
rotates anyway, and logs `range=[EOF,EOF]`. In the reproduced `tail()` failure the committed cursor
was 236 and `.1` ended at 471, but the persisted/logged cursor became 471. This closes over the
unprocessed interval and makes retry impossible. The committed cursor must only advance from the
successful drain result; failure must keep a durable pending drain/reconciliation state or record
the exact `[oldCursor, oldEOF]` loss interval before switching.

## Live rollback finding

The helper now uses exact `app.current_deployment_id`, but it compares raw deployment `image_tag`
values. A manual rollback attempt has its own row tag while `DeploymentRepository.runtimeImageTag()`
resolves through `is_rollback_of`. Existing evidence before this submission states deployment 18
was current and actually ran `a17-notes-0911:v16`; deployment 18 is a rollback of deployment 16.
The new helper treated row `18.image_tag=v18` as current and selected deployment 16 with row tag
v16. Both resolve to runtime v16, and the final evidence again shows compose/runtime v16. Deployment
19 therefore re-ran the same runtime image and does not prove a rollback between different runtime
versions. The helper must resolve lineage for current and target and verify the live container
`.Config.Image` before and after.

## Coverage and provenance

`c6c728c` adds two activation tests, but no new pipeline `it()` regression. The pipeline test diff
only extends the SSH harness. Therefore the handoff claim that snapshot/DB/cancel recovery,
restore wrong/missing image and manual/auto failure have production regressions is not supported by
the committed suite. The missing cancellation and rotation cases allowed three reviewer
regressions to fail. The submission provenance itself is complete at docs HEAD `018cb70`.

Review 05 made no VPS or persisted SQLite mutation and did not run ML train/score. Temporary tests
were removed after execution; the three pre-existing untracked paths remain unchanged.
