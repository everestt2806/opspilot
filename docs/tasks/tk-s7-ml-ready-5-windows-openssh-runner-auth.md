# ML-READY-5: Windows OpenSSH authentication for experiment runner

## Scope and constraints

- Base reviewed: ML-READY-4 correction code/evidence `e8b9ad14bd95b8241c6ef7cd413917eed6aeb8b2` and task record `11585a9`.
- Branch: `feat/deploy-reachability`.
- Diagnose/fix only the existing `resolve_ssh_client` / `SystemSshClient` credential-to-Windows-OpenSSH path. Keep saved host pin and strict host-key checking. Never use SshManager/snapshot as runner proof.
- Live access, if attempted, is through the explicit profile clone and read-only runner commands only, maximum two authentication attempts in this checkpoint. No deploy, pilot, loadgen, fault, service/DNS/firewall edits, app stop or VPS writes. No contract/schema changes. Keep pre-existing untracked files untouched.

## Requirement ledger

| Requirement | Change or reason not applicable | Current-session check and result | State |
|---|---|---|---|
| Diagnose key conversion, encoding/newline and real Windows ACL offline | Inspect materialization and test using disposable key fixtures; do not expose profile credential | Windows OpenSSH 9.5p2; a disposable Ed25519 key materialized by current code as CRLF with final newline was accepted by `ssh-keygen -y`; Windows ACL test ran and passed; cleanup passed. This does not establish source credential format. | PASS |
| Diagnose actual OpenSSH binary, inherited config, identity selection and algorithm behavior | Capture sanitized effective configuration/binary metadata; keep strict host-key and saved pin | `C:\Windows\System32\OpenSSH\ssh.exe` 9.5p2; `ssh -G` showed strict host checking, `IdentitiesOnly=yes`, isolated known_hosts, one explicit identity, no proxy directive. No user/system SSH config was present. | PASS |
| Sanitize stderr to an allowlisted error code in memory | Never place raw stderr or credential in exception/report | Added allowlisted classifier and `last_error_code`; timeout/process errors are stable codes; `verify_connection()` raises sanitized exceptions; preflight preserves safe reason codes. Regression covers format, permissions, algorithm, auth and host-key diagnostics with secret sentinels. | PASS |
| Apply smallest evidence-backed fix; preserve strict saved pin | Fix only what current evidence proves | No key-byte/identity/algorithm change was justified. New live runner evidence proves Windows OpenSSH rejects the materialized profile credential at key parsing (`SSH_KEY_FORMAT_ERROR`), before host-key verification or authentication. Exact cause among key encoding/container/passphrase/source formatting remains unproven; changing bytes would be speculative. | BLOCKED |
| Verify through the runner client only, then rerun launcher read-only; preserve historical report | At most two live auth attempts; report SshManager separately; preserve all ML pilot gates | One launcher run on explicit clone and pin: SshManager pin/auth + clock/resource commands PASS; runner returned `SSH_KEY_FORMAT_ERROR`, therefore runner host-key/auth and runner clock/resource commands NOT_RUN. Exit 2, scratch cleanup PASS. Pilot stays blocked on ML endpoint, multi-app host, disk target, provider metadata/pair. | BLOCKED |
| Run SSH/preflight/handoff/runner tests, Ruff, Node 22 scripts typecheck if launcher changes, diff check; update board/note with actual SHA | Commit local only; no push/PR/merge | Python focused suites 95/95 PASS; scoped Ruff PASS; `git diff --check` PASS. Launcher was unchanged, so Node scripts typecheck is N/A. | PASS |

## Journal

### START 21/10

- Read task-discipline, `CLAUDE.md`, `DECISIONS.md`, board and ML-READY-4 correction note/report.
- Begin with offline inspection of credential materialization, OpenSSH config/effective options and existing error classification. Preserve ML-READY-4 evidence unchanged.

### UPDATE 21/10 — offline gates and bounded live check

- `SystemSshClient` used `ssh` resolved to Windows OpenSSH 9.5p2 (`C:\Windows\System32\OpenSSH\ssh.exe`). `ssh -G` with the runner options confirmed strict host-key checking, `IdentitiesOnly=yes`, explicit isolated known_hosts, and a single selected identity; no ProxyCommand/ProxyJump or user/system SSH config was present.
- A generated disposable Ed25519 fixture passed `ssh-keygen -y` after the current Windows temp-file materialization (CRLF, terminal newline). Its temporary directory/key were removed. Windows ACL regression ran on this host and passed. This rules out a general failure of the materialization path, but not a difference in the protected profile credential; no real key data was written to the report.
- Added in-memory OpenSSH stderr classification to an allowlist. `SystemSshClient.exec()` now returns only a reason code for failed commands, and `verify_connection()` raises sanitized errors with `reason_code`; preflight records that code instead of collapsing known failures or exposing stderr. No strict verification, saved pin, identity option, algorithm policy or credential bytes were changed.
- One live attempt used `%TEMP%\opspilot-live0-20261020`, VPS/app 1/1, `160.191.243.89:22`, existing saved pin and Electron safeStorage handoff. SshManager separately passed pinned authentication and its fixed read-only clock/resource commands. The experiment runner stopped at `SSH_KEY_FORMAT_ERROR`; its host-key/auth verification and clock/resource commands were NOT_RUN. This proves failure at the local OpenSSH key parser stage, but not whether source encoding, container format, passphrase, or another content difference caused it. No second authentication attempt was made because no concrete byte-level fix was yet justified.
- Launcher/preflight exit code 2; no scratch-cleanup marker and zero `opspilot-ml-preflight-*` directories remained. The profile clone was read-only; no VPS/app/container/config changes, experiment, pilot, loadgen or fault occurred. ML endpoint and all historical protocol blockers remain in place.
- New evidence (historical ML-READY-4 evidence preserved): `docs/evidence/tk-s7-ml-ready-5/`. SHA-256: preflight `1AA2C58DCEF68AEA6C42E160FF341F6915BEB567051BEB37DB700BABE5CD0EC7`; SSH diagnostic `6F341BC1A3B92B56B9B916A7D9935B45863F8077BDCEAE7FA486195B746957DC`; launcher result `59E8ED964C2DF709D21019D7C1ABFA56E68590D12DE63D432D2F0FB9E6CF81A5`.
- Gates: `ml-service/.venv/Scripts/python.exe -m pytest experiments/tests/test_preflight.py experiments/tests/test_runner_e2e.py -q` — 95 passed; `ml-service/.venv/Scripts/python.exe -m ruff check experiments/run_experiment.py experiments/preflight.py experiments/tests/test_preflight.py` — PASS; `git diff --check` — PASS. Node 22 scripts typecheck N/A because no launcher/TypeScript source changed.
- Local handoff remains **BLOCKED** until the exact credential-format incompatibility is isolated and the runner itself verifies the pinned host and completes its read-only clock/resource commands. No push/PR/merge.
