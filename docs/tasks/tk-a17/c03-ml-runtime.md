# C03 — ML train và chấm điểm thật, có trạng thái khi chưa sẵn sàng

> **OPEN sau C02 review-10 (12/09/2026).** Worker dùng execution plan tại
> [c03-worker-plan.md](c03-worker-plan.md); C04–C09 vẫn đóng/`NOT_RUN`.

## Đầu vào

C02 APPROVED. Đọc M07/M06, ML OpenAPI, schema/IPC, mlClient/mlApi/service và ml-service.
Chặng này không hứa model phát hiện trước rule, không tối ưu mô hình hoặc làm thí nghiệm chính thức.

## Các bước Worker làm

1. Chạy Python ML process qua lifecycle thật của Electron/CLI; xác nhận health/status đúng
   deployment và executable venv, không dùng mock scorer trong bằng chứng live.
2. Thu baseline bình thường ≥180 mẫu chu kỳ 10s, nguồn VPS C02, không bật fault. Model có
   thể auto-train từ 150 theo code hiện có; xác nhận train dataset/time/count và cơ chế train.
3. Mở rộng CLI live C02 để gọi ML client thật; ghi readiness, số metric/score và null/non-null
   theo method. Score mới sau train từ 3 model + ensemble; rule là hàng so sánh thứ năm.
4. Test dưới 150, đủ 150, train-now, auto-train cooldown/status, reset process/restart.
   Không dựa vào số dòng SQLite để suy model memory đã tồn tại.
5. ML down → metric/rule vẫn hoạt động, ML score null; phục hồi → status/score đúng,
   không duplicate/replay sai thứ tự. Đảm bảo timestamp/deployment identity khớp.
6. Ghi quy trình baseline/train lại khi chặng sau redeploy thay current deployment; không
   chuyển model của deployment cũ sang mới chỉ để tránh chờ thu mẫu.

## File được sửa

Monitor/mlClient/runtime wiring, ml-service sửa lỗi tích hợp có bằng chứng, CLI live và test.
Không thay model/feature/threshold/window contract, thêm dependency hay dữ liệu thí nghiệm giả.

## Case và DoD

- [ ] C03-T1: live baseline ≥180 sạch có nguồn/time range và model train thật thành công.
- [ ] C03-T2: batch mới sau train có 5 rows/sample, 4 ML score hữu hạn và range đúng contract.
- [ ] C03-T3: thiếu mẫu/training/not-ready/down là trạng thái thật, null không thành zero.
- [ ] C03-T4: tắt/khởi động lại đúng process thử nghiệm, metric/rule tiếp tục, ML phục hồi.
- [ ] C03-T5: train/status/cooldown/restart regression; monitor và ML pytest, typecheck/lint/format.
- [ ] C03-T6: hướng dẫn tái lập dataset/model sau đổi deployment được kiểm chứng.

## Evidence và review

`c03/ml-live.md`: deployment, baseline provenance, API status/train tóm tắt, score counts
theo method/null, lifecycle logs; handoff-c03.md. Không dump secret/raw DB người dùng.
Leader xác minh real client/process và provenance, không dùng fixture CLI làm proof ML.
C03 APPROVED mới mở C04. Nếu ML chưa đạt giữ BLOCKED; không đổi mục tiêu thành rule-only ngầm.
