# HỢP ĐỒNG: Format metric & bố trí file trên VPS

Người B viết `collector/collect.py` theo file này. Người A viết `monitor/poller.ts` theo file
này. Hai bên **không được** thoả thuận miệng thứ gì ngoài đây.

---

## 1. Bố trí thư mục trên VPS

```
/opt/deploytool/
└── <app_name>/                       app_name khớp cột app.name, slug [a-z0-9-]
    ├── src/                          source đã upload (M4 bước UPLOAD)
    ├── Dockerfile                    sinh từ templates/ (bước RENDER)
    ├── docker-compose.yml            sinh từ template (bước RENDER)
    ├── .env                          secret, chmod 600, KHÔNG BAO GIỜ tải ngược về máy user
    ├── metrics/                      bind mount vào collector, chmod 755
    │   ├── metrics.jsonl             ★ NGUỒN DỮ LIỆU CHÍNH THỨC (append-only)
    │   ├── metrics.jsonl.1           file đã xoay vòng (khi > 50MB)
    │   └── latest.json               ghi đè mỗi vòng, CHỈ để xem nhanh/debug
    └── data/                         volume persistent của app + postgres (migrate sẽ tar cái này)
```

Quy tắc: **mọi đường dẫn phía VPS ghép bằng `path.posix.join`**, không dùng `path.join` của
Node trên Windows (sẽ ra dấu `\`).

---

## 2. `metrics.jsonl` — nguồn dữ liệu chính thức

- **Append-only**, mỗi dòng là một JSON object hoàn chỉnh, kết thúc bằng `\n`.
- Collector ghi **một dòng mỗi `COLLECT_INTERVAL_S` giây (mặc định 10)**.
- Ghi bằng `open(path,'a')` + `f.flush()` + `os.fsync()` mỗi dòng — poller đọc song song
  qua SSH, không được thấy dòng viết dở.
- Dòng luôn ≤ 4KB. Không xuống dòng bên trong object.

### Format một dòng (mọi trường luôn có mặt; không đo được thì `null`)

```json
{"seq":1042,"ts":"2026-10-06T14:32:10Z","cpu_pct":12.34,"mem_mb":210.5,"mem_pct":20.1,"mem_limit_mb":1024.0,"latency_ms":45.2,"http_error_rate":0.0,"db_response_ms":3.1,"container_up":1,"host_cpu_pct":18.7,"host_mem_pct":42.0,"collector_version":"1.0.0"}
```

| Trường | Kiểu | Đơn vị / miền giá trị | Ghi chú |
|---|---|---|---|
| `seq` | int | ≥1, tăng đúng 1 mỗi dòng | **Không reset khi xoay vòng file, không reset khi restart collector** — đọc lại từ dòng cuối của file hiện có lúc khởi động |
| `ts` | string | ISO-8601 UTC, giây | **Đồng hồ VPS.** Luôn có `Z` ở cuối |
| `cpu_pct` | float\|null | 0–100 (có thể >100 nếu nhiều core) | từ `docker stats` |
| `mem_mb` | float\|null | MB | từ `docker stats` |
| `mem_pct` | float\|null | 0–100 | `mem_mb / mem_limit_mb * 100` |
| `mem_limit_mb` | float\|null | MB | giới hạn container, cố định trong compose |
| `latency_ms` | float\|null | ms | thời gian probe HTTP. `null` khi timeout/lỗi |
| `http_error_rate` | float\|null | **0–1** (không phải %) | tỷ lệ phản hồi 5xx trong cửa sổ trượt **60 giây** |
| `db_response_ms` | float\|null | ms | `SELECT 1`. `null` khi app không có DB |
| `container_up` | int | 0 hoặc 1 | 0 khi container không chạy **hoặc** probe thất bại |
| `host_cpu_pct` | float\|null | 0–100 | từ `/proc/loadavg` chia số core |
| `host_mem_pct` | float\|null | 0–100 | từ `/proc/meminfo` |
| `collector_version` | string | semver | tăng khi đổi ý nghĩa trường — `analyze.py` kiểm tra để không trộn nhầm dữ liệu |

**Bất biến quan trọng:** `null` ≠ `0`. `latency_ms: null` nghĩa là *không đo được*;
`latency_ms: 0` là vô lý và bị coi là bug. ML service điền giá trị hợp lệ gần nhất cho `null`
và ghi lại trong `detail_json`.

---

## 3. `latest.json`

Nội dung **giống hệt một dòng** của `metrics.jsonl`, ghi đè mỗi vòng bằng cách ghi ra file
tạm rồi `os.replace()` (đổi tên nguyên tử — tránh đọc phải file rỗng).
Poller **không dùng** file này; nó chỉ phục vụ debug tay: `ssh vps cat .../latest.json`.

---

## 4. Cách poller đọc (M6)

```
offset = app.metrics_offset          -- byte, 1-based, mặc định 1
tail -c +<offset> /opt/deploytool/<app>/metrics/metrics.jsonl
```

1. Cắt phần trả về theo `\n`. **Dòng cuối không kết thúc bằng `\n` là dòng viết dở → bỏ,
   không cộng vào offset.**
2. Với mỗi dòng hoàn chỉnh: parse JSON → insert `metric_sample`
   (`UNIQUE(deployment_id, seq)` tự chống trùng khi retry).
3. Cộng offset đúng **số byte của các dòng đã xử lý trọn vẹn**, ghi lại `app.metrics_offset`.
4. Gửi sang ML service `POST /ingest` **theo đúng thứ tự `seq` tăng dần** — sai thứ tự làm
   hỏng cửa sổ trượt và EWMA.

**Khi file xoay vòng:** `metrics.jsonl` bị thay bằng file mới, kích thước nhỏ hơn offset →
poller phát hiện `tail` trả rỗng trong khi `stat` cho kích thước < offset → reset offset về 1
và ghi `action_log`. `seq` không reset nên không có mẫu nào bị đếm hai lần.

**Khi mất kết nối SSH:** không tạo mẫu giả, không nội suy. Kết nối lại → `tail -c +offset`
tự nạp bù toàn bộ khoảng thiếu. Đây là lý do chọn append-only thay vì ghi đè `latest.json`
(xem ADR-007).

---

## 5. Biến môi trường của container collector

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `COLLECT_INTERVAL_S` | `10` | Chu kỳ ghi một dòng |
| `APP_CONTAINER_NAME` | — | Tên container app để `docker stats` |
| `APP_URL` | — | vd `http://app:3000/health` — probe qua docker network, **không qua internet** |
| `PROBE_TIMEOUT_S` | `5` | Timeout probe HTTP |
| `ERROR_WINDOW_S` | `60` | Cửa sổ tính `http_error_rate` |
| `DB_DSN` | rỗng | DSN postgres; rỗng → `db_response_ms` luôn `null` |
| `METRICS_DIR` | `/var/metrics` | Thư mục ghi (bind mount ra `/opt/deploytool/<app>/metrics`) |
| `MAX_FILE_MB` | `50` | Ngưỡng xoay vòng file |

Container chạy với `--restart unless-stopped`, mount `/var/run/docker.sock:ro`, giới hạn
`mem_limit: 128m`. Collector chết không được làm chết app.

---

## 6. Vì sao probe từ bên trong VPS, không probe từ máy người dùng

Nếu đo `latency_ms` từ laptop qua internet, jitter mạng (10–200ms, thay đổi theo giờ và theo
nhà mạng) sẽ lấn át tín hiệu suy giảm cần phát hiện, và dữ liệu 50 run sẽ không so sánh được
với nhau. Probe từ container collector qua docker network chỉ đo đúng độ trễ của app.
Đây là điểm cần nêu trong chương 5 khi mô tả phương pháp đo.
