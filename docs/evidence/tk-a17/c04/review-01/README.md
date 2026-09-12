# TK-A17/C04 reviewer evidence — review 01

## Identity and safety

- Review date: 2026-09-13 (Asia/Bangkok).
- Base: `4635a9bfa280a95078c365d3bebed0f1825e750b`.
- Submitted code: `259bc583f145f8dc2ca47cd313ab187f69a6e28d`.
- Submitted docs HEAD: `24d1f93`.
- Review was local/read-only. No live migration, deploy, data mutation, tunnel, push, PR or merge was run.
- Protected untracked paths were preserved: `.devflow/`, `docs/ban-giao-20-08.md`, `logo.png`.

## Independent commands

| Check                                           | Result                  |
| ----------------------------------------------- | ----------------------- |
| `git merge-base --is-ancestor 4635a9b 259bc58`  | exit 0                  |
| `git merge-base --is-ancestor 259bc58 24d1f93`  | exit 0                  |
| Worker focused Vitest command from C04 evidence | 6 files / 49 tests PASS |
| TCP connect `221.121.1.79:22`, 5 s              | `False`                 |
| TCP connect `221.121.1.80:22`, 5 s              | `True`                  |

Focused command:

```text
pnpm exec vitest run --maxWorkers=1 src/main/migrate/repository.test.ts src/main/migrate/service.test.ts src/main/deploy/precheck.test.ts src/main/deploy/pipeline.test.ts src/main/deploy/service.test.ts src/main/ipc.test.ts
```

Runtime reported by the command: Node `24.16.0`, pnpm `11.1.0`, Vitest `4.1.10`. The package engine warning
expects Node `>=22 <23`; it did not fail this review command.

## Source/contract findings

The committed tests pass but do not execute the migration state machine. Direct inspection established:

1. Stateless tar always names `data`, while the canonical stateless compose only creates `metrics`.
2. PostgreSQL restore happens after full app deploy/health, and marker source is queried while the source app is
   stopped.
3. Transfer materializes the entire base64 archive in `stdout`, then materializes it again in `writeFile`.
4. Target app creation precedes PREPARE and its `try/catch`; precheck uses a fixed disk threshold rather than
   artifact size.
5. Confirm writes the target deployment ID into the source app without moving its VPS/port/URL identity.
6. Awaiting-confirm abort does not restart source; active abort can race cleanup and terminal events.
7. There is no persisted job reload/reconcile API and no migrate progress/log event emission.
8. Four service tests and one repository test do not substantiate C04-T1/T2/T4/T5/T6/T7/T8.

Full expected behavior and regression gates are recorded in
[`review-c04.md`](../../../../tasks/tk-a17/review-c04.md). VM01 remains an independent external blocker, but it
does not account for these local implementation defects.
