# M09 — Migrate pipeline · Người A · Tuần 6–7

`app/src/main/migrate/pipeline.ts` — FR-C1..C5, UC-05

## Mục tiêu
Chuyển một app (kèm database và dữ liệu persistent) từ VPS nguồn sang VPS đích, **kiểm chứng
toàn vẹn dữ liệu**, và chỉ đụng đến VPS nguồn sau khi người dùng xác nhận.

Chỉ hỗ trợ app **do chính tool này deploy** — cấu trúc thư mục và volume đã biết trước.

## Đọc trước
- **`docs/contracts/deploy-events.md` mục 2** — 7 bước, bất biến, nhánh lỗi
- `docs/contracts/schema.sql` bảng `migration_job`
- `docs/contracts/ipc-contract.ts` — `MigrateEvent`
- `docs/02-ui-ux-spec.md` mục 3.6

## Bảy bước

| # | Bước | Việc |
|---|---|---|
| 1 | `PREPARE` | Precheck VPS đích (dùng lại `PRECHECK` của M4), cấp `host_port` trên đích, tạo `/opt/deploytool/<app>` |
| 2 | `FREEZE` | `docker compose stop app` trên **nguồn** (postgres vẫn chạy để dump). **Bắt đầu đếm downtime** |
| 3 | `BACKUP` | `docker exec <pg> pg_dump -Fc -U <user> <db> > backup.dump` (nếu `needs_db`) · `tar czf data.tar.gz data/` · copy `.env` · `sha256sum` từng file |
| 4 | `TRANSFER` | `ssh nguồn 'cat f' \| ssh đích 'cat > f'` — stream qua máy người dùng, **không yêu cầu 2 VPS thấy nhau**. Phát `progress` theo byte |
| 5 | `RESTORE` | Giải nén `data/`, chạy RENDER→BUILD→DEPLOY của M4 trên đích, `pg_restore` vào postgres đích |
| 6 | `VERIFY` | Đối chiếu 3 nhóm (bảng dưới), phát `verify-result` |
| 7 | `AWAITING_CONFIRM` | Chờ người dùng. **Dừng đếm downtime** khi healthcheck đích OK |

## `VERIFY` — FR-C4, đây là bằng chứng chụp vào báo cáo

| Nhóm | Cách kiểm | Đạt khi |
|---|---|---|
| Checksum file | `sha256sum` mọi file backup ở nguồn và sau khi truyền ở đích | Khớp từng file |
| Bản ghi DB | `SELECT count(*)` từng bảng ở nguồn và đích (lấy danh sách bảng từ `information_schema`) | Khớp từng bảng |
| Ứng dụng | Healthcheck trên đích | 2xx |

Kết quả lưu `migration_job.verify_json`, UI hiện **bảng 2 cột Nguồn | Đích**.

## Bất biến — hội đồng chắc chắn hỏi về mục 1

1. **VPS nguồn không bị đụng đến cho tới khi người dùng bấm xác nhận** — kể cả khi mọi thứ
   thành công (FR-C5). Sau xác nhận mới có 2 lựa chọn: "giữ nguồn" / "dọn nguồn".
2. Lỗi ở bất kỳ bước nào → dọn sạch **bên đích** (`docker compose down -v` trên đích là hợp lệ
   vì dữ liệu ở đó vừa được tạo) → `docker compose start app` bên **nguồn** →
   `status='rolled_back'`. Nút "Huỷ & rollback" luôn hiện cho tới trước bước 7.
3. **`VERIFY` fail thì KHÔNG tự dọn** — chuyển sang `awaiting_confirm` kèm cảnh báo đỏ, để
   người dùng tự quyết. Tự động xoá dữ liệu khi đang nghi ngờ là hành vi nguy hiểm.
4. `downtime_ms` đo bằng **đồng hồ VPS nguồn**, không phải đồng hồ máy user (số liệu này vào
   báo cáo).
5. Không cho phép migrate app đang có deploy chạy dở (khoá theo `app_id`).

## Test — bắt buộc test cả nhánh hỏng

| Kịch bản | Kỳ vọng |
|---|---|
| Migrate app **không DB** giữa 2 VPS | Thành công, app chạy ở đích, checksum khớp (mốc tuần 6) |
| Migrate app **có PostgreSQL** có sẵn ~1000 bản ghi | `count(*)` khớp từng bảng (mốc tuần 7) |
| **Ngắt SSH giữa `TRANSFER`** (rút mạng) | Đích dọn sạch, **nguồn tự `start` lại**, `status='rolled_back'`, app nguồn vẫn phục vụ được |
| Đích thiếu disk | `PREPARE` chặn trước, thông báo con số thực tế |
| Sửa 1 byte file backup ở đích trước khi VERIFY | VERIFY báo lệch checksum, **không** tự dọn |
| Bấm "Huỷ" ở bước `AWAITING_CONFIRM` | Đích dọn, nguồn chạy lại |

## Định nghĩa xong
- [ ] 6 kịch bản trên đều đúng
- [ ] Bảng verify 2 cột hiển thị đầy đủ và **chụp được vào báo cáo**
- [ ] `downtime_ms` được ghi và hợp lý (kỳ vọng 1–3 phút với app nhỏ)
- [ ] Sau khi chọn "giữ nguồn", app ở **cả hai** VPS đều chạy được
- [ ] Toàn bộ các bước tra lại được trong màn Lịch sử
