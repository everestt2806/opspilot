# C02 review 06 — owner reconciliation and gap-range analysis

## Reviewed payload

- Review base `eaca497`; code `37d9e19`; submitted HEAD `4b4f82e`; ancestry valid.
- Reviewer independently confirmed focused 95/95, ML-service 19/19, collector 26/26,
  node/web/scripts typecheck, scoped lint/format and build.
- GitNexus analyze passed. The submission changes 26 symbols and affects 114 processes at CRITICAL
  risk across deployment, rollback, monitoring and IPC flows.

## Runtime ownership

The independent cleanup signal fixes cancellation of the cleanup command itself, and the forward
restore-unknown test now retains a prepared row. The state model is not applied consistently to
manual and automatic rollback. `stopCollectorAndFlush()` changes `runtimeOwner` merely from
`app.current_deployment_id`; stopping the collector does not change or verify the app runtime. This
also reintroduces the DB-pointer inference forbidden by review 04.

For manual rollback, a target compose failure followed by an inconclusive runtime inspect leaves
`runtimeOwner='previous'`. The catch consequently aborts the prepared target activation and polling
has no reconciliation barrier even though the actual runtime is unknown. The reviewer regression
received zero prepared rows instead of one. Auto rollback has the same transition: after the new
candidate is active, stop/flush overwrites its owner from the stale current DB pointer; an
inconclusive rollback attempt may then abort its prepared boundary without preserving unknown state.

A durable prepared row also has no recovery path after process restart. Repository/poller code only
detects it and throws fail-closed. No startup/service/deploy API inspects the live runtime, selects
the verified owner and atomically activates or aborts the row. A subsequent deploy tries to insert a
second prepared row and hits the unique index. The committed test checks the barrier in the same
process; it does not restart or reconcile it. This can leave monitoring and later deploys blocked
indefinitely.

## Rotation audit range

Tail read failure now preserves the old cursor and can retry, and a fully consumed matching `.1`
no longer logs a false gap. Complete invalid lines still produce an inaccurate loss interval.
`pollUnlocked()` returns only `hadWarnings`; after consuming an invalid line it returns the EOF
`nextOffset`. The outer rotation uses that EOF as both `endOffset` and gap cursor, so the action is
`range=[EOF,EOF]` instead of the skipped line's byte interval. The reviewer reproduction skipped
bytes `[236,247]` but logged `cursor=247 range=[247,247]`. Exact warning byte offsets must be carried
out of parsing/commit and included in the rotation action.

## Evidence and coverage

The runtime-lineage helper now rejects a same resolved image and verifies Docker image/state before
and after; its code closes the earlier raw-row-tag bug. The committed artifact does not include the
raw helper/event/SQL output claimed by the prose evidence. It also says deployment 20 routing had
`5` rows while the same run added 359 metrics, without a per-deployment metric/score breakdown or
activation boundary that explains the split. Persist scrubbed raw output plus exact SQL counts and
boundary rows before this live gate can be audited.

Only two new pipeline tests were committed: successful cancellation cleanup and forward restore
unknown. The required cleanup-failure, manual/auto unknown-owner, inspect timeout/disconnect and
restart reconciliation matrix is absent. This missing coverage allowed the manual regression above
to fail while the handoff claimed all owner transitions and restart reconciliation were covered.

Review 06 made no VPS or persisted SQLite mutation and did not run ML train/score. Temporary tests
were removed after execution; the three pre-existing untracked paths remain unchanged.
