# TK-S7 P3b-2b — durable branch observation and desired reconciliation

| Owner | Date | Branch | Status | Contract base |
|---|---|---|---|---|
| Worker | 22/10/2026 | `feat/deploy-reachability` | CHỜ REVIEW | P3b-1 `b67c9551ce2cb1a763abc3a52f4754931e63772e`; persistence 016 `82a342fe737d992fca6fd24afb47bb66df1e920e` |

## Requirement ledger

`START 2026-10-22` — continuing implementation review from the existing durable-reconciliation working tree; scope remains repository/SQLite only.

| Requirement | Implementation / evidence | State |
|---|---|---|
| Atomic observe/reconcile validates active controller, Product owner, generations/config/ref/app/VPS and pre-fetch observation sequence | `loadReconcileContext`; invalid/stale tests show no partial rows | PASS |
| Changed tip records observation, updates desired, supersedes only stale auto queued/retry-wait; unchanged tip keeps sequence/key and still reconciles | Repeated poll, A-live→B-queued→A, unchanged-tip after restart tests | PASS |
| Durable enqueue key; pending behind active work; uncertainty/manual pause preserved; no failed/rolled-back/uncertain auto replay | Timeline/state tests verify B remains deploying, pending desired survives reopen, manual job stays intact | PASS |
| `satisfied` derives only from canonical DB job/attempt/current deployment/config evidence | No caller `verified` or live SHA is consumed; linked Product history satisfies, unlinked current deployment plus fake caller claim does not | PASS |
| SQLite temporary tests cover rollback, generation/ref/app conflicts and separate connection durability | Mid-transaction injected enqueue failure restores observation, desired, and queued job; independent SQLite handle and reopen preserve one sequence/job | PASS |
| No contract/schema migration, poller, claim/lease/worker, executor, API/IPC/UI, enrollment, VPS or production DB changes | Scope review / diff | PASS |

## Invariant boundary

P3b-1 has no caller-supplied current-live evidence contract. The repository treats only the current `app.current_deployment_id` joined to a running `deployment`, successful Product `job` + `attempt`, matching target SHA, controller/ownership/source generations and config hash as canonical live proof. A current deployment with no Product audit chain cannot become `satisfied`.

Observation calls include the sequence read before fetching a tip. The transaction compares it with the current durable latest sequence, preventing an older fetch result from overwriting a newer observation. This repository concurrency guard does not change the reviewed state machine. Migration 016 already has all required durable fields; no schema/contract changes were needed.

## Gates

- Node `22.23.4` (`npx --yes node@22`): focused Vitest command for desired reconciliation, repository and migration/index tests — PASS, 4 files / 32 tests.
- Node `22.23.4` (`npx --yes node@22`): `tsc --noEmit -p tsconfig.node.json --composite false` — PASS.
- Node `22.23.4` (`npx --yes node@22`): scoped ESLint on `productDeployRepository.ts`, `productDeployRepository.test.ts`, `productDesiredReconciliation.test.ts`, and `productMigration.test.ts` — PASS, 0 errors / 0 warnings.
- `git diff --check` and staged `git diff --cached --check` — PASS.
- No scheduler/claim worker, real concurrent scheduler, Git poller, or remote deployment was run; local SQLite transaction tests do not claim those gates.

Implementation commit SHA: `5967381947ce663231b138c6018aaa2e5e1e372d`.
