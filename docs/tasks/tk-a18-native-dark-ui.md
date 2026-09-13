# TK-A18 — Làm mới UI desktop native, dark mặc định

> **Nguồn thực thi hiện hành:** [`tk-a18/review-02-fluent-plan.md`](tk-a18/review-02-fluent-plan.md).
> Review 02 thay thế hướng dẫn/DoD cũ khi mâu thuẫn, cho phép chạm `BrowserWindow` để dùng Window
> Controls Overlay/Mica và khóa ba màn mẫu Dashboard, VPS, Settings theo đánh giá Fluent ngày 13/09.

| Chủ      | Hạn        | Branch                    | Brief                                                        | Ưu tiên |
| -------- | ---------- | ------------------------- | ------------------------------------------------------------ | ------- |
| A/Worker | 14/09/2026 | `feat/a18-native-dark-ui` | [`../prompts/tk-a18-worker.md`](../prompts/tk-a18-worker.md) | P0 demo |

## Mục tiêu

Làm mới toàn bộ renderer để OpsPilot trông như một ứng dụng quản trị desktop Windows: gọn, đặc,
phân cấp rõ bằng pane, toolbar, đường phân cách và bảng dữ liệu. Dark là theme mặc định ngay từ lần
mở đầu tiên. Giao diện phải bỏ cảm giác landing page/web dashboard và các dấu hiệu "AI slop" như
gradient trang trí, glow, card lồng card, bo góc quá nhiều, tiêu đề/phần mô tả phô trương hoặc badge
màu không mang thông tin.

Task chỉ thay đổi cách trình bày. Luồng deploy đa source và migrate hai VPS đã `DEMO_READY` phải giữ
nguyên hành vi, IPC, dữ liệu, thứ tự bước, điều kiện confirm và thông báo lỗi.

## Mốc an toàn và cách làm

- Tạo branch `feat/a18-native-dark-ui` từ HEAD chứa task packet này; commit cha trước khi mở TK-A18
  là `66ab90b` trên `feat/a17-demo-checkpoint`. Mốc code rehearsal đã duyệt là `936e643`.
- Trước khi sửa, lưu ảnh baseline của 7 màn vào `docs/evidence/tk-a18/before/` ở cửa sổ
  1366×768. Không đưa secret, host/IP đầy đủ hoặc credential vào ảnh.
- Làm một goal liên tục, nhưng tạo ba checkpoint local để dễ review/quay lại:
  1. `ui: establish native dark shell` — token, dark mặc định, title bar, navigation, page shell.
  2. `ui: restyle desktop workflows` — toàn bộ 7 màn và component dùng chung.
  3. `test: verify native dark renderer` — regression, evidence, handoff, board.
- Nếu checkpoint 2 chưa đạt trước giờ demo, dừng ở checkpoint 1 chỉ khi tất cả gate vẫn xanh; nếu
  không thì dùng lại `936e643`. Không sửa/rebase/reset nhánh A17 để "dọn" lịch sử.

## Được sửa

- `app/src/renderer/src/**`: component, page, `strings.ts`, Zustand UI state, theme token, CSS và
  test renderer.
- `docs/tasks/tk-a18-native-dark-ui.md`, `docs/tasks/tk-a18/**`, `docs/tasks/board.md`.
- `docs/evidence/tk-a18/**`: ảnh trước/sau và báo cáo visual smoke đã scrub.
- Có thể cập nhật mục giao diện trong `docs/02-ui-ux-spec.md` nếu code cuối cùng cần ghi lại quyết
  định đã được task này chốt; không mở rộng chức năng.

## Không được sửa

- `docs/contracts/**`, `app/src/main/**`, `app/src/preload/**`, `app/src/shared/**`, schema/migration,
  deploy/migrate service, SSH relay, collector, ML service, templates và demo apps.
- Không thêm dependency, CSS framework, icon library, animation framework, font tải từ mạng hoặc
  state manager mới. Dùng Ant Design v5, icon AntD và CSS/token hiện có.
- Không thay tên/kênh/payload IPC; không đổi logic tiến trình, retry, cancel, rollback, verify,
  `keepSource`, source pointer hay credential.
- Không deploy, migrate, reset demo, train/score ML hoặc gây mutation trên VM01/VM02. Chỉ được xem
  read-only nếu cần xác nhận dữ liệu hiển thị.
- Không push, mở PR hoặc merge. Giữ nguyên `.devflow/`, `docs/ban-giao-20-08.md`, `logo.png` và mọi
  file untracked của A.

## Ngôn ngữ thiết kế bắt buộc

### 1. Dark mặc định và theme

- Người dùng mới hoặc localStorage chưa có `opspilot-ui-session` phải thấy dark ngay từ frame đầu,
  không flash nền sáng. Đổi giá trị mặc định trong store và giữ bước gán `data-theme` trước render.
- Nếu người dùng đã chủ động lưu `light`, app vẫn tôn trọng lựa chọn đó sau reload. Không xóa hoặc
  ghi đè preference cũ. Light vẫn là tùy chọn phụ trong Cài đặt; không cần đặt switch lớn trên title bar.
- Mọi màu giao diện nằm trong `themeTokens.ts`/`tokens.css`. Dark dùng nền than trung tính, ba cấp
  surface rõ bằng độ sáng và border; accent chỉ dành cho selected/focus/primary action. Không rải mã
  hex trong page, trừ terminal cố định và màu nút đóng cửa sổ.
- Không dùng gradient, glass/translucent panel, `backdrop-filter`, glow trang trí hoặc shadow cho
  panel thường. Shadow chỉ dành cho popup/modal/dropdown và terminal khi thật sự cần tách lớp.

### 2. App shell kiểu desktop

- Giữ custom frameless title bar cao 32–36px và toàn bộ drag/no-drag, double-click maximize,
  minimize/maximize/restore/close IPC. Title bar chỉ giữ logo/tên, caption màn hiện tại và window
  controls. Chuyển theme control vào Cài đặt; bỏ cụm badge SSH/ML khỏi title bar. ML đang deferred
  nên không được để badge đỏ "stopped" chi phối màn demo.
- Sidebar là navigation rail/pane liền với cửa sổ, 200–220px khi mở và 52–56px khi thu gọn. Item cao
  32–36px, bo 4–6px; selected state dùng nền nhẹ + vạch/accent, không tạo nút pill lớn.
- Content padding 12–16px. Không bọc cả trang bằng một card nổi có margin lớn. Dùng nền đặc, pane
  liền nhau và border 1px. Scroll chỉ xuất hiện ở vùng nội dung cần cuộn.
- Page header một hàng: title 16–18px bên trái, toolbar/action bên phải; mô tả phụ chỉ hiện khi giúp
  người dùng ra quyết định. Không dùng hero, subtitle quảng bá hoặc title level 2 khổ lớn.

### 3. Density và component

- Scale mặc định: font 13px, control 32–34px, khoảng cách cơ sở 4/8/12/16px, radius 4–6px. Không
  giảm vùng click của window controls hoặc hành động nguy hiểm xuống dưới mức đang dùng.
- Table dùng `size="small"`, header rõ, row cao khoảng 36–40px, hover/selected đủ tương phản, số và
  host/port/path/checksum dùng mono/tabular nums. Empty/loading/error giữ đầy đủ hành động tiếp theo.
- `Tag`/`Badge` chỉ dùng cho trạng thái thật. Không biến mọi metadata thành chip màu. Mỗi vùng chỉ có
  một primary action; action phụ dùng default/text button theo mức độ.
- Dùng `Card` khi nội dung thực sự là một đơn vị tách biệt. Bỏ card lồng card và dãy card KPI khổ lớn;
  thay bằng compact summary strip, `Descriptions`, bảng hoặc các vùng có divider.
- Focus-visible phải rõ; tất cả thao tác hiện có vẫn dùng được bằng bàn phím. Trạng thái không chỉ dựa
  vào màu: luôn có text/icon. Không thêm animation trang; tôn trọng `prefers-reduced-motion`.

### 4. Loại bỏ "AI slop"

- Xóa gradient/glow/pulse trang trí, câu khẩu hiệu, lời giải thích lặp lại, câu chung chung và icon
  trang trí trước mọi heading. Giữ copy ngắn, cụ thể, mô tả trạng thái hoặc hành động thật.
- Không emoji, illustration sinh tự động, nền blob, glassmorphism, card mosaic, KPI khổng lồ hoặc
  nhiều accent tím/xanh/hồng cùng lúc.
- Tất cả text người dùng thấy phải đi qua `strings.ts`, tiếng Việt, sentence case. Chuẩn hóa các chuỗi
  hard-code còn trong Migrate/Settings trong phạm vi các màn được chạm.
- Không giấu log, checksum, marker, trạng thái verify hay lỗi kỹ thuật cần cho demo. Có thể thu gọn
  chi tiết kỹ thuật bằng Collapse/Drawer, nhưng kết quả chính phải nhìn thấy ngay.

## Yêu cầu theo từng màn

1. **Shell/title bar/navigation:** làm trước; caption không bị cắt ở 1366×768, window controls đúng
   hành vi Windows, sidebar không nhảy layout khi collapse.
2. **Deploy:** wizard và stepper gọn ở phần trên; vùng log/terminal chiếm phần lớn chiều cao còn lại.
   Trạng thái, progress, cancel/retry, kết quả và hai nút mở app/dashboard giữ nguyên. Không đổi pipeline.
3. **Migrate:** source/target thành một command pane rõ chiều chuyển; step/status/downtime và bảng
   verify nằm trong một workspace liên tục. Nút confirm chỉ hiện/bật theo state thật hiện có; cancel và
   rollback luôn giữ đúng semantics.
4. **VPS:** ưu tiên bố cục master–detail; fleet summary thành strip gọn, server list dễ scan, action bar
   cố định theo pane, resource/status không bị biến thành nhiều card rời.
5. **Apps:** list/version/deployment details dùng table/list + detail pane; primary deploy action nổi rõ,
   metadata và trạng thái dùng hierarchy thay vì chip/card dày đặc.
6. **Dashboard:** đổi bốn KPI card thành summary strip gọn và giữ recent activity dạng table. Vì ML
   deferred, không thêm score/model giả và không biến dashboard thành màn marketing.
7. **History/Settings:** toolbar filter gọn trên table; detail dùng Drawer/Descriptions. Settings chia
   section bằng divider/form row, đặt Appearance ở đây và không dùng card lồng card.

## Acceptance / Definition of Done

- [ ] Dark là mặc định khi storage trống và được đặt trước render; persisted light vẫn sống qua reload.
- [ ] 7 màn dùng cùng shell, spacing, typography, surface, border, action hierarchy; không còn page
      hero, translucent page panel, card lồng card hoặc trang trí gradient/glow.
- [ ] Title bar drag/double-click/window controls vẫn PASS; theme control có thể dùng trong Settings;
      không còn badge ML đỏ ở global chrome.
- [ ] Deploy và Migrate giữ nguyên toàn bộ data/event/action semantics; focused regression hiện có PASS.
- [ ] Ở 1366×768: sidebar mở, title bar, header và primary action nhìn thấy; Deploy/Migrate không có
      horizontal scrollbar; phần log/verify đủ đọc mà không cần zoom trình duyệt.
- [ ] Ở 1920×1080: content không bị kéo thành dòng quá dài; pane/table tận dụng không gian hợp lý.
- [ ] Keyboard Tab đi qua navigation, toolbar, primary/destructive actions; focus ring rõ. Text/status
      đạt tương phản đọc được và không chỉ dựa vào màu.
- [ ] Ảnh `after/` đủ 7 màn ở 1366×768, cộng Deploy và Migrate ở 1920×1080; cùng trạng thái dữ liệu
      hợp lệ, đã scrub secret/host nhạy cảm. Tạo `docs/evidence/tk-a18/README.md` đối chiếu before/after.
- [ ] Test mới có ít nhất: default dark; persisted light; theme switch ở Settings; title bar controls;
      navigation; Deploy/Migrate không mất các action/state quan trọng. Không dùng snapshot toàn trang.
- [ ] Chạy PASS: focused renderer tests, `pnpm typecheck`, `pnpm lint`, `pnpm exec prettier --check .`,
      `pnpm build`. Full `pnpm test` phải PASS trước handoff.
- [ ] Diff từ commit task packet do Leader bàn giao tới HEAD chỉ có renderer UI/test và hồ sơ TK-A18;
      không có contract/backend/live mutation. Board + task + `docs/tasks/tk-a18/handoff.md` được cập
      nhật cùng commit bàn giao.
- [ ] Bàn giao `READY_FOR_LOCAL_REVIEW`, ghi từng commit SHA, test count, đường dẫn ảnh và các điểm
      chưa hoàn tất. Worker không tự ghi `DEMO_READY`.

## Cách kiểm tra nhanh tính "native, không web/AI slop"

Reviewer phải trả lời **có** cho cả sáu câu:

1. Khi che logo, giao diện vẫn giống desktop operations tool hơn một landing page/admin template?
2. Có thể tìm source, target, trạng thái và primary action trong 3 giây ở Deploy/Migrate?
3. Một màn có tối đa một primary action nổi bật tại cùng thời điểm?
4. Border/spacing/typography tạo hierarchy mà không cần nhiều card, shadow hoặc màu?
5. Mở ở 1366×768 có đủ thông tin demo cốt lõi mà không zoom hay cuộn ngang?
6. Không có số liệu, ML status, badge hoặc copy mang tính trang trí/giả lập?

## Nhật ký

- `START 13/09` — Worker bắt đầu trên branch `feat/a18-native-dark-ui`: khóa phạm vi renderer-only, giữ nguyên file untracked của A, dựng dark shell trước rồi restyle 7 màn, test/evidence/handoff ở checkpoint cuối.
- `UPDATE 13/09` — Checkpoint shell pass tại `cfc7a8d`; renderer dark default/persist, title bar, navigation, Settings Appearance và density tokens đã hoạt động. Focused `8/8`, typecheck/build/lint pass.
- `HANDOFF-LOCAL 13/09` — Local review package gồm renderer changes, scrubbed `docs/evidence/tk-a18/after/`, `docs/evidence/tk-a18/README.md` và `docs/tasks/tk-a18/handoff.md`; full app `289/289` + ML `19/19`, no push/PR/merge. Baseline `before/` chưa có, ghi rõ là DoD gap.
- `UPDATE 13/09` — Checkpoint workflow/evidence pass tại `cee7d9a`; chuẩn bị checkpoint cuối với task log, board và handoff đồng bộ.
- `PLAN 13/09` — Leader mở TK-A18 theo yêu cầu: native desktop hơn, dark mặc định, giảm web/AI
  slop; khóa backend/live và giữ `936e643` làm rollback point. Worker chưa bắt đầu.
- `REVIEW 13/09` — Leader review submission `c35e797`: `CHANGES_REQUESTED`; mở A18-R1-01…07.
  Dark shell đạt nhưng bốn page chính không có source diff, visual vẫn card/web, Settings hiển thị
  ML/auto rollback giả, theme tests chưa kiểm rehydrate và capture xóa storage thật. Baseline before
  được waive; xem `docs/tasks/tk-a18/review-01.md`.
- `REPLAN 13/09` — A cung cấp đánh giá chuyên gia Windows 11 Fluent. Leader mở Review 02, đổi titlebar
  sang Window Controls Overlay native để có Snap Layout, cho phép Mica/fallback, chốt type/token/state và
  ba màn đối chiếu Dashboard/VPS/Settings. Review 02 thay phần thực thi Review 01; chưa sửa production
  code, chưa push/PR/merge.

## Lệnh tái hiện

```powershell
cd app
pnpm test
pnpm typecheck
pnpm lint
pnpm exec prettier --check .
pnpm build
```

## PR

Chưa được phép push, mở PR hoặc merge.
