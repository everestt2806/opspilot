# C09 — Nghiệm thu demo dành cho người không chuyên

## Đầu vào

C00–C07 APPROVED; C08 APPROVED hoặc DEFERRED rõ. Không xây thêm module ở đây.
Mục tiêu: đóng finding, khóa bản chạy và chứng minh thầy nhìn thấy giá trị không cần đọc code.

## Các bước Worker làm

1. Ghi code SHA cuối, môi trường/manifest/model readiness/DB marker/image/source. Kiểm tra
   runtime hiện tại thay vì coi evidence chặng trước là trạng thái VPS hiện tại.
2. Chạy full gate tuần tự Node 22 trong `app/` (mỗi dòng lệnh riêng):

```powershell
node --version
pnpm typecheck
pnpm lint
pnpm test -- --maxWorkers=1
pnpm try:monitor
pnpm build
```

3. Scoped Prettier cho đúng files đổi; Python venv chạy `python -m pytest tests -q` lần lượt
   cwd collector và ml-service. CLI live C02/C03 chứng minh SSH/ML, fixture chỉ regression.
4. Viết `docs/25-kich-ban-demo-monitor-recovery.md`: source path, start app/ML, target URLs,
   baseline/train, version/image chuẩn bị, click path từng cảnh, helper fault/reset command,
   phép đo chờ, expected/actual, fallback và trạng thái giữ lại sau demo.
5. Hai lượt rehearsal từ trạng thái chuẩn bị xác định: tạo ghi chú → nhanh → fault/chậm →
   alert → recovery → nhanh + ghi chú còn. Reset fault/training đúng quy trình giữa lượt;
   không sửa trực tiếp SQLite để làm đẹp biểu đồ. Nếu C08 deferred dùng rollback thủ công.
6. Chụp website + OpsPilot ở các cảnh; quay ít nhất một lượt thật. Ảnh/video ghi timestamp/
   code SHA, không secret. Screenshot thầy xem được text chính ở viewport demo, không chỉ chart.
7. Lưu “bảng kết quả lượt demo”: time windows/n/median, alert/recovery, marker DB, image;
   phân biệt observation với đánh giá thống kê. Không công bố accuracy/% hoàn thành từ demo.
8. Update board/task/handoff/docs/05 theo bằng chứng. Giữ baseline/DB/images cho A tập;
   không dọn/reset VPS nếu A chưa yêu cầu riêng. Tắt fault của lượt test và ghi rõ runtime.

## DoD / điều kiện DEMO_READY

- [ ] C09-T1: toàn bộ gate test/build có exit/count/log đúng SHA, không skip/hang bị gọi PASS.
- [ ] C09-T2: hai lượt đầu-cuối thực tế, có thời gian chờ và kết quả lặp lại được.
- [ ] C09-T3: website thể hiện tác động thật; OpsPilot giải thích sự cố bằng lời dễ hiểu.
- [ ] C09-T4: recovery/image/DB marker có bằng chứng, collector/current deployment đúng.
- [ ] C09-T5: before/after truy lại được mẫu, null/stale/model readiness không gây hiểu nhầm.
- [ ] C09-T6: public URL xác minh riêng; tunnel/video fallback công bố đúng hình thức.
- [ ] C09-T7: runbook có lệnh/click chính xác, ảnh/video mở được, không placeholder.
- [ ] C09-T8: không blocker mở; reviewer xác nhận bản code chạy thực tế và scope C08.

## Review cuối

`c09/test-summary.md`, `rehearsal-01.md`, `rehearsal-02.md`, ảnh/video và handoff-c09.md.
Leader làm walkthrough và kiểm tra evidence: “Nhìn không nghe giải thích vẫn thấy website
đang chậm, tool đang xử lý, website đã tốt lại” phải đúng bằng dữ liệu/thao tác thực.
Chỉ Leader ghi DEMO_READY đúng SHA. Rule-only/không live/thiếu rollback proof là fallback
chưa đạt đủ mục tiêu, phải ghi rõ, không đổi thành hoàn thành mặc định.
