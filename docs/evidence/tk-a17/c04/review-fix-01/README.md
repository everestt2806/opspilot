# TK-A17/C04 review-fix 01 evidence

## Identity

- Branch: `feat/a17-demo-checkpoint`; review-fix base `e78b4ea`.
- Source VM02 profile 2 (`221.121.1.80`); target VM01 profile 1 (`221.121.1.79`).
- C05-C09 remain `NOT_RUN`; app B was not mutated.

## Fixes and local gates

- Stateless backup includes `data` only when present and verifies payload files without generated/runtime files.
- PostgreSQL snapshots the source probe before freeze, uses `pg_dump -Fc`, restores after target DB readiness and before app restart, then verifies rows and marker.
- Transfer uses two SSH channels with backpressure, progress, staged output and checksum verification.
- Empty pre-created targets are first deployments; migration errors retain code/message/cause in action history; VERIFY reads the persisted source probe.
- Focused Vitest: `49/49` (6 files). `pnpm typecheck`, scripts typecheck, scoped ESLint, scoped Prettier and `pnpm build` all exit `0` in `app`.

## Live ledger

Failed jobs `1-17` remain in SQLite/action history. Jobs `7`, `12-16` exposed PostgreSQL restore defects; job `17` exposed stale probe state. These attempts were not deleted.

- **Vite app 18 / job 18**: ran first, PREPARE -> FREEZE -> BACKUP -> TRANSFER -> RESTORE -> VERIFY -> awaiting-confirm -> completed, `keepSource=true`; artifact `22,704` bytes, SHA-256 `59aa113814d429f41976af66de4c950659f7df8bc80a6a9703e57e3f12cedf4c`, files `20/85,968`, runtime/HTTP/collector matched.
- **Express/PostgreSQL app 16 / job 19**: ran second with the same pipeline and `keepSource=true`; artifact `30,926` bytes, SHA-256 `c0e5131bef77f49e672840b2834b23c2f26a24fd47eacdc612ba563b21508b2e`, files `18/96,609`, `items` rows `1001 -> 1001`, source/target marker matched, runtime/HTTP/collector matched.

Both source apps were restarted after migration and source-kept. Target deployments were recorded in SQLite; no C05/ML/monitor/fault/recovery work was done.

## C04 mapping

| Requirement | Evidence |
| --- | --- |
| C04-T1 | Vite job 18 |
| C04-T2 | Express/PostgreSQL job 19 |
| C04-T3 | focused precheck/pipeline/service suite and PREPARE events |
| C04-T4 | relay progress and matching SHA in jobs 18/19 |
| C04-T5 | retained failed-job ledger and cleanup events |
| C04-T6 | failed jobs retained; confirm only after matched VERIFY |
| C04-T7 | repository/service suite and persisted action ledger |
| C04-T8 | migration IPC/UI typecheck and build |
| C04-T9 | VM02 -> VM01 jobs 18 then 19 |

Related requirements: R03, R04, R06, R10, R18, R20, R21, R23. C05-C09 remain `NOT_RUN`.
