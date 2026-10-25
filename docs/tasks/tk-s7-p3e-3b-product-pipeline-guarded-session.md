# TK-S7 P3e-3b — Product pipeline through guarded SSH session

> **Leader closeout H0 25/10:** hai finding request-ID traversal và quota đã sửa và kiểm chứng lại. Source/render đạt gate giới hạn của slice; xem mục H0 cuối hồ sơ và [kế hoạch partner/song song](tk-s7-partner-handoff-2026-10-25.md). P3e-3b tổng thể vẫn PARTIAL/BLOCKED: chưa build/activate/health/rollback/publish/finalization, chưa deployment Product thật. Những báo cáo trước H0 dưới đây là lịch sử, không phải kết luận cuối.

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

## Source/render continuation — 25/10/2026

START 25/10 — Implement typed, bounded source transfer and render through the existing guarded SSH session; keep build/deploy/finalization blocked and record real localhost SSH evidence.

### Requirement ledger

| Requirement | Implementation/evidence | State |
|---|---|---|
| Typed bounded transfer operations under one GuardedExecution; stop-and-wait backpressure; quotas/checksums | Contract: 40 KiB request, 64 KiB response, 24 KiB chunk, 8 MiB/file, 64 MiB/session, 1,024 files, 1,024-byte relative path, 12,288 messages; session output capped at 4 MiB; per-file and sorted scope SHA-256 | PASS |
| Safe app/deployment staging; traversal/symlink/hardlink/overwrite protection; incomplete cleanup; env mode 0600/redaction | Helper uses enrolled state root + app ID + canonical deployment ID, exclusive staging, nofollow temp files and no-overwrite link commit; Linux SSH lab covers traversal rejection, incomplete disconnect cleanup, file checksum and `.env` mode. Symlink component rejection enforced by helper; external concurrent same-UID race stress is not covered | PASS |
| Reuse existing snapshot/source packaging and render templates; canonical deployment only; no Desktop setup/promotion; polling-only default | Adapter reuses detector, upload exclusions, collector path and render templates; accepts verified snapshot/session canonical deployment; SQLite lab asserts one deployment. Does not invoke Desktop setup/current/finalization. Controller CLI does not wire worker executor | PASS |
| Linux real localhost SSH transfer/render lifecycle and attack/failure cases | OpenSSH localhost + Linux Node 22 + isolated SQLite lab exercised multichunk source, render outputs, checksum, scope completion, lock, traversal rejection and incomplete disconnect cleanup | PASS |
| Focused tests, typecheck, scoped lint/Ruff, artifact/helper build, Linux SSH lab, diff check; preserve partial gates | 12 files/174 focused tests, Node 22 typecheck, ESLint (0 errors), Ruff, controller artifact build, Linux lab artifact/helper build and Linux OpenSSH/SQLite lab, `git diff --check` all pass on current source. Docker and full Product deployment phases remain blocked | PASS |

### Contract decision before code

- Added typed scope/file/chunk/complete messages. All post-open operations remain bound to the session's immutable `claim.app_id` and `deployment_id`; operation DTOs contain relative source paths only and exact render filenames. The target computes staging under its configured state root using the session identity; no operation can select an absolute destination.
- The helper will create a fresh app/deployment staging directory exclusively. It acknowledges only after writing each chunk; files become visible only after per-file size/hash validation and atomic commit. Scope completion checks count, aggregate bytes and sorted manifest hash. Completed source/render scopes remain for the later build phase; any incomplete scope is removed by the helper's finally path. This slice does not run build/activation or claim deployment success.
- `.env` can only be a fixed render filename and is forced to `0600`; no content is returned in protocol responses, events or logs. The adapter supports Express with no database and no required secrets in this slice; unsupported plans fail before dispatch.

### Source/render implementation evidence — 25/10/2026

- Product adapter `stageProductSourceAndRender(database, repository, ssh, verifiedSnapshot, options)` is an internal seam only. It reads App/deployment through existing repositories, accepts only Express without DB/required environment keys, packages source plus the existing collector with `shouldExcludeUploadPath`, and renders the existing Dockerfile/compose/env templates. It does not call `DeployPipeline.setup`, `createNextVersion`, Desktop promotion/current-pointer, or terminal Product finalization. Result explicitly remains `source_render_staged_dispatch_unknown`.
- Protocol operations are `begin_scope`, `begin_file`, `file_chunk`, `finish_file`, `complete_scope`; each request is stop-and-wait acknowledged in the same GuardedExecution/channel. Scope/file declarations are checked against session quotas before bytes are sent. A render scope is exactly the three fixed template files; `.env` mode is 0600 and values are never emitted in logs/output.
- Linux localhost SSH lab (Node 22, SQLite file databases, actual OpenSSH and Python helper): 70 KiB source file transferred over multiple chunks; per-file bytes/SHA and both `.scope-complete` markers verified; three render files checked and `.env` mode checked; the target lock checked after transfer; one canonical deployment row asserted. Traversal was rejected without creating an escaped target path. Abrupt disconnect during partial file transfer removed the incomplete deployment staging. All lab resources are scratch and cleanup runs in `finally` under a watchdog.
- The Linux lab uses scratch SSH credentials and a scratch-enrolled target only. No Docker/container, build, activation, health check, rollback, publish/exposure, or Product finalization ran. P3e-3b remains PARTIAL/BLOCKED overall. Symlink component checks are implemented, while adversarial same-UID concurrent filesystem race stress and quota boundary matrix are not proven by this lab.
- No Windows Docker engine or WSL Docker executable is available from the prior gate; container gate remains BLOCKED. The Linux SSH lab is not evidence of a live deployment.

### Commands and current-source gates

- Windows Node 22 focused tests: `cd app; npm exec --yes --package=node@22 -- node ./node_modules/vitest/vitest.mjs run src/main/controlPlane src/main/db/productJobClaim.test.ts src/main/db/productDeployRepository.test.ts src/main/db/productDesiredReconciliation.test.ts src/main/deploy/pipeline.test.ts src/main/deploy/precheck.test.ts src/main/ssh/hostFingerprint.test.ts src/main/ssh/ssh.test.ts` — 12 files / 174 tests PASS.
- Windows Node 22 typecheck: `cd app; npm exec --yes --package=node@22 -- node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` — PASS.
- Windows scoped lint: `cd app; npm exec --yes --package=node@22 -- node ./node_modules/eslint/bin/eslint.js src/main/controlPlane/guardedSshSession.ts src/main/controlPlane/guardedSshProtocol.ts src/main/controlPlane/productPipelineSourceRender.ts scripts/p3e3a-guarded-ssh-linux-lab.mjs scripts/p3e3a-guarded-ssh-lab-entry.ts src/main/controlPlane/guardedSshProtocol.test.ts` — PASS, no warnings after formatting.
- Linux Ruff: `uvx --from ruff ruff check app/src/main/controlPlane/target_guarded_ssh_helper.py app/src/main/controlPlane/target_execution_guard.py` — PASS.
- Linux Node 22 controller artifact/helper build: `OPSPILOT_CONTROL_PLANE_OUTPUT=/var/tmp/opspilot-p3e3b-runtime/dist/control-plane.cjs OPSPILOT_CONTROL_PLANE_MODULES=/var/tmp/opspilot-p3e3a-runtime/node_modules npm exec --yes --package=node@22 -- node ./scripts/build-control-plane.mjs` — `CONTROL_PLANE_BUILD_OK`.
- Linux lab artifact build: `OPSPILOT_P3E3A_LAB_ARTIFACT=/var/tmp/opspilot-p3e3b-runtime/p3e3b-lab.cjs OPSPILOT_P3E3A_MODULES=/var/tmp/opspilot-p3e3a-runtime/node_modules npm exec --yes --package=node@22 -- node ./scripts/build-p3e3a-ssh-lab.mjs` — PASS.
- Linux real localhost SSH filesystem lab: `NODE_PATH=/var/tmp/opspilot-p3e3a-runtime/node_modules OPSPILOT_P3E3A_LAB_ARTIFACT=/var/tmp/opspilot-p3e3b-runtime/p3e3b-lab.cjs OPSPILOT_P3E3A_HELPER_DIR=/var/tmp/opspilot-p3e3b-runtime/dist/target-helper npm exec --yes --package=node@22 -- node ./scripts/p3e3a-guarded-ssh-linux-lab.mjs` — `P3E3B_SOURCE_RENDER_SSH_LAB_PASS`; 5 source files/71,909 bytes, 3 rendered files, checksum/manifest, lock, traversal/symlink/quota/deployment mismatch, incomplete disconnect cleanup and ownership-stale rejection passed. SQLite and SSH daemon were scratch-only.
- `git diff --check` — PASS.

The failed intermediate lab attempts were harness setup/fixture issues (wrong artifact exports, occupied build slot, wrong target state and expected helper exit after a rejected frame); each was corrected and the final source/current Linux lab above passed. No production database, VPS, Docker, or live deployment was used.

### Handoff

- Implementation commit SHA: `d8b932935dcc5475d3c4021afa3a6bdf07b25c94` (local, not pushed); commit preserves author `Codex Worker` and contains the requested co-author trailer.
- Result: source/render slice PASS; P3e-3b overall remains BLOCKED pending build/activate/health/rollback/publish/finalization and the Docker Express integration gate.
- Runtime polling-only default remains unchanged; no executor enablement was added.

HANDOFF-LOCAL 25/10 — `d8b9329` · 174 focused tests, Node 22 typecheck, scoped ESLint/Ruff, controller/lab artifact build, Linux localhost SSH filesystem lab, `git diff --check` PASS · remaining deployment phases and Docker gate BLOCKED.

## H0 — Đóng hai finding an toàn trước bàn giao, 25/10/2026

START 25/10 — User yêu cầu Leader hoàn tất checkpoint rồi push cho partner, setup làm song song. Phạm vi giới hạn source/render; không triển khai các phase runtime tiếp theo.

### Thay đổi và bằng chứng

- H0-01: header chỉ nhận request ID `[A-Za-z0-9_-]{1,128}`, từ chối malformed trước guard/filesystem. `tempfile.mkstemp` tự sinh tên tại đúng directory đã kiểm tra; không dùng wire identifier làm đường dẫn.
- H0-02: cộng file sizes đã commit và file mới trước tạo thư mục/file; kiểm tra scope/session actual bytes gồm file đang truyền trước ghi từng chunk. Giữ nguyên count/hash/manifest và quota gốc; không đổi DB/schema.
- Regression `app/scripts/test_guarded_ssh_transfer.py`: 8 tests Linux thật, dữ liệu nhỏ; source + render dùng giới hạn 2 byte bằng patch hằng số trong test. 6/8 test fail trên helper cũ `d8b9329` được import từ scratch; cùng 8 tests pass trên helper sửa. Không checkout/reset working tree để lấy baseline.
- Linux OpenSSH lab thêm raw frame malformed request ID với path hợp lệ, scope zero-byte/file 1-byte, và cộng dồn file vượt quota. Tất cả bị từ chối đúng mã, helper thoát và dọn incomplete staging; không tạo `escaped.part` ngoài staging.
- Không có Worker chạy song song trong phiên sửa: Orca từ chối readiness vì `agent-update-prompt`, dispatch đã release. Leader thực hiện sửa và kiểm thử; kế hoạch parallel cho partner ghi riêng.

| Tiêu chí | Gate trên source cuối | State |
|---|---|---|
| H0-01 và H0-02 bị chặn trước I/O vượt quyền/quota | 8 Linux filesystem tests, 6 failures có chủ ý trên baseline cũ; Linux SSH regressions pass | PASS |
| Không hồi quy source/render, guard, canonical deployment | Node 22 Windows 19 files / 247 tests; Linux SSH source/render lab pass | PASS |
| Contract, typecheck, lint, build artifact/helper | Node main typecheck; ESLint lab harness; Ruff helper/tests; controller/lab artifact builds pass | PASS |
| Còn nguyên phạm vi partial và dữ liệu cá nhân | Không executor/VPS/production DB/Docker deploy; git diff check sạch | PASS |

### Lệnh tái hiện

```powershell
. ./tools/enter-node22.ps1
pnpm --prefix app exec vitest run src/main/db src/main/controlPlane src/main/git src/main/ssh src/main/deploy/pipeline.test.ts src/main/deploy/precheck.test.ts
pnpm --prefix app exec tsc --noEmit -p tsconfig.node.json --composite false
pnpm --prefix app exec eslint scripts/p3e3a-guarded-ssh-linux-lab.mjs
ml-service/.venv/Scripts/python.exe -m ruff check app/src/main/controlPlane/target_guarded_ssh_helper.py app/scripts/test_guarded_ssh_transfer.py
wsl python3 app/scripts/test_guarded_ssh_transfer.py -v
git diff --check
```

- Linux artifact/helper/lab chạy đúng biến môi trường/cwd theo [handoff](tk-s7-partner-handoff-2026-10-25.md): `CONTROL_PLANE_BUILD_OK`, `P3E3A_LAB_BUILD_OK`, `P3E3B_SOURCE_RENDER_SSH_LAB_PASS`. Node 22.23.4, actual localhost OpenSSH, isolated SQLite; 5 source files / 71,909 bytes, 3 render files, lock và unknown/no-replay giữ nguyên.
- Một lần gọi lab qua PowerShell pipe bị CR ở cuối filename (`.mjs\r`), không chạy test; đã bỏ CR và chạy lại đầy đủ pass. Không phải lỗi Product runtime.

REVIEW 25/10 — H0/source-render được Leader chấp nhận trong phạm vi lab; CHỜ REVIEW/merge theo board. P3e-3b tổng thể PARTIAL/BLOCKED; H1 build rồi H2 deployment/finalization mới tiếp tục. Docker gate chưa chạy, không được dùng SSH lab để nhận deployment thành công.

HANDOFF 25/10 — H0 implementation/regression SHA `900ad77`, đã push `origin/feat/deploy-reachability` theo yêu cầu user. H1 runtime và L0 Docker lab có thể bắt đầu song song với owner/file riêng; H2-D chỉ proposal, H2-I chờ integration gate. File cá nhân/untracked không được đưa vào commit; không PR/merge hoặc thay đổi VPS/production DB.
