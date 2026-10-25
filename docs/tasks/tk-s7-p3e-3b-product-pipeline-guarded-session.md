# TK-S7 P3e-3b — Product pipeline through guarded SSH session

| Checkpoint | Input | Status |
|---|---|---|
| P3e-3b | P3e-3a approved code `2cf6541`, dossier `ee2a878`; Product contracts and existing DeployPipeline | BLOCKED |

## Requirement ledger

| Requirement | Evidence / blocker | State |
|---|---|---|
| Reuse the existing DeployPipeline while binding its canonical Product deployment and full-SHA snapshot, with no duplicate deployment/version | `beginGitDispatch` already creates one canonical deployment, but `DeployPipeline.setup()` unconditionally calls `createNextVersion`; the pipeline has no entry point to accept the canonical deployment | BLOCKED |
| Route upload/render/build/activate/health rollback/publish/cleanup through the same guarded SSH lock and never a second SSH channel | P3e-3a helper protocol supports only `open`, `authorize_phase`, and `close`; `DeployPipeline` uses independent `SshManager.exec/uploadDir/readFile/writeFile/fileSize` connections. There is no guarded command/file transfer protocol or pipeline adapter | BLOCKED |
| Do not let Product execution use Desktop current-pointer/finalization paths; unknown must remain unknown absent terminal Product proof | Existing `DeployPipeline` calls activation/current pointer and deployment status writes (`recordSuccess`, `recordFailure`, `activatePrepared`); Product repository has no terminal result/finalization proof. Connecting it directly would promote state outside the Product lease/fence contract | BLOCKED |
| Preserve no-replay/unknown semantics for SSH, lease, abort and phase failures; exposure failure must not rollback a healthy app | Existing standalone pipeline has desktop retry/cleanup/activation semantics; it is not wired to guarded session and does not expose a Product-safe phase outcome boundary | BLOCKED |
| Controlled SQLite/transport regression for canonical SHA/deployment, one lock, no channel bypass, phase failures, abort, lease loss/disconnect and no duplicate | Existing P3e-3a tests cover dispatch marker, target binding, unknown/no replay and one guarded lock; they do not execute DeployPipeline through that channel | IMPLEMENTED |
| Linux localhost SSH pipeline integration and Docker Express container lab | Docker unavailable: Windows Docker CLI cannot connect to `//./pipe/dockerDesktopLinuxEngine`; WSL reports `docker: command not found`. Existing localhost SSH lab only exercises guard/session protocol, not pipeline | BLOCKED |
| Run relevant tests, typecheck, scoped lint/Ruff, artifact build, diff check and record evidence | Current-source baseline commands/results recorded below; passing component gates do not establish pipeline integration | IMPLEMENTED |
| Preserve unrelated worktree files; commit locally only with requested co-author trailer on implementation | No runtime implementation can safely be committed from current protocol/repository boundaries; unrelated pre-existing untracked paths remain untouched | BLOCKED |

## START / bounded investigation — 25/10/2026

- Read `CLAUDE.md`, board, ADR-011, P3a design, Product auto-deploy/target guard/guarded SSH contracts, deploy event contract, P3e-3a dossier, `DeployPipeline`, Product queue worker, guarded session/helper and Product dispatch repository.
- Confirmed the canonical dispatch marker and strict host-pinned session exist, but there is no supported pipeline execution operation in that session.
- Confirmed three incompatible persistence/transport assumptions that prevent a safe direct adapter: `DeployPipeline.setup()` creates a second version; its SSH operations open independent channels; success/activation/failure paths update the Desktop deployment/current pointer without Product fence finalization.
- These are not solved by authorizing a phase then issuing a separate `SshManager` call: that would leave the actual mutation outside the held target lock and violate the checkpoint requirement.
- Docker gate checked: `docker version` reports Docker Desktop engine pipe missing; `wsl docker version` reports no Docker executable/integration. No container was started.

## Required follow-up before implementation can pass

1. Add a bounded, typed, target-side operation protocol for the actual deploy pipeline (source transfer, render/write, build, activate, health/rollback, exposure policy, cleanup) that executes through the existing helper while it owns `GuardedExecution`; do not add raw arbitrary command forwarding.
2. Add a Product-specific `DeployPipeline` entry point that consumes the already-created canonical deployment and the verified snapshot, and prevents Desktop activation/current-pointer/finalization code from running. Keep the attempt `unknown` unless a future Product terminal finalizer verifies the outcome.
3. Add phase-specific certainty classification and cleanup semantics; no replay or unsafe Desktop rollback after disconnect/lease loss.
4. Restore an isolated Docker daemon and integration in the Linux lab before claiming the Express build/health/live-version preservation gate.

No source/runtime/contract changes were made in this checkpoint attempt because the current contract has no pipeline operation boundary and the existing pipeline's persistence semantics would violate canonical deployment/lease fencing if called as-is. No VPS, production DB, deployment, DNS/firewall or ML state was touched.

## Checks and evidence — 25/10/2026

- Node 22 Windows command: `npm exec --yes --package=node@22 -- node ./node_modules/vitest/vitest.mjs run src/main/controlPlane src/main/db/productJobClaim.test.ts src/main/db/productDeployRepository.test.ts src/main/db/productDesiredReconciliation.test.ts src/main/deploy/pipeline.test.ts src/main/deploy/precheck.test.ts src/main/ssh/hostFingerprint.test.ts src/main/ssh/ssh.test.ts` — 12 files / 174 tests PASS. These are component regressions; no Product pipeline executor was called.
- Node 22 main typecheck: `npm exec --yes --package=node@22 -- node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` — PASS.
- Scoped ESLint on guarded session, controller tests, pipeline and Product persistence — exit 0, 0 errors, 21 Prettier warnings.
- Linux Node 22 artifact: `OPSPILOT_CONTROL_PLANE_OUTPUT=/var/tmp/opspilot-p3e3a-runtime/dist/control-plane.cjs OPSPILOT_CONTROL_PLANE_MODULES=/var/tmp/opspilot-p3e3a-runtime/node_modules npm exec --yes --package=node@22 -- node ./scripts/build-control-plane.mjs` — `CONTROL_PLANE_BUILD_OK`.
- Linux Node 22 localhost SSH lab build/run — PASS: host pin accept/reject, dispatch-before-target guard, lock contention, multiple guarded phases, and lost-response unknown/no replay. Lab output explicitly reports `pipeline_execution:false`; it is not P3e-3b evidence.
- Linux Ruff: `uvx --from ruff ruff check src/main/controlPlane/target_guarded_ssh_helper.py src/main/controlPlane/target_execution_guard.py` — PASS (existing helper files; unchanged).
- Docker readiness: Windows CLI failed to reach `//./pipe/dockerDesktopLinuxEngine`; WSL has no `docker` command. Express container build/health/failed-health-live-preservation lab — BLOCKED; no Docker container was started.
- `git diff --check` — PASS.

## Handoff

- Checkpoint result: BLOCKED, documentation-only status record. No implementation SHA exists. Status record commit `3559bb87587cad3eb8dc70ec5738134cbd5a8504` includes the requested co-author trailer; it is not an implementation commit.
- Safe next step: establish the target operation/payload contract and Product-safe pipeline entry/finalization boundary, then implement and test before enabling any executor. Docker lab remains a separate required gate.
