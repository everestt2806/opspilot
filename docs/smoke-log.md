# NHẬT KÝ SMOKE TEST

Chạy **mỗi thứ Sáu** trên `main` và **trước mọi buổi demo**.
Checklist 10 bước: [`15-checklists.md`](15-checklists.md#smoke-test-10-phút)

Bảng này vào **phụ lục báo cáo** làm bằng chứng nhóm có quy trình kiểm thử đều đặn —
đừng để trống, và đừng ghi "pass" khi chưa chạy.

| Ngày       | Người chạy | Kết quả             | Bước fail                       | Ghi chú / đã sửa ở đâu                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------- | ---------- | ------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-08-09 | A + Codex  | ✅ PASS             | —                               | M00: typecheck, lint, 2 test TS, 1 test Python; dev + bản đóng gói `/health` OK; DB v1 đủ 11 bảng; đóng app dev không còn Python mồ côi                                                                                                                                                                                                                                                                                                               |
| 2026-08-24 | A + Codex  | ❌ FAIL             | Bước 5                          | Lát cắt demo cơ bản bước 1–4 đạt trên VM01: ML/SSH xanh, precheck đạt, deploy Express v2 qua đủ 7 bước trong 18.4s, URL công khai `/health` trả 200, PostgreSQL giữ nguyên 1.000 dòng. Full smoke dừng ở bước 5 vì Dashboard/collector chưa có số liệu; chưa tuyên bố MVP hoàn chỉnh. Sửa lỗi redeploy ở branch `fix/redeploy-postgres-password`.                                                                                                     |
| 2026-09-01 | A + Codex  | ⚠️ PASS CÓ GIỚI HẠN | VM01 network / VM02 public port | TK-A15 chạy thật trên VM02 fallback: v1/v2 khỏe, v3 health 503 tự rollback về v2, manual rollback v4 về runtime v1, PostgreSQL giữ 1.001 dòng và còn đúng 3 image. Smoke bắt lỗi readiness một-probe và đã sửa thành 10 probe hữu hạn. VM01 timeout TCP/22; public port 30000 của VM02 chưa mở nên chưa thay thế bằng chứng public URL VM01. Ảnh và biên bản: [`evidence/tk-a15/2026-09-01-smoke-vm02.md`](evidence/tk-a15/2026-09-01-smoke-vm02.md). |

<!--
Ví dụ cách ghi:
| 2026-08-14 | A | ❌ FAIL | Bước 5 | Dashboard không có số liệu sau 60s — offset không được lưu. Sửa ở PR #23 |
| 2026-08-21 | B | ✅ PASS | — | |
-->
