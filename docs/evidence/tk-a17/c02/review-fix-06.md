# C02 REVIEW-FIX 06 evidence

- Scope: TK-A17/C02 only; base `24c669b`, code `61f43df`, docs before append `4b4f82e`.
  C03-C09 remain closed/`NOT_RUN`; `.devflow/`, `docs/ban-giao-20-08.md`, and `logo.png` remain untracked.

## Findings

| Finding | Evidence | Status |
| --- | --- | --- |
| C02-R6-01 | Collector stop sets owner `unknown`; candidate/previous/down require compose exit and live image/state; cleanup failure retains the barrier. | PASS |
| C02-R6-02 | `MonitorService` reconciles prepared rows after restart under `withAppLock`, inspects app/collector, snapshots stream identity/size, and atomically activates/aborts only a verified owner; unknown remains prepared. | PASS |
| C02-R6-03 | Parser carries absolute warning byte ranges through poller; invalid rotated gaps use the skipped interval/cursor, never `[EOF,EOF]`. | PASS |
| C02-R6-04 | Production regressions cover cleanup/owner/barrier/restart and valid/invalid rotation; focused `18 files/96 tests`. | PASS |
| C02-R6-05 | Controlled live rollback used distinct resolved runtime images and recorded before/after Docker ownership, health, cursor and deployment counts. | PASS |
| C02-R5-02/04/05/06 | Durable unknown barrier, committed-byte retry, lineage image resolution and pipeline regressions retained and re-run. | PASS |

## Local gates

All commands exited `0`:

```text
app> pnpm exec vitest run --maxWorkers=1 src/main/db src/main/monitor src/main/deploy src/main/shutdown.test.ts
18 files, 96 tests passed
app> pnpm typecheck
app> pnpm exec tsc -p tsconfig.scripts.json --noEmit
app> pnpm exec eslint <scoped changed production/test files>
app> pnpm exec prettier --check <scoped changed production/test files>
app> pnpm build (renderer 3045 modules)
ml-service> .venv\Scripts\python.exe -m pytest -q       19 passed
collector> ..\ml-service\.venv\Scripts\python.exe -m pytest -q  26 passed
```

## Live mutation ledger

Target was only VM02 id `2`, app id `1`, `a17-notes-0911`; app B was inspect-only and ML was not
trained/scored. Commands from `app`, after local green:

```text
pnpm exec tsc -p tsconfig.scripts.json                  exit 0
node scripts/prepare-cli.js                              exit 0
pnpm exec electron ..\tools\a17-c02-live-rollback.cjs   exit 0
pnpm exec electron .out-scripts/scripts/a17-c02-live.js  exit 0
```

Raw rollback result:

```json
{"before":{"deployment":20,"row_tag":"a17-notes-0911:v20","resolved":"a17-notes-0911:v15","docker":"a17-notes-0911:v15|running"},"target":{"deployment":19,"row_tag":"a17-notes-0911:v19","resolved":"a17-notes-0911:v16"},"after":{"deployment":21,"is_rollback_of":19,"row_tag":"a17-notes-0911:v21","resolved":"a17-notes-0911:v16","docker":"a17-notes-0911:v16|running","health_exit":0}}
```

The helper events retained collector stop/flush, compose recreation, collector start, runtime
inspect and healthcheck success. Live runner raw output:

```json
{"before":{"metrics":4836,"scores":24180,"offset":1418551},"after":{"metrics":5257,"scores":26285,"offset":1542238},"mutation":{"metrics":421,"scores":2105,"scores_per_metric":5},"retry_inserted":0,"reconnect_inserted":0,"duplicates":0,"deployment_21_rows":5,"scheduler":{"ticks":2,"max_concurrent":1,"active_after_stop":false,"process_exit":0}}
```

Read-only final verification: A17 app `a17-notes-0911:v16|running|restart 0`, collector running,
PostgreSQL `postgres:16-alpine|running|restart 0`, health HTTP `200`, PostgreSQL marker query
returned `210`; app B containers remained running/restart `0`. No SQLite/PostgreSQL history was
reset, deleted, or reassigned. ML scores remain null where no model result exists.

## Contract mapping

- C02-T1/T2: migration/activation persistence and v1/partial-v2 tests — PASS.
- C02-T3: collector boundary, stream identity/size and rotation — PASS.
- C02-T4: routing, dedupe, transaction and five-score cardinality — PASS (`421/2105`, duplicates `0`, deployment 21 `5 rows`).
- C02-T5: real `MonitorService`/`MonitorScheduler` — PASS (two ticks, max `1`, clean stop, exit `0`).
- C02-T6: audit/live recovery evidence — PASS.
- C03-T1 onward — `NOT_RUN`; C03-C09 remain unopened.
