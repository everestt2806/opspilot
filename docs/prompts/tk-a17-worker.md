# Prompt giao Worker — TK-A17

Dán nguyên khối sau vào Worker. A là người quyết định sản phẩm; Leader review; bạn thực thi.

```text
Bạn là Worker của OpsPilot. Thực hiện TK-A17 để A demo trong khoảng 3 ngày.
Đọc đầy đủ CLAUDE.md, docs/tasks/README.md, docs/tasks/board.md,
docs/24-ke-hoach-demo-3-ngay.md, docs/tasks/tk-a17-demo-checkpoint.md và
docs/tasks/tk-a17-worker-handoff.md. Đọc contract/spec được task yêu cầu trước mỗi chặng.

Baseline code Leader đã kiểm tra: origin/main@683bfc6. Plan nằm trên
plan/a17-demo-checkpoint. Kiểm tra HEAD/dirty trước; tạo feat/a17-demo-checkpoint
từ HEAD chứa đầy đủ hồ sơ plan, không từ main cũ làm mất tài liệu. Nếu nhánh Worker
đã có thì tiếp tục đúng HEAD, không checkout lùi/rebase/rewrite. Không đụng untracked/stash
của A. Ghi trạng thái bắt đầu vào board/task, tóm tắt kế hoạch rồi thực hiện G0 → G1.

P0: deploy Express/PostgreSQL kèm collector, metric VPS qua SSH vào SQLite, ML thật,
Monitor UI, alert/label/settings, version + rollback thủ công, evidence và kịch bản demo.
M8 auto-rollback theo score là P1 chỉ mở khi đạt điều kiện trong task và Leader duyệt gate.
Không mở migrate/Next/Vite detector hoặc redesign UI trong task này.

Dùng GitNexus để tra flow/impact trước sửa core nếu khả dụng; đọc source trực tiếp để
xác nhận. Nếu GitNexus lỗi, ghi hạn chế rồi tiếp tục bằng rg, không block cả task.
Đặc biệt kiểm tra renderCompose cả deploy lẫn restore, probe business endpoint (health vẫn
200 khi fault), deployment/offset khi redeploy, ML null, alert resolved không có trong
new_alerts, và rollback trả ID ngay chưa phải thành công. Không coi CLI fixture là ML live.

G1 xong: test + commit local có message tiếng Anh, ghi handoff R1 và dừng để A chuyển Leader.
Sau review, sửa từng finding, thêm regression, update REVIEW-FIX; rồi làm G2 và bàn giao R2.
G3 là full regression + 2 rehearsal + screenshot/video + runbook; bàn giao R3.
Không tự approve gate. Khi chờ review có thể chuẩn bị docs/test plan, không vượt gate phụ thuộc.

Được đọc/sửa/test/commit local. Không push, mở PR, merge hoặc spawn subagent.
Không cần xin lại quyền cho các sửa code trong scope. Triển khai thật chỉ trên app demo
riêng sau manifest/preflight; không dọn VPS hay app B. Thiếu quyền/credential thì ghi blocker
cụ thể và tiếp tục phần local độc lập; không xin người dùng paste secret vào chat/log.

Mỗi checkpoint cập nhật board + task log + handoff. Ghi SHA, files, command/cwd/exit code,
test count, evidence path, giới hạn và bước tiếp theo. FAIL/NOT_RUN ghi đúng, không tự gọi
là baseline. Không sửa test để che lỗi. Full suite chạy tuần tự Node 22 theo task.
Không tuyên bố DEMO_READY hay HOÀN THÀNH thay Leader.

Bắt đầu ngay G0/G1. Trả cuối chặng: outcome, gate, branch/base/code HEAD/docs HEAD,
commits, kết quả test/live, findings còn mở, link handoff và “CHƯA PUSH — CHƯA PR — CHƯA MERGE”.
```

Prompt nhắc tiếp sau review:

```text
Tiếp tục TK-A17 ở HEAD hiện tại. Đọc handoff và review mới nhất của Leader.
Sửa các finding theo đúng gate, thêm regression rồi cập nhật REVIEW-FIX/test evidence.
Commit local tiếng Anh; không push/PR/merge. Bàn giao đúng mẫu, không bỏ qua gate còn đỏ.
```
