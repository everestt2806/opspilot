# TK-S7 P3b-2c — atomic Product job claim and lease

| Owner | Date | Branch | Status | Contract base |
|---|---|---|---|---|
| Worker | 22/10/2026 | `feat/deploy-reachability` | ĐANG LÀM | Product contract `docs/contracts/product-auto-deploy.ts`; persistence migrations 016-018; P3b-2b `9528efc5d42c02ce187498af6ad49d43a44d15f7` |

## Requirement ledger

`START 22/10` — add SQLite repository claim and heartbeat only; no scheduler, Git/SSH, deployment executor, external DB, or VPS.

| Requirement | Implementation / evidence | State |
|---|---|---|
| Atomic claim validates active controller, current Product owner/config/app/VPS, priority, availability, retry budget, desired auto revision, pause and uncertain state | `claimNextJob` eligibility SQL + manual priority, stale-generation/paused/obsolete/uncertain/future-available tests | PASS |
| Claim creates both leases, monotonic fences, one attempt and claimed state atomically; failed claims leave no partial state | Immediate transaction + rollback trigger test; app fence and global build fence increase on reopened DB; auto desired becomes `in_progress` atomically | PASS |
| Heartbeat CAS validates complete attempt/lease/fence identity and refuses expired/revoked/stale authority | Renew test covers both lease rows; rejects altered app/build fence, changed generation, inactive controller, and expired lease | PASS |
| Expired unreconciled lease is surfaced and never reclaimed automatically; TTL 60s, target heartbeat 15s | Contract constants; expired slot returns `reconciliation_required`, no attempt/fence reuse | PASS |
| File-backed SQLite concurrent worker/process test proves one winner and one build slot | Two child Node processes wait on a shared gate and contend through the real repository against one SQLite file; one claims, the other gets no job/build-slot busy; exactly one attempt/active slot persists | PASS |
| Product claim/repository/migration/index tests, Node 22 typecheck, scoped lint and diff check | Node 22.23.4: 5 focused DB test files / 45 tests; main typecheck PASS; scoped ESLint 0 errors/0 warnings; `git diff --check` PASS | PASS |
| Update contract/DECISIONS/task/board and commit locally; preserve unrelated untracked files | Contract and decision recorded; task/board updated in local commits; pre-existing untracked entries remain un-staged | PASS |

## Scope and decision

Use the existing `product_app_lease`, `product_app_fence`, `product_worker_lease`, `product_deploy_attempt`, and `product_deploy_job` schema. Prefer manual work over branch-poll jobs. All claim selection and persistence runs under one SQLite `BEGIN IMMEDIATE` transaction. The single build slot is controller-wide. Both an unreleased lease and an expired lease block new claims; expiry returns `reconciliation_required`, because expiry cannot prove that a remote mutation stopped. No release/reclaim/recovery API is added in this checkpoint.

Lease TTL is 60 seconds and expected heartbeat period is 15 seconds. The repository owns these values. A clock seam may be injected by tests only; production calls use the system clock.

## Gates

Final gates (Node 22.23.4, cached Node executable, cwd `app/`):

- `node node_modules/vitest/vitest.mjs run src/main/db/productJobClaim.test.ts src/main/db/productDesiredReconciliation.test.ts src/main/db/productDeployRepository.test.ts src/main/db/productMigration.test.ts src/main/db/index.test.ts` — PASS, 5 files / 45 tests. Includes two spawned Node processes contending for one real file-backed SQLite DB.
- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` — PASS.
- Scoped ESLint on `src/main/db/productDeployRepository.ts` and `src/main/db/productJobClaim.test.ts` — PASS, 0 errors / 0 warnings.
- `git diff --check` — PASS.

No scheduler, SSH, Git poller, deploy executor, IPC/UI, enrollment, VPS, or production DB operation is in scope.

Implementation commit SHA: `1f729af1b89aec063446f6535d049a7344d5012c`.
