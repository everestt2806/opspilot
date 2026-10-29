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

## P3d lifecycle correction — close DB only after all runtime tasks stop

Base review: `b4a7472`; previous P3d implementation: `dc7fa9c`.

| Requirement | Implementation and current evidence | State |
|---|---|---|
| Any runtime task failure immediately marks fatal and aborts siblings; wait for every runtime task before DB close | Each poller/worker task has an immediate failure handler that records a sanitized fatal state and aborts the shared signal. `runtimeTask` uses `Promise.allSettled` only after those handlers, so it waits for the sibling. Controller composition tests cover poller failure during a slow executor and worker failure during poller cleanup with a real SQLite repository | PASS |
| DB is not closable while executor may use it; deadline miss keeps durable state and reports unconfirmed stop | Worker `canCloseDatabase()` is false while an executor task may still use its repository and remains false after stop deadline. Service close waits for worker run; on timeout it reports `WORKER_TASK_STOP_UNCONFIRMED` and leaves DB open. SQLite asserts claim/attempt and both leases remain unchanged | PASS |
| Close is idempotent and retains fatal/stop errors | `close()` returns one cached cleanup promise to concurrent and repeated callers. It is marked closed only after DB close. Runtime fatal is reported after safe cleanup; fatal plus unconfirmed task has a combined safe code. Tests assert promise identity and repeated rejection; no raw exception text is propagated | PASS |
| Composition/lifecycle regressions catch previous implementation | Tests assert close remains pending while the slow aborted executor is active (the reviewed old `Promise.all(...).catch(...)` path resolved close immediately), test a worker failure with delayed poller DB access, and test unconfirmed stop plus late pre-write result. These conditions contradict the reviewer’s pre-fix observation (close completed in ~1 ms while executor needed 150 ms), so the regressions fail on that behavior | PASS |
| Focused Node 22 checks, Linux lifecycle/worker lab, docs and local commit | Node 22.23.4 typecheck PASS; controller/DB/Git suite 10 files / 100 tests PASS; scoped ESLint and `git diff --check` PASS. Linux Node 22 artifact and controller composition lab PASS; no real deployment. Correction code `80d5067` | PASS |

### Correction journal

- BASELINE EVIDENCE — Leader’s controlled Linux repro on P3d `dc7fa9c`: poller throw caused `Promise.all` rejection; catch completed `runtimeTask` while worker sibling still ran. `canCloseDatabase()` remained true; `close()` returned in ~1 ms while executor needed 150 ms. This is the failure mode the new composition tests target.
- FIX — `ControllerService` tracks each task failure separately, sets fatal and aborts the shared controller inside the rejection handler, then waits for all guarded tasks to settle. `close()` caches its promise, closes the listener, waits for runtime tasks, checks worker closeability, and only then closes SQLite. It reports sanitized error codes and keeps the failed promise for every later caller. The worker closeability guard stays false during active execution and after an unconfirmed deadline; it never releases or retries the claim.
- WINDOWS GATES (Node 22.23.4) — `npm exec --yes --package=node@22 -- node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` PASS. `npm exec --yes --package=node@22 -- node ./node_modules/vitest/vitest.mjs run src/main/controlPlane src/main/db/productJobClaim.test.ts src/main/db/productDesiredReconciliation.test.ts src/main/db/productDeployRepository.test.ts src/main/db/productMigration.test.ts src/main/db/index.test.ts src/main/git/publicBranch.test.ts` PASS: 10 files / 100 tests. Scoped ESLint for controller, worker, Product repository, Git, build and Linux lab files PASS; `git diff --check` PASS.
- LINUX GATE (WSL Ubuntu, Node 22.23.4) — Rebuilt `/var/tmp/opspilot-p3d-control-plane.cjs` with isolated Linux modules; ran `scripts/control-plane-worker-linux-lab.mjs node /var/tmp/opspilot-p3c-lab-20261022b/runtime/node_modules`. Output confirmed two SQLite workers/one executor, heartbeat renewal, poller failure aborting sibling, no early close, same promise for concurrent close, `CONTROL_PLANE_RUNTIME_FAILED`, claim and both leases preserved after reopen, and `remote_deploy=false`. Temporary DB, child and generated artifact were cleaned. The executor was controlled/local and never deployed remotely.
- LIMIT — The regression verifies controller/worker lifecycle and SQLite durability only; it does not establish remote executor shutdown semantics or deployment success. No VPS, production DB, network deployment, DNS/firewall, API/UI, or real SSH/Docker executor was used.
- CORRECTION CODE COMMIT — `80d5067` (`fix(control-plane): await worker shutdown before closing database`). Board/evidence commit follows.
