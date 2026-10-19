# TK-S7 P1f-3 — Shared ingress/HTTPS UI

> State: CHỜ REVIEW. Renderer and renderer tests only; no backend, database, IPC contract, pipeline, or real VPS changes.

## START 2026-10-19

- Baseline HEAD: `b51853f` (`P1f-2` reviewed at `497e8b0`). Existing untracked files are preserved.
- Add a full-width app-detail tab using ingress list/status/action IPC. Make recorded status, loading/error/empty/disabled, HTTP fallback, explicit HTTPS setup/check, progress, stale-result cancellation, and en/vi/cn/jp strings testable.
- Run Node 22 UI and IPC/service focused tests, typecheck, build, scoped lint, and `git diff --check`.
- Capture real Electron fixture screenshots at 1280x800 and 1366x768 in dark/light; record overflow check and exact evidence paths. Do not claim VPS or live HTTPS evidence.

## UPDATE 2026-10-20

- Added a fourth full-width app-detail tab. It reads the app/VPS scoped list on entry and uses status reads on explicit refresh/action completion; no write action runs on mount or tab change.
- Presents stored DNS/route/certificate/probe state and reason code with safe localized guidance, loading/error/retry/empty/disabled states, and the existing HTTP URL as fallback. HTTPS opening requires DTO `active` plus propagated DNS, active route, valid certificate, and passed probe.
- HTTPS setup requires confirmation and runs install → reconcile → HTTPS check once. It continues through the expected `installed` and `reconciled_pending` intermediate results only; blocked/degraded/pending/uncertain outcomes stop the chain. Uncertain results direct the user to inspect current VPS state. An explicit retry runs only HTTPS check. Requests are guarded by a per-instance generation and the tab/app/VPS key remounts the child to discard late results.
- Added renderer interaction tests for loading/error/retry/empty/disabled, HTTP fallback and active-only HTTPS, confirmation/cancel, setup order, blocked outcomes at all three steps, uncertain stop, duplicate-submit prevention, stale action on app switch, four locales, and no automatic action. AppsPage test checks list IPC and verifies no action dispatch on tab selection.
- IPC contract had sufficient DTO data; no contract gap and no backend/DB/IPC contract changes.
- Node `v22.23.3`: focused UI + IPC/service/repository `vitest` — **5 files, 96 passed**; typecheck PASS; build PASS; scoped ESLint **0 errors / 1 warning**. The remaining warning is an unchanged Prettier warning at `AppsPage.tsx:1177`, outside the new tab. `git diff --check` PASS.
- Electron layout captures at 1280x800 and 1366x768, dark/light: **NOT_RUN**. Attempted an isolated `%TEMP%` APPDATA dev launch, but CUA reported no app/window inventory (`apps: []`, `browsers: []`) and the runtime did not expose `listWindows`; no fixture was seeded and no screenshots/overflow claim are recorded. No live VPS/HTTPS actions were performed.
- Implementation and documentation commit SHA: recorded in the board row after commit. Screenshot paths: none (NOT_RUN).