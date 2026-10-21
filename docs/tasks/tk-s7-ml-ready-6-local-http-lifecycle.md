# TK-S7 ML-READY-6 — local isolated ML HTTP lifecycle

| Owner | Deadline | Branch | Brief | Priority |
|---|---|---|---|---|
| Worker | 21/10/2026 | `feat/deploy-reachability` | Real HTTP train/ingest/restart verification in isolated scratch | P1 |

## Objective

Run the real ML service from an isolated source copy and empty state directory, using only the documented HTTP API and the verified ML-READY-1 historical split. Verify persistence across restart and prove the existing app model state remains unchanged.

## Requirement ledger

| Requirement | Current check/evidence | State |
|---|---|---|
| Start real service only on explicit loopback port from isolated source/state; refuse occupied port | Harness uses `prepareIsolatedMlService`, empty copied state, fixed `127.0.0.1:18765`; busy-port regression 1/1; Node 22 real HTTP lifecycle PASS | PASS |
| Use HTTP health/status, train 150 chronological samples, then ingest 30 holdout samples and validate four finite scores | Real HTTP health/status PASS; train 150 seq 9118–9267 with 131 feature vectors; ingest seq 9268–9297, all methods finite/in [0,1]; CSV artifact | PASS |
| Restart owned service with same state; confirm loaded model and continue inference | Restart status trained=true, train_sample_count=150, sample_count=180; repeated final holdout seq 9297 scored after restart; child-stop test PASS | PASS |
| Hash production state before/after; clean only owned process/scratch on all outcomes | SHA-256 map of 22 files in `production-state-integrity.json` identical; service stopped, port released, scratch absent. Initial trial exposed Windows parent-only termination; harness now uses bounded `taskkill /T /F` for its own child tree and cleanup was re-run successfully | PASS |
| Run relevant tests, Ruff and diff check | Node 22.23.3: TS main/scripts typecheck PASS, focused Vitest 3/3, scoped ESLint PASS; ML service pytest 19/19; scoped Ruff PASS; `git diff --check` PASS | PASS |
| Preserve pilot blockers and state that this is not pilot/accuracy evidence | README and summary explicitly say historical normal-data smoke only; no labels or accuracy metrics; dedicated-host, hardware/storage, clock-skew, ML endpoint/provider gates remain blocked | PASS |

## Constraints

No VPS, pilot, loadgen, fault, contract/schema edits, production model state mutation/reset, or unrelated/untracked file changes. This is historical normal-data smoke only.

## Journal

### START 21/10

- Base `2d3867a48bf3e21bea62ae6787d431cea09baf12`, branch `feat/deploy-reachability`.
- Read task-discipline, `CLAUDE.md`, task process, ML API contract, and ML-READY-1/3/5 records.
- Preserve existing untracked files. Implement a rerunnable HTTP harness using `prepareIsolatedMlService` and a fixed loopback endpoint.

## Reproduction

See [`../evidence/tk-s7-ml-ready-6/README.md`](../evidence/tk-s7-ml-ready-6/README.md). Command:

```powershell
pnpm --dir app exec tsc -p tsconfig.scripts.json
node app/.out-scripts/scripts/ml-ready-6-http.js
```

### UPDATE 21/10 — isolated HTTP lifecycle and gates

- Added `app/scripts/ml-ready-6-http.ts`, which refuses the explicit loopback port if busy, copies only ML source with the existing isolation helper, starts the real FastAPI service, and uses the contract endpoints via HTTP only. It trains on the first 150 verified historical samples, ingests the next 30 chronologically, stops the owned service process tree, restarts from the same isolated state and verifies post-restart scoring.
- One initial harness attempt exposed Windows `child.kill()` terminating only the parent while the spawned Python listener remained. The harness was corrected to use a bounded `taskkill /T /F` scoped to its exact owned child PID, await exit, and verify/remove only its own prefixed scratch below the OS temp root. The one owned leftover PID from that failed attempt was explicitly stopped and its exact scratch removed before rerun. No unrelated process or port was touched.
- Final real run via Node `v22.23.3` at `2026-10-21T04:58:23Z`: `/health` status ok; empty state `/status` trained=false/sample_count=0; `/train` trained 150, 131 feature vectors, feature version `v1-5metrics-4feats-w20`; trained status confirms 150; all 30 HTTP ingests returned ready and all four method scores finite in `[0,1]`. No warm-up needed after train. After restart the model reloaded with 180 persisted samples and successfully scored the final historical row again (seq 9297; explicitly a repeated observation, not a new source sample).
- Artifacts: `docs/evidence/tk-s7-ml-ready-6/run-summary.json`, `inference-scores.csv` (30 rows), `production-state-integrity.json` (per-file hashes for all 22 existing state files; before/after maps identical), and README. Final listener check found no process on port 18765; no `opspilot-ml-ready-6-*` scratch remained.
- Node 22.23.3: scripts TypeScript compile + main/scripts no-emit typecheck PASS; focused Vitest 3/3 PASS (busy port, score validation, owned child cleanup); scoped ESLint PASS. `ml-service/.venv/Scripts/python.exe -m pytest ml-service/tests -q` — 19 passed; scoped Ruff — PASS; `git diff --check` — PASS. No contract/schema change, VPS/pilot/loadgen/fault, or production-state write.
- Historical normal-data HTTP lifecycle smoke only. No fault labels or accuracy/precision/recall claims. Pilot blockers remain: dedicated host, hardware/storage requirement, clock skew, and ML endpoint/provider gates.

### HANDOFF-LOCAL 21/10 — pending commit SHA

Local only; no push/PR/merge.
