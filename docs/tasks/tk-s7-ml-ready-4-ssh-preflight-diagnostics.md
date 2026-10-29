# ML-READY-4: SSH preflight timeout diagnosis

## Scope and safety

- Base reviewed: `92f7cf4`; preceding ML-READY-3 record: `71d2620`.
- Used the existing read-only clone `%TEMP%\opspilot-live0-20261020`, VPS/app IDs 1/1, stored SSH pin, and Electron safeStorage credential handoff. The clone DB was opened SQLite read-only/query-only. No source profile, key, DB, deployment, DNS, firewall, service, container, model state, or app was changed.
- Compared bounded TCP/banner, OpenSSH keyscan, and main-process `SshManager`. Remote operations were SSH authentication and fixed read-only clock/resource commands only.

## Diagnosis

- TCP connect and SSH banner succeeded in 122 ms; banner was 40 bytes. This established reachability to `160.191.243.89:22`, not host identity.
- `ssh-keyscan -T 5` with a 12-second parent timeout ended after 5,422 ms with exit 1 and no key bytes. Separate bounded scans for ed25519, ecdsa, and rsa ended after 5,125 / 5,172 / 5,109 ms, also with no key output. The previous 5-second subprocess timeout expired before the keyscan process exited at 5.42 seconds, so `HOST_KEY_SCAN_TIMEOUT` described the outer guard, not a proven network timeout or pin mismatch. No fingerprint comparison was possible from those keyscan outputs.
- Main-process `SshManager` authenticated with the saved SHA-256 pin. It identified the verified key type as `ssh-rsa`; the full fingerprint and key bytes are not in the diagnostic report. Final run phases: pinned SSH handshake/auth 2,544 ms; read-only clock command 1,081 ms (offset +605 ms); read-only resource inventory 677 ms (1,900 bytes).
- A separate legacy Python/OpenSSH authentication attempt returned the sanitized code `SSH_AUTHENTICATION_FAILED` after host-key verification. The app `SshManager` authentication passed with the same stored credential. The launcher now uses bounded resource/clock results from that pinned `SshManager` connection instead of starting a second OpenSSH authentication stack. It does not treat the OpenSSH failure as evidence of a bad pin.
- Kept one 25-second total deadline for the manager handshake, the original 5-second per-connection keyscan limit, and an evidence-based 8-second keyscan process limit. The 8-second process cap allows the observed 5.42-second child exit plus startup/exit margin; it is not an open-ended retry. The live manager path does not depend on keyscan output when the exact pin has already been verified by `SshManager`.
- The manager-produced known_hosts line and snapshot exist only in launcher scratch. Python checks the exact endpoint, key type and SHA-256 pin from the clone before accepting the bounded snapshot. Snapshot schema/size/identity failures block; no caller-provided `verified` flag is accepted as standalone evidence. OpenSSH fallback keeps strict checking and disables global known_hosts when using its private known_hosts file.

## Fresh live preflight

- Evidence: `docs/evidence/tk-s7-ml-ready-4/`.
- `SSH_HOST_KEY`, `SSH_TRANSPORT`, `VPS_RESOURCES`, app health, CPU, RAM available, NTP, clock offset and Docker/Compose passed. Resource inventory was freshly read through the pinned manager.
- Overall remains **BLOCKED**: ML endpoint `127.0.0.1:8765` had no usable local service; VPS disk total was 26,307,022,848 bytes against the 40,000,000,000-byte protocol target; Docker inventory showed 4 DB apps and 9 running containers, so the dedicated-host gate failed; provider/region and declared-spec metadata are absent; provider-pair gate is NOT_RUN. These are fresh report results, not the older LIVE-0 snapshot.
- Launcher exit code: `2` (preflight BLOCKED). Scratch cleanup: PASS; cleanup failure would emit `ML_PREFLIGHT_SCRATCH_CLEANUP_FAILED` and return 3. No launcher scratch directory or new process remained after completion. No live report from ML-READY-3 was overwritten.
- The required next information for full protocol eligibility is a dedicated VPS meeting the 40 GB target, complete provider/region/spec metadata and a configured, responding explicit local ML endpoint; a second provider VPS is needed for the pair gate. The SSH pin does not need replacement based on these results.

## Artifacts and hashes

- `preflight-report.json` SHA-256: `11e215eb5dfbdf3c08359bde62f38a04bafb0273b6276111487c2fd93e2065d9f`.
- `ssh-diagnostic.json` SHA-256: `e251a59f5af4410e1204d7846152c18fbbef73aa9c8bd0b5c37c5aab611e7224`.
- `ssh-comparison.json` SHA-256: `28ed149bc516158eb856dfd925b04078960c645dd06f379552da732bb0409975`.
- `launcher-result.json` SHA-256: `a42ea03bd08c35e3ca2a62fd971733afb46cf9ff3719ab8fc2aa1f382b8c2370`.
- Historical ML-READY-3 report remains unchanged; SHA-256 `70fe45aebf6d8e6619195aba344cf8747dd39daf52a21e072bea31f3489d7af8`.

## Gates

- Node 22.23.3 focused SSH/handoff Vitest: 24/24 PASS.
- Node 22.23.3 main and scripts typecheck: PASS; scoped ESLint: PASS, 0 errors / 0 warnings.
- Python preflight/handoff/runner E2E: 90/90 PASS; scoped Ruff: PASS.
- `git diff --check`: PASS.
- Implementation/evidence commit: `961979da8f87bb2e7fe8aa8610f4cb7cbda35d6e`; local only, no push/PR/merge.
- No SSH raw output, credential, complete fingerprint or key material is stored in reports. No deployment, pilot, fault, load generation, VPS writes or service changes.

## Correction — runner transport is separate from SshManager

### START 20/10

- Reviewed task-discipline, `CLAUDE.md`, `DECISIONS.md`, this checkpoint and board.
- Scope: make `SSH_TRANSPORT` describe the experiment runner's own `resolve_ssh_client` / `SystemSshClient`; retain SshManager results as separate read-only diagnostic evidence. Add snapshot identity/time/freshness and ensure replayed data never counts as live. No deployment or VPS changes.

### Findings and implementation

- The earlier Python path created `VerifiedSshSnapshotClient`; its `verify_connection()` did nothing and it replayed SshManager's resource output. That made the runner's `SSH_TRANSPORT=PASS` claim unsupported. The earlier live SshManager measurements remain historical evidence for the app connection only; the old runner-PASS claim is superseded by this correction.
- Python now always resolves the runner client with an isolated known_hosts file and saved key material. The runner must pass strict host-key/authentication verification and execute the fixed read-only resource command successfully before `SSH_TRANSPORT=PASS`. Resource PASS details identify `experiment_runner.SystemSshClient`, collection time, VPS ID, endpoint and 5-minute freshness limit.
- SshManager snapshot now carries source `SshManager`, UTC collection time, target VPS ID and endpoint. Python validates schema, target, endpoint, timestamp and a five-minute freshness bound, but labels a valid snapshot `RECORDED_NOT_LIVE_PROOF`; it never uses snapshot resource output or clock data for readiness. Stale/invalid snapshots are reported as not usable. The separate runner connection must generate any live PASS.
- Strict host-key verification remains enabled with an isolated known_hosts file containing only key material whose SHA-256 matches the saved profile pin. No new pin is trusted and no global known_hosts is changed.

### Fresh read-only live result

- Used the existing clone `%TEMP%\opspilot-live0-20261020`, VPS/app 1/1, endpoint `160.191.243.89:22`; profile DB query-only, existing credential handoff. No source profile, model state, app, container, DNS, firewall or service was changed.
- TCP/banner: PASS, 120 ms.
- SshManager pinned handshake/auth: PASS, 2,620 ms; verified key type `ssh-rsa` (fingerprint omitted). Its fixed read-only clock command: PASS, 1,159 ms, offset +686 ms. Its resource inventory: PASS, 672 ms, 1,900 bytes. These are SshManager observations only.
- Runner strict host-key verification: PASS. Runner authentication: BLOCKED with sanitized `SSH_AUTHENTICATION_FAILED`; its inventory was NOT_RUN. The report does not contain raw OpenSSH stderr, so the precise underlying authentication rejection detail is unavailable. This does not indicate a bad pin: runner strict host-key verification passed and SshManager authenticated with the saved pin. The OpenSSH authentication issue remains unresolved; no claim that its cause was fixed.
- Launcher and preflight exit code: 2 (BLOCKED). Cleanup: PASS; no cleanup failure marker, no `opspilot-ml-preflight-*` scratch directory remained, and no Electron process remained.
- Pilot remains BLOCKED: explicit local ML endpoint unavailable; protocol dedicated-host gate cannot pass with the current multi-app VPS; disk total is below 40 GB; provider/spec metadata and provider-pair evidence are absent/NOT_RUN. The new run stopped before fresh VPS resource inventory through the runner, so historical resource values are not substituted as current evidence.

### Evidence

- New evidence only; historical ML-READY-4 and ML-READY-3 evidence were preserved: `docs/evidence/tk-s7-ml-ready-4-correction/`.
- Fresh `preflight-report.json` SHA-256: `7cc0396ac6b603de6a09424ed26bc6ddb92bbdd117366a76b1c7598428162fd3`.
- Fresh `ssh-diagnostic.json` SHA-256: `7fc1c3d40baab5f80b0c5fdbf501a36ca5531cafafb3523b76bee371263b23e0`.
- `launcher-result.json` SHA-256: `25afc112e59fd47598ec6a229fc12225f5457ed9161f795d1050c14c53cde475`; records launcher/preflight exit 2 and cleanup result without raw output or secret.

### Gates and handoff

- `ml-service/.venv/Scripts/python.exe -m pytest experiments/tests/test_preflight.py -q`: 53 passed.
- `ml-service/.venv/Scripts/python.exe -m pytest experiments/tests/test_runner_e2e.py -q`: 37 passed.
- `ml-service/.venv/Scripts/python.exe -m ruff check experiments/preflight.py experiments/tests/test_preflight.py`: pass.
- Node 22.23.3: `pnpm --filter @opspilot/app typecheck:node`, `pnpm --filter @opspilot/app exec tsc -p tsconfig.scripts.json --noEmit`, and scoped ESLint on `scripts/ml-preflight-live.ts`: pass, no diagnostics.
- Node 22.23.3 Vitest `src/main/crypto/credentialHandoff.test.ts`: 12 passed.
- `git diff --check`: pass (after final documentation/evidence update).
- Fresh VPS run was strictly read-only. No deploy, service/firewall/DNS change, stop, fault, loadgen or experiment/pilot.
- UPDATE 20/10: runner readiness no longer inferred from SshManager; new live outcome is runner authentication BLOCKED after strict host-key PASS. No evidence supports replacing the saved pin.
- Code/evidence commit: `e8b9ad14bd95b8241c6ef7cd413917eed6aeb8b2`; local only.
- HANDOFF-LOCAL 20/10 — `e8b9ad14bd95b8241c6ef7cd413917eed6aeb8b2` · 90 Python tests + 12 Vitest pass; Node 22 typecheck/scoped lint, Ruff and diff check pass · evidence `docs/evidence/tk-s7-ml-ready-4-correction/`. No push/PR/merge.
