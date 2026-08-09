# HỢP ĐỒNG: State machine & event của Deploy / Migrate pipeline

Kiểu TypeScript của event: [`ipc-contract.ts`](ipc-contract.ts) (`DeployEvent`, `MigrateEvent`).
File này định nghĩa **thứ tự, bất biến và nhánh lỗi** — thứ mà kiểu dữ liệu không diễn tả được.

---

## 1. Deploy pipeline (M4)

### Thứ tự bước — tuyến tính, không nhảy cóc, không song song

```
PRECHECK → UPLOAD → RENDER → BUILD → DEPLOY → HEALTHCHECK → RECORD
```

Mỗi bước phát đúng chuỗi event sau:

```
step-start  → log* → step-done          (thành công)
step-start  → log* → step-failed        (thất bại, pipeline dừng)
```

Kết thúc pipeline **luôn** phát đúng một `finished`, kể cả khi thất bại hoặc bị huỷ.
UI dựa vào `finished` để tắt spinner — thiếu nó là màn hình treo vĩnh viễn.

### Bảng bước

| Bước | Lệnh chính trên VPS | Điều kiện qua | Nhánh lỗi |
|---|---|---|---|
| `PRECHECK` | `free -m`, `df -h /`, `ss -tlnp`, `docker --version` | RAM trống >512MB · disk trống >2GB · `host_port` chưa dùng · Docker tồn tại | Dừng. **Chưa ghi gì lên VPS** |
| `UPLOAD` | `tar czf - --exclude=... . \| ssh 'tar xzf - -C /opt/deploytool/<app>/src'` | tar trả 0 | Xoá `/opt/deploytool/<app>` nếu vừa tạo mới |
| `RENDER` | ghi `Dockerfile`, `docker-compose.yml`, `.env` (chmod 600) | 3 file tồn tại | Dừng, xoá file vừa ghi |
| `BUILD` | `docker build -t <app>:v<N> .` | exit 0 | `docker image rm <app>:v<N>` (bỏ qua lỗi) |
| `DEPLOY` | `docker compose up -d` | exit 0, container app `running` | Nếu có v(N-1): `docker compose` với tag cũ. Nếu không: `compose down` (giữ volume) |
| `HEALTHCHECK` | `curl -fsS http://127.0.0.1:<host_port><path>` ×10, cách 3s | ≥1 lần trả 2xx | **Tự rollback về v(N-1)** (UC-03); không có v(N-1) → status `failed`, container giữ nguyên để người dùng xem log |
| `RECORD` | `docker image ls` + xoá image cũ (giữ 3 bản) | luôn qua | Chỉ log warning, **không** làm fail cả deploy |

### Bất biến (vi phạm là bug nghiêm trọng)

1. **Không bao giờ xoá thư mục `data/` hoặc volume** trong bất kỳ nhánh lỗi nào.
2. `PRECHECK` không được thay đổi bất cứ thứ gì trên VPS (chỉ đọc).
3. `.env` chỉ đi một chiều lên VPS. **Không bao giờ tải ngược về máy user**, không ghi vào
   SQLite, không xuất hiện trong log (che bằng `***` khi in).
4. `version` cấp trong một transaction: `SELECT MAX(version)+1 FROM deployment WHERE app_id=?`.
5. Huỷ giữa chừng = coi như `step-failed` ở bước đang chạy, chạy đúng nhánh lỗi của bước đó.
6. Rollback tự động ở `HEALTHCHECK` phát thêm event `step-start`/`step-done` với step
   `DEPLOY` (để stepper trên UI thể hiện đúng), rồi `finished` với
   `status:'rolled_back'`.

### Log

- `log` event stream **nguyên văn** stdout/stderr, giữ ANSI escape (xterm.js sẽ render màu).
- Không gộp dòng, không trim — gộp làm hỏng progress bar của `docker build`.
- Main giữ **200 dòng cuối mỗi bước** trong bộ nhớ để đưa vào `step-failed.last_log_lines`.
- Toàn bộ log của một deployment ghi ra `~/.deploytool/logs/deploy-<id>.log` để tra lại sau.

---

## 2. Migrate pipeline (M9)

```
PREPARE → FREEZE → BACKUP → TRANSFER → RESTORE → VERIFY → AWAITING_CONFIRM → (completed)
```

| Bước | Việc | Đo gì |
|---|---|---|
| `PREPARE` | Precheck VPS đích, kiểm tra Docker, cấp `host_port` trên đích | |
| `FREEZE` | `docker compose stop app` trên nguồn (postgres vẫn chạy) | **Bắt đầu đếm downtime** |
| `BACKUP` | `pg_dump -Fc` + `tar` thư mục `data/` + `.env`; tính `sha256sum` từng file | `bytes_transferred` |
| `TRANSFER` | `ssh nguồn 'cat f' \| ssh đích 'cat > f'` qua máy user | phát `progress` theo byte |
| `RESTORE` | RENDER→BUILD→DEPLOY của M4 trên đích + `pg_restore` + mount volume | |
| `VERIFY` | sha256 hai phía · `SELECT count(*)` từng bảng · healthcheck đích | phát `verify-result` |
| `AWAITING_CONFIRM` | Chờ người dùng bấm nút | **Dừng đếm downtime** khi healthcheck đích OK |

### Bất biến

1. **VPS nguồn không bị đụng đến cho tới khi người dùng bấm xác nhận.** Kể cả khi mọi thứ
   thành công. Đây là FR-C5 và là điều hội đồng chắc chắn sẽ hỏi.
2. Lỗi ở bất kỳ bước nào → dọn sạch **bên đích** (`compose down -v` trên đích là hợp lệ vì
   dữ liệu ở đó vừa được tạo) → `docker compose start app` bên **nguồn** →
   `status='rolled_back'`.
3. `VERIFY` fail (checksum lệch hoặc count lệch) **không** tự dọn — chuyển sang
   `awaiting_confirm` với cảnh báo đỏ, để người dùng tự quyết. Tự động xoá dữ liệu khi
   nghi ngờ là hành vi nguy hiểm.
4. `downtime_ms` là số liệu đưa vào báo cáo — phải đo bằng đồng hồ VPS nguồn, không phải đồng
   hồ máy user.

> **Ghi chú rà soát 28/07/2026 — đề xuất, chưa thay contract gốc:**
>
> - Câu “VPS nguồn không bị đụng đến” ở bất biến 1 mâu thuẫn với `FREEZE` và `BACKUP`.
>   Ý cần bảo vệ nên được viết chính xác là: **không xoá, không dừng vĩnh viễn và luôn có thể
>   khởi động lại VPS nguồn trước khi người dùng xác nhận**.
> - `docs/01-ke-hoach.md` đang nói mọi lỗi đều rollback, còn bất biến 3 ở đây giữ dữ liệu đích
>   khi `VERIFY` fail. Đề xuất an toàn: `VERIFY` fail thì giữ dữ liệu đích để điều tra nhưng
>   dừng app đích, khởi động lại app nguồn ngay, giữ trạng thái `awaiting_confirm` kèm cảnh báo
>   đỏ; người dùng có thể retry verify hoặc abort để dọn đích. Không cho “xác nhận thành công”
>   khi kiểm tra toàn vẹn vẫn fail.

---

## 3. Quy ước chung cho cả hai pipeline

- Mỗi pipeline là **một máy trạng thái chạy trong main process**, có `AbortSignal` để huỷ.
- Không cho phép 2 pipeline chạy đồng thời **trên cùng một app** (khoá theo `app_id`).
- Cho phép chạy song song trên các app khác nhau (thí nghiệm cần 2 VPS chạy cùng lúc).
- Mọi bước có timeout riêng; hết timeout = `step-failed` với `code:'SSH_TIMEOUT'`:
  `PRECHECK` 30s · `UPLOAD` 10 phút · `RENDER` 30s · `BUILD` 15 phút ·
  `DEPLOY` 3 phút · `HEALTHCHECK` 60s · `TRANSFER` 30 phút.
- Mọi chuyển bước ghi một dòng `action_log`.
