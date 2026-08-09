# M05 — Metric collector · Người B · Tuần 1–2

`collector/collect.py` + `collector/Dockerfile` — FR-D1

## Mục tiêu
Một script Python ~150 dòng chạy trong container Alpine trên VPS, đo 8 chỉ số của ứng dụng
mỗi 10 giây và **append** vào một file JSONL. Không Prometheus, không cAdvisor (ADR-003).

**Đây là nguồn của toàn bộ dữ liệu thí nghiệm.** Collector chết = mất dữ liệu không tái tạo được.

## Đọc trước
- **`docs/contracts/metric-format.md`** — format từng trường, đường dẫn, biến môi trường
- `docs/14-quyet-dinh-kien-truc.md` ADR-003, ADR-007

## Vòng lặp mỗi `COLLECT_INTERVAL_S` giây (mặc định 10)

1. **Container stats** — `docker stats --no-stream --format '{{json .}}' <APP_CONTAINER_NAME>`
   qua `subprocess` (mount `/var/run/docker.sock:ro`). Parse `CPUPerc`, `MemUsage`, `MemPerc`
   → `cpu_pct`, `mem_mb`, `mem_pct`, `mem_limit_mb`.
   **Không dùng SDK `docker`** — kéo theo quá nhiều phụ thuộc, image phải nhỏ.
2. **HTTP probe** — `GET $APP_URL`, timeout `PROBE_TIMEOUT_S` (5s).
   - `latency_ms` = thời gian phản hồi. Timeout/lỗi kết nối → `latency_ms = null`, `container_up = 0`
   - Đẩy `(timestamp, status_code)` vào deque; `http_error_rate` = tỷ lệ mã 5xx trong cửa sổ
     trượt `ERROR_WINDOW_S` (60s). Cửa sổ rỗng → `null`
3. **DB probe** — nếu `DB_DSN` khác rỗng: `SELECT 1` bằng `psycopg2`, đo thời gian →
   `db_response_ms`. Lỗi → `null`. `DB_DSN` rỗng → luôn `null`.
   Giữ **một** kết nối, mở lại khi hỏng — không mở kết nối mới mỗi vòng.
4. **Host** — `/proc/loadavg` chia số core → `host_cpu_pct`; `/proc/meminfo` → `host_mem_pct`.
5. **Ghi**:
   - append một dòng JSON + `\n` vào `$METRICS_DIR/metrics.jsonl`, rồi `f.flush()` +
     `os.fsync(f.fileno())` — poller đọc song song qua SSH, **không được thấy dòng viết dở**
   - ghi `latest.json` bằng cách ghi file tạm rồi `os.replace()` (đổi tên nguyên tử)

## Quy tắc sống còn

1. **Collector không bao giờ được chết.** Mọi lời gọi bọc `try/except`; lỗi → trường tương ứng
   `null`, in cảnh báo, **tiếp tục vòng lặp**. Không `raise` ra ngoài vòng lặp chính.
2. **`null` ≠ `0`.** Không đo được thì `null`. Ghi `0` cho `latency_ms` là bug.
3. **`seq` tăng đúng 1 mỗi dòng, không bao giờ reset.** Lúc khởi động: đọc dòng cuối của
   `metrics.jsonl` (nếu có) lấy `seq` rồi tiếp tục từ đó. Restart collector giữa chừng mà
   `seq` nhảy về 1 sẽ làm `UNIQUE(deployment_id, seq)` bên poller từ chối dữ liệu mới.
4. **Chu kỳ ổn định:** ngủ `interval - thời_gian_đã_dùng` (không phải ngủ đủ `interval`), để
   khoảng cách giữa các mẫu đều — chuỗi thời gian đều là điều kiện cho EWMA và slope đúng.
5. **Xoay vòng file** khi `metrics.jsonl > MAX_FILE_MB` (50MB): đổi tên thành `.1`, tạo file
   mới, **`seq` không reset**.
6. `ts` lấy bằng `datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')` — luôn UTC, luôn có `Z`.
7. Nhận `SIGTERM` → ghi nốt dòng đang xử lý rồi thoát sạch.

## Dockerfile

`python:3.12-alpine`, cài `requests` + `psycopg2-binary` + `docker-cli` (chỉ CLI, không daemon).
Image mục tiêu **< 80MB**. Chạy `python -u collect.py` (unbuffered để `docker logs` thấy ngay).

Trong compose: `mem_limit: 128m`, `restart: unless-stopped`,
mount `/var/run/docker.sock:/var/run/docker.sock:ro` và `./metrics:/var/metrics`.

## Test độc lập (không cần Electron, không cần tool)

1. Chạy local bằng Docker Desktop với một container nginx đóng vai app:
   ```
   docker run -d --name testapp -p 8080:80 nginx
   docker run --rm -v /var/run/docker.sock:/var/run/docker.sock:ro \
     -v $PWD/metrics:/var/metrics \
     -e APP_CONTAINER_NAME=testapp -e APP_URL=http://host.docker.internal:8080/ \
     collector:dev
   ```
2. Kiểm tra sau 2 phút: `metrics.jsonl` có ~12 dòng · `seq` liên tục · mọi trường đúng kiểu ·
   `ts` cách nhau đúng 10 giây ±1
3. `docker stop testapp` → các dòng tiếp theo có `container_up: 0`, `latency_ms: null`,
   **collector vẫn sống**
4. Restart collector → `seq` tiếp tục từ số cũ, không quay về 1
5. Sửa `DB_DSN` thành DSN sai → `db_response_ms: null`, không crash

## Định nghĩa xong
- [ ] 5 bước test trên đều đúng
- [ ] Chạy liên tục **2 giờ** trên VPS thật, không chết, không thủng `seq`
- [ ] Image < 80MB
- [ ] RAM container < 50MB sau 2 giờ
- [ ] Một dòng JSON đúng **từng trường** so với `docs/contracts/metric-format.md` (so bằng mắt,
      cẩn thận với `_pct` là 0–100 còn `http_error_rate` là 0–1)
