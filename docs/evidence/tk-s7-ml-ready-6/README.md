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

## Lifecycle review correction

The current harness confirms the owned child has exited **and** the exact
loopback listener is gone. On Windows, `taskkill /T /F` has a deadline and its
exit status is checked; the listener PID must be the harness child or a
verified descendant in its Win32 process ancestry. A fallback kill or stop
deadline error makes the run fail even if cleanup later succeeds. Scratch
removal and production-state hashing run in `finally`; the `PASS` summary and
CSV are written only after those checks pass. The previous summary and data
are preserved as `*-b66c6b1` history. Failed attempts have separate
`run-failure-*.json` records, each with cleanup and state-integrity checks;
they do not leave a current `run-summary.json` marked PASS.

The final rerun at `2026-10-21T16:23:50Z` passed the full HTTP sequence again:
150 training samples, 30 chronological ingests, same-state restart and a
post-restart score. `run-summary.json` records all final cleanup checks true.
The earlier bounded startup/owner-detection attempts are retained in the
failure records with unchanged production state and completed cleanup.

Focused regression coverage includes taskkill failure, a still-running child
past deadline, startup/train/restart exceptions, scratch-delete failure,
occupied port handling, and a real Windows parent-plus-listener-child tree
that is terminated with its listener released.

## Interpretation limits and remaining blockers

This proves the local HTTP API lifecycle and persistence behavior for a
historical normal-data training smoke only. It does not run the 75-minute
protocol, create fault labels, or establish model quality. ML pilot blockers
remain as documented by LIVE-0 and ML-READY-5: dedicated-host isolation,
hardware/storage requirements, clock skew, and ML endpoint/provider gates.
No VPS, DNS, firewall, service, app, load generator, or fault was touched.
