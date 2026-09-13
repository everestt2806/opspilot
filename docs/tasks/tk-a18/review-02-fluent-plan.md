# TK-A18 — Kế hoạch sửa Review 02: Windows 11 Fluent

- Ngày chốt: `13/09/2026`.
- Branch: `feat/a18-native-dark-ui`; HEAD chứa Review 01: `93504a1`.
- Mốc rollback demo chức năng: `936e643`.
- Trạng thái: **REVIEW_FIX_REQUIRED**.
- Phạm vi demo hình ảnh: **Dashboard, danh sách VPS, Cài đặt**.
- Không push, mở PR, merge hoặc gây mutation trên VM01/VM02.

Tài liệu này thay thế hướng dẫn thực thi và DoD của `review-01.md` khi có mâu thuẫn. Các lỗi chức năng
và an toàn còn mở trong Review 01 vẫn phải đóng. Yêu cầu mới của A cho phép chạm phần khởi tạo
`BrowserWindow` chỉ để bật title bar native và Mica; đây là ngoại lệ có chủ đích so với phạm vi
renderer-only trước đó.

## 1. Kết luận kiến trúc

### 1.1 Title bar và Snap Layout

Không tự vẽ ba nút minimize/maximize/close bằng Ant icon hoặc SVG. Trên Windows, dùng
`titleBarStyle: 'hidden'` cùng `titleBarOverlay` để Electron đặt **Window Controls Overlay native**.
React `AppTitleBar` chỉ còn logo, tên OpsPilot, caption màn hiện tại và vùng kéo.

- Vùng kéo dùng `-webkit-app-region: drag`; phần tử tương tác dùng `no-drag`.
- Dùng `env(titlebar-area-x)`, `env(titlebar-area-width)` và `env(titlebar-area-height)` để nội dung
  không nằm dưới caption buttons.
- Không đặt `frame: false` cho nhánh Windows nếu nó làm mất overlay/Snap Layout. Worker phải spike trên
  Electron cài thực tế (`39.8.10`) trước khi sửa toàn shell.
- Snap Layout phải hiện khi rê/giữ nút maximize native. Không dựng Snap popover giả trong DOM.
- Close hover ưu tiên hành vi Windows native, có màu chuẩn gần `#C42B1C`. Không phủ nút CSS lên caption
  button hệ điều hành chỉ để ép màu.
- Giữ nguyên IPC cửa sổ hiện có để không đổi contract; không xóa/refactor contract trong task này.

### 1.2 Mica và fallback

Trên Windows 11 22H2+, dùng `backgroundMaterial: 'mica'` cho cửa sổ chính. Không dùng Acrylic làm nền
toàn cửa sổ/sidebar; Acrylic chỉ phù hợp surface tạm thời như menu/flyout.

1. Bật Mica trong `BrowserWindow`; giữ `backgroundColor: '#202020'` cho frame đầu/fallback.
2. Cho root/content đủ trong để quan sát vật liệu, nhưng không giữ transparent-window hack nếu gây chữ mờ,
   nền đen, mất resize hoặc góc bo.
3. Smoke normal → maximize → restore → snap → restore trên máy demo.
4. Evidence phải ghi `MICA_PASS` hoặc `MICA_FALLBACK`. Không báo Mica thật chỉ vì option đã set.

Fallback dùng sidebar tối hơn content một bậc, một linear gradient rất nhẹ với alpha tối đa `0.02` và
divider `rgba(255,255,255,0.06)`. Không blob, glow, backdrop blur hoặc texture nổi rõ.

## 2. Phạm vi

Được sửa:

- `app/src/main/index.ts` và test main liên quan trực tiếp tới BrowserWindow options.
- Shell/theme/string/store/CSS/test trong `app/src/renderer/src/**`.
- Component dùng chung cho navigation, table, badge, button, input, toggle.
- Dashboard, VPS, Settings, FleetSummary và component VPS mà ba màn dùng.
- `app/.prettierignore` chỉ để ignore đúng `.out-scripts/` và `.pytest_cache/`.
- Hồ sơ TK-A18 và evidence local đã scrub.

Không sửa preload/shared/contracts/schema, deploy/migrate/SSH/collector/ML, dữ liệu người dùng hoặc logic
nghiệp vụ. Không thêm dependency, CSS framework, icon package hoặc font mạng. Deploy, Migrate, Apps,
History chỉ nhận token/state dùng chung; không tái cấu trúc riêng trong lượt mẫu này.

## 3. Design token đích

Hợp nhất token vào `tokens.css` và ánh xạ tương ứng sang AntD trong `themeTokens.ts`. Không rải mã
màu/radius/font mới trong page.

### 3.1 Typography

| Token                    | Giá trị                                                  | Dùng cho                        |
| ------------------------ | -------------------------------------------------------- | ------------------------------- |
| `--font-ui`              | `'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif` | Toàn UI                         |
| `--font-mono`            | `'Cascadia Mono', Consolas, monospace`                   | Host, port, path, checksum, log |
| page size/line/weight    | `28px / 36px / 600`                                      | Tiêu đề trang                   |
| section size/line/weight | `20px / 28px / 600`                                      | Heading section                 |
| body size/line/weight    | `14px / 20px / 400`                                      | Text và control                 |
| caption size/line/weight | `12px / 16px / 400`                                      | Mô tả/caption                   |

Body dùng `--text-primary`. Mô tả dưới heading dùng `--text-secondary`, 12px, margin-top 4px, không
cùng weight/màu với heading. Không dùng ALL CAPS cho label thường.

### 3.2 Dark color và vật liệu fallback

| Token                 | Giá trị đích              |
| --------------------- | ------------------------- |
| `--window-fallback`   | `#202020`                 |
| `--sidebar-fallback`  | `#191919`                 |
| `--content-fallback`  | `#202020`                 |
| `--surface-card`      | `rgba(255,255,255,0.045)` |
| `--surface-elevated`  | `rgba(255,255,255,0.065)` |
| `--fill-hover`        | `rgba(255,255,255,0.055)` |
| `--fill-pressed`      | `rgba(255,255,255,0.035)` |
| `--fill-selected`     | `rgba(96,205,255,0.10)`   |
| `--stroke-divider`    | `rgba(255,255,255,0.06)`  |
| `--stroke-control`    | `rgba(255,255,255,0.12)`  |
| `--text-primary`      | `rgba(255,255,255,0.90)`  |
| `--text-secondary`    | `rgba(255,255,255,0.62)`  |
| `--text-disabled`     | `rgba(255,255,255,0.36)`  |
| `--accent`            | `#60CDFF`                 |
| `--accent-hover`      | `#6ED3FF`                 |
| `--accent-pressed`    | `#55BDE8`                 |
| `--accent-foreground` | `#003545`                 |
| `--danger-close`      | `#C42B1C`                 |

Light theme đã persist vẫn phải hoạt động bằng cặp token light tương ứng. Dark là mặc định khi storage
trống và phải áp trước frame đầu.

### 3.3 Spacing, radius, border, shadow

- Spacing: `4, 8, 12, 16, 24, 32px`; page gutter và section gap 24px.
- Control nhỏ: radius 4px. Card/panel/dialog: radius 8px. Pill: 999px chỉ khi semantics là pill.
- Panel: border 1px `--stroke-divider` và shadow `0 1px 2px rgba(0,0,0,.30)`.
- Không shadow nhiều tầng hoặc shadow accent.
- Content dùng `width: min(100%, 1100px)`, căn giữa; pane/table dùng hết chiều rộng này.

## 4. Interaction states

### Sidebar/navigation

- Item cao 36px, radius 4px. Hover chỉ dùng fill trắng 4–6%, không tăng weight/đổi chữ accent.
- Active dùng nền nhẹ và rail accent 3px × khoảng 18px, căn giữa ở mép trái.
- Icon inactive outline, active filled. Dùng cặp AntD sẵn có; nếu thiếu, tạo mapping tập trung bằng font
  hệ thống `Segoe Fluent Icons`, có fallback và `aria-hidden`. Không tự vẽ SVG/thêm dependency.
- Collapse trigger hòa vào sidebar; không còn thanh xanh rộng ở đáy.

### Table/list

- Bỏ zebra; dùng divider 1px giữa row.
- Row click được có hover fill 4–6% và cursor pointer.
- Row selected dùng accent nhạt + rail 2–3px ở cell đầu, có `aria-selected`.
- Action icon mặc định ẩn về thị giác; hiện khi hover, `focus-within` hoặc selected. Vẫn truy cập được
  bằng keyboard và có tooltip/aria-label.
- Sort indicator chỉ hiện khi hover/focus header, hoặc luôn hiện ở cột đang sort thật.

### Button/input/toggle

- Primary có default/hover/pressed/disabled/focus-visible. Pressed dùng accent tối hơn và inset shadow nhẹ.
- Input/select focus bằng underline accent 2px; không làm sáng toàn border. Error luôn có text/icon.
- Toggle transition nền/thumb `140ms cubic-bezier(0.33, 0, 0.67, 1)`; tắt khi reduced motion.

### Badge và pill hành động

- Tách semantic `status-badge` và `action-pill`.
- Status badge: không border/hover/shadow/cursor, luôn có nhãn tiếng Việt.
- Action pill: border rõ, hover/pressed/focus-visible/cursor pointer. Không dùng raw code như
  `migrate_start` làm label.

## 5. Ba màn mẫu

### Dashboard

- Header `Tổng quan` 28px; mô tả ngắn 12px.
- Thay bốn `<Card><Statistic>` bằng một summary strip, bốn cell compact, divider dọc, số tabular.
- Chỉ được thêm progress ring cho tỷ lệ VPS online/total vì đây là dữ liệu thật. Không tạo sparkline giả.
- `Hoạt động gần đây` là một table panel liền mạch với đủ row/header/action states.

### Danh sách VPS

- Master–detail tối đa 1100px: list trái 38–42%, detail phải; chỉ xếp dọc dưới breakpoint hiện có.
- Fleet summary thành strip compact, không bốn Card rời.
- Row VPS có hover/selected/rail; sửa/xóa/kết nối hiện khi hover/focus/selected. Giữ delete confirm.
- Detail dùng section/divider thay card lồng; giữ nguyên dữ liệu và action thật.

### Cài đặt

- Hai cột: category list hẹp bên trái, form section bên phải.
- Theme control là chức năng thật; default dark và persisted light đúng.
- Bỏ `autoRollback=true`, Save giả, warning active và trusted ML list. Thay row read-only:
  `Giám sát ML và rollback tự động — Đang phát triển, dự kiến sau 28/09`.
- Form row dùng divider, label 14px và description 12px, không Card lồng.

## 6. Ngôn ngữ

Tiếng Việt là ngôn ngữ chính; mọi chuỗi người dùng thấy đi qua `strings.ts`.

- Ví dụ: `Overview` → `Tổng quan`, `Servers` → `Máy chủ`, `Settings` → `Cài đặt`,
  `Completed` → `Hoàn tất`, `Online` → `Trực tuyến`.
- Tên riêng, framework, path, checksum, command và raw pipeline code giữ nguyên khi cần đối chiếu.
- Raw English/value phụ nằm trong tooltip/detail mono; không trộn hai ngôn ngữ trong một label.

## 7. Checkpoint cho một goal Worker dài

### F0 — Native window spike

- Sửa BrowserWindow, chuyển native overlay, thử Mica/fallback.
- Smoke drag, double-click vùng kéo, minimize, maximize, restore, Snap Layout, resize edge, close.
- Chỉ tiếp tục nếu không duplicate caption buttons, không che caption và vẫn resize được.
- Commit: `ui: use native Windows window chrome`.

### F1 — Token và component primitives

- Thay font/token/surface trong themeTokens/tokens.
- Dọn selector canonical, xóa block override trùng cuối `main.css`.
- Hoàn thiện sidebar/table/button/input/toggle/badge/action pill states.
- Kiểm focus-visible và reduced motion.
- Commit: `ui: establish Fluent dark tokens and states`.

### F2 — Ba màn mẫu

- Sửa source thật Dashboard, VPS, Settings.
- Chuẩn hóa visible strings của shell và ba màn.
- Smoke bốn route còn lại để chắc global style không làm vỡ giao diện/chức năng.
- Commit: `ui: redesign dashboard vps and settings`.

### F3 — Regression và evidence

- Sửa test theme vacuous; thêm test BrowserWindow options, titlebar không có nút HTML trùng, Settings
  không báo ML active và navigation/table semantics.
- Capture bằng profile tạm hoặc snapshot/restore trong `finally`; không xóa storage thật.
- Cập nhật evidence/handoff/task/board cùng commit cuối.
- Commit: `test: verify Fluent desktop review`.

## 8. Evidence before/after

Không dựng lại baseline trước TK-A18. Dùng ảnh hiện có trong `docs/evidence/tk-a18/after/` làm baseline
**trước Review 02**, sao chép nguyên vẹn ba ảnh vào `docs/evidence/tk-a18/review-02/before/`:

- `dashboard-1366x768.png`
- `vps-1366x768.png`
- `settings-1366x768.png`

Chụp after cùng CSS viewport 1366×768, DPR, data state và sidebar state. Metadata ghi CSS viewport, DPR,
pixel dimensions, Electron/Windows version và Mica verdict. Nếu công cụ chụp được overlay hệ điều hành,
thêm ảnh titlebar/Snap. Scrub host/IP/secret; không dùng profile OpsPilot thật.

Mỗi cặp ảnh phải đối chiếu: titlebar/vật liệu; type ramp; radius/shadow/border; interaction states; badge
so với action pill; layout 1100px/hai cột; tiếng Việt.

## 9. Test và gate

Regression bắt buộc:

- BrowserWindow Windows có hidden title bar, native overlay, Mica và fallback color.
- AppTitleBar chỉ còn brand/caption/drag region, không duplicate ba caption buttons.
- Storage trống tạo dark thật; persisted light rehydrate thật; data-theme có trước render; Settings đổi
  theme thật.
- Navigation active và table selected/action keyboard semantics có test hành vi; không snapshot toàn trang.
- Settings không còn `autoRollback=true`, `ON (Active)` hoặc Save giả.
- Existing Deploy/Migrate focused tests vẫn PASS.

Gate:

```powershell
cd app
pnpm test
pnpm typecheck
pnpm lint
pnpm exec prettier --check .
pnpm build
```

Không chạy ML, collector hoặc live VPS. Full app test cần một lượt sạch; nếu Deploy timeout lặp lại, sửa
nguyên nhân đồng bộ thay vì chỉ tăng global timeout.

## 10. Definition of Done

- [ ] F0–F3 hoàn tất bằng các commit local tách biệt, không có diff ngoài scope.
- [ ] Native caption buttons và Snap Layout thật hoạt động; không còn glyph HTML dày.
- [ ] Mica được kiểm thật; nếu không ổn định, fallback đạt và có lý do/trình tự tái hiện.
- [ ] CSS/AntD dùng đúng font, type scale, màu, spacing, radius và shadow ở mục 3.
- [ ] Sidebar, table, controls và hai loại badge có đủ mouse/keyboard/reduced-motion states.
- [ ] Dashboard, VPS, Settings có source/layout mới và ba cặp ảnh before/after cùng điều kiện.
- [ ] Không còn KPI Card rời; VPS là master–detail; Settings không còn ML/auto-rollback giả.
- [ ] Content chính tối đa 1100px; không còn card nhỏ lẻ giữa khoảng trống lớn ở ba màn.
- [ ] Shell và ba màn mẫu dùng tiếng Việt qua strings.ts; raw kỹ thuật chỉ ở tooltip/detail.
- [ ] Full app test, typecheck, lint, Prettier và build exit 0.
- [ ] Không mutation VM, không backend/contract/preload/shared/ML change, không push/PR/merge.
- [ ] Handoff ghi SHA, test count, ảnh, Mica verdict và gap thật; dừng `READY_FOR_LOCAL_REVIEW`.

## 11. Prompt giao Worker

```text
Tiếp tục một goal dài duy nhất TK-A18 Review-Fix 02 từ HEAD hiện tại; không checkout/reset về c35e797
hoặc mốc A17. Đọc CLAUDE.md, docs/tasks/tk-a18/review-02-fluent-plan.md, review-01.md, task packet và
handoff. Review 02 là nguồn thực thi ưu tiên khi mâu thuẫn.

Làm tuần tự F0→F3 và commit local từng checkpoint. Trước hết spike BrowserWindow trên Electron hiện có:
dùng native titleBarOverlay để có caption glyph/Snap Layout Windows thật, AppTitleBar chỉ giữ brand/caption/
drag region; thử backgroundMaterial mica trên Windows 11 và giữ CSS fallback an toàn. Sau đó hợp nhất Fluent
dark tokens và interaction states, dọn CSS override trùng, rồi sửa source thật đúng ba màn Dashboard, VPS,
Settings. Tiếng Việt là UI chính; Settings phải bỏ ML/auto-rollback giả. Deploy/Migrate/Apps/History chỉ
nhận shared token/state trong lượt này và phải giữ nguyên chức năng.

Dùng ba ảnh current dashboard/vps/settings làm before Review 02; chụp after cùng viewport/DPR/data/sidebar,
profile capture cô lập, scrub host/secret và ghi MICA_PASS hoặc MICA_FALLBACK bằng smoke thật. Viết regression
hành vi, chạy full app test, typecheck, lint, full Prettier và build. Không chạy ML/collector/live VPS, không
đổi contract/preload/shared/backend, không thêm dependency, không push/PR/merge và giữ nguyên mọi untracked
của A. Cập nhật evidence/handoff/task/board trong commit cuối rồi dừng READY_FOR_LOCAL_REVIEW.
```
