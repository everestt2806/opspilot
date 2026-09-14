# C01 REVIEW-FIX 02 - Evidence

Date: 2026-09-11. Scope: `C01-R2-01` only. Code commit: `8e42856`.
No deploy, marker, restart, SQLite/VPS reset, app B operation, push, PR or merge.

## Regression and gates

- `pnpm exec vitest run --maxWorkers=1 src/main/deploy src/main/detectors` / `app`: 6 files,
  55 tests, exit 0.
- Added regressions in `app/src/main/deploy/pipeline.test.ts`: POST-only `/items` falls back
  to `/health`; GET `/items/:id` falls back to `/health`. Existing GET `/items` demo and
  generic health fallback remain covered.
- `pnpm typecheck` / `app`: node and web exit 0.
- Scoped ESLint / `app`: exit 0.
- Prettier check for changed files / `app`: exit 0.
- `pnpm exec electron-vite build` / `app`: 3045 renderer modules, exit 0.

## Read-only live check

After tests, read-only SSH checks against VM02 `a17-notes-0911` at UTC `02:28:48` and
`02:29:02` reported collector `running|0|0`; app v9 was healthy, DB was running, and JSONL
seq increased `372->373`. No deploy or marker request was made.

## Finding closure

`C01-R2-01` is CLOSED: `resolveCollectorAppPath` recognizes only static GET collection route
`/items` with optional trailing slash. POST-only and GET item-detail routes cannot cause a false
business probe. C02 and later stages remain `NOT_RUN` and unopened.
