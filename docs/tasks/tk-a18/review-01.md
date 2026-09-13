# TK-A18 — Leader review 01

- Submission: `cfc7a8d`, `cee7d9a`, `c35e797` trên `feat/a18-native-dark-ui`.
- Review base: task packet `30d39b0`.
- Verdict: **CHANGES_REQUESTED**. TK-A18 chuyển về `REVIEW_FIX_REQUIRED`; chưa được dùng làm
  demo SHA, chưa push/PR/merge.
- Phạm vi fix: renderer UI/test, `app/.prettierignore`, evidence/handoff/task/board và
  `tools/a18-capture.cjs` nếu giữ tool này. Không live mutation, backend, contract, preload, shared,
  schema, collector hoặc ML.

## Phần đã đạt

- Default state đã đổi sang dark; token dark là solid charcoal, giảm radius/control height.
- Title bar chỉ còn brand/caption/window controls; maximize event và IPC controls vẫn có regression.
- Appearance đã chuyển vào Settings; typecheck, lint và build reviewer đều exit 0.
- Evidence đủ 7 màn ở CSS viewport 1366×768 và Deploy/Migrate ở 1920×1080; IP/host trên ảnh đã scrub.
- GitNexus ghi nhận 34 changed symbols/22 files, 14 flow liên quan; không có caller trực tiếp bị vỡ
  trong impact walk. Blast radius tổng thể vẫn HIGH vì thay `App` và nhiều component renderer.

## Findings phải đóng

### A18-R1-01 — BLOCKER — Checkpoint “toàn bộ 7 màn” chưa được hiện thực

`AppsPage.tsx`, `DeployPage.tsx`, `MigratePage.tsx`, `HistoryPage.tsx` hoàn toàn không có diff từ
`30d39b0` tới `c35e797`. Worker chủ yếu thêm một lớp CSS chung ở cuối `main.css`; điều này không thay
được cấu trúc màn theo task.

Evidence hiện tại xác nhận:

- `after/deploy-1366x768.png`: heading + subtitle kiểu web, form nằm trên và khoảng trống rất lớn;
  action Back/Next tách xa nội dung. Chưa có compact command/workspace layout.
- `after/migrate-1366x768.png`: hai Card rộng, raw step names, khoảng trống lớn; source/target chưa
  thành một command pane có chiều chuyển rõ.
- `after/apps-1366x768.png`: title chứa `(UC-03 / UC-04)`, subtitle thuyết minh và card lồng/pane card.
- `after/history-1366x768.png`: vẫn dùng heading/subtitle web; thanh filter và table chưa được gom
  thành một desktop workspace.
- Dashboard và VPS vẫn render bốn `<Card><Statistic>` riêng tại `DashboardPage.tsx:209-244` và
  `FleetSummary.tsx:23-45`, trái yêu cầu bỏ KPI card lớn.

**Fix:** sửa source từng màn/component, không chỉ override CSS. Dùng một workspace/pane liền mạch,
toolbar sát nội dung, summary là một strip có cell + divider, action nằm gần dữ liệu điều khiển. Deploy
và Migrate phải được ưu tiên; giữ nguyên toàn bộ event/state/confirm/cancel/verify semantics và test.

### A18-R1-02 — MAJOR — CSS đang là append-only override và sidebar trigger bị vỡ thị giác

`main.css:1094-1251` định nghĩa lại `.app-titlebar`, `.content`, `.page-panel`, `.page-heading`, Card và
responsive rules đã có ở phần trước file. Cách chồng specificity này để lại hai nguồn sự thật, khiến
nhiều card cũ vẫn lọt qua.

Trong toàn bộ ảnh 1366×768, Ant Sider collapse trigger hiện thành một thanh xanh đậm rộng 220px ở đáy
trái, tách khỏi sidebar và nổi bật hơn primary action. Đây không phải chrome desktop đạt yêu cầu.

**Fix:** đưa giá trị vào selector canonical rồi xóa block override trùng. Style
`.ant-layout-sider-trigger` theo surface/border của sidebar hoặc dùng trigger AntD gọn, giữ keyboard và
collapse behavior. Không để gradient/glow/translucent panel/shadow trang trí.

### A18-R1-03 — BLOCKER — Settings đang tuyên bố ML/Auto-Rollback hoạt động dù đã deferred

`SettingsPage.tsx:22` tự đặt `autoRollback=true`; `:29-50` chỉ đổi local state/toast; `:106-140` hiển
thị trusted ML method, `ON (Active)`, warning “Auto-Rollback is active” và Save Settings dù không đọc/
ghi IPC. Ảnh `after/settings-1366x768.png` vì vậy nói với người xem một chức năng chưa làm đang active.

**Fix:** trong demo scope, Settings giữ Appearance thật. Ẩn form ML/auto rollback giả; có thể thay bằng
một hàng read-only trung tính “Giám sát ML và rollback tự động: đang phát triển, dự kiến sau 28/09”.
Không thêm IPC hay implementation ML trong TK-A18.

### A18-R1-04 — MAJOR — UI chưa tuân thủ tiếng Việt và `strings.ts`

CLAUDE.md yêu cầu UI tiếng Việt và mọi text tập trung ở `strings.ts`, nhưng evidence vẫn có `Overview`,
`Application & Version Management`, `Pick a source folder`, `Recent activity`, `History`, `Settings`,
`Save Settings`, raw status/step và nhiều chuỗi hard-code. Riêng Settings hard-code gần như toàn bộ tại
`SettingsPage.tsx:32-50,57-80,86-140`; Migrate hard-code steps/copy tại `MigratePage.tsx:7,125-172`.

**Fix:** chuyển copy người dùng nhìn thấy của 7 màn + title/window tooltip vào `strings.ts`, tiếng Việt
sentence case. Tên app, framework, path, command, checksum, action code từ dữ liệu và mã pipeline kỹ
thuật được giữ nguyên/mono khi cần đối chiếu.

### A18-R1-05 — MAJOR — Regression theme chưa kiểm đúng điều được báo cáo

`uiState.test.ts:8-14` gọi `useUiState.setState({ theme: 'dark' })` trước test “default dark”, nên test
vẫn PASS nếu production default bị đổi lại thành light. Test persisted light chỉ kiểm chuỗi vừa ghi vào
localStorage; chưa tạo lại store/rehydrate và chưa render Settings. Không có test navigation mới.

**Fix:** dùng fresh module/store với storage trống để kiểm default; tạo lại module/rehydrate với storage
đã lưu light; thêm Settings interaction test và App navigation smoke. Kiểm `data-theme` được gán trước
frame đầu bằng test phù hợp hoặc capture metadata. Không snapshot toàn trang.

### A18-R1-06 — MAJOR — Capture evidence làm thay đổi profile thật

`tools/a18-capture.cjs:7` trỏ `userData` vào profile OpsPilot thật và `:42` xóa
`opspilot-ui-session`. Như vậy chính tool evidence phá preference đã lưu, trái yêu cầu persisted light.
Tool còn nằm ngoài phạm vi ban đầu; Review 01 chỉ cho phép giữ nó nếu sửa an toàn.

**Fix:** ưu tiên bỏ tool khỏi commit và chụp thủ công không sửa storage. Nếu giữ tool, dùng userData tạm
hoặc snapshot/restore state trong `finally`, kể cả khi lỗi; không xóa preference thật. Metadata ghi cả
CSS viewport, DPR và pixel dimensions. Ảnh after mới phải phản ánh code fix và scrub host/secret.

### A18-R1-07 — MAJOR — Full gate reviewer chưa xanh và Prettier gate đang đỏ

- Reviewer `pnpm test`: **50/51 files, 288/289 tests**, Deploy happy path timeout 5s.
- Chạy riêng `DeployPage.test.tsx`: **5/5 PASS**, nên hiện được xếp là flaky/gate chưa ổn định, chưa
  kết luận functional regression.
- `pnpm typecheck`, `pnpm lint`, `pnpm build` PASS; ML `19/19` PASS.
- `pnpm exec prettier --check .` exit 1 vì đúng 50 file trong `.out-scripts/` và `.pytest_cache/`.

**Fix:** sau thay đổi chạy lại full app suite tới khi có một lượt sạch; nếu timeout lặp lại, sửa wait/
đồng bộ đúng nguyên nhân, không chỉ tăng global timeout. Review 01 cho phép sửa `app/.prettierignore`
để ignore đúng `.out-scripts/` và `.pytest_cache/`, rồi full Prettier phải exit 0.

## Waiver để đẩy nhanh demo

- Không cần tái tạo `before/`: Leader chấp nhận thiếu baseline lịch sử vì không thể chụp lại đúng thời
  điểm mà không tốn công/rủi ro. Đây không còn là blocker.
- Không chạy ML/collector/live VPS trong review-fix; chỉ renderer gates và ảnh local.
- Không thêm màn, dependency, animation, design system hay refactor backend.

## DoD Review-Fix 01

- [ ] Đóng A18-R1-01…07, ghi mapping finding → code/test/evidence trong handoff.
- [ ] Diff thực có thay đổi cho Apps/Deploy/Migrate/History và thay summary Card ở Dashboard/VPS.
- [ ] 7 ảnh 1366×768 mới; Deploy/Migrate thêm 1920×1080; sidebar trigger không còn thanh xanh.
- [ ] Settings không tuyên bố ML/auto rollback active; theme dark/light dùng thật và persist thật.
- [ ] UI copy tiếng Việt qua `strings.ts`; không còn copy demo kiểu web/UC/marketing.
- [ ] Focused theme/Settings/App/Deploy/Migrate PASS; full app test, typecheck, lint, Prettier, build exit 0.
- [ ] Không live mutation, backend/contract/preload/shared/schema/ML change, push/PR/merge.
- [ ] Board/task/handoff/evidence cập nhật cùng commit cuối; bàn giao `READY_FOR_LOCAL_REVIEW`.

## Prompt giao Worker

```text
Tiếp tục duy nhất TK-A18 Review-Fix 01 từ HEAD chứa Leader review, không checkout/reset về c35e797.
Đọc docs/tasks/tk-a18/review-01.md và task packet. Đóng A18-R1-01…07 theo đúng fix/DoD; ưu tiên
Deploy, Migrate, Settings và sidebar trước. Đây là renderer-only visual fix: giữ nguyên deploy/migrate
IPC, event, state machine, confirm/cancel/verify và không làm ML/backend/live. Baseline before đã được
Leader waive; chỉ chụp lại after bằng cách không sửa profile/storage thật. Được sửa app/.prettierignore
đúng hai generated/cache path để full Prettier xanh. Viết regression thật, chạy focused + full app test
+ typecheck + lint + Prettier + build, cập nhật evidence/handoff/task/board, commit cục bộ và dừng ở
READY_FOR_LOCAL_REVIEW. Không push/PR/merge; giữ nguyên mọi untracked của A.
```
