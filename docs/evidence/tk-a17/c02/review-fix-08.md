# C02 REVIEW-FIX 08 evidence

- Scope: TK-A17/C02 only. Base `deb69b9` (Leader review-08 request), code `8fe4842`, docs before
  this append `2503c12`. C03-C09 remain closed/`NOT_RUN`.
- Preserved untracked `.devflow/`, `docs/ban-giao-20-08.md`, and `logo.png`.

## Findings and regressions

| Finding | Fix / regression | Result |
| --- | --- | --- |
| C02-R8-01 / R6-02 | Reconciliation enumerates only app IDs outside the lock, then reloads the current prepared episode, app and deployment under `withAppLock`; candidate requires image/state, running collector, matching generation and `snapshot.size + 1 >= start_offset`. | PASS |
| C02-R8-02 | `ActivationRepository.activateAndPoint()` validates the reloaded row and commits previous close, prepared activation and `app.current_deployment_id` in one SQLite transaction. Pointer-trigger failure rolls all state back; retry activates once. | PASS |
| C02-R8-03 / R7-03 | Production tests cover multi-level rollback, cycle/missing lineage, short boundary, stale-row-safe reload, close/reopen, reconnect-style retry, second tick idempotency and deploy-visible pointer. | PASS |
| R6-03/R6-04/R6-05 | Existing mixed-invalid rotation, exact warning ranges, regression coverage and read-only deployment 20/21 evidence remain green. | PASS |

## Exact local gates

All commands exited `0`:

```text
app> pnpm exec vitest run --maxWorkers=1 src/main/db src/main/monitor src/main/deploy src/main/shutdown.test.ts
18 files, 99 tests passed
app> pnpm typecheck
app> pnpm exec tsc -p tsconfig.scripts.json --noEmit
app> pnpm exec eslint <scoped changed production/test files>
app> pnpm exec prettier --check <scoped changed production/test files>
app> pnpm build (renderer 3045 modules)
ml-service> .venv\Scripts\python.exe -m pytest -q       19 passed
collector> ..\ml-service\.venv\Scripts\python.exe -m pytest -q  26 passed
```

## Regression matrix

- Exact boundary and boundary-1: short snapshot keeps prepared; durable boundary activates.
- Missing snapshot/generation mismatch/wrong image/collector missing or down/SSH unknown: barrier is
  retained with an operational action; no DB pointer inference.
- One- and multi-level prepared rollback, active rollback owner, cycle/missing lineage: resolved
  lineage is used under lock; invalid lineage remains prepared.
- Previous owner abort, stale prepared replacement, close/reopen DB and second service tick: row is
  reloaded by ID/deployment, stale row is a no-op, and no duplicate activation/action is created.
- Injected SQLite pointer failure: previous active row, prepared row, pointer and cursor remain
  unchanged; dropping the trigger and retrying activates exactly once.
- Routing/dedupe/cardinality and mixed invalid rotation remain covered by the focused monitor suite;
  every metric has five score rows and ML nulls are not fabricated.

## Read-only live scope

No live mutation was run for review-fix 08. Existing read-only VM02 evidence remains:

```text
source generation/size: 2050:520983 / 1720293
SQLite cursor: 1543119
deployment 20 activation: [1417093,1541655), 424 metrics / 2120 scores
deployment 21 activation: [1541655,EOF), 5 metrics / 25 scores
mutation arithmetic: 416+5=421 metrics; 2080+25=2105 scores
final A17: v16, app/collector/DB running, health HTTP 200
app B: read-only inspect, running/restart 0
```

No SQLite/PostgreSQL reset, delete, reassignment, deploy, rollback, ML train/score, UI/fault or
app B operation was performed. C03-T1 onward remains `NOT_RUN`.
