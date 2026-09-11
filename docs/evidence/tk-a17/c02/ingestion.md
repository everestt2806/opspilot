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
