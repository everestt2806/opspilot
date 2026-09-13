# TK-A18 — Handoff

- Status: `REVIEW_FIX_REQUIRED`
- Branch: `feat/a18-native-dark-ui`
- Parent before task packet: `66ab90b`
- Stable demo rollback point: `936e643`
- Task packet: [`../tk-a18-native-dark-ui.md`](../tk-a18-native-dark-ui.md)
- Evidence: `docs/evidence/tk-a18/`

## Local handoff

- Code checkpoints: `3710d55` (F0), `0654bb0` (F1), `36dec2d` (F2), final local HEAD (F3).
- Visible changes: dark-first persisted theme, compact frameless title bar with only app/caption/window controls, pane/sidebar navigation, restrained surface tokens, compact summary strips, flat Settings appearance section, and shared desktop density across renderer screens.
- Regression coverage: default dark and persisted light theme, title-bar IPC controls, existing Deploy/Migrate action/state tests, and full existing renderer suite.
- Tests: `pnpm test` = app `291/291` across 53 files, ML `19/19`, exit 0; `pnpm typecheck`/`pnpm lint`/`pnpm build` exit 0. Focused Review-Fix tests `6/6`, exit 0.
- Prettier: generated `.out-scripts/` and `.pytest_cache/` are ignored as planned; full check still reports only pre-existing boundary files `src/main/detectors/types.ts` and `src/shared/ipc.ts`, which remain untouched by scope.
- Visual evidence: `docs/evidence/tk-a18/review-02/`; before/after baseline copied as instructed and host/IP values scrubbed.
- No live mutation, backend/contract/preload/shared change, push, PR, or merge was performed. Worker stops at `READY_FOR_LOCAL_REVIEW`.

## Review-Fix 02 handoff

- F0 `3710d55`: native Windows `titleBarOverlay`/Snap Layout path, Mica option, safe fallback, and no duplicate HTML caption buttons.
- F1 `0654bb0`: Fluent token primitives, Segoe/Cascadia typography, sidebar/table/control states, focus-visible/reduced-motion rules, and generated/cache Prettier ignore.
- F2 `36dec2d`: Dashboard summary strip, VPS semantic FleetSummary cells/loading skeleton, Settings two-column Appearance UI and deferred ML/rollback row.
- F3 final local HEAD: fresh-store theme tests, Settings behavior test, native window/AppTitleBar tests, temporary-profile scrubbed capture and documentation.
- R1-01…07 mapping is closed in code/tests/evidence; Deploy/Migrate IPC and state semantics were not changed.
- Evidence: `docs/evidence/tk-a18/review-02/`; verdict `MICA_FALLBACK`; no live VPS, ML, collector, deploy, migrate or reset run.
- Remaining risk: Apps/Deploy/Migrate/History source structure is unchanged beyond shared primitives; Prettier boundary files remain unchanged by scope.

Worker cập nhật file này khi bàn giao local: code/docs SHA, thay đổi theo từng màn, test count,
visual evidence, phần DoD chưa đạt và xác nhận không live mutation/push/PR/merge.

## Leader review 01

- Verdict: `CHANGES_REQUESTED` tại submission `c35e797`.
- Findings: A18-R1-01…07 trong [`review-01.md`](review-01.md).
- Baseline `before/` được waive; không tái tạo. Fix renderer/evidence local, không live mutation.

## Leader replan — Review 02

- Kế hoạch hiện hành: [`review-02-fluent-plan.md`](review-02-fluent-plan.md).
- Phạm vi mẫu: Dashboard, VPS, Settings; các route còn lại chỉ nhận token/state dùng chung và smoke.
- Ngoại lệ theo yêu cầu mới của A: được sửa `app/src/main/index.ts` và test tương ứng để dùng native
  Window Controls Overlay/Mica. Không đổi IPC contract hoặc backend.
- Evidence kỹ thuật: `docs/evidence/tk-a18/review-02/research.md`.
- Trạng thái vẫn `REVIEW_FIX_REQUIRED`; production code chưa đổi sau Review 01.

## Leader review submission Review-Fix 02

- Verdict tại `d99d7c5`: `CHANGES_REQUESTED`.
- Findings hiện hành: A18-R2-01…07 trong [`review-02-result.md`](review-02-result.md).
- Blocker chính: WCO safe-area làm caption chồng brand; Mica fallback vẫn flat; type/state chưa áp dụng;
  UI còn trộn ngôn ngữ; evidence trễ/sai route và không cùng data; full test/Prettier đỏ.
- Reviewer evidence: `docs/evidence/tk-a18/review-02/leader-review.md`.
- Không chạy live mutation; chưa push/PR/merge.
