# C02 Review-Fix 01 - Boundary Proposal

## Status

- Base: `05848d1`, branch `feat/a17-demo-checkpoint`.
- Review: `docs/tasks/tk-a17/review-c02.md`, evidence `docs/evidence/tk-a17/c02/review-01`.
- Outcome: `BLOCKED` before boundary implementation or live mutation.
- C03-C09 remain closed and `NOT_RUN`.

## Finding audit

- `C02-R1-01`: BLOCKED. The schema has one app-wide `metrics_offset`; `deployment.started_at` is deployment creation time, not a source-file activation boundary. Timestamp filtering is unsafe under VPS clock skew, rotation, restart and failed deploy. The 80 historically misrouted rows remain untouched.
- `C02-R1-02`: NOT_RUN. Real scheduler observation waits for boundary policy approval because it mutates the existing target database.
- `C02-R1-03`: FIXED IN DOCS. The original and successful run boundaries are documented separately, including the failed assertion run and full `+2120/+10600` reconciliation. Missing raw output is not reconstructed.
- `C02-R1-04`: FIXED IN DOCS. SQLite atomicity only is claimed; ML delivery is at-least-once in the crash window and ML idempotency is not claimed.
- `C02-R1-05`: FIXED IN THIS REVIEW-FIX DOCS. Exact current provenance is recorded after commit.

## Proposal requiring Leader decision

Use the append-only metrics file byte position at successful activation, not `ts_vps` or deployment creation time. Activation is after the new compose healthcheck succeeds and immediately before `app.current_deployment_id` switches.

Required migration metadata:

- `deployment.metrics_start_offset` (1-based next unread byte for that deployment), nullable for historical rows.
- `deployment.activated_at` (UTC audit timestamp), nullable for historical rows.
- Preserve `app.metrics_offset`; do not rewrite historical samples.

At successful activation, obtain remote file size through SSH and persist boundary metadata in the same SQLite transaction as the current-deployment switch. A failed attempt has no activation boundary and never becomes the monitor target.

Routing policy:

- Forward deploy: pre-boundary bytes remain with the prior active deployment; post-boundary bytes route to the new deployment.
- Failed attempt: prior deployment remains current and consumes its backlog.
- Manual/auto rollback: rollback gets a new post-healthcheck boundary and keeps `is_rollback_of` for audit.
- Rotation/restart: retain shrink reset and monotonic `seq`; add a file-generation marker if byte offsets can be reused.
- Scheduler race: serialize activation and poll routing; poll snapshots `(deployment_id, metrics_offset, boundary)` and commits rows plus cursor atomically.
- Crash window: SQLite metric/score/cursor writes are atomic; external ML remains at-least-once until ML idempotency exists.

Leader must approve or amend this migration and activation serialization before Worker changes schema/poller/deploy lifecycle or performs live redeploy/rollback. No timestamp heuristic, silent backlog drop, reassignment or live mutation was performed.

## Commands/evidence

No live mutation was run after review because the boundary policy is not approved. Existing independent evidence remains valid: focused monitor/deploy `71/71`, static/build PASS, reviewer boundary regression `1/1 FAIL`. SQLite/VPS data and A untracked files were preserved.
