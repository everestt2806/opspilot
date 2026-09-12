# TK-A17/C04 review-fix 03

## Identity and gates

- Scope: C04 only; C05-C09, ML, monitor/fault/recovery and app B mutation remain NOT_RUN.
- Branch `feat/a17-demo-checkpoint`; review-fix base `1ff2743`; code/docs HEAD `517233e` before this bookkeeping commit.
- Exact `git diff --name-status a51f72e..HEAD` and `git diff --stat a51f72e..HEAD` were run before handoff; the diff includes production pipeline/migration/repository/IPC, SSH relay, renderer UI/test and evidence/handoff bookkeeping.
- Local command from `app`: `pnpm exec vitest run --maxWorkers=1 src/main/migrate/repository.test.ts src/main/migrate/service.test.ts src/main/deploy/precheck.test.ts src/main/deploy/pipeline.test.ts src/main/deploy/service.test.ts src/main/ipc.test.ts src/main/ssh/ssh.test.ts src/main/db/index.test.ts src/renderer/src/pages/MigratePage.test.tsx` — exit 0, 9 files / 65 tests.
- `pnpm typecheck`, `pnpm exec tsc -p tsconfig.scripts.json --noEmit`, scoped ESLint, scoped Prettier check and `pnpm build` — all exit 0.

## Production changes

- Migration restore now passes the VPS-resident relayed payload through the shared DeployPipeline; it does not re-upload desktop source and preserves the transferred `.env`.
- Migration jobs are persisted/listed through repository and IPC; MigratePage reloads persisted state, filters active-job events and waits for authoritative terminal events.
- SSH relay uses a bounded backpressure stream with exact byte counting, abort handling and close-order-safe channel results.

## Live ledger

The initial `node scripts/run-as-node.js .out-scripts/scripts/a17-c04-live.js` attempt exited 1 before SSH/VPS mutation because Electron `app` is unavailable in Electron-as-Node mode. The failed attempt is retained; full Electron runtime retry passed.

Source VM02 profile 2 -> target VM01 profile 1, `keepSource=true`, in required order:

| Order | App/job                            | Result and proof                                                                                                                                                                                                                                                                                                             |
| ----- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Vite app 18 / job 23               | Completed PREPARE -> FREEZE -> BACKUP -> TRANSFER -> RESTORE -> VERIFY -> awaiting-confirm -> completed; artifact 22704 bytes, SHA `59aa113814d429f41976af66de4c950659f7df8bc80a6a9703e57e3f12cedf4c`; files `20/85968`; target Docker/runtime/HTTP/health/collector PASS; source restarted and HTTP 200; downtime 87781 ms. |
| 2     | Express/PostgreSQL app 16 / job 24 | Completed same pipeline; artifact 30925 bytes, SHA `407eba652d4204c3eee1e4aa9cdce21c80d36ce56d034cb8fa422d33b1dccbb24`; files `18/96609`; pg_isready/restore/table/marker, target Docker/runtime/HTTP/health/collector PASS; source restarted and HTTP 200; downtime 57054 ms.                                               |

Failed historical attempts remain in SQLite/action history. No data reset/delete/reassign occurred. App B was not mutated or used as a success signal.

## Review mapping

| Finding   | Production file                                           | Regression and evidence                                        |
| --------- | --------------------------------------------------------- | -------------------------------------------------------------- |
| C04-R3-01 | `app/src/main/migrate/service.ts`, `repository.ts`, IPC   | migration/repository tests; 65-test command above; this ledger |
| C04-R3-02 | `app/src/main/deploy/pipeline.ts` remote payload/env path | pipeline regression and live jobs 23/24; this ledger           |
| C04-R3-03 | `app/src/main/ssh/manager.ts` `relayStreams`              | `src/main/ssh/ssh.test.ts`; 65-test command; this ledger       |
| C04-R3-04 | `app/src/renderer/src/pages/MigratePage.tsx`              | `MigratePage.test.tsx`; 65-test command; this ledger           |
| C04-R3-05 | production/test/docs change set                           | local gates and raw helper event/command output; this ledger   |
