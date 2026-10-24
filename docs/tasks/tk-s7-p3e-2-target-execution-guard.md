# TK-S7 P3e-2 — target-side execution lock and fencing guard

| Checkpoint | Accepted base | Status |
|---|---|---|
| P3e-2 | P3e-1 `ad93b39`; accepted dossier `0835644` | CHỜ REVIEW |

## Requirement ledger

| Requirement | Change/evidence | State |
|---|---|---|
| Internal identity/marker contract precedes implementation; explicit fixture enrollment only | Contract and decision were recorded before code; initializer refuses any existing state root. Lab only creates disposable roots. | PASS |
| Real Linux OS lock covers complete mutation; app/controller/generation/claim/attempt/fence bound | `target_execution_guard.py` holds `fcntl.flock` through context; independent process probes the lock during mutation; identity/generation/fence and fixed phase are checked. | PASS |
| Durable atomic monotonic fence, replay/unknown fail closed; no timeout stealing | Marker uses temp write, file fsync, atomic replace and directory fsync. Unknown/replay blocks after restart; orphan `.marker-*` blocks after interrupted write; timeout returns busy without stealing. | PASS |
| Validate authority before each fixed write phase; no renderer shell interpolation | Only fixed phase names are accepted; lab mutates marker between phases and confirms next write authorization is rejected. API accepts no shell command/path payload. | PASS |
| Dispatch marker precedes target marker/mutation; pinned SSH integration boundary documented | Contract/task note require committed `beginGitDispatch` before guard use. This checkpoint has no DB/SSH/pipeline invocation, so ordering is documented, not runtime evidence. | N/A — P3e-3 integration gate |
| Multi-process Linux lab, watchdog and scoped cleanup; controller/DB/Git regression | Linux real-process lab PASS; watchdog kills only its process group; parent-owned scratch is removed after child close. Node 22 controller/DB/Git/deploy/SSH suite 13 files / 174 tests PASS. | PASS |
| Typecheck, scoped lint, artifact build and diff check; local scoped commit | Node main and strict contract typecheck, ESLint, Ruff, Linux artifact build and `git diff --check` PASS; commits pending | IMPLEMENTED |

## Accepted review and source facts

- P3e-1 `ad93b39` / dossier `0835644` is accepted input: 126 focused tests, typecheck/diff and Linux public snapshot/process-tree lifecycle passed; it did not prove remote deployment.
- ADR-011 selects a persistent controller coordinating targets over SSH and does not require a resident target service.
- `SshManager.exec()` supports `retryOnReconnect`; every future mutation must disable retry because a disconnect leaves outcome unknown. Host pinning remains mandatory.
- `DeployPipeline` has process-local `activeByApp`/`withAppLock` only and performs writes in separate SSH calls. P3e-3 must hold a single target guard across the entire mutation sequence. A guard-only test does not establish pipeline coverage.

## Internal contract

The marker is created only by an explicit enrollment initializer. The initializer refuses existing target directories/markers and is used in this checkpoint only for disposable lab fixtures. Marker identity binds controller ID, app ID, and ownership generation. Each execution additionally binds claim ID, attempt ID, and monotonically increasing app fence.

On Linux, an advisory `flock` lock is held for the whole execution. While holding it, the guard checks the marker and identity, atomically writes/fsyncs the new highest fence and an `unknown` execution record before permitting the first mutation. Each subsequent fixed write phase rechecks the same identity, claim/attempt/fence and durable unknown record while the same lock remains held. There is no timeout-based steal or automatic clearing of unknown. Process death releases the kernel lock but leaves durable state blocking successor mutations until reconciliation. A leftover atomic-write temp file also blocks access; it is retained as evidence, not treated as an idle marker.

The future controller must commit `beginGitDispatch` before requesting target fence advancement or any remote mutation. The target guard cannot prove that a caller genuinely committed this DB transaction; the trust boundary is the pinned SSH credential and controller-only invocation. It does not create a deployment or reissue dispatch permission. The guard cannot revoke a command already running or stop Docker daemon work. Any lost SSH result is `TARGET_OUTCOME_UNKNOWN`; no mutation retry is allowed.

## P3e-3 integration gaps

- Wrap every write phase of DeployPipeline, including upload, Docker build/activation, health-driven rollback, exposure and cleanup semantics, in one target lock lifetime.
- Define safe remote invocation over pinned SshManager without arbitrary shell interpolation; explicitly disable reconnect retries for mutation.
- Order `beginGitDispatch` before target marker advancement and all mutation; reconcile unknown state without creating a second deployment or replaying the attempt.
- Prove a legacy desktop/root bypass is not prevented by this guard alone. Credential cutover and enforcement at the target account/path are mandatory before live cutover.
- Confirm target Linux Python/flock/runtime assumptions before selecting the final transport wrapper. This checkpoint's lab proves the guard fixture, not a real VPS integration.

## Evidence and gates

- Linux lab (WSL Ubuntu, Python 3.12 / Node 22): `PYTHONDONTWRITEBYTECODE=1 node scripts/p3e2-target-guard-linux-lab.mjs` — PASS. Two real processes contended on one app and only one reached mutation; a second app overlapped independently; direct `flock` probing confirmed the lock remained held through mutation; lock timeout did not steal. Stale ownership/controller/app/fence, missing/corrupt marker, replay after restart, unknown phase, changed authority before next phase, process kill during mutation, crash before atomic replace/orphan marker temp, and initializer adoption refusal all rejected. Watchdog/scratch cleanup passed; `remote_deploy=false`.
- Node 22 focused suite: `vitest run src/main/controlPlane src/main/db/productJobClaim.test.ts src/main/db/productDesiredReconciliation.test.ts src/main/db/productDeployRepository.test.ts src/main/db/productMigration.test.ts src/main/db/index.test.ts src/main/git/snapshot.test.ts src/main/git/publicBranch.test.ts src/main/deploy/pipeline.test.ts src/main/ssh/hostFingerprint.test.ts` — 13 files / 174 tests PASS.
- Node 22 main typecheck: `tsc --noEmit -p tsconfig.node.json --composite false` — PASS. Strict contract typecheck: `tsc --noEmit --strict --target ES2022 --module NodeNext ../docs/contracts/product-target-execution-guard.ts` — PASS.
- Scoped ESLint over controller/deploy context and the P3e-2 Node lab — PASS. Ruff 0.17.2 (installed under `/var/tmp`, not added to project) over target guard/lab — PASS. Python syntax check with built-in `compile()` — PASS.
- Linux Node 22 controller artifact: `OPSPILOT_CONTROL_PLANE_OUTPUT=/var/tmp/opspilot-p3e2-control-plane.cjs OPSPILOT_CONTROL_PLANE_MODULES=/var/tmp/opspilot-p3c-lab-20261022b/runtime/node_modules npm exec --yes --package=node@22 -- node scripts/build-control-plane.mjs` — `CONTROL_PLANE_BUILD_OK`.
- `git diff --check` — PASS.
- No SSH, Docker, deployment pipeline execution, target VPS, production DB, DNS/firewall, or ML state was used. The Linux lab proves the fixture guard and kernel lock only. It does not prove `beginGitDispatch` ordering through SSH, enforcement against an old desktop/root bypass, credential cutover, or that Docker daemon work stops after a caller dies. Those remain mandatory P3e-3/live gates.

Implementation commit SHA: pending local commit; no push/PR/merge.
