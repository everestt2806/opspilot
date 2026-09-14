# C08A — Quyết định tự khôi phục, chưa chạy rollback thật

C07 APPROVED. Đọc M08, schema/IPC, poller/service/repository và playbook.
C08A chỉ policy/candidate/test; không bật automation trong index.ts hoặc gọi SSH rollback.

## Thực hiện từng bước

1. Tạo `app/src/main/monitor/auto-rollback.ts`, giữ signature shouldAutoRollback trong M08.
   Các helper nội bộ được đặt tên rõ, không đổi IPC. Unit test trước cho enabled/consecutive/
   cooldown; inject `now` để test thời gian, không dùng sleep.
2. Candidate lấy score rows vừa commit của current deployment và setting đúng app. Đếm
   suffix các mẫu liên tiếp của trusted method theo seq, không đếm callbacks/polls/alert rows.
   Poller hiện gọi onSample sau khi commit cả batch; query không giới hạn đến sample đang xử lý
   sẽ vô tình nhìn các sample tương lai. Dùng batch evaluator với thứ tự xác định, chỉ quyết
   định hành động từ trạng thái cuối batch hiện tại để không rollback vì đoạn high đã hết.
3. Duplicate/retry batch không tăng đếm; null/method không đúng không tạo trigger. Alert phù
   hợp phải tồn tại. Điều kiện alert đủ mẫu và rollback_consecutive là hai điều kiện riêng,
   không nhân hai ngưỡng hoặc dùng độ dài alert để đếm thay score.
4. Chặn hành động từ stale backlog khi reconnect: thu metric vẫn đủ nhưng không rollback
   từ incident đã cũ. Ghi policy freshness nội bộ dựa chu kỳ poll/collector; test timestamp
   tương lai/clock skew và không âm thầm thêm setting contract. Leader review policy cụ thể.
5. Target selection dùng previous successful deployment còn runtime image, bỏ current,
   failed attempt và chain cùng runtime image nếu chỉ dẫn đến restart cùng release. Kiểm tra
   relation app/image thật tại execution C08B; C08A chỉ quyết định và lý do.
6. Trả reason rõ cho disabled/insufficient/cooldown/no-target/stale/busy; không gán reason
   ngoài signature shouldAutoRollback, dùng coordinator candidate result nội bộ cho guard mở rộng.

## Test / DoD

- [ ] A-T1: disabled, <N, =N, quá cooldown/đúng boundary, datetime invalid.
- [ ] A-T2: 3 high cùng batch và bắc qua batch; retry; null ở giữa; setting đổi; đúng method.
- [ ] A-T3: backlog high→low, stale batch, current đổi, clock skew không kích hoạt sai.
- [ ] A-T4: v1/no-target/failed gaps/runtime rollback chain và target khác app.
- [ ] A-T5: test thuần + repository fixture có SQL thật, typecheck/lint/format PASS.

Handoff `handoff-c08a.md`: decision table/input→expected, test log, base/code SHA; evidence
`c08a/`. Leader review logic và mức tươi dữ liệu; APPROVED mới C08B. Không nhận live auto PASS.
