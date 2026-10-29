# TK-S7 P3e-3a — guarded SSH execution session

| Checkpoint | Base / accepted input | Status |
|---|---|---|
| P3e-3a | P3e-2 correction `af9acb0`; accepted dossier `c65dc79` | CHỜ REVIEW |

## P3e-3a authority-binding correction — 25/10/2026

## P3e-3a security-profile revision correction — 25/10/2026

### Requirement ledger

| Requirement | Implementation/evidence | State |
|---|---|---|
| Bind SSH username/auth method and a stable credential/profile revision without exposing credentials | Migration 019 adds monotonic `vps.ssh_security_revision`; `VpsRepository` advances it for endpoint, pin, username, auth method, credential rotation, archive/restore; binding contains no secret | PASS |
| Security profile changes during open or between phases revoke the old session; telemetry updates do not | SQLite + real `VpsRepository.update()` same-second tests; controlled channel verifies old connection principal receives no `open`, stale phase is blocked, and last-seen/status changes preserve authority | PASS |
| Retain target/lease/pin/canonical deployment/no-replay behavior and prove focused, static, lint, artifact, Linux SSH gates | 17 files/229 tests, main + strict contract typecheck, scoped ESLint (0 errors; 138 Prettier warnings), Ruff, Linux controller artifact and real localhost SSH lab, `git diff --check` | PASS |

### Nhật ký correction

- START 25/10 — Leader tái hiện credential principal đổi trong cùng giây qua `VpsRepository.update()`; `updated_at` giữ nguyên và session cũ vẫn gửi open/build. Thay timestamp heuristic bằng monotonic security revision trong forward migration.
- UPDATE 25/10 — thay `updated_at` bằng `ssh_security_revision` monotonic, secret-free; verified connection identity có username/auth method. Revision tăng khi endpoint, pin, principal, auth method hoặc credential đổi; `last_seen_at`/`last_status` không tăng revision. Thêm regression cho cập nhật hai lần cùng giây, credential/profile đổi trong lúc open, principal thực tế cũ, đổi profile sau open và telemetry.
- GATES 25/10 — Node 22 Windows focused suite 17 files/229 tests PASS; main TypeScript và strict Product contracts PASS; scoped ESLint exit 0 (0 errors, 138 Prettier warnings); WSL Ruff PASS; Node 22 Linux control-plane artifact build PASS; Linux localhost OpenSSH lab PASS; `git diff --check` PASS. Lab kiểm chứng SSH/guard localhost và controlled authority binding, không chạy DeployPipeline/deployment.
- HANDOFF-LOCAL — implementation `2cf654193025815256d170ee7740f3becde23306`; no VPS, production DB, production executor, deployment, DNS/firewall hoặc ML state.

### Requirement ledger

| Requirement | Implementation/evidence | State |
|---|---|---|
| Resolve target VPS/profile from current DB authority; expected VPS mismatch rejected before dispatch; bind endpoint and pin | `ProductDispatchTargetBinding` secret-free; mismatched expected VPS leaves marker/deployment untouched; SshManager reports the endpoint and pin verified on the opened connection | PASS |
| Recheck authority, lease/fence, target, deployment link and abort after async channel open before `open` frame; retain unknown marker on rejection | SQLite-controlled delayed-channel tests cover expiry, app target, source generation, profile and actual endpoint/pin changes; rejected post-marker cases keep one deployment and `unknown` | PASS |
| Session phases reject stale target/profile and preserve lock on unchanged target | Target mutation after open rejects next phase without sending a phase frame; valid target still authorizes multiple phases through the same session; Linux lock lab passes | PASS |
| Focused tests, Node typecheck, lint/Ruff, artifact build, Linux localhost SSH; document evidence/limits and commit | Node 22 16 files/216 tests; main/strict-contract typechecks, scoped ESLint, Linux Ruff, Node22 Linux build and real localhost SSH lab, diff check; code commit `5b52979` | PASS |

### Nhật ký correction

- START 25/10 — review finding tái hiện được: target VPS lấy từ `options.vps_id`; authority read không kiểm tra expiry sau khi mở channel. Đang bổ sung binding secret-free từ SQLite và xác minh fingerprint/endpoint thực của connection.
- UPDATE 25/10 — repository đọc `app.vps_id`, endpoint, pin và profile revision từ join authority của claim; mismatched `options.vps_id` bị từ chối trước `beginGitDispatch`. SshManager mở một channel strict-pinned và trả identity của đúng connection; sau `await`, trước frame `open`, và trước từng phase session đối chiếu lại claim/lease/ownership/source/deployment/target. Rejection sau dispatch giữ canonical row và durable `unknown`, không reconnect/replay.
- UPDATE 25/10 — regression SQLite/controlled channel gồm hai VPS, lease hết hạn khi open chờ, đổi app target/profile/source khi open, sai endpoint/pin thực tế, và đổi target sau khi session đã mở. Mã cũ không thỏa các assertion này; baseline finding là reproduction do Leader cung cấp, không checkout/chạy lại bản cũ.

### Gates correction và handoff

- Node 22 Windows: `npm exec --yes --package=node@22 -- node ./node_modules/vitest/vitest.mjs run src/main/controlPlane src/main/db/productJobClaim.test.ts src/main/db/productDeployRepository.test.ts src/main/db/productDesiredReconciliation.test.ts src/main/db/productMigration.test.ts src/main/db/index.test.ts src/main/git/snapshot.test.ts src/main/git/publicBranch.test.ts src/main/deploy/pipeline.test.ts src/main/ssh/hostFingerprint.test.ts src/main/ssh` — 16 files / 216 tests PASS.
- Main typecheck: `npm exec --yes --package=node@22 -- node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` — PASS. Strict contract typecheck trên `product-auto-deploy.ts`, `product-guarded-ssh-session.ts`, `product-target-execution-guard.ts` — PASS.
- Scoped ESLint trên guarded session, tests, repository và SshManager — PASS, không warning/error. Ruff trong WSL Linux: `uvx --from ruff ruff check src/main/controlPlane/target_guarded_ssh_helper.py src/main/controlPlane/target_execution_guard.py` — PASS. Python file không đổi; Windows Python không có Ruff cài sẵn.
- Linux Node 22 artifact: `OPSPILOT_CONTROL_PLANE_OUTPUT=/var/tmp/opspilot-p3e3a-runtime/dist/control-plane.cjs OPSPILOT_CONTROL_PLANE_MODULES=/var/tmp/opspilot-p3e3a-runtime/node_modules npm exec --yes --package=node@22 -- node ./scripts/build-control-plane.mjs` — `CONTROL_PLANE_BUILD_OK`.
- Linux real localhost OpenSSH lab, artifact/helper build và test: `OPSPILOT_P3E3A_LAB_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/node_modules/@opspilot/p3e3a-lab.cjs OPSPILOT_P3E3A_HELPER_DIR=/var/tmp/opspilot-p3e3a-runtime/dist/target-helper npm exec --yes --package=node@22 -- node ./scripts/build-p3e3a-ssh-lab.mjs && npm exec --yes --package=node@22 -- node ./scripts/p3e3a-guarded-ssh-linux-lab.mjs` — PASS. Correct host pin accepted; wrong pin rejected before public-key auth; DB dispatch precedes target marker; same-app lock contention rejected; multiple phases share one lock; disconnect-after-open leaves one canonical deployment and unknown/no replay. Lab did not run DeployPipeline or deployment.
- `git diff --check` — PASS. Implementation/contract/decision/lab commit: `5b52979` (`fix: bind guarded SSH session to Product target authority`).
- Limits retained: guarded session only; pipeline upload/render/build/activate/health rollback/publish/cleanup remains unintegrated. No production VPS, DB, deployment, DNS/firewall, ML state or production executor used.

## Requirement ledger

| Requirement | Implementation/evidence | State |
|---|---|---|
| Typed internal framed protocol with bounded payload/output, sequence, timeout, allowlisted phases and stable errors | `product-guarded-ssh-session.ts`, protocol decoder/encoder, malformed/truncated/duplicate/timeout/abort tests | PASS |
| One strict host-pinned SSH channel holds one target GuardedExecution throughout; no reconnect/retry for writes | `SshManager.openGuardedExecutionChannel`; Linux loopback sshd pin + multi-phase + `flock` contention lab | PASS |
| Recheck Product authority; commit beginGitDispatch once before target fence/mutation; use canonical deployment ID | `beginGitDispatch` result supplies deployment ID; session reads active dispatch authority before each phase; SQLite test checks DB marker before channel opens | PASS |
| Malformed/truncated/duplicate messages, timeout/abort/disconnect fail closed as unknown; no replay | Unit protocol/session tests and Linux real SSH drop-first-response lab: marker remains unknown, next dispatch requires reconciliation, one deployment row | PASS |
| Lab uses ephemeral credentials/pins and harmless scratch markers; no production VPS/state | Linux Node 22 localhost `sshd`, temporary host/client keys and isolated SQLite/target state; cleanup passed | PASS |
| Package target Python helper; run focused regression/typecheck/lint/build and Linux lab | Control-plane artifact and helper bundle built in Linux Node 22 runtime; 196 focused tests, main/contract typechecks, ESLint/Ruff pass | PASS |
| Explicitly record P3e-3b pipeline seams; no claim of pipeline/remote deployment | Seams listed below; no pipeline executor configured or called | PASS |

## Scope and accepted evidence

- P3e-2 correction `af9acb0` / dossier `c65dc79` was accepted: 218 focused tests, typecheck/diff, and Linux guard lifecycle lab passed. The guard was not connected to DeployPipeline and there was no remote deployment.
- This checkpoint adds an internal SSH session boundary only. It does not enable production execution or implement upload/render/build/activate/health rollback/publish/cleanup.

## Decisions

- The internal protocol is uint32 big-endian frame length plus UTF-8 JSON, one outstanding request, 16 KiB request cap, 1 MiB response/output cap, 32-message session cap and 15-second request timeout. Each request carries protocol version, UUID request ID, monotonic sequence, fixed operation and canonical deployment ID. Only `prepare`, `build`, `activate`, `rollback` phase authorization exists; the helper accepts no shell command or Git metadata.
- `SshManager` retains its strict host fingerprint check and opens one fixed Python helper command on one channel. It logs no command, does not reconnect that channel and does not expose an SSH client to renderer/IPC. Main process checks its current durable dispatch authority before each phase; the Python helper checks its active GuardedExecution and marker/fence under the held OS lock.
- `beginGitDispatch` is the only operation that creates the canonical deployment link and sets durable `remote_outcome='unknown'`. The session uses the returned deployment ID. It commits before channel open can enter the target guard and advance the target fence. A second call after the marker returns reconciliation-required and opens no new channel.
- A failed/malformed/truncated/duplicate/timed-out/aborted exchange destroys the channel and puts the in-memory session into reconciliation-required. Durable dispatch and target unknown marker remain. No retry, current pointer promotion, deployment finalization or remote recovery is implemented.
- Build output packages `target-helper/target_guarded_ssh_helper.py` and its guard module. Linux runtime dependencies add only the already-approved `ssh2` and `tar`; polling-only controller composition does not activate the session.

## Gates and evidence

- Windows Node 22.23.4 focused command: `npm exec --yes --package=node@22 -- node ./node_modules/vitest/vitest.mjs run src/main/controlPlane src/main/db/productJobClaim.test.ts src/main/db/productDesiredReconciliation.test.ts src/main/db/productDeployRepository.test.ts src/main/db/productMigration.test.ts src/main/db/index.test.ts src/main/git/snapshot.test.ts src/main/git/publicBranch.test.ts src/main/deploy/pipeline.test.ts src/main/ssh/hostFingerprint.test.ts src/main/ssh/ssh.test.ts` — 15 files / 196 tests PASS. Includes Product persistence, guarded-session protocol, SSH pin/client, Git and unchanged Desktop pipeline regression.
- Windows Node 22.23.4 main typecheck: `npm exec --yes --package=node@22 -- node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` — PASS.
- Contract strict typecheck: `npm exec --yes --package=node@22 -- node ./node_modules/typescript/bin/tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext ../docs/contracts/product-guarded-ssh-session.ts ../docs/contracts/product-target-execution-guard.ts ../docs/contracts/product-auto-deploy.ts` — PASS.
- Scoped ESLint on the changed TypeScript/JavaScript files — PASS, zero errors/warnings. Ruff 0.17.2 on `target_guarded_ssh_helper.py` and the existing `target_execution_guard.py` — PASS.
- Linux Node 22.23.4 build: `OPSPILOT_CONTROL_PLANE_OUTPUT=/var/tmp/opspilot-p3e3a-runtime/dist/control-plane.cjs OPSPILOT_CONTROL_PLANE_MODULES=/var/tmp/opspilot-p3e3a-runtime/node_modules npm exec --yes --package=node@22 -- node /mnt/d/Developing/DuAnCNTT/app/scripts/build-control-plane.mjs` — `CONTROL_PLANE_BUILD_OK`; helper pair copied alongside artifact. The isolated runtime package was installed under `/var/tmp`, not into the Windows workspace.
- Linux Node 22.23.4 session bundle build: `OPSPILOT_P3E3A_MODULES=/var/tmp/opspilot-p3e3a-runtime/node_modules OPSPILOT_P3E3A_LAB_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/node_modules/@opspilot/p3e3a-lab.cjs npm exec --yes --package=node@22 -- node /mnt/d/Developing/DuAnCNTT/app/scripts/build-p3e3a-ssh-lab.mjs` — PASS.
- Linux Node 22.23.4 real localhost SSH lab: `OPSPILOT_P3E3A_LAB_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/node_modules/@opspilot/p3e3a-lab.cjs OPSPILOT_P3E3A_HELPER_DIR=/var/tmp/opspilot-p3e3a-runtime/dist/target-helper npm exec --yes --package=node@22 -- node /mnt/d/Developing/DuAnCNTT/app/scripts/p3e3a-guarded-ssh-linux-lab.mjs` — PASS. Temporary OpenSSH server bound only to loopback, ephemeral host/user keys, correct fingerprint accepted, wrong fingerprint rejected before public-key authentication. The lab copies the helper from the built controller artifact. SQLite dispatch/canonical deployment precedes target marker; same app second helper receives `TARGET_LOCK_BUSY`; prepare/build authorization stays on one target lock; dropped open response after target marker retains one canonical deployment and unknown state; malformed, truncated and duplicate frames rejected; helper/server/scratch cleanup passed.
- Linux Node 22.23.4 existing guard lifecycle lab: `PYTHONDONTWRITEBYTECODE=1 npm exec --yes --package=node@22 -- node scripts/p3e2-target-guard-linux-lab.mjs` — PASS, including mutual exclusion, lifecycle, stale fence, replay and crash markers.
- `git diff --check` — PASS.

## P3e-3b integration seams and limits

- This session only authorizes fixed phase names through the target guard. It does not upload or render source, run Docker build/activate, perform health checks or rollback, publish the current deployment, or clean pipeline resources.
- P3e-3b must connect every DeployPipeline mutation to this same session and lock, including upload/render/build/activate/health rollback/publish/cleanup; no separate SSH channel may run a write phase.
- No terminal success/failure finalization or reconciliation proof exists here. Target and DB remain `unknown`; current deployment is not promoted. The localhost target uses only temporary enrollment markers, not Docker/deploy.
- No production VPS, production DB, API/UI, network/firewall/DNS/ML state was used. The lab does not prove enforcement against root or old desktop credentials bypassing this helper, nor prove remote daemon task cancellation.

## Handoff

- Implementation commit SHA: `0f25766c` (local; no push/PR/merge).
- Terminal Product deploy finalization/reconciliation and all pipeline integration gates remain for P3e-3b.

## Nhật ký

- START 24/10 — đọc task-discipline, CLAUDE.md, ADR-011, Product target guard contract/implementation, snapshot preparation, SshManager, deploy pipeline và board; tạo requirement ledger. Tiếp theo chốt protocol typed, thêm seam channel nội bộ, helper framing và lab localhost SSH.
- UPDATE 24/10 — thêm internal TypeScript protocol/session, durable dispatch authority read, fixed Python helper, SSH2 channel seam, runtime deps/build packaging và Windows/Linux lab. Node 22 focused 196/196; main/contract typecheck, scoped ESLint, Ruff và Linux real localhost SSH + guard lifecycle lab PASS. Handover records accepted P3e-2 limits; pipeline/deployment NOT_RUN.
- HANDOFF-LOCAL 24/10 — implementation `0f25766c` · 15 focused files / 196 tests PASS, Node 22 typechecks/scoped lint/Ruff/diff PASS, Linux artifact + real localhost SSH/target guard lab PASS. Lab proved dispatch→target marker ordering, pin rejection, single-lock phases, unknown/no replay; no DeployPipeline, Docker, VPS or production DB execution.
