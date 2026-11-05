# ML-READY-7 — Monitor → ML HTTP → SQLite integration

| Owner | Deadline | Branch | Brief | Priority |
|---|---|---|---|---|
| Worker | 21/10/2026 | `feat/deploy-reachability` | Isolated monitor poller + real ML HTTP + SQLite verification | P1 |

## Requirement ledger

| Requirement | Change or evidence | State |
|---|---|---|
| Use real monitor/headless poller, repository, temporary SQLite/model state/processes; replace SSH with explicit historical fixture only | Final harness run PASS; temporary DB/model state and fixed SSH fixture | PASS |
| Train 150 historical baseline rows, then process 30 chronological rows over ML HTTP | Real `MonitorService.trainNow` + `MlApiClient` HTTP, then `HeadlessPoller` ingest | PASS |
| Verify deployment/timestamp/method identity, finite [0,1] score, dedupe and no cross-deployment writes | 30 holdouts, 4×30 finite scores, identity SQL assertions, repeat poll zero additions, deployment 22 has zero score rows | PASS |
| Confirm drain/stop, listener/scratch cleanup, and unchanged production DB/model state before PASS | Final summary: drain, process stopped, listener free, scratch absent; production DB/WAL/SHM and 22 model-state file hashes identical | PASS |
| Preserve scope and report fixture/normal-data limits; update board and commit locally | README + run summary; no contract/schema, VPS, pilot, loadgen, fault, or actual rollback | PASS |
| Node 22 + existing Python gates and diff check | Node 22.23.3 focused tests 46/46, typecheck/build/scoped lint PASS (0 warnings); ML pytest 19/19, Ruff PASS; `git diff --check` PASS | PASS |

## Constraints

No contract/schema change, VPS activity, deployment, pilot, loadgen, fault or real auto-rollback. Source rows are historical normal data, not accuracy/F1 or pilot evidence. Keep pre-existing untracked files intact.

## Journal

### START 21/10

- Base `56bafd8789a804d6821134ddd71360b96a05a8da`, branch `feat/deploy-reachability`.
- Read task-discipline, `CLAUDE.md`, `DECISIONS.md`, metric contract, ML API contract, MonitorPoller, MonitorService, HeadlessPoller, repositories and ML-READY-6 isolation harness.
- Plan: real FastAPI HTTP service in private scratch; temporary SQLite seeded through the real MonitorPoller with the first 150 public historical metric rows and fixed SSH fixture; train through MonitorService HTTP client; then process the remaining 30 using HeadlessPoller and the same SQLite/repository. Repeat poll/drain for idempotency and inspect row identity. Never use production DB/model state for writes.

### UPDATE 22/10 — integrated run and gates

- Added rerunnable `app/scripts/ml-ready-7-monitor-http.ts` and evidence under `docs/evidence/tk-s7-ml-ready-7/`. The fixture hashes are checked against ML-READY-1; raw source rows are validated for 180 count, seq 9118–9297 and exact 10-second chronology.
- Final real local integration run on Node 22.23.3 passed at recorded artifact time `2026-10-21T17:03:09Z`: temporary DB got 150 baseline samples through `HeadlessPoller`; `MonitorService.trainNow` sent exactly 150 to the isolated real ML service HTTP endpoint; 30 following samples were ingested by `HeadlessPoller` through HTTP. SQLite held 180 rows for deployment 11 and exactly 30 scores per each of four ML methods, all finite in [0,1], with timestamps/seq bound to source. A repeat poll left metric count at 180; deployment 22 received no scores.
- Final checks passed before evidence PASS was written: poller drain closed; real Python service process stopped; port 18766 released; scratch removed; production `opspilot.db`, `-wal`, `-shm` hashes unchanged; production model state all 22 file hashes unchanged. No VPS access or app deployment occurred.
- A first harness diagnostic run found fixture-only bad `current_deployment_id` (0 baseline rows); it is retained in `run-failure.json`. Corrected the fixture identity, reran successfully, and added explicit pre-train identity/count checks. No application defect was observed.
- Gates: Node 22.23.3 focused monitor/headless/repository tests 46/46 PASS (`node node_modules/vitest/vitest.mjs run src/main/monitor/poller.test.ts src/main/monitor/headlessPoller.test.ts src/main/monitor/service.test.ts`); script TS compile PASS (`node node_modules/typescript/bin/tsc -p tsconfig.scripts.json`); `pnpm run typecheck` PASS; `pnpm run build` PASS; scoped ESLint on the new harness PASS with 0 warnings; `ml-service/.venv/Scripts/python.exe -m pytest ml-service/tests -q` 19/19 PASS; `ml-service/.venv/Scripts/ruff.exe check ml-service` PASS; `git diff --check` PASS. Python sources were unchanged; pytest/Ruff checked compatibility of the real HTTP service.
- Interpretation remains historical normal-data integration smoke with fixed SSH metric fixture. Not pilot/accuracy/F1/fault/rollback evidence. No schema/contract changes.

### HANDOFF-LOCAL 22/10 — code/evidence `4cfdfa8e31835a51ef692b4418283c2f71a19681`

- Node 22.23.3: monitor/headless/service focused tests 46/46; scripts TypeScript compile, main/web typecheck, production build and scoped ESLint PASS (0 warnings).
- Python: ML service pytest 19/19, Ruff PASS. `git diff --check` PASS.
- Real integration evidence: `../evidence/tk-s7-ml-ready-7/run-summary.json`; reproducible harness: `../../app/scripts/ml-ready-7-monitor-http.ts`; run instructions and limits: `../evidence/tk-s7-ml-ready-7/README.md`.
- Local only on `feat/deploy-reachability`; no push, PR, merge, VPS access, deployment, pilot, loadgen, fault, schema/contract edit, or actual rollback. Existing untracked files preserved.

## Reproduction

From repo root in PowerShell with Node 22.23.3:

```powershell
Push-Location app
$env:PATH = "C:\Users\everestt28\AppData\Local\npm-cache\_npx\52027bd8fc0022aa\node_modules\node\bin;$env:PATH"
node --version
node node_modules/typescript/bin/tsc -p tsconfig.scripts.json
node .out-scripts/scripts/ml-ready-7-monitor-http.js
Pop-Location
```

Current real-run evidence: `../evidence/tk-s7-ml-ready-7/run-summary.json`.
