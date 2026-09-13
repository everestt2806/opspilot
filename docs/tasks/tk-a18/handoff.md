# TK-A18 — Handoff

- Status: `REVIEW_FIX_REQUIRED`
- Branch: `feat/a18-native-dark-ui`
- Parent before task packet: `66ab90b`
- Stable demo rollback point: `936e643`
- Task packet: [`../tk-a18-native-dark-ui.md`](../tk-a18-native-dark-ui.md)
- Evidence: `docs/evidence/tk-a18/`

## Local handoff

- Code checkpoints: `cfc7a8d` (`ui: establish native dark shell`), `cee7d9a` (`ui: restyle desktop workflows`), final local HEAD (`test: verify native dark renderer`).
- Visible changes: dark-first persisted theme, compact frameless title bar with only app/caption/window controls, pane/sidebar navigation, restrained surface tokens, compact summary strips, flat Settings appearance section, and shared desktop density across renderer screens.
- Regression coverage: default dark and persisted light theme, title-bar IPC controls, existing Deploy/Migrate action/state tests, and full existing renderer suite.
- Tests: `pnpm test` = app `289/289`, ML `19/19`, exit 0; `pnpm typecheck` exit 0; `pnpm lint` exit 0; `pnpm build` exit 0. Focused renderer tests `8/8`, exit 0.
- Prettier: touched renderer files pass; full `pnpm exec prettier --check .` is blocked by 50 pre-existing generated `.out-scripts`/cache files outside the task change.
- Visual evidence: `docs/evidence/tk-a18/after/`; scrubbed host/IP values. `before/` baseline is not available and is a known DoD gap.
- No live mutation, backend/contract/preload/shared change, push, PR, or merge was performed. Worker stops at `READY_FOR_LOCAL_REVIEW`.

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
