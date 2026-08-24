# NHẬT KÝ SMOKE TEST

Chạy **mỗi thứ Sáu** trên `main` và **trước mọi buổi demo**.
Checklist 10 bước: [`15-checklists.md`](15-checklists.md#smoke-test-10-phút)

Bảng này vào **phụ lục báo cáo** làm bằng chứng nhóm có quy trình kiểm thử đều đặn —
đừng để trống, và đừng ghi "pass" khi chưa chạy.

| Ngày | Người chạy | Kết quả | Bước fail | Ghi chú / đã sửa ở đâu |
|---|---|---|---|---|
| 2026-08-09 | A + Codex | ✅ PASS | — | M00: typecheck, lint, 2 test TS, 1 test Python; dev + bản đóng gói `/health` OK; DB v1 đủ 11 bảng; đóng app dev không còn Python mồ côi |
| 2026-08-24 | A + Codex | ❌ FAIL | Bước 5 | Lát cắt demo cơ bản bước 1–4 đạt trên VM01: ML/SSH xanh, precheck đạt, deploy Express v2 qua đủ 7 bước trong 18.4s, URL công khai `/health` trả 200, PostgreSQL giữ nguyên 1.000 dòng. Full smoke dừng ở bước 5 vì Dashboard/collector chưa có số liệu; chưa tuyên bố MVP hoàn chỉnh. Sửa lỗi redeploy ở branch `fix/redeploy-postgres-password`. |

<!--
Ví dụ cách ghi:
| 2026-08-14 | A | ❌ FAIL | Bước 5 | Dashboard không có số liệu sau 60s — offset không được lưu. Sửa ở PR #23 |
| 2026-08-21 | B | ✅ PASS | — | |
-->
