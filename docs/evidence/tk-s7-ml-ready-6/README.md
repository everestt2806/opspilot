# ML-READY-6 — isolated local HTTP lifecycle

This is a real local ML-service HTTP lifecycle check using the historical
normal-data source verified in ML-READY-1. It is not a pilot, live VPS check,
or evidence of accuracy, precision, recall, or fault detection quality.

## Reproduction

From the repository root on Windows, with the existing ML virtualenv and Node
22 available:

```powershell
pnpm --dir app exec tsc -p tsconfig.scripts.json
node app/.out-scripts/scripts/ml-ready-6-http.js
```

The harness checks that `127.0.0.1:18765` is available before starting. It
copies only service source via `prepareIsolatedMlService`, requires an absent
isolated state directory, starts the copied FastAPI service on that explicit
loopback endpoint, and uses only `GET /health`, `GET /status`, `POST /train`,
and `POST /ingest`. It never calls Python model functions directly and does
not use `/reset` or `/replay`. It starts the same copied service again against
the same isolated state after stopping the first owned process.

The dataset is `docs/demo-11-10/ml-samples-v5-180.csv`, SHA-256
`9d2af5f64e64c3371fb988b54fef0770460368ddf935b456a605a1abd7bc425a`.
Training uses the first 150 rows (seq 9118–9267); inference uses the following
30 rows in chronological order (seq 9268–9297). The holdout is not used for
training/scaling. No warm-up rows were needed after training. After restart,
the harness re-ingests seq 9297 once to verify that the persisted model can
continue scoring; this repeated observation is not represented as a new
historical row.

## Results

- `run-summary.json`: train/status, inference, restart and cleanup summary.
- `inference-scores.csv`: four finite in-range method scores for each of the
  30 chronological holdout samples.
- `production-state-integrity.json`: per-file SHA-256 before and after for
  all existing files under `ml-service/state/`; the maps are identical.
- Service process stopped and scratch removed after the successful run. The
  isolated endpoint was not left listening.

The service state under `ml-service/state/` was only read for hashing. No app
model or production state was reset, copied, trained, or overwritten.

## Interpretation limits and remaining blockers

This proves the local HTTP API lifecycle and persistence behavior for a
historical normal-data training smoke only. It does not run the 75-minute
protocol, create fault labels, or establish model quality. ML pilot blockers
remain as documented by LIVE-0 and ML-READY-5: dedicated-host isolation,
hardware/storage requirements, clock skew, and ML endpoint/provider gates.
No VPS, DNS, firewall, service, app, load generator, or fault was touched.
