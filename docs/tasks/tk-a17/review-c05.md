# TK-A17/C05 — Leader review

## Verdict

**DEMO_READY** ngày 13/09/2026 tại rehearsal SHA `936e643`, submitted docs `e21ba1c`.

Hai rehearsal liên tiếp đáp ứng phạm vi demo 14/09: deploy Express/Next.js/Vite bằng pipeline thật, sau đó
migrate Vite stateless và Express/PostgreSQL VM02 -> VM01 với `keepSource=true`. C06–C09, ML train/score,
monitor/fault/recovery tiếp tục `NOT_RUN`.

## Independent verification

- Ancestry `a384b2f -> 936e643 -> e21ba1c`: PASS. Rehearsal SHA chỉ thêm runbook; production giữ code C04 đã
  duyệt, nên cả hai lượt dùng cùng code/runtime identity.
- Full Node suite: 50 files / 287 tests PASS; ML service 19/19 PASS; collector 26/26 PASS.
- Node 22 không có trên máy; final gate dùng Node 24.16.0 và không được ghi thành Node 22 PASS.
- SQLite read-only: jobs 25–28 đều completed/source-kept, checksum/files/rows/marker `ok=true`, target app owner
  đúng và không có active migration.
- SSH read-only: rehearsal-02 Express/Next/Vite, hai source migrate và hai target migrate đều running/healthy,
  HTTP 200; collector liên quan running.
- Hai thư mục rehearsal có README, deploy JSON/log và migrate log được track. Quét pattern private key,
  PostgreSQL password/DATABASE_URL/encrypted secret không có kết quả.

## Demo boundary

- Dùng [runbook](../../26-kich-ban-demo-deploy-migrate-14-09.md) và [tài liệu nguyên lý](../../25-nguyen-ly-deploy-migrate-demo-14-09.md).
- Nếu live path gặp lỗi, làm đúng decision tree trong runbook; không sửa SQLite thủ công hoặc nói rehearsal là
  kết quả vừa chạy.
- Nói rõ ML đang phát triển và cần thêm dữ liệu, dự kiến xem lại từ 28/09/2026.
- `DEMO_READY` không cấp quyền push, mở PR hay merge. `HOÀN THÀNH` chỉ sau quy trình Git riêng của người A.

Reviewer evidence: [`review`](../../evidence/tk-a17/c05/review/README.md).
