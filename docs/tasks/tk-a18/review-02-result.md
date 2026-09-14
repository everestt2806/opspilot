# TK-A18 — Leader review kết quả Review-Fix 02

- Submission: `3710d55`, `0654bb0`, `36dec2d`, `d99d7c5`.
- Review base: `9579c85`.
- Verdict: **CHANGES_REQUESTED**.
- Trạng thái tiếp theo: `REVIEW_FIX_REQUIRED`; chưa được dùng làm demo SHA, chưa push/PR/merge.
- Nguồn kỹ thuật/DoD vẫn là [review-02-fluent-plan.md](review-02-fluent-plan.md); file này ghi kết
  quả kiểm độc lập và prompt sửa tiếp.

## Phần đã đạt

- `BrowserWindow` đã bỏ `frame: false` trên Windows, bật `titleBarOverlay`,
  `backgroundMaterial: 'mica'` và fallback color; HTML caption buttons đã được bỏ.
- Settings đã bỏ fake `autoRollback=true`, trusted model, warning active và Save giả; theme control
  dùng store thật.
- Dashboard và FleetSummary đã bỏ bốn `Card/Statistic` rời, chuyển thành summary strip.
- Capture đã dùng temporary `userData` và xóa profile tạm ở `will-quit`; không còn xóa preference thật.
- Reviewer: focused 6 files/14 tests PASS; typecheck, lint và build PASS, build 3045 renderer modules.
- GitNexus: 23 changed symbols/23 code files, aggregate graph risk LOW; `AppTitleBar` có direct dependents
  là `App` và test, kéo theo bảy renderer flows. CSS global vẫn được xem là visual blast radius toàn app.

## Findings phải đóng

### A18-R2-01 — BLOCKER — Dùng sai safe-area của Window Controls Overlay làm titlebar chồng chữ

`main.css:26` dùng `padding-right: env(titlebar-area-width)` và `:67-68` tiếp tục dùng cùng biến làm
width/min-width của spacer phải. `titlebar-area-width` là chiều rộng vùng titlebar **khả dụng**, không phải
chiều rộng caption buttons. Kết quả trong toàn bộ ảnh after là logo/brand/caption chồng lên nhau ở góc trái,
ví dụ dòng đầu trông như `OpsPilotOpsPilot-Dashboard`.

**Fix:** dùng rectangle WCO đúng nghĩa: đặt vùng brand/caption trong
`left: env(titlebar-area-x)`, `width: env(titlebar-area-width)`,
`height: env(titlebar-area-height)` hoặc grid tương đương; không dùng area width làm right padding/spacer.
Xóa selector titlebar/button/status cũ không còn được render. Smoke thật normal/maximize/restore/snap/resize
và ghi kết quả; không cần tự vẽ lại caption buttons.

Tài liệu chuẩn: <https://www.electronjs.org/docs/latest/tutorial/custom-title-bar>.

### A18-R2-02 — BLOCKER — MICA_FALLBACK vẫn là nền flat và không có phân cấp vật liệu yêu cầu

Evidence ghi `MICA_FALLBACK`, nên fallback CSS là đường chạy thật. Nhưng `main.css:1110-1114` ép
`.app-shell`, `.ant-layout-sider` và `.ant-menu` cùng `--bg-base`; sidebar không dùng
`--sidebar-fallback`. Content cũng dùng cùng màu. Không có gradient/noise rất nhẹ. Ảnh after cho thấy toàn
cửa sổ là một mảng `#202020` phẳng.

Panel vật lý cũng chưa đúng: `.page-panel` bị reset border/radius/background về 0/transparent; global
`.ant-card` vẫn `border-radius: 5px; box-shadow: none`.

**Fix:** khi Mica fallback, dùng window/content `#202020`, sidebar `#191919`, một gradient alpha ≤0.02
ở lớp window/content, divider 1px; card/panel thật radius 8px, border mờ và shadow
`0 1px 2px rgba(0,0,0,.3)`. Không biến toàn page thành một Card lớn. Nếu Mica chưa hiển thị qua
webContents thì giữ verdict fallback, không thêm transparent-window hack sát demo.

### A18-R2-03 — BLOCKER — Type ramp, radius và max-width chưa được áp dụng

Block “Native desktop density” cũ vẫn nằm cuối `main.css` và thắng selector canonical:

- `main.css:1155`: mọi page heading bị ép `17px !important`, không phải page title 28px.
- Không có section heading 20px/token line-height/weight đầy đủ.
- `themeTokens.ts` vẫn dùng `fontSize: 13`, `borderRadius: 5`; control radius chưa 4px.
- `main.css:1164-1165`: Card radius 5px, không shadow.
- Không có content wrapper `max-width: 1100px`; ba màn vẫn kéo hết chiều rộng.
- CSS vẫn có nhiều định nghĩa lặp cho titlebar/content/page heading/Card thay vì một nguồn canonical.

**Fix:** hợp nhất CSS, xóa block override cũ/trùng; đưa type ramp 28/20/14/12 và radius control/panel 4/8
vào token thật. Thêm inner workspace max-width 1100px căn giữa, nhưng giữ table/pane dùng hết workspace.

### A18-R2-04 — BLOCKER — Các interaction state được báo cáo nhưng chưa hiện thực

Các selector mới chỉ bao phủ một phần và nhiều yêu cầu không có production usage:

- Sidebar selected vẫn tô toàn item bằng `--bg-elevated` và inset rail 2px toàn chiều cao; icon của cả
  bảy item vẫn là `Outlined`.
- `.status-badge` và `.action-pill` chỉ tồn tại trong CSS, không component nào dùng.
- Action delete/edit trong VPS table luôn hiện; không có `:focus-within`/selected reveal.
- Không có selected-row accent rail hoặc sort arrow hover/focus rule.
- Primary pressed chỉ đổi màu, thiếu inset pressed state.
- Input focus vừa đổi toàn border sang accent vừa thêm underline, trái yêu cầu chỉ nhấn cạnh dưới.
- Không có transition 140ms cho Ant toggle.

**Fix:** sửa component/CSS thật, không thêm selector chết. Action ẩn bằng opacity/visibility nhưng phải hiện
khi hover, focus-within và selected; keyboard vẫn focus được. Dùng filled/outline icon pair, rail active
3px cao khoảng 50%, đủ table states, pressed inset, underline-only focus và toggle/reduced-motion.

### A18-R2-05 — BLOCKER — UI vẫn trộn Việt/Anh trên shell và ba màn mẫu

`strings.ts` chỉ dịch title Dashboard và phần Settings. Navigation vẫn `Apps/Deploy/Dashboard/Migrate/
History/Settings`; Dashboard còn `Refresh, VPS online, Apps running, Recent activity, Time, Action,
Succeeded`; VPS còn `Servers, Fleet overview, Total VPS, Online, Server list...`. Evidence thể hiện trực
tiếp tình trạng này.

**Fix:** tiếng Việt là ngôn ngữ chính cho toàn shell và ba màn Dashboard/VPS/Settings; đồng thời dịch visible
copy của Deploy/Migrate vì đây là hai màn demo ngày 14/09. Raw step code/framework/path/checksum giữ mono
trong tooltip/detail nếu cần. Mọi copy đi qua `strings.ts`; không ghép hai ngôn ngữ trong một label.

### A18-R2-06 — BLOCKER — Evidence after sai route và không cùng data state với before

Các file không phản ánh tên ghi trong `capture.json`:

- `after/deploy-1366x768.png` vẫn là Apps.
- `after/dashboard-1366x768.png` là Deploy.
- `after/migrate-1366x768.png` là Dashboard empty state.
- `after/history-1366x768.png` là Migrate.
- `after/settings-1366x768.png` là History; không có ảnh Settings after.
- VPS before có hai row và Dashboard before có dữ liệu, nhưng after dùng DB trống; không thể đối chiếu
  interaction/table/stat cùng trạng thái.

Capture chỉ chờ delay cố định và ghi filename, không kiểm selected menu/page marker, nên
`errors: []` không phát hiện ảnh trễ một route.

**Fix:** sau click phải chờ selected key và một marker duy nhất của page đích, rồi chờ compositor frame trước
`capturePage`. Assert page marker trước khi ghi file; mismatch phải làm tool exit 1. Dùng fixture scrubbed
deterministic trong profile tạm để ba cặp Dashboard/VPS/Settings có cùng data state; chụp đúng ba before/after
cốt lõi và ghi screenshot/native-smoke riêng nếu cần chứng minh Snap Layout.

### A18-R2-07 — MAJOR — Gate bàn giao chưa sạch và regression còn thiếu

Reviewer `pnpm test`: **52/53 files, 290/291 tests**, Deploy happy path timeout 5s tại
`DeployPage.test.tsx:174`. Focused sáu file/14 tests PASS, nên đây tiếp tục là flake full-suite chưa được
đóng; Review 02 yêu cầu một lượt full sạch.

Full Prettier FAIL đúng hai file Worker báo. Đây không phải residual có sẵn không liên quan: commit F1 đã
**xóa** ba ignore hiện hữu (`src/shared/ipc.ts`, `src/main/detectors/types.ts`,
`src/main/db/migrations/*.sql`) rồi thêm generated/cache ignore, làm gate chuyển đỏ. Test cũng chưa kiểm
navigation/table state hoặc `data-theme` trước render như DoD.

**Fix:** khôi phục các ignore hiện hữu và giữ thêm `.out-scripts/`, `.pytest_cache/`; full Prettier phải
exit 0. Sửa đồng bộ/wait của Deploy test nếu full suite còn timeout, không tăng global timeout. Bổ sung
behavior test cho navigation active icon/state, selected row + contextual action keyboard và pre-render
theme; không snapshot toàn trang.

## DoD Review-Fix 03

- [ ] Đóng A18-R2-01…07, mapping finding → code/test/evidence trong handoff.
- [ ] Titlebar không chồng chữ ở 1366×768/DPR 1.5; native Snap smoke có kết quả thật.
- [ ] MICA_FALLBACK có sidebar/content phân tầng và surface vật lý; không còn nền flat.
- [ ] Type ramp 28/20/14/12, radius 4/8, shadow/border và workspace 1100px được áp dụng thật.
- [ ] Sidebar/table/button/input/toggle/badge/action-pill đủ state và có production usage.
- [ ] Shell + Dashboard/VPS/Settings + visible Deploy/Migrate copy thống nhất tiếng Việt.
- [ ] Evidence đúng tên route, cùng deterministic data state, không dùng profile thật và mismatch exit 1.
- [ ] Focused + full app test, typecheck, lint, full Prettier và build đều exit 0.
- [ ] Không live mutation, không contract/preload/shared/backend/ML change, không push/PR/merge.
- [ ] Cập nhật board/task/handoff/evidence, commit local và dừng `READY_FOR_LOCAL_REVIEW`.

## Prompt giao Worker

```text
Tiếp tục duy nhất TK-A18 Review-Fix 03 từ HEAD chứa Leader review này; code submission là d99d7c5,
không reset/checkout về mốc cũ. Đọc
docs/tasks/tk-a18/review-02-result.md và đóng A18-R2-01…07 theo DoD. Ưu tiên: (1) sửa WCO safe-area
để titlebar hết chồng chữ và smoke native Snap; (2) sửa capture chờ/assert đúng route với fixture cùng data;
(3) hợp nhất CSS/token canonical và áp đủ Fluent states; (4) thống nhất tiếng Việt; (5) làm sạch full gates.

Không chỉ thêm CSS selector: mỗi state phải có production component usage và evidence nhìn thấy được.
Khôi phục các Prettier ignore đã tồn tại rồi giữ generated/cache ignore. Không tăng global test timeout.
Không live VPS/deploy/migrate/ML, không đổi contract/preload/shared/backend, không dependency mới, không
push/PR/merge; giữ nguyên untracked của A. Commit local theo checkpoint hợp lý, cập nhật
evidence/handoff/task/board và dừng READY_FOR_LOCAL_REVIEW.
```
