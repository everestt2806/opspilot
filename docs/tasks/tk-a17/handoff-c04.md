# TK-A17/C04 handoff

> Historical Worker handoff at submitted `24d1f93`. Leader review 01 changed C04 to
> `REVIEW_FIX_REQUIRED`; VM01 was subsequently unblocked with TCP and actual credential resolver SSH PASS.
> Continue from [`review-c04.md`](review-c04.md), not from the blocker instruction below.

## Identity and scope

- Stage/outcome: C04 / `BLOCKED`
- Branch: `feat/a17-demo-checkpoint`
- Base SHA: `4635a9bfa280a95078c365d3bebed0f1825e750b`
- Code HEAD: `259bc58`
- Docs HEAD: `6ccd592`
- Previous stage: C03 approved; C05-C09 remain `NOT_RUN`.
- Scope: migration service/repository, IPC wiring, and real migration UI only. No app B mutation.

## Changes

- Added persistent migration job repository and service state machine.
- Added desktop-mediated archive transfer with target checksum verification and PostgreSQL dump packaging.
- Added real file/runtime/HTTP/PostgreSQL verification and fail-closed confirmation.
- Replaced migration mock UI with app/VPS selectors and event/verification rendering.
- Added repository and service guard regressions.

## Gates

See [`docs/evidence/tk-a17/c04/README.md`](../../evidence/tk-a17/c04/README.md). Local focused suite is `49/49`; typecheck, scripts typecheck, scoped ESLint, Prettier and build all exit `0`.

## C04 checklist

| Case                                  | Result                                           | Evidence                               |
| ------------------------------------- | ------------------------------------------------ | -------------------------------------- |
| C04-T1 stateless live success         | NOT_RUN                                          | VM01 blocker                           |
| C04-T2 PostgreSQL live success        | NOT_RUN                                          | VM01 blocker                           |
| C04-T3 precheck/validation guards     | PASS local                                       | `app/src/main/migrate/service.test.ts` |
| C04-T4 transfer interruption/checksum | NOT_RUN live                                     | no two-VPS run                         |
| C04-T5 restore/build failure cleanup  | NOT_RUN live                                     | no two-VPS run                         |
| C04-T6 verify mismatch/confirm gate   | PASS local implementation path; live NOT_RUN     | `app/src/main/migrate/service.ts`      |
| C04-T7 cancel/race/idempotency        | PASS local guard/repository subset; live NOT_RUN | migration tests                        |
| C04-T8 real UI IPC/events             | PASS static/typecheck; live NOT_RUN              | `MigratePage.tsx`                      |
| C04-T9 two real VPS migrations        | BLOCKED                                          | VM01 TCP timeout                       |

## Live status and blocker

- VM01 `221.121.1.79:22`: TCP timeout (`Test-NetConnection` false).
- VM02 `221.121.1.80:22`: TCP reachable; no C04 mutation performed.
- App B: no mutation; no live success claim.
- SQLite/PostgreSQL: no C04 mutation.
- Unblock: restore VM01 SSH reachability, rerun read-only precheck, then execute the two controlled migrations and collect raw scrubbed evidence.

## NOT_RUN

C05-C09, ML training/scoring, monitoring/fault/recovery, Flask, and all live C04 migration outcomes remain `NOT_RUN`.

## REVIEW-FIX

| Finding                    | Fix commit | Regression                                 | Evidence                             |
| -------------------------- | ---------- | ------------------------------------------ | ------------------------------------ |
| C04 initial implementation | pending    | 49 local focused tests; live cases blocked | `docs/evidence/tk-a17/c04/README.md` |

CHƯA PUSH — CHƯA PR — CHƯA MERGE.
