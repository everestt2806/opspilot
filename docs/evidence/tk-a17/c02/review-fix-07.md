# C02 REVIEW-FIX 07 evidence

- Scope: TK-A17/C02 only. Base `1b2f150` (Leader review-07 request), code `65d85ac`, docs
  before this append `413ec20`. C03-C09 remain closed/`NOT_RUN`.
- Preserved untracked `.devflow/`, `docs/ban-giao-20-08.md`, and `logo.png`.

## Findings and regressions

| Finding | Fix / regression | Result |
| --- | --- | --- |
| C02-R7-01 / R6-02 | `MonitorService` uses `DeploymentRepository.runtimeImageTag()` for prepared and active owners under the app lock; cycle/missing lineage logs a barrier and leaves the row prepared. | PASS |
| C02-R7-02 / R6-03 | Rotation closes the old episode at committed `drained.nextOffset`; every invalid warning keeps its own absolute `[start,end]` range and valid rows after warnings remain in the old episode. | PASS |
| C02-R7-03 / R6-04 | Restart integration creates active v2 plus prepared rollback v3->v1, closes/reopens SQLite, initializes a new `MonitorService`, reconciles, and runs the second tick idempotently. | PASS |
| C02-R7-04 / R6-05 | Read-only deployment 20/21 activation, source and grouped metric/score evidence explains `416+5=421` and `2080+25=2105`; helper runtime events remain recorded in prior evidence. | PASS |

## Exact local gates

All commands exited `0`:

```text
app> pnpm exec vitest run --maxWorkers=1 src/main/db src/main/monitor src/main/deploy src/main/shutdown.test.ts
18 files, 98 tests passed
app> pnpm typecheck
app> pnpm exec tsc -p tsconfig.scripts.json --noEmit
app> pnpm exec eslint <scoped changed production/test files>
app> pnpm exec prettier --check <scoped changed production/test files>
app> pnpm build (renderer 3045 modules)
ml-service> .venv\Scripts\python.exe -m pytest -q       19 passed
collector> ..\ml-service\.venv\Scripts\python.exe -m pytest -q  26 passed
```

## Read-only live evidence

No live mutation was run for review-fix 07. Existing VM02/A evidence was read-only and showed:

```json
{
  "target": "VM02/app 1/a17-notes-0911",
  "source": {"generation": "2050:520983", "size": 1720293},
  "sqlite": {"metrics_offset": 1543119, "metrics_stream_generation": "2050:520983"},
  "activation": [
    {"id": 10, "deployment_id": 20, "start": 1417093, "end": 1541655, "generation": "2050:520983", "state": "closed"},
    {"id": 11, "deployment_id": 21, "start": 1541655, "end": null, "generation": "2050:520983", "state": "active"}
  ],
  "grouped_counts": [
    {"deployment_id": 20, "metrics": 424, "scores": 2120, "seq": "4832..5255"},
    {"deployment_id": 21, "metrics": 5, "scores": 25, "seq": "5256..5260"}
  ]
}
```

The runner baseline before the prior live mutation had 8 deployment-20 rows; after the mutation
there were 424, so the mutation is `416` backlog metrics to deployment 20 plus `5` healthcheck
metrics to deployment 21. Scores are exactly `416*5 + 5*5 = 2080+25 = 2105`; no rows were
reassigned or deleted. The source cursor advanced from `1418551` to `1542238` in the raw runner,
then to the current read-only cursor `1543119` as the collector continued writing. Final A17
runtime remained `a17-notes-0911:v16|running|restart 0`, collector and PostgreSQL were running,
health was HTTP `200`; app B was inspected read-only only and remained running/restart `0`.

## C02 mapping

- C02-T1/T2: lineage resolver, cycle/missing barrier, close/reopen migration/activation — PASS.
- C02-T3: mixed invalid rotation, UTF-8/partial/complete warning ranges, tail/DB/callback retry — PASS.
- C02-T4: routing, dedupe, activation ranges and five scores/sample — PASS.
- C02-T5: production service/scheduler behavior remains covered by prior live evidence — PASS.
- C02-T6: deployment 20/21 raw-derived activation and grouped counts — PASS.
- C03-T1 onward: `NOT_RUN`; C03-C09 remain unopened.
