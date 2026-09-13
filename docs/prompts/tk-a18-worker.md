# Prompt Worker — TK-A18 native dark desktop UI

```text
Thực hiện một goal dài duy nhất TK-A18 trong repo hiện tại: sửa code, test, chụp evidence và commit
cục bộ; dừng ở READY_FOR_LOCAL_REVIEW.

Đọc đầy đủ theo thứ tự:
1. CLAUDE.md
2. docs/tasks/README.md và docs/tasks/board.md
3. docs/tasks/tk-a18-native-dark-ui.md — đây là task packet và nguồn scope/DoD chính
4. docs/02-ui-ux-spec.md và docs/prompts/m10-ui.md
5. app/src/renderer/src/App.tsx, main.tsx, store/uiState.ts, utils/themeTokens.ts,
   assets/tokens.css, assets/main.css, components/AppTitleBar.tsx và toàn bộ 7 page hiện tại

Tạo/switch branch feat/a18-native-dark-ui từ HEAD chứa task packet này; commit cha trước task là
66ab90b. Trước khi sửa, kiểm tra git status và giữ nguyên .devflow/, docs/ban-giao-20-08.md, logo.png
cùng mọi untracked của A. Chuyển TK-A18 thành ĐANG LÀM và thêm START 13/09 vào task khi thật sự bắt đầu.

Outcome bắt buộc:
- UI trông như ứng dụng quản trị desktop Windows: solid pane, toolbar, divider, table/list compact.
- Dark là mặc định từ frame đầu khi storage trống; preference light đã lưu vẫn được tôn trọng và
  theme control chuyển vào Settings.
- Bỏ cảm giác web/AI slop: không gradient/glass/glow, hero heading, card lồng card, KPI card lớn,
  chip màu tràn lan, copy phô trương hoặc trạng thái giả.
- Làm đồng bộ cả Shell, Deploy, Migrate, VPS, Apps, Dashboard, History, Settings theo tiêu chí và
  thông số trong task packet.
- Giữ nguyên tuyệt đối deploy/migrate IPC, event, state machine, verify/confirm/cancel/rollback và dữ
  liệu. Không làm ML; bỏ badge ML đỏ khỏi global title bar vì ML đang deferred, không sửa ML IPC.

Không thêm dependency và không sửa contract/backend/preload/shared/schema/collector/ML/template/demo
app. Không chạy deploy/migrate/reset demo hoặc mutation VM01/VM02. Không push/PR/merge.

Làm theo ba checkpoint commit được chỉ định trong task. Tự kiểm tra sau mỗi checkpoint; nếu phát hiện
regression chức năng, sửa trước khi chuyển tiếp. Chụp ảnh baseline/after và scrub dữ liệu nhạy cảm.
Không dùng screenshot test toàn trang; viết regression hành vi cho default/persist theme, Settings,
title bar, navigation và action/state Deploy/Migrate.

Trước bàn giao, chạy focused renderer tests, full pnpm test, typecheck, lint, Prettier check và build.
Đối chiếu diff với commit task packet Leader bàn giao. Cập nhật docs/evidence/tk-a18/README.md,
docs/tasks/tk-a18/handoff.md, task log và board trong cùng commit cuối. Trả về đúng:
1. outcome và các thay đổi nhìn thấy theo từng màn;
2. danh sách file/commit SHA;
3. test command + số test + exit code;
4. đường dẫn ảnh before/after;
5. phần DoD chưa đạt/rủi ro thật;
6. xác nhận không live mutation, không backend/contract change, không push/PR/merge;
7. trạng thái READY_FOR_LOCAL_REVIEW. Không tự ghi DEMO_READY.
```
