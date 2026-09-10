# C08C — Trình chiếu tự khôi phục thật, không can thiệp bằng tay

C08B APPROVED. Đọc playbook mục release/demo/nguồn trạng thái và IPC events/settings.
Automation theo rule là live gate bắt buộc; ML score thật là gate C03 và phải giữ hoạt động.

## Thực hiện từng bước

1. Nối toggle auto (mặc định OFF), chọn trusted method, confirm tác động. Save failure phải
   giữ trạng thái cũ, không bật giả trên UI. Confirm xảy ra trước fault, không hỏi mỗi lần trigger.
2. Projection mode hiển thị một tiến trình lớn: theo dõi → phát hiện → tự khôi phục → xác minh
   → phục hồi; dữ liệu thật theo playbook. Khôi phục thủ công là fallback, không nằm trong happy path.
3. Phân biệt `system:auto-rollback` success thao tác với business recovery: green hero chỉ
   sau ≥3 mẫu mới current deployment hợp lệ và trong ngưỡng theo tiêu chí playbook.
4. Chuẩn bị R1/R2 source/image identity, DB marker và baseline R2. Bật auto, trusted rule,
   giữ threshold mặc định, bật latency 2400ms. Helper chỉ fault/status/verify, không rollback.
5. Để coordinator tự chạy. Thu timeline screenshot/video, target runtime image, marker DB,
   sample windows và action origin. Nếu timeout reset xảy ra trước verification, lượt không PASS.
6. Quan sát sau rollback: collector còn, app pointer đúng, old alert attribution giữ nguyên,
   ML current chưa train không được hiện score cũ. Tính before/after đúng deployment/window.
7. Test cooldown qua incident tiếp có đủ target hợp lệ và recent last_rollback_at; không đổi
   timestamp DB để ép. Ghi suppression thực, reset fault thử nghiệm sau khi đã lấy proof.
8. Thử thêm trusted ML khi có candidate thật trên baseline/fault không đổi threshold để ép.
   Nếu không trigger, ghi số liệu quan sát; không bịa trước-rule claim, không đổi tên rule thành ML.

## Test / DoD

- [ ] C-T1: toggle/confirm/cancel/save failure, method switch, reload settings có tests.
- [ ] C-T2: success-only event chưa làm hero xanh; stale/null/new deployment recovery tests.
- [ ] C-T3: live rule-triggered automatic recovery, không manual/reset can thiệp trước proof.
- [ ] C-T4: live image identity + marker + collector; cooldown suppression thật.
- [ ] C-T5: 3 ML+ensemble scores đúng nguồn, ML trigger outcome được ghi trung thực.
- [ ] C-T6: UI/evidence 1366×768 và full-HD, readable; focused tests/typecheck/lint/format/build.

`handoff-c08c.md` + `c08c/auto-live.md`/video/ảnh/summary: fault start, decision samples,
automatic attempt, finish, business recovery, helper cleanup times. Leader phải phân biệt
recovery do reset với do pipeline và xác nhận toàn C08 trước C09. Không có DEFERRED gate.
