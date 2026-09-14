# TK-A17/C04 reviewer evidence — review 02

## Identity and independent gates

- Review date: 2026-09-13 (Asia/Bangkok).
- Review base `e78b4ea`; submitted code `67063ff`; submitted docs `06da273`; ancestry PASS.
- Worker focused command rerun independently: 6 files / 49 tests PASS.
- `pnpm typecheck`: node/web PASS.
- `git diff e78b4ea..67063ff -- **/*.test.ts **/*.test.tsx`: no changed test files.
- No new migration was started by the reviewer.

## Actual SQLite finding and recovery

Immediately after Worker jobs 18/19, actual OpsPilot SQLite contained:

| App               | VPS | Current deployment | Deployment owner | Result                    |
| ----------------- | --- | ------------------ | ---------------- | ------------------------- |
| source Express 16 | 2   | 45                 | target app 22    | invalid cross-app pointer |
| source Vite 18    | 2   | 44                 | target app 21    | invalid cross-app pointer |
| target Vite 21    | 1   | 44                 | target app 21    | valid                     |
| target Express 22 | 1   | 45                 | target app 22    | valid                     |

Reviewer recovery used one local SQLite transaction after checking deployments 39/41 are `running` and owned
by apps 16/18. Final pointers are:

| App               | Current deployment | Deployment owner |
| ----------------- | ------------------ | ---------------- |
| source Express 16 | 39                 | 16               |
| source Vite 18    | 41                 | 18               |
| target Vite 21    | 44                 | 21               |
| target Express 22 | 45                 | 22               |

SSH inspect showed both source app containers were `exited`, despite the Worker evidence saying they had been
restarted. Reviewer ran `docker compose start app` only in the exact source directories, then checked twice:

| Source app | Before | Final runtime                        | Health  | HTTP |
| ---------- | ------ | ------------------------------------ | ------- | ---- |
| Vite 18    | exited | `c03r2-34290093-vite:v1`, running    | healthy | 200  |
| Express 16 | exited | `c03r2-34290093-express:v2`, running | healthy | 200  |

The recovery did not change target containers, PostgreSQL, app B or migration history. Protected untracked files
remain unchanged.

## Review conclusion

Jobs 18/19 substantiate small happy-path archive/restore/verify behavior, including matching archive SHA,
Express `items` count 1001 and saved business probe. They do not close the review because:

- the two live postconditions for `keepSource=true` failed and required recovery;
- relay still accumulates binary stdout and lacks symmetric abort cleanup;
- restore still uploads desktop source/collector, overwrites migrated env and opens app before DB restore;
- PREPARE, abort/restart, UI/reload and required regression work from review 01 remain unchanged;
- the evidence directory contains only a summary README, with no raw scrubbed event/command output.

Required fixes and rerun gates are in [`review-c04.md`](../../../../tasks/tk-a17/review-c04.md), Review 02.
