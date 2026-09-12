# Handoff C05 - TK-A17

## Outcome

- Status: `READY_FOR_LOCAL_REVIEW`; scope only C05. C06-C09 remain closed/`NOT_RUN`.
- Branch `feat/a17-demo-checkpoint`; code SHA used for both rehearsals: `936e643`.
- Runbook: `docs/26-kich-ban-demo-deploy-migrate-14-09.md`.

## Full gates

- Node `v24.16.0` / pnpm `11.1.0`; Node 22 unavailable and not claimed.
- `pnpm test -- --maxWorkers=1` from `app`: exit 0, 50 files / 287 tests.
- `pnpm exec tsc -p tsconfig.scripts.json --noEmit`: exit 0.
- `ml-service/.venv/Scripts/python.exe -m pytest`: exit 0, 19 passed.
- `collector/..\ml-service\.venv\Scripts\python.exe -m pytest`: exit 0, 26 passed.
- `pnpm lint`: exit 0, existing formatting warnings only; no errors.
- Prettier check for changed docs: exit 0. `pnpm build`: exit 0.

## Two consecutive rehearsals

Both used fresh Electron launches, actual credential resolver, no manual DB edits, and clean shutdown.

| Run | Deploy proof                                                                    | Migration proof                                   | Result |
| --- | ------------------------------------------------------------------------------- | ------------------------------------------------- | ------ |
| 01  | Express app 27 (50/51), Next 28 (52), Vite 29 (53), all seven steps and healthy | Vite job 25, PostgreSQL job 26, `keepSource=true` | PASS   |
| 02  | Express app 32 (56/57), Next 33 (58), Vite 34 (59), all seven steps and healthy | Vite job 27, PostgreSQL job 28, `keepSource=true` | PASS   |

Both runs proved runtime image/health, HTTP, collectors, checksums/file counts, PostgreSQL marker/rows and source-kept recovery. Raw scrubbed logs/JSON are in `docs/evidence/tk-a17/c05/rehearsal-01/` and `rehearsal-02/`. Failed setup attempts were retained; no app B mutation or C02 data reset occurred.

## Checklist

| Requirement                                             | Result     | Evidence                                        |
| ------------------------------------------------------- | ---------- | ----------------------------------------------- |
| Full gates                                              | PASS       | commands above                                  |
| Runbook                                                 | PASS       | `docs/26-kich-ban-demo-deploy-migrate-14-09.md` |
| Three Tier 1 deploys                                    | PASS twice | rehearsal deploy JSON/logs                      |
| Vite and PostgreSQL migration                           | PASS twice | jobs 25/26 and 27/28                            |
| Marker/checksum/rows/runtime/HTTP/collector/source-kept | PASS twice | rehearsal logs                                  |
| Two consecutive runs on final code SHA                  | PASS       | rehearsal-01 and rehearsal-02                   |

No push, PR or merge was performed.
