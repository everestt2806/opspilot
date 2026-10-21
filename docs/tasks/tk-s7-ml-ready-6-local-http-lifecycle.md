# TK-S7 ML-READY-6 — local isolated ML HTTP lifecycle

| Owner | Deadline | Branch | Brief | Priority |
|---|---|---|---|---|
| Worker | 21/10/2026 | `feat/deploy-reachability` | Real HTTP train/ingest/restart verification in isolated scratch | P1 |

## Objective

Run the real ML service from an isolated source copy and empty state directory, using only the documented HTTP API and the verified ML-READY-1 historical split. Verify persistence across restart and prove the existing app model state remains unchanged.

## Requirement ledger

| Requirement | Current check/evidence | State |
|---|---|---|
| Start real service only on explicit loopback port from isolated source/state; refuse occupied port | Existing isolation helper; occupied-port test; listener PID must match owned child or verified Windows process-tree descendant; final Node 22 HTTP run PASS | PASS |
| Use HTTP health/status, train 150 chronological samples, then ingest 30 holdout samples and validate four finite scores | Final run health/status PASS; train seq 9118–9267 (131 vectors); ingest seq 9268–9297, all methods finite/in [0,1]; current CSV artifact | PASS |
| Restart owned service with same state; confirm loaded model and continue inference | Final restart trained=true, train_sample_count=150, sample_count=180; repeated last holdout seq 9297 scored after restart | PASS |
| Confirm process tree/listener stop; hash production state and clean scratch in finally; PASS only after final checks | Final `run-summary.json` records child tree stopped, listener released, scratch removed, and 22 state-file SHA maps unchanged. Windows tree integration test PASS. Failure runs are separate records, with no stale PASS presented for those attempts | PASS |
| Exercise taskkill failure, deadline, startup/train/restart error cleanup and scratch-delete failure | Focused Vitest 11/11, including injected taskkill/fallback failure with non-exiting child, deadline, phase cleanup, scratch-delete failure and real Windows process-tree listener release | PASS |
| Run Node 22 typecheck/scoped lint, service tests, Ruff and diff check | Node 22.23.3 main/scripts typecheck PASS; focused Vitest 11/11; scoped ESLint PASS; service pytest 19/19; scoped Ruff PASS; `git diff --check` PASS | PASS |
| Preserve pilot blockers and normal-data interpretation limits | README/current summary state historical normal-data smoke only, no quality claims; dedicated-host, hardware/storage, clock-skew, ML endpoint/provider gates remain blocked | PASS |

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

## Correction per review of b66c6b1

### UPDATE 21/10 — cleanup confirmation, failure reports and live rerun

- Base correction `cf7e10566ca5133e4290a4f98183031c242c8fb7`. Reworked `stopOwnedChild`: Windows `taskkill /T /F` uses a command timeout and nonzero/error is preserved; fallback kill results are checked; completion requires parent exit and no listener on the fixed port before deadline. Deadline/failure returns `SERVICE_CLEANUP_FAILED` with reason codes. Windows listener owner is confirmed by PID or read-only Win32 parent ancestry; no other PID is killed.
- `executeWithCleanup` carries the primary phase error and cleanup errors separately. State hashing now runs in finalization for startup/train/restart failures. Scratch removal is path-verified and confirmed absent. An attempt first archives prior summary/CSV/hash evidence and removes the current summary; a failure produces `run-failure.json`, never a PASS summary. The PASS summary and score CSV are atomically written only after final process-tree, listener, scratch and production-state checks all pass.
- Final real HTTP rerun `2026-10-21T16:23:50Z` PASS: empty state, health/status, train 150 seq 9118–9267, 131 feature vectors, 30 chronological ingests seq 9268–9297 with all four finite scores in range, stop/restart against same scratch state, reload confirms 180 stored samples, post-restart inference on repeated seq 9297. Final 22-file production state hash maps are equal; listener and scratch are absent. Current artifacts are `run-summary.json`, `inference-scores.csv`, `production-state-integrity.json`; prior b66c6b1 outputs and subsequent attempts are preserved separately.
- Three diagnostic attempts before the final run are retained as `run-failure-2026-10-21T16-13-27-309Z.json` (startup timeout), `...16-14-41-029Z.json` (listener PID ownership not yet recognized), and `...16-15-17-090Z.json` (venv launcher PID 21136 vs listener PID 25920). Each records primary error, successful cleanup checks, unchanged production hashes; no old PASS was left as the result of those failures. PID ancestry verification resolved the legitimate launcher/listener PID distinction; final run then passed.
- Focused tests 11/11: busy port, scores, taskkill failed with successful fallback still reported as error, taskkill/fallback failure while child remains alive at deadline, startup/train/restart errors each run cleanup, cleanup errors retain the primary phase failure, scratch deletion failure prevents PASS, and actual Windows parent + listener-child tree is stopped with listener release.
- Gates: Node 22.23.3 script compile and main/scripts typecheck PASS; focused Vitest 11/11 PASS; scoped ESLint PASS; ML service pytest 19/19 PASS; scoped Ruff PASS (Python sources unchanged); `git diff --check` PASS. No contract/schema changes, VPS/pilot/loadgen/fault, or production state writes.

### HANDOFF-LOCAL correction 21/10 — `8278ebbfe2faf4621f8d6b0595db5bbc3b7764a2`

Final corrected harness/evidence commit. Node 22.23.3 compile and main/scripts typecheck PASS; focused Vitest 11/11 including Windows process-tree integration; scoped ESLint PASS; ML service pytest 19/19 and Ruff PASS; `git diff --check` PASS. Final real HTTP run `2026-10-21T16:23:50Z` PASS after process-tree/listener/scratch/state checks. Branch `feat/deploy-reachability`; local only, no push/PR/merge. This SHA is recorded in the board; this handoff record follows in a documentation-only local commit.

### HANDOFF-LOCAL 21/10 — `b66c6b1f390a5bcd3e5129b048881b51878dad68`

Node 22.23.3 focused lifecycle 3/3, service pytest 19/19, main/scripts typecheck, scoped ESLint, Ruff and diff check PASS. Real isolated HTTP lifecycle PASS; artifacts under `docs/evidence/tk-s7-ml-ready-6/`. Local only; no push/PR/merge. The board/task SHA is the implementation/evidence commit; this handoff record follows in a documentation-only local commit.
