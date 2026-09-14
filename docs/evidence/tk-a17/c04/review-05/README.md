# TK-A17/C04 reviewer evidence — review 05

## Identity and independent gates

- Review date: 2026-09-13 (Asia/Bangkok).
- Review base `1ff2743`; production `517233e`; submitted docs `499e5a2`; ancestry PASS.
- Focused: 9 files / 65 tests PASS.
- Scripts typecheck and `pnpm build`: PASS; build transformed 3045 renderer modules.
- Local runtime was Node 24.16.0 while package engines request Node >=22 <23.

## Read-only live verification

SQLite:

| Job | Source                         | Target app/deployment  | Status    | Source kept | Payload/DB                                    |
| --- | ------------------------------ | ---------------------- | --------- | ----------- | --------------------------------------------- |
| 23  | Vite app 18 / deployment 41    | app 25 / deployment 48 | completed | 1           | 22,704 bytes, SHA match                       |
| 24  | Express app 16 / deployment 39 | app 26 / deployment 49 | completed | 1           | 30,925 bytes, rows 1001 -> 1001, marker match |

SSH through the actual userData credential resolver:

- VM02 source Vite and Express: app `running|healthy|HTTP 200`; collectors running.
- VM01 target Vite and Express: app `running|healthy|HTTP 200`; collectors running.
- No live mutation was performed by the reviewer.

## Verdict boundary

C04 is approved for the two happy paths required in the 14/9 demo. Persisted crash ownership, PostgreSQL
DB-first ordering, per-path manifest/source-clock downtime and full contract/UI/relay hardening are retained as
C04-D1…D4 for post-demo work. They must not be described as complete technical guarantees.
