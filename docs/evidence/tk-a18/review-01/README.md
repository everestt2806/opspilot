# TK-A18 — Reviewer evidence 01

- Range reviewed: `30d39b0..c35e797`.
- GitNexus after re-index: 34 changed symbols, 22 changed files, 14 affected processes, aggregate
  risk HIGH; direct upstream impact for `App`/`VpsAppsTab` returned no breaking callers.
- Scope check: `AppsPage.tsx`, `DeployPage.tsx`, `MigratePage.tsx`, `HistoryPage.tsx` unchanged.
- Visual inspection: all nine submitted images inspected at original pixels. CSS viewport 1366×768
  captures are 2051×1154 pixels and 1920×1080 captures are 2880×1620 because of display scale/DPR.
- `pnpm test`: exit 1, 50/51 files and 288/289 tests; Deploy happy path timeout at 5 seconds.
- Focused `DeployPage.test.tsx`: exit 0, 5/5.
- `pnpm typecheck`: exit 0. `pnpm lint`: exit 0. `pnpm build`: exit 0, 3045 renderer modules.
- ML `.venv` pytest: exit 0, 19/19.
- `pnpm exec prettier --check .`: exit 1; 49 generated `.out-scripts` files plus
  `.pytest_cache/README.md` are the complete 50-file set.
- No live VPS command or mutation was performed during review.
