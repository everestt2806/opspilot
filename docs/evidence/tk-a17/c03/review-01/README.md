# C03 review 01 evidence

- Review time: `2026-09-12T15:44:11Z` (`UTC+07:00` local).
- Reviewed: base `c2d55ad`, code `c149291`, submitted docs `dcbe3b5`.
- Review mode: local tests plus read-only VM02/public checks; no deploy, stop, delete, DB mutation,
  push, PR or merge.

Files:

- `contract-regression.test.ts.txt`: reviewer regression source, stored outside production tests.
- `contract-regression.txt` and `.exit.txt`: 1 file / 5 tests failed, exit 1.
- `vm02-inventory.txt`: filtered read-only Docker inventory; all C03 apps remain healthy/running and
  app B remains running.
- `vm02-content.txt`: loopback Express/Next/Vite content plus PostgreSQL marker proof.
- `public-path.txt`: three direct presentation URLs timed out with HTTP `000`.

Independent Worker gates were also rerun: focused 55/55, collector 26/26, node/web/scripts typecheck,
scoped ESLint and build all passed. The new regression isolates behavior omitted by that suite.
