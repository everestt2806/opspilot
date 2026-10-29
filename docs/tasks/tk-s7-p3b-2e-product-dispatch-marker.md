# TK-S7 P3b-2e — verified Git snapshot and durable dispatch marker

| Owner | Date | Branch | Status | Base |
|---|---|---|---|---|
| Worker | 22/10/2026 | `feat/deploy-reachability` | CHỜ REVIEW | P3b-2d `33e8e6dc3efed3f545671b6ba8f3df3f651a06ee`; implementation `ef15e77196ca502eddf8889b0a6d11c4a6f766ef`; Product migrations 016–018 |

## Scope

Contract and SQLite repository/tests only. No Git fetch, SSH, remote command, deployment execution, executor, scheduler, API/IPC/UI, VPS or production DB.

## Review record

Leader approved P3b-2e code `ef15e77196ca502eddf8889b0a6d11c4a6f766ef` with dossier `a9df123d66868aeb7b9454076c61b7021c91de32`. Approval covers persistence, executor-supplied metadata equality and the one-shot durable marker only. It does not establish a real Git fetch, remote execution or successful Product auto deployment; these remain P3e/P3g gates.

## Requirement ledger

| Requirement | Implementation / evidence | State |
|---|---|---|
| Verify internal Git snapshot metadata against job/config without a boolean shortcut | `markGitSnapshotVerified()` checks repository/root/full SHA/config against durable authority; metadata is explicitly not fetch evidence | PASS |
| Begin dispatch atomically after post-lock clock, controller/ownership/config, token, exact leases/fences, snapshot/desired/pause/uncertain checks | `beginGitDispatch()` uses `BEGIN IMMEDIATE`, samples clock after lock, validates current authority and auto desired state before writes | PASS |
| Create exactly one canonical deployment/version and link attempt; mark job/attempt deploying + outcome unknown and write safe history atomically | Shared `insertNextDeploymentVersion()` and attempt/job/history mutations share one SQLite transaction; current pointer is untouched | PASS |
| Repeated dispatch/reopen returns reconciliation required and never grants second dispatch or creates duplicate deployment; pre-write completion is blocked after marker | Durable deploying/unknown/deployment link guard; reopen and prewrite regressions pass | PASS |
| Clearly block unsupported manual rollback; preserve current deployment pointer and old lease history | Claim path blocks `manual_rollback`; dispatch does not update current pointer/release leases | PASS |
| Tests for valid/mismatched metadata, stale/expired claims, desired/pause/uncertain, concurrent/repeated calls, transaction rollback and reopen | Product DB suite 78/78; includes two real worker processes contending on one file DB and injected transaction failure | PASS |
| Node 22 Product/DB tests, typecheck, scoped lint, diff check; update contract/decision/board and commit | Node 22.23.4 gates all pass; scoped ESLint 0 errors/0 warnings; diff check clean | PASS |

## Evidence limitation

Metadata equality tests prove only that executor-supplied repository/root/SHA/config values match the durable Product job/config. They do not prove a real Git fetch or repository authenticity. No remote action is run in this checkpoint.

## Journal

- `START 2026-10-22`: inspected repo rules, Product contract/migrations 016–018, claim/prewrite repository and tests. No migration needed because the attempt already has a unique deployment link; shared deployment-version allocator can run inside dispatch transaction.
- `UPDATE 2026-10-22`: Node 22.23.4 via direct `node.exe ...pnpm.mjs`; `vitest run src/main/db` = 7 files / 78 tests PASS; `pnpm typecheck:node` PASS; scoped ESLint on `productDeployRepository.ts`, `productJobClaim.test.ts`, `deploymentRepository.ts` = 0 errors / 0 warnings; `git diff --check` PASS. Tests cover exact/mismatched metadata, stale/expired token, desired change/pause, uncertain work, archived identity, one-shot/reopen/prewrite guard, two real worker processes, transaction rollback, and manual rollback block. No migration required. No Git/SSH/remote deploy was run.
- `HANDOFF-LOCAL 2026-10-22`: implementation commit `ef15e77196ca502eddf8889b0a6d11c4a6f766ef`; docs/board finalization follows in local commit. No push/PR/merge.
