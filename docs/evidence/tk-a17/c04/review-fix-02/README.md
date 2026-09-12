# TK-A17/C04 review-fix 03 evidence

Review-fix 03 base: `a51f72e`. Fresh live jobs are 21/22 on new target apps 23/24; the prior review-fix 02 ledger remains historical.

## Identity

- Base `611cb64`; branch `feat/a17-demo-checkpoint`; scope C04-R2-01..06 only.
- Source VM02 profile 2: Vite app 18 and Express/PostgreSQL app 16.
- Fresh target VM01 profile 1: target apps 23 and 24. App B was not mutated. C05-C09 remain `NOT_RUN`.

## Local gates

Exact focused command in `app`:

`pnpm exec vitest run --maxWorkers=1 src/main/migrate/repository.test.ts src/main/migrate/service.test.ts src/main/deploy/precheck.test.ts src/main/deploy/pipeline.test.ts src/main/deploy/service.test.ts src/main/ipc.test.ts`

PASS: 6 files / 50 tests. `pnpm typecheck`, scripts typecheck, scoped ESLint, scoped Prettier and `pnpm build` all exited 0.

Review-fix changes serialize confirmation/abort, keep the source deployment pointer unchanged, recover and health-check a source for `keepSource=true`, avoid relay stdout accumulation, close both relay channels on error, and make the live harness await confirmation and stale-job cleanup.

## Fresh live runs

Both runs used the real Electron userData credential resolver, shared migration pipeline and `keepSource=true`.

1. **Vite app 18 / job 21 / target app 23**: PREPARE -> FREEZE -> BACKUP -> TRANSFER -> RESTORE -> VERIFY -> awaiting-confirm -> completed. Artifact `22,704` bytes; SHA-256 `59aa113814d429f41976af66de4c950659f7df8bc80a6a9703e57e3f12cedf4c`; files `20/85,968`; runtime/HTTP/collector matched.
2. **Express app 16 / job 22 / target app 24**: same sequence. Artifact `30,925` bytes; SHA-256 `a7cb922266f2723117fdbd148efcdd4932011008a3c0e105441a063d3e534082`; files `18/96,609`; `items` rows `1001 -> 1001`; source/target marker matched; runtime/HTTP/collector matched.

Read-only SQLite after both runs: source app 18 current deployment `41` (`c03r2-34290093-vite:v1`, running); source app 16 current deployment `39` (`c03r2-34290093-express:v2`, running). Jobs 21/22 are `completed`, `source_kept=1`; target pointers remain target-owned. Stale job 20 was cleaned to `rolled_back` before job 21. Failed attempts remain in SQLite/action history.

## Mapping

| Finding | Evidence |
| --- | --- |
| C04-R2-01 | service confirmation regression; source pointers remain `41/39`, target jobs are 21/22 |
| C04-R2-02 | serialized stale-job cleanup; job 20 rollback event and source HTTP recovery |
| C04-R2-03 | relay binary drain path, 900s timeout, dual-channel cleanup, fresh SHA/progress |
| C04-R2-04 | fresh target-side staged restore; DB restore completes before final verify |
| C04-R2-05 | confirmation recovery and IPC/UI typecheck/build gates |
| C04-R2-06 | exact local commands, fresh raw event ledger, persisted JSON and failure history |

C04-T1/T2/T9 are fresh live PASS for jobs 21/22. C04-T3/T4/T5/T6/T7/T8 have local regression/path evidence above. C05-C09, ML, monitor/fault/recovery and Flask remain `NOT_RUN`.
