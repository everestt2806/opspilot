# TK-S7 P3e-1 — immutable Git snapshot preparation

| Checkpoint | Base / accepted input | Status |
|---|---|---|
| P3e-1 | P3d correction `80d5067`; accepted dossier `3c8e9cf` | CHỜ REVIEW |

## Requirement ledger

| Requirement | Implementation/evidence | State |
|---|---|---|
| Read Product authority only from a valid claim; verify authority before and after async Git | `readGitSnapshotAuthority` validates job, controller, source, app eligibility, attempt and both lease/fence pairs; auto jobs must still match unpaused desired observation/epoch; preparer rechecks equality after fetch, and mark transaction checks auto desired again | PASS |
| Fetch exact full job SHA; detached checkout; verify actual checkout and guarded root | Snapshot accepts an exact SHA target and compares fetched and checked-out commit; real Git fixture pins A after branch moves to B; missing-SHA fixture proves no branch fallback | PASS |
| Call metadata repository verification only after source operation and authority checks | Internal preparer invokes `markGitSnapshotVerified` after exact SHA/root result and post-fetch authority check | PASS |
| Bound/cancel complete Linux Git process group and clean only after close | Snapshot Git children share the P3c process-group signal helper; timeout/output/abort wait for child close before snapshot cleanup | PASS |
| Idempotent internal snapshot cleanup | Handle cleanup is idempotent and checks the real scratch path is beneath configured temp root | PASS |
| Public HTTPS-only production source, no arbitrary helper/credential, no submodules or LFS download | Production preparer accepts GitHub HTTPS only; helper is blanked, inherited Git/secret-like environment removed, transport protocols restricted, submodules disabled, LFS smudge skipped | PASS |
| Real Git fixture: pinned A after branch moves to B; SHA missing; root traversal/symlink; cleanup | Snapshot fixture tests and Product claim integration test | PASS |
| SQLite authority stale/expiry/source-change integration regressions | Real local Git integration changes ownership after the scratch checkout starts; preparation rejects and removes the new snapshot. Repository regression rejects expired lease and changed ownership | PASS |
| Linux real HTTPS helper timeout/cancel, no process/scratch; controller artifact build; public GitHub full-SHA snapshot | WSL Ubuntu Node 22.23.4: built controller CJS; live public GitHub snapshot SHA `7fd1a60b01f91b314f59955a4e4d4e80d8edf11d` had matching detached `HEAD`, root `.` and cleanup; loopback HTTPS CONNECT stall timeout 1,225 ms and cancellation 1,218 ms, no matching Git/helper process in `/proc`, scratch empty | PASS |
| Focused Product/Git/controller suite, strict main typecheck, scoped lint and diff | Windows Node 22.23.4: 11 files / 113 tests PASS; main TypeScript typecheck PASS; scoped ESLint PASS with 0 warnings/errors; Linux artifact/lifecycle above; `git diff --check` PASS | PASS |

## Design notes

- The test-only local transport is exposed only by `prepareProductGitSnapshotFromLocalFixture`; production preparation always uses the canonical public GitHub HTTPS snapshot path.
- Product snapshot verification history continues to mean that the internal snapshot preparer fetched and checked out source; the older repository method alone still means metadata equality, not proof of fetch.
- Snapshot exceptions map in memory to a fixed internal error-code allowlist (timeout, cancellation, size limit, invalid root, unavailable/mismatched SHA, or generic Git failure); raw Git stderr/exception text is not returned by the preparation error. Credential-like inherited variables are removed from Git child environment.
- No `beginGitDispatch`, Docker, SSH, deployment row, current-pointer promotion, worker executor configuration, VPS, production DB, DNS, firewall, API, or UI was used.
- P3d review `80d5067` / dossier `3c8e9cf` is accepted context only: controlled executor lifecycle, not remote deployment.

## Gates

## Evidence and limits

- `npm exec --yes --package=node@22 -- node ./node_modules/vitest/vitest.mjs run src/main/controlPlane src/main/db/productJobClaim.test.ts src/main/db/productDesiredReconciliation.test.ts src/main/db/productDeployRepository.test.ts src/main/db/productMigration.test.ts src/main/db/index.test.ts src/main/git/snapshot.test.ts src/main/git/publicBranch.test.ts` — PASS, 11 files / 113 tests.
- `npm exec --yes --package=node@22 -- node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` — PASS.
- Scoped ESLint over snapshot, Product repository/preparation, tests and Linux lab — PASS, 0 errors / 0 warnings.
- WSL Node 22.23.4 build: `OPSPILOT_CONTROL_PLANE_OUTPUT=/var/tmp/opspilot-p3e1-control-plane.cjs OPSPILOT_CONTROL_PLANE_MODULES=/var/tmp/opspilot-p3c-lab-20261022b/runtime/node_modules npm exec --yes --package=node@22 -- node scripts/build-control-plane.mjs` — PASS.
- WSL Node 22.23.4 `scripts/p3e1-git-snapshot-linux-lab.mjs` — PASS, public snapshot SHA above; it verifies `HEAD`, detached symbolic-ref state and root `.`, then confirms snapshot cleanup. Real HTTPS proxy timeout/cancel were 1,225/1,218 ms, bounded near the existing 1,000 ms TERM→KILL grace; Git/helper process scan and scratch were empty. The harness does not prove arbitrary daemonized descendants that escape their process group.
- `git diff --check` — PASS.
- No SSH/Docker, dispatch marker, deployment row, promotion, VPS, production DB, DNS/firewall, API/UI, or remote deployment was used. Metadata history still records metadata equality; the actual fetch/checkout evidence is the internal preparer path plus real Git fixture/public snapshot gates. Resource/build host capacity and remote deployment remain unproven.

Final local commit SHA: to be recorded after commit.
