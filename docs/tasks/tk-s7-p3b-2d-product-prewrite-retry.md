# TK-S7 P3b-2d — atomic pre-write completion and safe retry

| Owner | Date | Branch | Status | Base |
|---|---|---|---|---|
| Worker | 22/10/2026 | `feat/deploy-reachability` | CHỜ REVIEW | Product persistence/claim `5b3ae993d3a6f4b2fad26024152865f664591834`; migrations 016–018 |

## Scope

SQLite repository, Product contract, tests and task records only. No Git/SSH/deploy executor, scheduler, API/IPC/UI, migration, VPS or production DB operation.

## Requirement ledger

| Requirement | Implementation / evidence | State |
|---|---|---|
| Finish only a current pre-write claim inside `BEGIN IMMEDIATE`, with clock after lock and full controller/ownership/source/app/VPS, attempt, lease, fence and expiry CAS | `finishPrewriteAttempt`; no caller safety boolean; accepts only claimed/snapshot-verified plus `remote_outcome=not_started` | PASS |
| Retry policy: same job, new attempt only on later claim; total maximum 3; backoff 30s then 120s plus bounded jitter; permanent/exhausted failure terminal | Durable `retry_wait`/`available_at`, max attempts contract and bounded 0–15s additive jitter; retry/budget/permanent failure tests | PASS |
| Supersede obsolete auto work without rewriting newer desired revision or manual pause | `check_obsolete` derives obsolete status from current desired identity and owner pause; non-obsolete request rejected without writes, newer desired remains unchanged | PASS |
| Update attempt, job, both lease rows and desired/history atomically while retaining lease/fence history | One immediate transaction, exact release CAS, history event; injected build-slot release failure checks full-row rollback | PASS |
| Reject expired/stale/double-completed/dispatched/applied/unknown attempts without mutation | Snapshot equality regressions; terminal remote outcomes require reconciliation; old attempt cannot release a newer lease | PASS |
| Tighten real lock-wait test handshake | Worker writes marker after imports/database/repository setup immediately before repository invocation; finite SQLite/process deadlines and child cleanup | PASS |
| Node 22 Product/DB tests, typecheck, scoped lint, diff check; update contract/decision/board and commit | Node 22.23.4: 5 files / 55 tests PASS; main typecheck PASS; scoped ESLint 0 errors / 0 warnings; final diff check below | PASS |

## Decisions and boundaries

- `max_attempts` remains constrained by migration 016 to 1–3; retryable attempts use this durable job budget and never exceed the contract maximum of three total.
- Additive jitter is uniformly bounded by 15 seconds; test injection is repository-local and production uses `Math.random`. Existing 30s and 120s backoff bases are unchanged.
- An auto job becomes superseded only when the current desired observation/SHA/epoch/link differs or the current owner policy is paused. A newer desired row is not updated. If pause applies to this exact desired row, its snapshot is set to paused while the app-level policy remains authoritative.
- Before any future remote mutation, an executor must durably mark the attempt `deploying` and `remote_outcome='unknown'` in a separate transaction. This checkpoint adds no such executor/transition. Build and health failures therefore cannot use this path.
- No schema change was needed; existing attempt state `abandoned_before_write`, job `retry_wait`, `available_at`, lease `released_at`, history table and fence tables cover the transition.

## Gates

Node 22.23.4, cwd `app/`:

- `node node_modules/vitest/vitest.mjs run src/main/db/productJobClaim.test.ts src/main/db/productDesiredReconciliation.test.ts src/main/db/productDeployRepository.test.ts src/main/db/productMigration.test.ts src/main/db/index.test.ts`: PASS, 5 files / 55 tests.
- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false`: PASS.
- Scoped ESLint on `src/main/db/productDeployRepository.ts` and `src/main/db/productJobClaim.test.ts`: PASS, 0 errors / 0 warnings.
- `git diff --check`: PASS before implementation commit; final documentation-inclusive diff check also PASS.

Final local command: `git diff --check` — PASS (documentation-inclusive change set).

Implementation commit SHA: `c52dfa0fde4cda9d0f809f98f1724f9814705322`.
No production/VPS operations. No migration, executor, scheduler or remote dispatch was run.

## Review correction — pre-write error allowlist

| Requirement | Implementation / evidence | State |
|---|---|---|
| Define explicit transient/permanent pre-write codes and verify runtime membership | Contract exports separate lists; repository accepts only transient `GIT_UNAVAILABLE`, `SSH_PREFLIGHT_TIMEOUT`, `NETWORK_ERROR` for transient disposition and permanent `INVALID_SOURCE_CONFIG`, `UNSUPPORTED_SOURCE_CONFIG`, `INVALID_REPOSITORY_URL` for permanent disposition | PASS |
| Reject unrecognized or mismatched codes before DB mutation, without echo | Regex-valid `UNRECOGNIZED_SECRET_SENTINEL` and `INVALID_SOURCE_CONFIG` + transient disposition both return generic rejection; full job/attempt/desired/lease/history snapshots remain identical | PASS |
| Valid transient/permanent codes retain intended results; dispatched state guard is exercised | Existing transient retry/backoff and permanent terminal-failure tests pass; post-dispatch regression uses allowlisted `GIT_UNAVAILABLE` and reaches durable `remote_outcome='unknown'` rejection | PASS |
| Product/DB gates, typecheck, scoped lint and diff check | Node 22.23.4: 5 files / 56 tests PASS; main typecheck PASS; scoped ESLint 0 errors / 0 warnings; diff check PASS | PASS |

Allowlist correction implementation SHA: `b1f8208061ea1c99bac877743fa99372f2b8b913`.
