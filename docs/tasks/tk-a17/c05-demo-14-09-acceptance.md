# TK-A17/C05 — Nghiệm thu và rehearsal demo 14/09/2026

> **CLOSED/NOT_RUN cho tới khi C04 APPROVED.** Chặng này không thêm tính năng mới; chỉ sửa blocker
> tích hợp tái hiện được rồi chạy lại gate liên quan.

## Mục tiêu

Khóa một SHA có thể trình diễn liên tục hai năng lực: deploy ba loại source và migrate stateless +
PostgreSQL giữa hai VPS. ML/fault/monitor/tự rollback không xuất hiện trong luồng demo.

## Runbook 6–8 phút

1. Mở tài liệu nguyên lý, nói ngắn detector → BuildPlan → pipeline chung.
2. Chọn lần lượt source Express, Next và Vite; cho xem dấu hiệu nhận diện và build plan.
3. Chạy live deploy một source đại diện; hai source còn lại mở history/runtime/URL từ rehearsal cùng SHA.
4. Mở app Express, tạo marker nghiệp vụ trước migrate và reload chứng minh có trong PostgreSQL nguồn.
5. Chọn source/target, chạy migrate; giải thích freeze, logical dump, SSH bridge và checksum khi stepper chạy.
6. Mở bảng verify Nguồn/Đích, marker ở đích và URL đích; xác nhận “giữ nguồn”.
7. Mở history với deployment/migration job thật và nói câu hoãn ML đã chốt.

Không chạy cả năm lượt live trong buổi nếu thời gian không đủ. Trước demo phải có hai rehearsal đầy đủ;
trong buổi dùng history/evidence cùng SHA cho phần không chạy lại và nói rõ đó là kết quả rehearsal.

## Gate DEMO_READY

- [ ] Full Node test tuần tự, scripts typecheck, lint/Prettier changed files và production build PASS.
- [ ] Ba deploy Tier 1 ở đúng SHA có runtime image/health/URL proof.
- [ ] Stateless migrate và PostgreSQL migrate giữa hai VPS ở đúng SHA đều PASS.
- [ ] Marker PostgreSQL, checksum, row count, bytes, downtime và source-kept đọc lại được.
- [ ] Hai rehearsal liên tiếp hoàn thành; ghi thời lượng, lỗi/retry và trạng thái VPS sau mỗi lượt.
- [ ] Đường trình chiếu public/tunnel đã thử; nếu public port chặn, tunnel được tạo lại theo runbook và
      nói đúng là tunnel.
- [ ] App B, dữ liệu C02 và untracked của A còn nguyên; không có experiment/process/helper treo.
- [ ] Không có số/tên/progress mock trên Migrate UI; không nói ML đã hoàn thành.

Tạo `docs/26-kich-ban-demo-deploy-migrate-14-09.md`, evidence hai rehearsal và
`docs/tasks/tk-a17/handoff-c05.md`. Chỉ Leader cấp verdict `DEMO_READY` sau khi kiểm tra đúng SHA;
không push/PR/merge nếu A chưa ra lệnh riêng.
