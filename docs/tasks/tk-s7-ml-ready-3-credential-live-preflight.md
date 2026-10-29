# TK-S7 ML-READY-3 — credential handoff và live preflight chỉ đọc

## Ledger

| Yêu cầu | Trạng thái | Bằng chứng |
|---|---|---|
| Mở khóa chỉ master key hiện hữu; DB SQLite clone read-only; profile/VPS/app được chọn tường minh | IMPLEMENTED | Electron CLI `app/scripts/ml-preflight-live.ts`; `loadExistingCredentialCipher()` không tạo key; SELECT trên DB `readonly` + `query_only` |
| Handoff secret ngoài argv/env/stdout/report; giới hạn, timeout và cleanup | IMPLEMENTED | stdin pipe nội bộ Electron→Python; output bounded; timeout giết process tree; Python chỉ nhận preflight-only và xóa biến môi trường secret |
| Child SSH/ssh-keyscan không kế thừa credential; pin strict và known_hosts tạm | IMPLEMENTED | lọc env nhạy cảm; SSH client giữ strict host check, preflight tạo known_hosts tạm từ key khớp pin |
| ML endpoint explicit, GET-only; không chạm model state hiện tại | IMPLEMENTED | launcher bắt buộc URL loopback tường minh; preflight chỉ GET `/health` và `/status`; service lab nếu chạy phải dùng source/state temp riêng |
| Offline regression + Node22/Ruff/diff gates | OPEN | Chạy sau khi implementation ổn định |
| Live preflight profile LIVE-0, VPS phát triển | OPEN | Chỉ chạy sau khi gate offline đạt; chỉ lưu report đã khử nhạy cảm |

## START — 20/10/2026

- Branch `feat/deploy-reachability`, base `9c15be3b05b48e49b492a0873e0962281a9a7f83`.
- Đọc task-discipline, task ML-READY-2, LIVE-0, safeStorage/credential cipher, main initialization, Python preflight và SSH resolver.
- Giữ nguyên report lịch sử `docs/evidence/tk-s7-ml-ready-2/preflight-report.json`; profile clone nguồn chỉ đọc.
- Không deploy, thay đổi VPS/DNS/firewall/service/container, chạy pilot/fault/loadgen, hoặc ghi profile nguồn.

## UPDATE ? implementation, offline gates, and live read-only preflight ? 20/10/2026

- Added `loadExistingCredentialCipher()` for existing-key-only unlock. Missing/decrypt-failed keys stop without creating/replacing the protected master key. Electron launcher sets clone `userData` before `whenReady`, uses app identity `vn.opspilot.desktop` / `OpsPilot`, reads SQLite `readonly` + `query_only`, validates explicit VPS/app/current deployment, then calls `loadSecret`.
- Added bounded stdin-only secret handoff to Python preflight. Child arguments, inherited environment, logs, report, and shell-parent environment do not contain credential. Temporary SSH key directories/files on Windows get an explicit DACL for current user and SYSTEM; ACL failure blocks before the key is written. Cleanup is performed on success/failure/timeout. SSH and ssh-keyscan child environments exclude variables named for secrets, tokens, passwords, credentials, private keys, app environment JSON, and the SSH-key-file override.
- ML endpoint was explicit loopback with a dynamically reserved test port. The ML service ran from a temporary copy of source modules; state was not copied and no state directory was created. Only GET `/health` and `/status` ran. The owned service PID was stopped after the check. Model state in the working tree was not touched.
- Live preflight at `2026-10-20T13:18:15Z`: profile selection (VPS 1/app 1/deployment 7), clone read-only, Electron safeStorage credential unlock, app health, and isolated ML health/status PASS. The single `ssh-keyscan` attempt timed out at the configured 5-second limit (`HOST_KEY_SCAN_TIMEOUT`); pin match, SSH authentication, VPS resource inventory, dedicated-host, RAM, NTP, and clock-offset gates are NOT_RUN. Overall BLOCKED. Do not infer live resource values from historical LIVE-0. Host remains ineligible by the documented dedicated/40 GB requirements and other-app constraint.
- Report: `docs/evidence/tk-s7-ml-ready-3/preflight-report.json`; sanitized JSON only. SHA-256 `70fe45aebf6d8e6619195aba344cf8747dd39daf52a21e072bea31f3489d7af8`. Previous ML-READY-2 report remains untouched. No VPS writes, deployment, DNS/firewall/service/container changes, fault/loadgen, or pilot.
- Offline gates (Node `v22.23.3`): focused Python `experiments/tests/test_preflight.py`, `test_credential_handoff.py`, `test_runner_e2e.py` ? 84 passed; scoped Ruff ? PASS; Electron/Vitest master-key + handoff/isolation tests ? 6 passed; script and main-process TypeScript checks ? PASS; scoped ESLint ? 0 errors/warnings; `git diff --check` ? PASS. Full Ruff is not a required pass here; latest repo-wide result remains 4 pre-existing findings in untouched `tools/a17-c00-inventory.py`.
- Actual implementation SHA: `bb6a3e2def1c5a3d79c44f972525c81225012614` (local commit; no remote operation).

### Final ledger

| Requirement | Status | Evidence |
|---|---|---|
| Existing safeStorage key only; explicit profile/VPS/app; SQLite read-only | PASS | Electron launcher, missing/decrypt-failure tests, live clone unlock and selection PASS |
| Short-lived stdin handoff, no argv/env/output/report disclosure, bounded cleanup | PASS | Handoff, output-limit/timeout and cleanup tests |
| Secret filtering for keyscan and SSH; strict saved-pin known_hosts | PASS offline / BLOCKED live | Filter tests PASS; live keyscan timed out before pin comparison |
| Explicit isolated ML service, GET only, no existing model state access | PASS | Temporary source copy; `/health` and `/status` PASS; isolated state absent before/after |
| Offline verification | PASS | 84 Python tests; 6 Electron tests; Node22 typechecks, scoped Ruff/ESLint, diff check PASS |
| Live VPS read-only preflight | BLOCKED | `HOST_KEY_SCAN_TIMEOUT` after 5 seconds; SSH transport and resources NOT_RUN |
| Dedicated host / 40 GB requirements | BLOCKED | Historical LIVE-0 snapshot records other apps and 26.3 GB total disk; not re-probed because pin could not be verified |

## UPDATE: review fixes on 7b28ccb (2026-10-20)

- Code review fix commit: `92f7cf4213722f017cace1c9c5ef59138ddf53c4` (local only).
- Launcher cleanup is now recursive only after `realpath` confirms the scratch root is strictly beneath the resolved OS temp root. The isolated ML tree is removed only after that containment check. Successful cleanup preserves preflight exit codes `0` and `2`; cleanup failure emits the separate `ML_PREFLIGHT_SCRATCH_CLEANUP_FAILED` marker and returns `3`.
- Profile clone containment now uses resolved path relationships (`relative`), rejecting the temp root itself, outside siblings, and symlink/junction destinations outside the root. No profile source or master key was changed or created.
- Secret stdin handoff now observes spawn errors, stdin errors/early close and delivery completion; it settles once with sanitized error codes and waits for child close after timeout/output-limit termination. It does not count an early child exit as successful credential delivery.
- Launcher/handoff tests: 12/12 PASS, covering exit-code preservation for preflight `0` and `2`, cleanup failure distinction, pre-decrypt/no-scratch failure, 1 MiB early pipe close, spawn failure, timeout, output limit, path containment, and cleanup. Scratch fixtures are verified absent after success; child-spawn tests await process close.
- Node 22.23.3 gates: focused Vitest 12/12 PASS; Python preflight/handoff/runner E2E 84/84 PASS; Ruff scoped PASS; main and scripts TypeScript checks PASS; production build PASS; scoped ESLint PASS (0 errors, 0 warnings); `git diff --check` PASS.
- **Saved live preflight evidence (unchanged):** `docs/evidence/tk-s7-ml-ready-3/preflight-report.json`, SHA-256 `70fe45aebf6d8e6619195aba344cf8747dd39daf52a21e072bea31f3489d7af8`; still overall BLOCKED because `ssh-keyscan` timed out at 5 seconds. This is not evidence of a bad pin. No live retry was performed.
- **Launcher result (separate from saved preflight report):** local fixture tests establish exit/cleanup behavior only; no new live preflight was run. Existing report was not replaced. No VPS write, deploy, or pilot.
