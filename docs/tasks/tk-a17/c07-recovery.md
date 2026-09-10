# C07 — Một thao tác khôi phục có xác nhận, website tốt lại và dữ liệu còn nguyên

## Đầu vào

C06 APPROVED; ít nhất hai version/image hợp lệ đã deploy qua tool. Đọc M04, deploy-events,
schema/IPC, runtime image chain, AppsPage/Versions mock, history service/renderer.
Đây là điểm nhấn P0; chỉ khi chặng này PASS mới có lời demo “khôi phục từ OpsPilot”.

## Các bước Worker làm

1. Thay Apps/Versions trong luồng demo bằng app:list/get/versions thật. Không dùng mockProjects/
   mockVersions để render thẻ/summary. Không hardcode commit người deploy không có trong DB.
2. Nút “Khôi phục phiên bản…” từ Monitor chọn target hợp lệ, giải thích tác động và confirm.
   Validate target thuộc app, trạng thái/image hợp lệ, không target hiện tại/đang busy.
3. app:rollback trả ID chỉ là accepted. Hiển thị tiến trình `deploy:event`, đợi finished;
   handling event sớm trước subscribe bằng subscribe trước/in-flight reconciliation, test race.
4. Failure hiện lỗi và hướng xử lý; không success toast khi vẫn đang start hoặc health fail.
   Success refresh app.current_deployment_id, versions/history, metric subscription mới.
5. Demo fault đang bật → click khôi phục → runtime version cũ healthy, website phản hồi nhanh.
   Xác minh image tag thực, không suy success từ restart xóa fault. PostgreSQL marker C04 còn.
6. Collector không mất, poller bám deployment mới, không train backlog cũ. Nếu model deployment
   mới chưa ready, hiển thị đúng; dữ liệu hồi phục của current version không được giả resolve
   alert thuộc deployment cũ. Giữ alert cũ với attribution và cho xem lại lịch sử.
7. Hiển thị timeline từ alert cũ → action rollback → kết quả → mẫu khỏe của deployment mới,
   nhãn IDs/version rõ. Khối trước/sau qua hai deployment phải chọn đúng từng window, không
   lọc mất lịch sử khi đổi selection hoặc gộp toàn bộ mẫu v1/v2.
8. History tự refresh, có action/target/outcome thật và điều hướng; không bịa log nghiệp vụ.

## File được sửa

Renderer Apps/Versions/Monitor recovery/history/nav; backend deploy chỉ bug/integration cần
thiết và regression. Không xây M8 coordinator ở C07; không viết lại pipeline đã ổn.

## Case và DoD

- [ ] C07-T1: Apps/Versions không mock trên luồng demo, ID/version/runtime đúng.
- [ ] C07-T2: target invalid/busy/confirm cancel/async failure/success/early-event race có test.
- [ ] C07-T3: live fault → rollback → healthy/image đổi; marker DB còn, collector vẫn ghi.
- [ ] C07-T4: switch deployment/UI không trộn data; alert cũ giữ đúng attribution.
- [ ] C07-T5: timeline/summary/history sau reload còn lấy được dữ liệu thật, không chỉ state tạm.
- [ ] C07-T6: deploy/monitor boundary+renderer tests, typecheck/lint/format/build, live ảnh/video.

## Evidence và review

`c07/recovery.md`: source/target/attempt/current/runtime image, thời gian accepted/finished/
observed healthy, marker before/after, collector seq, alert IDs, history; handoff-c07.md.
Leader review pipeline/UI race và data proof, rồi ghi C08 INCLUDE hoặc DEFERRED.
Nếu DEFERRED, tiếp C09; không mặc định mở auto-rollback chỉ vì nút thủ công đã chạy được.
