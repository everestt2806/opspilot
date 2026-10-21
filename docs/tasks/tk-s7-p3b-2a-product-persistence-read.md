# TK-S7 P3b-2a — Product persistence migration and read repository

| Owner | Date | Branch | Status | Contract base |
|---|---|---|---|---|
| Worker | 22/10/2026 | `feat/deploy-reachability` | CHỜ REVIEW | P3b-1 `b67c9551ce2cb1a763abc3a52f4754931e63772e` |

## Requirement ledger

| Requirement | Implementation / evidence | State |
|---|---|---|
| Forward migration after 015, no edits to old migrations | Migration `016_product_auto_deploy_persistence.sql`, registered as version 16; `schema.sql` synchronized from reviewed P3b-1 DDL | PASS |
| Empty persistence only; no identity, ownership, desired row, job or mode cutover | Fresh and v015-upgrade tests assert Product tables have no enrolled data; snapshots preserve legacy VPS/app/deployment/Git/monitor rows | PASS |
| Read controller/ownership/source/desired by exact identity/generation; explicit absence | `ProductDeployRepository` returns `{kind:'absent'}` or `{kind:'present', value}`; queries scope app + source generation + ref; desired `auto_paused` is mapped from SQLite integer to boolean. Observation read is also scoped | PASS |
| Migration is repeat-safe and atomic; DB constraints and links work | Migration tests cover v015 upgrade, repeat open, FK check, checked values, FK violations, SHA non-uniqueness, active lease/build-slot uniqueness, and injected mid-DDL name conflict rollback | PASS |
| No scheduler, claim, executor, API/IPC/UI, Product switch, production DB or VPS | No such paths were added or called | PASS |

## Persistence boundary

Migration 016 creates the eleven reviewed tables and indexes with no seed rows. Existing `app`, `deployment`, Git provenance and monitor configuration remain untouched. It does not imply Product ownership for legacy apps. The `schema_version` runner applies the migration in one SQLite transaction.

SQLite enforces primary/foreign keys, allowed state/check values, unique idempotency keys, unique attempt number per job, lease/fence references, and the partial unique active app lease/build slot. It deliberately does not enforce a permanent app/SHA uniqueness rule.

Repository transactions in the next checkpoint must enforce ownership/controller/source-generation CAS, exact desired-revision/job matching at enqueue and claim, legal state transitions, monotonic fence advancement, lease/heartbeat validity, and atomic history/desired/job changes. DDL constraints cannot establish that a queued auto job still matches the latest desired observation or that a caller owns a Product app.

No DDL inconsistency required a policy/state-machine change. The reader exposes absence explicitly and never treats missing ownership as Desktop-to-Product conversion.

## Gates

Run on Node `22.23.3` (Windows). No VPS/production database access was used.

- Node `22.23.3` focused Vitest: `node node_modules/vitest/vitest.mjs run src/main/db/productMigration.test.ts src/main/db/productDeployRepository.test.ts src/main/db/index.test.ts`: PASS, 3 files / 22 tests (includes schema-contract parity).
- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false`: PASS.
- Scoped ESLint on `index.ts`, `index.test.ts`, `productDeployRepository.ts`, `productDeployRepository.test.ts`, `productMigration.test.ts`: PASS with 0 errors and 82 Prettier warnings (primarily existing formatting in `index.test.ts` and `index.ts`; no autofix/whole-file formatting applied).
- `git diff --check`: PASS.
- Full app build, full-repo lint, and remote/production gates: NOT_RUN (not requested/explicitly out of scope).

Implementation commit SHA: pending local commit.
