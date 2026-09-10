# C08 — Tự khôi phục theo score (tùy chọn, review riêng)

## Điều kiện mở

C07 APPROVED và Leader ghi INCLUDE; không còn finding blocking P0. Không có điều kiện ngày.
Nếu DEFERRED: giữ tính năng OFF/disabled có giải thích, vào C09 và bỏ lời demo tự khôi phục.
Đọc đủ M08/M04, IPC system:auto-rollback, schema alert.acted/monitor_setting, deploy lifecycle.

## Các bước Worker làm

1. Tách `shouldAutoRollback` thuần khỏi coordinator. Đếm mẫu mới liên tiếp của trusted method,
   không đếm poll hoặc số alert; replay/null không tăng bộ đếm. Auto mặc định OFF.
2. Chọn previous successful deployment có runtime image thật, không lấy version−1 máy móc.
   v1/không image/busy/cooldown ghi skip reason đúng. Tái dùng app lock/pipeline hiện có.
3. Theo dõi rollback finish thật. Chỉ update acted thành công, last_rollback_at/cooldown và
   emit success notification sau healthy. Log phân loại automatic, không ghi manual success
   song song. M8 không phải nhánh tự rollback khi deploy healthcheck fail của M4.
4. Cooldown persistent sống qua restart; failure không tự retry ở poll tiếp. Coordinator
   single-flight, handling crash/restart/shutdown không phát lệnh trùng vô hạn.
5. UI opt-in confirm, chọn trusted method, thông báo bền và marker timeline đúng event.
   Status not-ready/ML-down rõ; không ép ensemble trigger chỉ để đạt demo.
6. Live ít nhất một automatic recovery và một cooldown suppression. Có thể trusted rule
   cho kịch bản chắc chắn, phải gọi đúng “tự khôi phục theo ngưỡng”; muốn nói ML-triggered
   thì phải có model score/alert thực sự kích hoạt và evidence riêng.

## File được sửa

`app/src/main/monitor/auto-rollback.ts` mới, coordinator/wiring/test cần thiết, pipeline
internal completion/source attribution nếu cần, UI auto settings/notification/marker.
Không thay contract trừ proposal Leader chấp thuận; không thêm automation engine tổng quát.

## Case và DoD

- [ ] C08-T1: disabled/thiếu mẫu/null/replay/đúng method/cooldown có unit tests.
- [ ] C08-T2: no target/missing image/failed attempt chain/busy/race có regression.
- [ ] C08-T3: success sau finished, failure không retry, restart/cooldown/shutdown test.
- [ ] C08-T4: live auto rollback + suppression, DB marker/collector/deployment boundary đúng.
- [ ] C08-T5: notification/history/marker thể hiện đúng nguồn, không double-log manual/auto.
- [ ] C08-T6: focused coordinator/deploy/monitor/UI, typecheck/lint/format/build PASS.

## Evidence và review

`c08/auto-recovery.md` gồm trigger samples, trusted method/settings, action IDs, result/
cooldown timestamps, image/marker proof; handoff-c08.md. Leader kiểm tra retry/failure/race,
không approve từ happy path. Code dở phải được cô lập khỏi runtime demo hoặc sửa hoàn chỉnh
trước C09; không gọi DEFERRED nhưng để coordinator chưa kiểm thử chạy nền.
