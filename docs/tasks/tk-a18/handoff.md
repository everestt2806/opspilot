# TK-A18 — Handoff

- Status: `READY_FOR_LOCAL_REVIEW`
- Branch: `feat/a18-native-dark-ui`
- Parent before task packet: `66ab90b`
- Stable demo rollback point: `936e643`
- Task packet: [`../tk-a18-native-dark-ui.md`](../tk-a18-native-dark-ui.md)
- Evidence: `docs/evidence/tk-a18/`

## Owner polish 04 — bản gọn cho demo

- Code checkpoint: `ef3b530`, xuất phát từ `7f7ec04`.
- Giảm giao diện về nhịp desktop kiểu VS Code: nền tối đặc có phân vùng, card phẳng, radius nhỏ,
  tiêu đề 20 px và primary action xanh trầm.
- Navigation chính, navigation trong panel và danh mục Settings không còn selected fill/pill; trạng
  thái hiện hành dùng vạch accent 2 px và màu chữ.
- Bỏ khung card bao toàn trang, giới hạn nội dung 1100 px, cho header/action tự wrap, giới hạn Select,
  Table và Steps trong pane để tránh chồng hoặc tràn ngang ở 1366×768.
- Fresh capture: `docs/evidence/tk-a18/review-02/after/`, bảy route 1366×768 và Deploy/Migrate
  1920×1080; `capture.json` exit 0, DPR 1.5, resize/maximize-restore PASS, Snap Layout manual-only.
- Gates: app `291/291`; focused Deploy `5/5`; typecheck, lint, scoped Prettier và production build
  (3045 modules) PASS. Không live mutation, backend/contract change, push, PR hoặc merge.

## Local handoff

- Code checkpoints: `a233a2e` (WCO safe-area/ignore), `e9cb70c` (canonical Fluent states + route markers), `197c703` (initial Vietnamese copy/tests), `e3df697` (complete Vietnamese copy/tests), `9eff0cc` (evidence/docs); final bookkeeping checkpoint follows.
- Visible changes: dark-first persisted theme, compact frameless title bar with only app/caption/window controls, pane/sidebar navigation, restrained surface tokens, compact summary strips, flat Settings appearance section, and shared desktop density across renderer screens.
- Regression coverage: default dark and persisted light theme, title-bar IPC controls, existing Deploy/Migrate action/state tests, and full existing renderer suite.
- Tests: `pnpm test` = app `291/291` across 53 files, ML `19/19`, exit 0; `pnpm typecheck`/`pnpm lint`/`pnpm build` exit 0. Focused Review-Fix tests `6/6`, exit 0.
- Prettier: generated `.out-scripts/` and `.pytest_cache/` are ignored as planned; full check still reports only pre-existing boundary files `src/main/detectors/types.ts` and `src/shared/ipc.ts`, which remain untouched by scope.
- Visual evidence: `docs/evidence/tk-a18/review-02/`; before/after baseline copied as instructed and host/IP values scrubbed.
- No live mutation, backend/contract/preload/shared change, push, PR, or merge was performed. Worker stops at `READY_FOR_LOCAL_REVIEW`.

## Review-Fix 03 DoD mapping

- `A18-R2-01`: WCO rectangle uses `titlebar-area-x/width/height`; native titlebar has no HTML window buttons; focused native tests pass.
- `A18-R2-02/03`: canonical Fluent fallback/surface/radius/type rules consolidated in `main.css` and tokens; duplicate density tail removed.
- `A18-R2-04`: selected VPS row, rail, keyboard semantics, contextual action pill, status badge, sidebar, input/button/toggle states have production usage.
- `A18-R2-05`: shell, navigation, Dashboard, VPS and Settings visible copy is routed through Vietnamese strings.
- `A18-R2-06`: capture asserts selected route and page marker, waits a compositor frame, records DPR/dimensions, and scrubs host/IP.
- `A18-R2-07`: restored Prettier boundary ignores, kept generated/cache ignores, and did not increase global timeout.
- Residual: Windows Snap Layout requires manual observation; no live VPS/ML/deploy/migrate run was performed.

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
