# C02 Review 02 — Leader decision on activation boundary

## Input and scope

- Reviewed blocker handoff HEAD: `87fa868`; proposal payload: `ca0b3fa`; review base: `05848d1`.
- Diff is documentation only. No production code, schema, SQLite, VPS or test state changed.
- Decision: **APPROVED_WITH_AMENDMENTS** for C02 implementation. This is not C02 APPROVED.

The proposal correctly rejects `ts_vps` as the boundary and correctly preserves the 80 historical
rows. Its proposed `deployment.metrics_start_offset`/`activated_at` pair is not sufficient by itself.

## Gaps found

1. Auto rollback at `pipeline.ts:1000-1007` sets `current_deployment_id` back to an existing previous
   deployment. One start offset on that deployment cannot represent its first run and later
   reactivation episodes.
2. A start offset without an exclusive end offset cannot route delayed backlog across more than one
   deployment transition.
3. The proposed boundary is after healthcheck, but the candidate app and collector already run during
   healthcheck. Those candidate metrics would be assigned to the previous deployment.
4. Reading remote size while the collector is still appending leaves a race. A SQLite transaction
   cannot make a remote `stat` and a concurrent file append atomic.
5. Rotation reuses byte offsets. A file-generation identity is therefore mandatory, not optional;
   size-only shrink detection also misses a replacement file that has already grown past the old
   offset.
6. A failed candidate that actually ran may emit metrics. Assigning those bytes to the prior
   deployment misstates the runtime version.

## Approved amended contract

### Persistent model

Add migration `002` and update the canonical schema. Keep `app.metrics_offset` as the next unread
1-based cursor, and add app-level current stream generation/identity. Add an append-only
`deployment_activation` table with one row per runtime episode, including:

- `app_id`, `deployment_id`, `stream_generation`;
- inclusive `start_offset`, exclusive nullable `end_offset`;
- `reason` (`deploy`, `manual_rollback`, `auto_rollback`, `rotation`, `legacy`);
- lifecycle state sufficient to distinguish `prepared`, `active`, `closed`, `aborted`;
- UTC activation/deactivation audit timestamps.

Multiple activation rows may point to the same deployment. This is required for auto rollback.
Prepared/aborted rows are never used to route metrics. Add indexes/constraints for app, generation,
offset ordering and at most one active episode per app. Do not edit migration `001` in place.

Existing databases are initialized lazily under the shared lock: bind the current remote file identity
to a new generation and create a `legacy` active episode for `current_deployment_id` starting at the
existing `app.metrics_offset`. Do not rewrite historical metric rows or the 80 contaminated rows.

### Exact cutover protocol

Use one per-app async lock shared by deploy/rollback and monitor polling. Hold it for the complete
runtime-changing interval; do not use separate unrelated locks.

Before a forward deploy or rollback replaces the runtime:

1. Stop only that app's collector and wait for graceful exit/flush.
2. Read the current file identity and byte size. The boundary is `size + 1`, because offsets are
   1-based and activation intervals use an exclusive end.
3. Insert a `prepared` activation for the candidate at that boundary. While it is prepared, polling
   for that app is blocked by the shared lock.
4. Start the candidate runtime/collector. After compose confirms the candidate actually started,
   atomically close the previous activation and promote the candidate activation to `active`.
5. Healthcheck success updates deployment status and `current_deployment_id`; healthcheck metrics
   remain assigned to the candidate episode because its boundary is the runtime cutover, not the
   later healthcheck timestamp.

If compose fails before the candidate runtime starts, mark the prepared row `aborted` and restore the
previous collector without moving the boundary. If the candidate ran and then failed, retain its
activation interval under the failed/rolled-back candidate deployment; do not assign that interval to
the previous deployment.

For auto rollback, stop/flush the candidate collector, close its activation at a new `size + 1`
boundary, and create a new activation row pointing to the previous deployment before restarting the
previous runtime. Manual rollback already creates a new deployment row and receives its own activation.
If the desktop exits with a prepared activation, startup must fail closed for that app: do not poll it
until runtime identity is reconciled, and record the condition in `action_log`.

### Rotation and cursor policy

The source snapshot must include a stable Linux file identity such as device/inode in addition to
size. When identity changes, the poller must detect rotation even if the new file is larger than the
old cursor. For one normal rotation, drain the unread suffix from `metrics.jsonl.1` when its identity
matches the stored generation, then open a continuation activation for the same deployment on the
new generation at offset 1. If the matching rotated file is unavailable, log an explicit data-gap
action and expose the gap in the poll result/evidence; do not claim lossless recovery.

Metric/score/offset and activation routing updates remain one SQLite transaction. External ML delivery
retains the documented at-least-once crash window.

## Impact and required coverage

GitNexus was reindexed at `87fa868` (FTS unavailable warning only). Impact results:

- `AppRepository.setCurrentDeployment`: CRITICAL, 3 direct callers, 8 affected processes across
  deploy, manual rollback and healthcheck auto rollback.
- `MonitorPoller.poll`: HIGH, 3 direct callers and 3 affected processes, including
  `MonitorService.pollAll` and both CLI runners.
- `DeployPipeline.recordSuccess`: HIGH; forward deploy service and try-deploy paths are affected.
- `recordManualRollbackSuccess`: direct manual rollback path affected.

Required regressions therefore cover migration fresh/v1 upgrade, lazy legacy initialization,
unconsumed backlog over two forward transitions, candidate metrics during healthcheck, failure before
runtime start, failure after runtime start, manual rollback, auto rollback reactivating the same old
deployment, prepared-state startup fail-closed, shared-lock no-overlap, rotation where new size is
smaller and larger than the old cursor, retry/dedupe, score cardinality and transaction rollback.

No runtime tests were rerun for this docs-only decision. The reviewer did not perform live mutation.
