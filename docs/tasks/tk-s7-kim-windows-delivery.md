# Kim — Windows delivery song song database core

START16/11/2026 — User giao phát triển đồng thời với Sơn. Nhánh `feat/kim-windows-delivery-20261116`; code baseline f699615 + commit tài liệu phân công. Đọc CLAUDE.md, task-discipline, DECISIONS.md, `tk-s7-parallel-2026-11-16.md`, R11a/R11b/R11c và README Windows release/upgrade. Không cần đợi d3 của Sơn.

Ảnh hưởng sản phẩm: người khác cài/mở app trên Windows không có developer Node/Python; giữ DB/key/model/UI qua đóng/mở/nâng bản; đóng app không để ML chạy mồ côi; có hướng dẫn demo/phục hồi rõ. Đây gồm phát triển delivery và sửa lỗi tái hiện được, không chỉ viết checklist.

## K1 — Package/current-schema acceptance

| Requirement | Check/evidence | State |
|---|---|---|
| Prerequisite trên máy mới | Inventory Node22/pnpm/approved dependencies/ML/controller resources; bootstrap/hướng dẫn tái hiện không phụ thuộc đường dẫn máy Sơn. Resource ignored không coi là có sẵn | OPEN |
| Harness tương thích baseline | Audit giả định cũ, ví dụ SQLite031 trong R11b trong khi baseline Desktop038; kiểm inventory migrations đúng baseline. Không sửa schema/runtime để phục vụ lab | OPEN |
| Full packaged app thật | Output mới; production Main/preload/renderer/SQLite/safeStorage/bundled ML, không mock. Locale/theme/cold reopen giữ DB/key/model/UI; synthetic180train/4scores chỉ kiểm runtime | OPEN |
| Process/data fixture | Profile/HOME/output nonce; xác minh child PID/port; quit không orphan ML; chỉ dọn đúng fixture/registry, giữ diagnostics khi fail | OPEN |
| Evidence | SHA baseline/source/ASAR/exe/manifests, commands/time/environment/actual vs synthetic; lint/types/build/focused meaningful checks; không tự nhận clean-machine PASS | OPEN |

Chỉ sửa file thuộc Kim theo bảng owner. Có thể thêm `app/scripts/windows-delivery/**`. Lỗi Main/IPC/shared ghi repro cho Sơn, không sửa chéo. Không đổi catalog/pin, không tắt beforePack/resource verification. Binary/dependency chỉ từ nguồn/hash đã duyệt. Nếu thiếu resources: báo đúng danh sách/prerequisite, tiếp tục K3 trong lúc chuẩn bị; không nhận package PASS khi chưa có artifact.

## K2 — Windows độc lập / NSIS lifecycle

Bắt đầu trên package baseline, không chờ feature core. Máy Kim hoặc Windows VM/disposable environment; ghi chính xác môi trường, account khác trên cùng máy không đồng nghĩa clean OS. K2 phụ thuộc nội bộ K1, không phụ thuộc code mới của Sơn.

- Cài mới bằng NSIS; shortcut/Start menu mở đúng app; runtime không cần developer Node/Python trong PATH.
- Reopen/repair/upgrade theo supported policy giữ SQLite/key/UI/model. Không nhận local credential protection là khả năng copy khóa sang mọi user/máy.
- Ordinary uninstall dọn app/shortcut/registry đúng identity, giữ user data theo policy; không gỡ bản OpsPilot đang sử dụng.
- Thiếu/tamper resource phải từ chối rõ và giữ dữ liệu. Unsigned ghi NotSigned; không giả signature hoặc tắt Windows security.
- PASS/FAIL/NOT_RUN riêng. Thiếu Windows disposable thì ghi blocker K2 và tiếp K3; không gọi R11/release tổng hoàn tất.

## K3 — Source CI và bàn giao demo

Có thể làm song song K1 hoặc trong lúc chờ môi trường K2:

- Workflow mới `.github/workflows/windows-delivery-source.yml`, script trong `app/scripts/windows-delivery/**`: Node22/lockfile hiện hành, source typechecks/tests/lint có lý do, logs/checksums/source SHA; không secret VPS/production DB. Ưu tiên workflow_dispatch để kiểm cấu hình trước; không publish installer/release hoặc tạo requirement tài khoản/secret mới.
- Source CI không đồng nghĩa package PASS. Job packaging chỉ PASS khi đủ verified resources; không skip toàn bộ rồi báo xanh.
- Hướng dẫn tại `docs/delivery/windows-kim/**`: cài/mở app, prerequisite, backup user data, log redacted, phục hồi khi installer lỗi.
- Kịch bản demo8–10phút dựa trên luồng đã có ở baseline, video/ảnh dự phòng nếu có, ghi SHA. Các mục live Git/database/VPS mới để coordinator xác nhận, không mô tả feature chưa có là đã hoàn tất.

## Quy tắc checkpoint

- Chỉ cập nhật task này/docs riêng, không board/DECISIONS/core. Coordinator tổng hợp. Contract/dependency/pin/runtime ngoài phạm vi: ghi proposal/repro.
- K1/K2/K3 commit riêng, normal push nhánh Kim; chưa PR/merge/publish release/VPS. Không reset/clean/stash/rebase/force; giữ dữ liệu sẵn có.
- Baseline cố định, không pull/rebase core liên tục. Coordinator chạy lại công cụ của Kim trên candidate ghép sau review. Không tự bỏ test lỗi.
- Bàn giao trong task: SHA, files, commands/results, evidence paths/hashes, môi trường/giới hạn, next action. Chat ngắn: `Kim đã xong K1 — <SHA>`; nếu chặn ghi cụ thể và tiếp đầu việc độc lập còn lại.
- Commit dùng đúng danh tính tác giả. Giữ dòng coauthor theo chỉ thị hiện hành khi áp dụng, không ghi danh người không có đóng góp như một sự kiện đã xác minh.

## Tiếp nhận trên máy riêng

Clone vào thư mục mới ngoài repo đang làm, hoặc worktree riêng. Không checkout đè workspace bẩn. Không copy node_modules/venv/userData của Sơn. Không cần credential VPS.

```powershell
# Từ thư mục CHA nơi muốn đặt checkout mới, đổi nơi lưu theo máy Kim.
git clone --branch feat/kim-windows-delivery-20261116 --single-branch https://github.com/everestt2806/opspilot.git OpsPilot-Kim
cd OpsPilot-Kim
git status --short --branch
git merge-base --is-ancestor f699615 HEAD
```

Kim thêm START với môi trường thực tế, chọn K1 hoặc K3 có thể chạy ngay, cập nhật ledger trước khi bàn giao.
