# ML-READY-7 — Monitor → ML HTTP → SQLite

This is an isolated local integration check using the real TypeScript
`HeadlessPoller`, `MonitorService`, monitor repository/SQLite writes and the
real ML FastAPI HTTP service. The only substituted boundary is SSH metric
reading, served from the published historical collector fixture. No production
database or model state is opened for writes.

## Reproduction

From the repository root in PowerShell, using Node 22.23.3 and the existing
Python virtualenv:

```powershell
Push-Location app
$env:PATH = "C:\Users\everestt28\AppData\Local\npm-cache\_npx\52027bd8fc0022aa\node_modules\node\bin;$env:PATH"
node --version
node node_modules/typescript/bin/tsc -p tsconfig.scripts.json
node .out-scripts/scripts/ml-ready-7-monitor-http.js
Pop-Location
```

The harness refuses a busy `127.0.0.1:18766`, creates a private temp
directory, a temporary SQLite DB from the current schema contract, and an
isolated source copy of the ML service with absent state. It inserts 150 rows
through the real monitor poller using the fixture-backed SSH interface,
trains via `MonitorService.trainNow` and `MlApiClient` HTTP, then sends the
next 30 chronological rows through `HeadlessPoller` and the same HTTP client.
It drains the poller and repeats a poll to test idempotency. The second valid
deployment in SQLite receives an empty fixture stream to verify score identity.

## Result

`run-summary.json` is written only after the process exits, listener is
released, scratch is removed, and production database/model-state hashes
match. The final run passed on Node 22.23.3: 150 baseline metrics in SQLite,
30 holdout metrics, 30 scores each for `zscore_ewma`, `iforest`, `ocsvm`, and
`ensemble`; all scores finite and in `[0,1]`. Each holdout has the matching
deployment, sequence and timestamp, repeated polling added no rows, and the
other deployment has no scores. Headless poller drain completed. The real ML
process stopped, port 18766 was free, temp scratch was absent, production DB
plus SQLite WAL/SHM hashes were unchanged, and the 22-file production model
state hash map was unchanged.

`run-failure.json` preserves a diagnostic harness attempt where the temporary
fixture deployment pointer was seeded with the wrong ID. The cause was fixed
in the harness before the passing runs; it did not involve application code or
production state, both of which remained untouched.

## Scope limits

The samples are historical normal operational data. The SSH boundary is a
local fixture. This is not a VPS check, 75-minute pilot, fault run, accuracy,
precision, recall, F1, fault-detection evidence, or real auto-rollback check.
No contract/schema was changed.
