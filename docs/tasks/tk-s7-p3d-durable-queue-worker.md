# TK-S7 P3d — durable queue worker and internal scheduler

| Owner | Date | Branch | Status | Base |
|---|---|---|---|---|
| Worker | 22/10/2026 | `feat/deploy-reachability` | CHỜ REVIEW | P3c code `35c163c`; accepted dossier `4884836` (Leader approved) |

## Scope

Implement one internal controller worker using the existing Product SQLite claim, heartbeat and pre-write completion primitives. Runtime has no deployment executor configured and stays polling-only. An explicitly injected internal executor is used only by tests/local composition. No API/UI, Docker/SSH executor, remote target, production DB or migration change.

P3c review is recorded with its accepted limit: P3c proves Linux controller bootstrap/polling and Git process-tree timeout/cancellation/shutdown only; it did not implement or prove a deployment executor.

## Requirement ledger

| Requirement | Implementation/evidence | State |
|---|---|---|
| One active task; reuse atomic `claimNextJob`; manual priority, timing, retry, desired/pause/ownership and both leases remain repository-owned | Sequential worker delegates all eligibility, priority, retry and durable lease/fence decisions to existing atomic repository claim; claims only with executor and admission configured | PASS |
| No placeholder success; unsupported/manual rollback and uncertain work remain blocked for reconciliation | No configured runtime executor means polling-only/no claim. Only allowlisted pre-write failures use `finishPrewriteAttempt`; unknown dispatch never finalizes/promotes/releases. Unsupported rollback halts with explicit `unsupported_job` and degraded health | PASS |
| 15 s serialized heartbeat / 60 s TTL, loss/DB error aborts and requires reconciliation; no stale lease release or late completion | Uses contract 15 s heartbeat and repository 60 s TTL. Heartbeats do not overlap; rejection/DB error aborts and halts. Racing executor completion cannot pre-write-finish after lost heartbeat; no TTL-based release | PASS |
| Shutdown drains claim loop, aborts active executor and has a finite stop confirmation deadline; unconfirmed task is not reported clean | Controlled task stop preserves claim/leases for reconciliation. Unconfirmed stop marks unsafe-to-close; late completion cannot mutate persistence | PASS |
| Admission hook defers before claim; idle/busy/blocked paths wait rather than spin | Executor requires explicit admission hook; unknown/error defers before claim. Empty/busy/deferred paths wait at bounded interval; no actual capacity is inferred | PASS |
| SQLite contention/restart/lifecycle regression | Independent workers/connections, retry timing, heartbeat renew/reject/error, unsupported rollback, late completion and dispatch-unknown reopen covered; Linux file-backed lab confirms one executor and durable claim/leases | PASS |
| Linux Node 22 isolated composition, existing regression suite, typecheck/lint/build/diff | Node 22.23.4 strict typecheck PASS; 9 files/88 tests PASS; scoped ESLint and diff check PASS; Linux Node 22 artifact build and controlled-executor SQLite lab PASS | PASS |

## Journal

- START 22/10 — Read task-discipline, `CLAUDE.md`, ADR-011, P3a, Product deploy contract, current controller/poller composition, and claim/heartbeat/pre-write/dispatch repository APIs. Worktree contains pre-existing untracked `%TEMP%/`, `.agents/`, `SKILL.md`, `report/`, `run.ps1`, and `start-opspilot.bat`; preserve them. No changes to these files.
- REVIEW INPUT — Leader approved P3c code `35c163c` / dossier `4884836`: 102 focused tests, Node typecheck, Linux real Git timeout/cancellation and controller shutdown PASS. Accepted scope was controller bootstrap, outbound Git polling and process lifecycle; no deployment executor was implemented or proved.
- IMPLEMENTATION — Added sequential internal worker and controller composition. Existing repository owns claim, lease/fence, priority, desired and retry semantics. Production composition has no executor and stays polling-only. Added read-only claim execution-state inspection. Heartbeat rejection/DB error aborts executor and preserves durable state for reconciliation; late completion after unconfirmed stop cannot mutate rows. Unsupported rollback now halts as `unsupported_job` and health is degraded instead of recurring through the queue. No schema/migration, contract, API/UI, VPS, poller, or remote-executor changes.
- GATES 22/10 — Node 22.23.4 on Windows: `npm exec --yes --package=node@22 -- node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` PASS. `npm exec --yes --package=node@22 -- node ./node_modules/vitest/vitest.mjs run src/main/controlPlane src/main/db/productJobClaim.test.ts src/main/db/productDesiredReconciliation.test.ts src/main/db/productDeployRepository.test.ts src/main/db/productMigration.test.ts src/main/db/index.test.ts` PASS, 9 files / 88 tests. Scoped ESLint on worker/service/repository/Linux harness PASS without warnings/errors. `git diff --check` PASS.
- LINUX LAB 22/10 — WSL Ubuntu Node `v22.23.4`, isolated Linux modules at `/var/tmp/opspilot-p3c-lab-20261022b/runtime/node_modules`. `scripts/build-control-plane.mjs` built `/var/tmp/opspilot-p3d-control-plane.cjs`. `scripts/control-plane-worker-linux-lab.mjs node /var/tmp/opspilot-p3c-lab-20261022b/runtime/node_modules` ran with temporary file-backed SQLite and two connections/workers; output: `workers=2`, `executors_called=1`, `heartbeat_renewed=true`, `shutdown_outcome=reconciliation_required`, claim and both leases preserved, `remote_deploy=false`. Harness cleaned temporary DB/process/artifact. This controlled executor does not prove a real deployment or real VPS resource sufficiency.
- PLATFORM LIMIT — Linux direct TypeScript/Vitest attempt using `/mnt/d` workspace dependencies failed at Vitest startup because optional `@rollup/rollup-linux-x64-gnu` is absent in Windows pnpm modules. Linux artifact build and Linux SQLite worker lab passed with isolated Linux modules. Full typecheck/test evidence is Node 22 Windows; no Linux full-suite pass is claimed.
- LIMITS — Admission hook proves only defer-before-claim ordering, not capacity on a real 2 vCPU/4 GB host. No deployment executor, remote finalization/recovery, target-side fence, VPS, production DB, Docker/SSH, auth API/UI, or pilot was exercised.
- CODE COMMIT — `dc7fa9c` (`feat(control-plane): add durable queue worker`). Task note/board commit follows.

## Gates and evidence

Requested P3d gates passed within the platform and evidence limits above. A real deploy executor remains P3e scope.
