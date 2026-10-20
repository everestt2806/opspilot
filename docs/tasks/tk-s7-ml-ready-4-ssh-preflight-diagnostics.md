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
