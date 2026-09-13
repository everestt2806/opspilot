# TK-A18 — Reviewer evidence cho submission Review-Fix 02

- Range: `9579c85..d99d7c5`.
- Visual: đã xem original pixels toàn bộ before/after; PNG after là `2051×1154` cho CSS viewport
  1366×768/DPR 1.5 và `2880×1620` cho 1920×1080.
- Evidence mismatch: deploy=Apps, dashboard=Deploy, migrate=Dashboard, history=Migrate, settings=History;
  không có Settings after đúng route. Before/after cũng không cùng data state.
- Titlebar: mọi ảnh after có brand/caption chồng nhau; source dùng sai `titlebar-area-width` làm right
  padding và spacer.
- Source conformance: heading 17px, Card radius 5/shadow none, sidebar/content cùng nền, không max-width
  1100; status/action classes không có production usage; navigation chỉ dùng outline icon.
- GitNexus indexed `d99d7c5`: 23 changed symbols/23 code files, graph risk LOW, 0 top-level affected
  processes; AppTitleBar impact có hai direct dependents và App liên quan bảy renderer flows.
- Reviewer full `pnpm test`: exit 1, 52/53 files, 290/291 tests; Deploy happy path timeout 5s.
- Focused 6 files: exit 0, 6/6 files, 14/14 tests.
- `pnpm typecheck`, `pnpm lint`, `pnpm build`: exit 0; build 3045 renderer modules.
- Full `pnpm exec prettier --check .`: exit 1, hai file
  `src/main/detectors/types.ts`, `src/shared/ipc.ts`. F1 đã xóa ignore hiện hữu của chúng.
- Không chạy live VPS/deploy/migrate/ML/collector và không thay dữ liệu thật trong review.
