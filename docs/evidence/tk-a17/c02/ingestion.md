# C02 Ingestion Evidence

## Boundary and target

- Target: VM02 / app `1` / `a17-notes-0911` / deployment `9`.
- Metrics source: `/opt/opspilot/a17-notes-0911/metrics/metrics.jsonl` via `SshMetricSource`.
- SQLite database: real OpsPilot profile; no reset or delete was performed.
- C01 inherited boundary before this run: `metrics_offset=6152`, 21 metrics, 105 scores.
- The first live run had already safely committed real rows before its retry assertion was corrected; this C02 run therefore records the actual current boundary rather than reconstructing a clean database.

## Live run

Command, cwd and runtime:

```text
pnpm exec tsc -p tsconfig.scripts.json
node scripts/prepare-cli.js
pnpm exec electron .out-scripts/scripts/a17-c02-live.js
cwd: D:\Developing\DuAnCNTT\app
runtime: Node v24.16.0, Electron 39.2.6, pnpm 11.1.0
exit: 0
```

The CLI is hard-scoped to VM02/app 1/deployment 9, uses the stored credential without printing it, and does not start the scheduler or ML service.

| Observation | Before | After first poll | After same-snapshot retry | After SSH reconnect poll |
| --- | ---: | ---: | ---: | ---: |
| metric rows | 2131 | 2141 | 2141 | 2141 |
| score rows | 10655 | 10705 | 10705 | 10705 |
| `metrics_offset` | 624525 | 627450 | 627450 | 627450 |
| deployment 9 rows | 2110 | 2120 | 2120 | 2120 |
| inserted metrics | - | 10 | 0 | 0 |

The source byte boundary was `624525 -> 627450`; the first batch added 10 samples and 50 score rows. Every new sample received five score rows. Retry with the frozen same snapshot inserted zero rows and did not change the offset. Reconnect completed without a duplicate or fabricated sample.

## SQL invariants

Read-only inspection after the run:

```text
app 1: name=a17-notes-0911, current_deployment_id=9, metrics_offset=627450
deployment 9: min_seq=22, max_seq=2141, rows=2120
score methods for deployment 9: rule=2120 non-null; zscore_ewma/iforest/ocsvm/ensemble=2120 null
duplicate (deployment_id,seq) groups: 0
deployment row counts: deployment 2=2, 3=11, 5=8, 9=2120
```

The null ML fields are reported as null; C02 makes no ML train/score claim. Existing rule scores are preserved and are not presented as ML output.

## C02-T1...T6 and related R checks

| Case | Result | Evidence |
| --- | --- | --- |
| C02-T1 live SSH -> SQLite batch, five score rows/sample | PASS | CLI JSON above; before/after boundary and SQL invariant |
| C02-T2 repeat/dedupe/byte offset | PASS | retry inserted `0`, offset unchanged, duplicate groups `0`; `poller.test.ts` |
| C02-T3 partial/invalid/UTF-8/rotation/reconnect | PASS | focused monitor tests: 71/71; reconnect test preserves offset and resumes |
| C02-T4 deployment boundary | PASS | deployment-boundary regression; deployment 1 and 2 rows remain separated; live deployment 9 dedupe `0` |
| C02-T5 scheduler overlap/shutdown lifecycle | PASS | focused monitor suite includes scheduler/service/shutdown tests; live CLI intentionally does not start scheduler |
| C02-T6 focused tests, typecheck, lint, format, build | PASS | commands recorded in handoff-c02.md |
| R01-R25 | NOT_RUN beyond C02-related ingestion/lifecycle checks | C03+ contracts and demo matrix remain closed |

## State after verification

- App deployment 9, PostgreSQL and collector were not modified by this worker; no app B action was performed.
- ML service/model, UI, faults, rollback policy and C03 remain NOT_RUN.
- Collector/VM live status is inherited from the approved C01 VM02 manifest; C02 live verification only read the metric source and used it for ingestion.

## Review-fix 02 evidence

### Historical runner attempts and arithmetic

The two live runner attempts are recorded as separate audit entries; SQLite was not reset,
deleted, or reassigned.

| Attempt | Command / cwd / runtime | Before | After | Exit | Raw output |
| --- | --- | --- | --- | ---: | --- |
| A | `pnpm exec electron ..\\tools\\a17-c02-live.cjs`, `app`, Node v24.16.0/Electron 39.2.6 | offset 6152; 21 metrics; 105 scores | Not recoverable as a separate snapshot | 1 (helper assertion/hang cleanup) | `MISSING` |
| B | `pnpm exec tsc -p tsconfig.scripts.json`; `node scripts/prepare-cli.js`; `pnpm exec electron .out-scripts/scripts/a17-c02-live.js`, `app`, Node v24.16.0/Electron 39.2.6 | offset 624525; 2131 metrics; 10655 scores | offset 627450; 2141 metrics; 10705 scores | 0 | Recorded in this file and runner output |

The historical reconciliation is `21+2120=2141` metrics and `105+2120*5=10705`
scores. The first attempt's raw output is unavailable and is intentionally not reconstructed.
The 80 historical rows remain unchanged for audit.

### Forward deploy, manual rollback, and activation proof

Commands were run from `app` against only VM02 / app `1` / `a17-notes-0911`; no app B
operation was performed.

```text
pnpm exec electron ..\\tools\\a17-c01-live.cjs
exit: 0; forward healthchecks passed; PostgreSQL marker 1004 -> 1005

pnpm exec electron ..\\tools\\a17-c02-live-rollback.cjs
exit: 0; manual rollback completed; current deployment 14 was healthy
```

The interrupted first rollback helper left deployment `13` in `building`; it is not current
and was not deleted, reset, or reassigned. Current target was restored healthy on deployment
`14`.

Persistent activation ranges read from SQLite after the controlled runs:

```text
deployment 9:  [627450,975570)
deployment 10: [975570,976462)
deployment 11: [976462,980273)
deployment 12: [980273,997293)
deployment 14: [997293,open)
```

Sequence ranges by deployment were `9: 22..3327 (3306 rows)`,
`10: 3328..3330 (3 rows)`, `11: 3331..3343 (13 rows)`, and
`12: 3344..3381 (38 rows)`. Duplicate `(deployment_id, seq)` groups remained `0`.

### Real scheduler and final live state

The live command compiled and prepared the script, then ran the production
`MonitorService` and `MonitorScheduler`:

```text
pnpm exec tsc -p tsconfig.scripts.json
node scripts/prepare-cli.js
pnpm exec electron .out-scripts/scripts/a17-c02-live.js
cwd: app
exit: 0
```

Before the live scheduler run: `2141` metrics, `10705` scores, offset `627450`.
After ingestion/retry/reconnect: `3378` metrics, `16890` scores, offset `990547`.
Two real 30-second scheduler ticks completed: tick 1 inserted `0`, tick 2 inserted `3`,
final counts were `3381` metrics and `16905` scores at offset `991422`. `max_concurrent=1`
and `active_after_stop=false`; service/scheduler stopped and closed cleanly with process exit `0`.

Final read-only VM02 verification:

```text
A17 app=running restarts=0 health=healthy image=a17-notes-0911:v11
A17 db=running restarts=0 health=healthy
A17 collector=running restarts=0
PostgreSQL records=1005
App B express-demo-app=running restarts=0
Latest raw metric seq=3407
```

### Regression and gate closure

Focused C02 coverage now includes v1->v2 migration/lazy legacy initialization, backlog across
forward deploys, candidate healthcheck metrics, pre/post-runtime failure, manual and repeated
auto rollback activation, prepared-crash fail-closed, scheduler/deploy shared-lock no-overlap,
rotation with a smaller/larger replacement file, retry/dedupe/cardinality and transaction
rollback. The focused suite passed `82` tests across `18` files. Collector pytest passed
`19` tests using `ml-service/.venv`; typecheck, scripts typecheck, scoped lint/format and
build all exited `0`. ML train/score, UI, fault coordinator and C03-C09 remain `NOT_RUN`.

## REVIEW-FIX 03 evidence

### Local regression and exact gates

The focused command was run from `D:\\Developing\\DuAnCNTT\\app`:

```text
pnpm exec vitest run --maxWorkers=1 src/main/db src/main/monitor src/main/deploy src/main/shutdown.test.ts
exit: 0; 18 files, 88 tests passed
pnpm exec tsc -p tsconfig.scripts.json
exit: 0
pnpm typecheck
exit: 0
pnpm exec eslint src/main/db/index.ts src/main/db/index.test.ts src/main/deploy/pipeline.ts src/main/deploy/pipeline.test.ts src/main/monitor/activation.ts src/main/monitor/activation.test.ts src/main/monitor/metricSource.ts src/main/monitor/poller.ts src/main/ssh/manager.ts
exit: 0
pnpm exec prettier --check src/main/db/index.ts src/main/db/index.test.ts src/main/db/migrations/002_metric_activation.sql src/main/deploy/pipeline.ts src/main/deploy/pipeline.test.ts src/main/monitor/activation.ts src/main/monitor/activation.test.ts src/main/monitor/metricSource.ts src/main/monitor/poller.ts src/main/ssh/manager.ts
exit: 0
pnpm build
exit: 0; renderer 3045 modules
ml-service/.venv/Scripts/python.exe -m pytest -q
cwd: ml-service; exit: 0; 19 passed
```

The regressions exercise production `DeployPipeline` and `MonitorPoller`: first deploy with
missing metrics file, stop/flush failure, candidate cutover, migration v1 fixture with history
and partial v2 reopen, matching `.1` drain, missing/mismatched `.1` explicit gap, five-score
cardinality, dedupe and offset preservation. Migration `002` and its `schema_version` write are
applied in one transaction; migration `001` was not edited.

### Controlled live forward and rollback

Target was only VM02 / app `1` / `a17-notes-0911`; commands were run from `app`:

```text
pnpm exec electron ..\\tools\\a17-c01-live.cjs
exit: 0; forward deployments 15 and 16 running; stop/flush collector ran before each snapshot;
PostgreSQL marker 1005 -> 1006; source snapshot identity 2050:520983 and size/boundary were
captured by production `stat -c '%d:%i:%s'` before compose up.

pnpm exec electron ..\\tools\\a17-c02-live-rollback.cjs
first attempt: exit 1, deployment 17 failed with SSH error; no activation row was committed
for 17 and deployment 16 remained current.
retry: exit 0, deployment 18 running, is_rollback_of=16; stop/flush and snapshot completed,
activation boundary was [1165732,open) after the previous episode closed at 1165732.
```

The first helper failure is retained as evidence, not counted as PASS. The successful retry
restored the target to healthy deployment 18 using image `a17-notes-0911:v16`; no historical
rows were reset, deleted, or reassigned.

### Live raw JSONL to SQLite and scheduler

Read-only SQLite after rollback and ingestion:

```text
deployment 9:  [627450,975570)
deployment 10: [975570,976462)
deployment 11: [976462,980273)
deployment 12: [980273,997293)
deployment 14: [997293,1163385)
deployment 15: [1163385,1163965)
deployment 16: [1163965,1165732)
deployment 18: [1165732,open)
current deployment=18, generation=2050:520983, offset=1167490
```

The live runner used the real `MonitorService` and `MonitorScheduler`:

```text
pnpm exec tsc -p tsconfig.scripts.json
node scripts/prepare-cli.js
pnpm exec electron .out-scripts/scripts/a17-c02-live.js
cwd: app; exit: 0
before: 3381 metrics, 16905 scores, offset 991422
first poll: +596 metrics, +2980 scores, offset 1166319
same-snapshot retry: +0, unchanged offset
SSH reconnect: +1 metric, +5 scores, offset 1166612
tick 1: inserted 0, offset 1166612
tick 2: inserted 3, offset 1167490
max_concurrent=1; active_after_stop=false; process exit=0
```

Final SQLite totals were `3981` metrics and `19905` scores, with zero duplicate
`(deployment_id,seq)` groups; every inserted metric has five score rows. Raw JSONL identity and
size after the run were `2050:520983:1168072`, latest raw sequence `3983`.

### Final read-only state

```text
A17 app=running restarts=0 health=healthy image=a17-notes-0911:v16
A17 db=running restarts=0 health=healthy
A17 collector=running restarts=0
PostgreSQL records=1006
App B express-demo-app=running restarts=0
```

C03-C09 remain closed/`NOT_RUN`; no ML train/score, UI, fault coordinator or app B mutation was
performed.
