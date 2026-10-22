# TK-S7 P3b-2b — durable branch observation and desired reconciliation

| Owner | Date | Branch | Status | Contract base |
|---|---|---|---|---|
| Worker | 22/10/2026 | `feat/deploy-reachability` | CHỜ REVIEW | P3b-1 `b67c9551ce2cb1a763abc3a52f4754931e63772e`; persistence 016 `82a342fe737d992fca6fd24afb47bb66df1e920e`; pause-policy correction 017 |

## Requirement ledger

`START 2026-10-22` — continuing implementation review from the existing durable-reconciliation working tree; scope remains repository/SQLite only.

| Requirement | Implementation / evidence | State |
|---|---|---|
| Atomic observe/reconcile validates active controller, Product owner, generations/config/ref/app/VPS and pre-fetch observation sequence | `loadReconcileContext`; invalid/stale tests show no partial rows | PASS |
| Changed tip records observation, updates desired, supersedes only stale auto queued/retry-wait; unchanged tip keeps sequence/key and still reconciles | Repeated poll, A-live→B-queued→A, unchanged-tip after restart tests | PASS |
| Durable enqueue key; pending behind active work; uncertainty/manual pause preserved; no failed/rolled-back/uncertain auto replay | Timeline/state tests verify B remains deploying, pending desired survives reopen, manual job stays intact | PASS |
| `satisfied` derives only from canonical DB job/attempt/current deployment/config evidence | No caller `verified` or live SHA is consumed; linked Product history satisfies, unlinked current deployment plus fake caller claim does not | PASS |
| SQLite temporary tests cover rollback, generation/ref/app conflicts and separate connection durability | Mid-transaction injected enqueue failure restores observation, desired, and queued job; independent SQLite handle and reopen preserve one sequence/job | PASS |
| No Git poller, claim/lease/worker, executor, API/IPC/UI, enrollment, VPS or production DB changes | Scope review / diff; forward migration 017 only adds durable pause policy | PASS |

## Invariant boundary

P3b-1 has no caller-supplied current-live evidence contract. The repository treats only the current `app.current_deployment_id` joined to a running `deployment`, successful Product `job` + `attempt`, matching target SHA, controller/ownership/source generations and config hash as canonical live proof. A current deployment with no Product audit chain cannot become `satisfied`.

Observation calls include the sequence read before fetching a tip. The transaction compares it with the current durable latest sequence, preventing an older fetch result from overwriting a newer observation. This repository concurrency guard does not change the reviewed state machine. The initial P3b-2b implementation added no schema changes. Review showed migration 016's `auto_paused` is scoped to a desired source generation and cannot serve as current app policy. Forward migration 017 adds `auto_deploy_paused` and `pause_reason` to `product_app_control`; that owner-level value is authoritative, while desired fields are snapshots. Migration 017 seeds from the newest durable desired snapshot rather than OR-ing older paused rows. No scheduler or resume API is part of this correction.

## Gates

- Node `22.23.4` (`npx --yes node@22`): focused Vitest command for desired reconciliation, repository and migration/index tests — PASS, 4 files / 32 tests.
- Node `22.23.4` (`npx --yes node@22`): `tsc --noEmit -p tsconfig.node.json --composite false` — PASS.
- Node `22.23.4` (`npx --yes node@22`): scoped ESLint on `productDeployRepository.ts`, `productDeployRepository.test.ts`, `productDesiredReconciliation.test.ts`, and `productMigration.test.ts` — PASS, 0 errors / 0 warnings.
- `git diff --check` and staged `git diff --cached --check` — PASS.
- No scheduler/claim worker, real concurrent scheduler, Git poller, or remote deployment was run; local SQLite transaction tests do not claim those gates.

Implementation commit SHA: `5967381947ce663231b138c6018aaa2e5e1e372d`.

## Review correction — pause survives source generation changes

`START 2026-10-22` — reviewer reproduced generation 1/main paused then generation 2/release unpaused/enqueued. Root cause: repository copied pause from the prior generation's desired row, while the schema had no app-level policy field.

| Requirement | Implementation / evidence | State |
|---|---|---|
| Pause is authoritative per current app ownership and source changes cannot clear it | Migration 017 adds owner-level policy; observe/reconcile apply it transactionally to each desired snapshot | PASS |
| Do not let historical pause override a later explicit resume | Repository reads only `product_app_control`; regression leaves old generation paused while current policy is resumed and verifies generation 2 queues | PASS |
| Preserve observation idempotency, manual work, active mutation, and transaction atomicity | Regression checks unchanged poll/reopen, queued manual job and deploying old auto job preservation, plus injected enqueue failure rollback | PASS |
| Keep migration/contract/decision/task records aligned and local-only | Migration 017 runner/schema contract/decision/board updated; no runtime scheduler or external host/DB use | PASS |

Correction gates: Node 22.23.4 focused reconciliation/repository/migration/index tests — PASS, 4 files / 35 tests; main typecheck — PASS; scoped ESLint on repository, reconciliation, migration and index tests — PASS, 0 errors / 96 Prettier warnings; `git diff --check` — PASS. Migration 017's backfill uses the newest persisted desired snapshot; existing v016 rows do not encode why an unpaused snapshot exists, so the migration follows the latest row and does not infer pause from any older row. Migration 016 creates no Product enrollment, so a normal v015 upgrade has no Product rows to interpret.

Correction commit SHA: `4c8018f722a1431a78d51cab59a444509cb42919`.

## Review correction — fail closed on ambiguous legacy pause provenance

`START 22/10` — corrected the review findings on current source. Migration 017's newest `auto_paused=0` snapshot is not evidence of explicit resume: the old generation-change bug can create precisely that sequence. Migration 018 adds `pause_policy_provenance` to the authoritative owner row. For each Product app with an unpaused owner policy and any paused desired history, it sets the owner policy to paused with `operator_required`; it does not enqueue/claim work or modify desired rows, jobs, attempts, deployments, or legacy app data. Apps with no ambiguous history retain inferred current pause state. Only provenance `explicit` represents a confirmed current resume. Historical timestamps/generation ordering are not used as resume proof.

| Requirement | Implementation / evidence | State |
|---|---|---|
| SQLite ownership read returns boolean true/false, and absence remains explicit | Repository maps persisted 0/1 to JS boolean; repository test checks `typeof`, both values and absent | PASS |
| v016 generation 1 paused → generation 2 unpaused cannot auto enqueue after upgrade | Upgrade integration seeds the reproduced state, runs 017 and 018, verifies owner is `operator_required` paused and zero branch-poll jobs | PASS |
| Already-v017 ambiguous state also fails closed | Integration starts at v017, applies only forward migration 018, checks per-app operator-required and no job enqueue | PASS |
| Explicit resume evidence survives reopen and repeated reconciliation; history cannot override it | Provenance `explicit` survives DB reopen; reconciliation regression confirms unchanged poll/reopen keeps it unpaused and does not duplicate its job | PASS |
| Preserve legacy rows, Product history/jobs/attempts and transaction rollback; never execute queued work | Migrations are additive and update only app policy; migration/index/reconciliation suite passes, queue remains untouched | PASS |

Migration 018 is forward-only; migrations 016/017 are unchanged. Ambiguous v017 rows cannot be safely auto-resumed because the schema has no provenance field before 018; an operator must explicitly confirm policy before auto reconciliation can proceed. No API/UI for that confirmation, scheduler, claim or executor was added.

Current-session gates (Node `22.23.4`):

- `node node_modules/vitest/vitest.mjs run src/main/db/productDesiredReconciliation.test.ts src/main/db/productDeployRepository.test.ts src/main/db/productMigration.test.ts src/main/db/index.test.ts` — PASS, 4 files / 36 tests, Node 22.23.4.
- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` — PASS, Node 22.23.4.
- Scoped ESLint for `index.ts`, `index.test.ts`, `productDeployRepository.ts`, `productDeployRepository.test.ts`, `productDesiredReconciliation.test.ts`, and `productMigration.test.ts` — PASS, 0 errors / 115 warnings (Prettier warnings; no bulk formatting performed).
- `git diff --check` — PASS (Git reports the existing schema.sql CRLF-to-LF normalization warning).

Implementation commit SHA: `e27444b424671523351be60c01d92b921919559d`. No Product scheduler/executor, production DB, VPS, IPC/UI, or remote operation was used.
