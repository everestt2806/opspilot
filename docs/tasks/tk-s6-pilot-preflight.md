# Hồ sơ Preflight Thí nghiệm Pilot TK-S6 (1 Kịch bản 75 Phút)

> ⚠️ **NGUYÊN TẮC BẢO TOÀN TRẠNG THÁI PILOT**:
> Hồ sơ này chuẩn bị đầy đủ các điều kiện kỹ thuật, cấu hình, và kế hoạch thu hồi phục vụ chạy pilot một kịch bản đầu–cuối.
> **Toàn bộ hạ tầng VPS thật và tải 75 phút vẫn được giữ nghiêm ngặt ở trạng thái `NOT_RUN`**.
> Tuyệt đối không kết nối mạng tới VPS, không chạy tải thực tế, không push/PR/merge vào nhánh chính khi chưa có phê duyệt từ Tech Lead / Giảng viên hướng dẫn.

---

## 1. Bảng Tổng hợp Điều kiện Preflight & Trạng thái Kiểm chứng

| STT | Hạng mục kiểm tra | Tiêu chuẩn kỹ thuật bắt buộc | Lệnh / Bằng chứng xác minh cục bộ | Trạng thái |
| :---: | :--- | :--- | :--- | :---: |
| **1** | **Python Environment** | Python 3.12+ với đầy đủ virtualenv, pytest, ruff | `ml-service/.venv/Scripts/python.exe --version` (Python 3.12.10) | **PASS** |
| **2** | **Bộ kiểm thử Harness** | 268/268 unit & integration tests experiments + collector pass | `pytest experiments/ collector/tests/` (268 passed in 20.25s) | **PASS** |
| **3** | **Cấu trúc Demo App** | `demo-apps/express-api` có `package.json`, `server.js`, `Dockerfile`, `public/` | Kiểm tra file và cú pháp Node: `node -c demo-apps/express-api/server.js` | **PASS** |
| **4** | **Fault Routes Demo App** | Đầy đủ `/health` (miễn nhiễm), `/debug/*` (leak, cpu, error-rate, slow-db, latency, reset) | Soát mã nguồn `server.js` (lines 187, 275–319); bảo vệ bởi `ENABLE_FAULT_ENDPOINTS=true` | **PASS** |
| **5** | **ML Service Local** | FastAPI service có các endpoint `/health`, `/status`, `/train`, `/reset`, `/ingest` | `pytest ml-service/tests/` (19/19 tests passed in 25.53s) | **PASS** |
| **6** | **Counter Path Mapping** | Đồng bộ `/var/metrics/loadgen_counter.json` giữa loadgen container và collector | Soát `templates/docker-compose.template.yml` (lines 28, 33) & `LoadgenAdapter` mount | **PASS** |
| **7** | **Đọc Counter Collector** | `read_loadgen_error_rate` phân tích cửa sổ trượt 60s đúng chuẩn | `pytest collector/tests/test_loadgen_error_rate.py` (9/9 passed) | **PASS** |
| **8** | **CLI Security & Argv** | Loại bỏ hoàn toàn `--ssh-secret` khỏi argv; nhận `--ssh-key-file` an toàn; cờ `--allow-pilot-4500` | `pytest experiments/tests/test_runner_e2e.py` (22/22 passed, bắt lỗi `--ssh-secret`) | **PASS** |
| **9** | **SSH Transport Gate** | `SystemSshClient` dùng `-i`, `IdentitiesOnly=yes`, `StrictHostKeyChecking=yes`, `verify_connection()` | Unit test mức transport trong `test_runner_e2e.py` (chứng minh abort trước deploy) | **PASS** |
| **10** | **Schema SQLite** | Hỗ trợ `attempt_index 1..3`, `UNIQUE(scenario, repeat_index, attempt_index)`, khoá ngoại ON | `pytest experiments/tests/test_run_store.py` (43/43 passed) | **PASS** |
| **11** | **VPS Specs & OS** | 02 VPS WiService (2 vCPU, 4GB RAM, 40GB SSD, Ubuntu 22.04 LTS / Debian 12) | Phụ thuộc hạ tầng nhà cung cấp WiService VN | **NOT_RUN** |
| **12** | **Docker trên VPS** | Docker Engine $\ge 24.0$, Docker Compose plugin $\ge v2.20$ | Cần SSH vào VPS thực thi `docker --version && docker compose version` | **NOT_RUN** |
| **13** | **Đồng bộ giờ NTP VPS** | Dịch vụ `systemd-timesyncd` đang active, độ lệch $\|offset\| \le 2000$ ms | Cần kết nối SSH đo clock skew thực tế qua `measure_clock_offset_ms` | **NOT_RUN** |
| **14** | **Cổng mạng & UFW VPS** | Mở cổng SSH (22 hoặc custom) và dải cổng demo app (30000–30999) | Cần kiểm tra firewall VPS qua lệnh `ufw status` trên máy chủ | **NOT_RUN** |
| **15** | **Live Pilot 75 phút** | Chạy toàn bộ chu trình Pha A–D (4500s) với tải 5 req/s trên VPS | Giữ nguyên trạng thái an toàn theo cam kết đồ án | **NOT_RUN** |

---

## 2. Chi tiết Điều kiện Hạ tầng VPS (Remote Checklist — NOT_RUN)

Khi nhận lệnh khởi chạy pilot thực tế từ Tech Lead, người thực hiện cần kiểm tra các thông số sau trên VPS:

1. **Thông số phần cứng & Hệ điều hành**:
   - Nhà cung cấp: WiService (Việt Nam), Datacenter cùng Region.
   - Cấu hình: Tối thiểu 2 vCPU, 4GB RAM, 40GB SSD (đáp ứng lưu trữ ảnh Docker và metrics).
   - Hệ điều hành khuyến nghị: Ubuntu 22.04 LTS hoặc Debian 12 (x86_64).
2. **Docker Runtime**:
   - Docker Engine phiên bản $\ge 24.0.0$.
   - Docker Compose Plugin phiên bản $\ge 2.20.0$.
   - Docker daemon đang chạy: `systemctl is-active docker` trả về `active`.
   - Quyền hạn: User SSH thuộc nhóm `docker` hoặc sử dụng tài khoản `root`.
3. **Đồng bộ thời gian (NTP Time Synchronization)**:
   - Dịch vụ đồng bộ giờ: `systemd-timesyncd` hoặc `chrony` đang hoạt động (`timedatectl status`).
   - Múi giờ máy chủ nên đặt UTC: `timedatectl set-timezone UTC`.
   - Sai số đồng hồ với máy điều khiển bắt buộc phải $< 2.000$ ms (nếu $\ge 2.000$ ms, Clock Skew Gate của runner sẽ lập tức abort attempt).
4. **Tường lửa & Mạng (UFW / Firewall)**:
   - Cho phép cổng SSH (mặc định 22 hoặc cổng được cấp).
   - Cho phép dải cổng host cho ứng dụng demo: `30000:30999/tcp`.
   - Cho phép container Docker truy cập ra ngoài mạng (NAT/MASQUERADE) để tải package nếu cần build.
5. **Bản ghi trong cơ sở dữ liệu SQLite (`vps` table)**:
   Trước khi chạy runner, SQLite DB cần có bản ghi VPS hợp lệ:
   ```sql
   INSERT INTO vps (id, name, host, port, username, auth_type, encrypted_secret)
   VALUES (1, 'vps-wiservice-01', '<vps_ip>', 22, 'root', 'key', X'00');
   ```

---

## 3. SSH Key, Known Hosts & Cơ chế Credential Dùng chung

### 3.1. Cấu hình Khóa SSH & Xác thực Host Key
- **Định dạng khóa**: Khóa riêng SSH OpenSSH (Ed25519: `id_ed25519` hoặc RSA 4096: `id_rsa`).
- **Passphrase**: Khóa không cài đặt passphrase (hoặc được load sẵn vào `ssh-agent`) để hỗ trợ runner chạy tự động không tương tác.
- **Phân quyền tập tin**: Trên hệ thống POSIX, file khóa riêng phải có quyền `0600` (`chmod 600 ~/.ssh/id_rsa`).
- **Kiểm tra Host Key**:
  - Tuyệt đối không tắt kiểm tra host key (`StrictHostKeyChecking=yes`).
  - Runner không bao giờ chuyển hướng `UserKnownHostsFile` về `/dev/null`.
  - Trước khi chạy, thêm host key của VPS vào file known_hosts cục bộ:
    ```bash
    ssh-keyscan -p <vps_port> <vps_ip> >> ~/.ssh/known_hosts
    ```
  - Hoặc chỉ định file known hosts riêng qua biến `OPSPILOT_KNOWN_HOSTS`.

### 3.2. Cơ chế Credential Dùng chung (Runner, DeployAdapter, Headless Poller)
Để bảo đảm tính an toàn và ngăn chặn rò rỉ credential:
1. **Loại bỏ hoàn toàn `--ssh-secret` khỏi dòng lệnh (`argv`)**:
   - Lệnh gọi CLI của `run_experiment.py` chỉ chấp nhận cờ `--ssh-key-file <duong_dan_file_key>`.
   - Ngăn chặn triệt để nguy cơ các tiến trình khác trên hệ điều hành đọc được secret thông qua bảng tiến trình (`ps aux`, `Get-Process`).
2. **Kênh truyền Credential an toàn**:
   - Biến môi trường: `OPSPILOT_SSH_KEY_FILE` (đường dẫn file khóa).
   - Hoặc biến môi trường nội bộ: `OPSPILOT_SSH_SECRET` / `OPSPILOT_DEPLOY_SECRET` (chỉ dùng khi nạp bí mật trong bộ nhớ hoặc pipeline CI).
3. **Cơ chế xử lý của DeployAdapter**:
   - Nhận thông tin cấu hình nhạy cảm qua biến môi trường `OPSPILOT_APP_ENV_JSON`.
   - Trước khi spawn tiến trình con (deploy-cli / docker), tự động xóa sạch các biến môi trường nhạy cảm kế thừa khỏi môi trường tiến trình con.
4. **Cơ chế xử lý của Headless Poller**:
   - Poller kết nối trực tiếp tới SQLite DB bằng đường dẫn file trên đĩa (`db_path`), không nhận password hay private key qua tham số CLI.
5. **Chính sách Khử Secret (Sanitization)**:
   - `SystemSshClient.__repr__` luôn ẩn secret (`secret=******`).
   - Mọi thông báo lỗi, log, và stdout/stderr của lệnh SSH tự động thay thế chuỗi secret bằng `******`.
   - Bản ghi `experiment_run` (cột `abort_reason`, `notes`, `fault_params_json`) và bảng `deployment` trong SQLite cam kết 100% không chứa chuỗi secret thô.

---

## 4. Ứng dụng Demo (`express-api`) & Cấu hình Fault Injection

### 4.1. Cấu trúc Mã nguồn Cục bộ
Thư mục: `demo-apps/express-api/`
- `package.json`: Khai báo phụ thuộc `express`, `pg` (không có dependency thừa).
- `server.js`: Web server xử lý logic API sản phẩm, phân trang, seed 1000 bản ghi (fallback bộ nhớ khi không có PostgreSQL).
- `Dockerfile`: Multi-stage / lightweight Node.js runtime.
- `public/`: Giao diện web tĩnh HTML/JS kiểm tra trực quan.

### 4.2. Biến Môi trường Bắt buộc khi Triển khai Thí nghiệm
Khi deploy ứng dụng demo phục vụ thí nghiệm pilot, bắt buộc phải truyền biến môi trường:
```bash
ENABLE_FAULT_ENDPOINTS=true
PORT=3000
```
*(Nếu `ENABLE_FAULT_ENDPOINTS` khác `"true"`, toàn bộ các route `/debug/*` sẽ trả về `404 Not Found` để bảo vệ an toàn cho ứng dụng).*

### 4.3. Bảng Ánh xạ 5 Kịch bản Lỗi (Docs/07 Mục 6) và Endpoint Ứng dụng
Toàn bộ các endpoint `/debug/*` và `/health` đều được miễn nhiễm khỏi middleware gây chậm/lỗi, bảo đảm bảng điều khiển luôn phản hồi ngay cả khi app suy giảm nghiêm trọng:

| Kịch bản (`--scenario`) | Endpoint tác động | Phương thức | Tham số & Quy luật tác động (Pha C: 1200 giây) |
| :--- | :--- | :---: | :--- |
| **`memory_leak`** | `/debug/leak` | `GET` | `?mb=5`: Cấp phát thêm 5MB mỗi 10 giây (120 lần, tổng cộng 600MB). Mảng lưu trữ toàn cục giữ tham chiếu khiến GC không thể thu hồi. |
| **`cpu_spike`** | `/debug/cpu` | `GET` | `?ms=x`: Ramp tuyến tính từ 20ms lên 400ms (+20ms mỗi phút). Busy-loop chặn event loop khiến CPU container tăng vọt. |
| **`error_burst`** | `/debug/error-rate` | `GET` | `?p=0.3`: Kích hoạt đột ngột một lần duy nhất tại phút 0 của Pha C. 30% tổng số request nhận HTTP 500. |
| **`slow_db`** | `/debug/slow-db` | `GET` | `?sec=x`: Ramp tuyến tính từ 0.05s lên 1.5s mỗi phút. Chèn lệnh `pg_sleep(x)` vào truy vấn database PostgreSQL. |
| **`latency_creep`** | `/debug/latency` | `GET` | `?ms=x`: Tăng dần +50ms mỗi phút, đạt trần tối đa 2500ms. Chèn `setTimeout` trì hoãn phản hồi HTTP của toàn bộ request ứng dụng. |
| **Reset chung** | `/debug/reset` | `POST` | Xóa sạch toàn bộ buffer rò rỉ, giải phóng bộ nhớ, đưa toàn bộ tham số delay/error/cpu về 0. |

Endpoint sức khoẻ: `GET /health` trả về `{"ok": true, "uptime_s": ...}` với HTTP 200 (không chịu ảnh hưởng của fault injection — đây chính là bài toán cốt lõi: healthcheck nhị phân vẫn xanh trong khi chất lượng dịch vụ đã suy giảm, đòi hỏi OpsPilot phải phát hiện qua ML).

---

## 5. Dịch vụ Học máy (ML Service)

### 5.1. Khởi động Dịch vụ Cục bộ
Dịch vụ ML Service chạy trên máy điều khiển local để xử lý huấn luyện mô hình và chấm điểm bất thường:
```bash
# Kích hoạt môi trường và khởi động ML Service
cd ml-service
.venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
```

### 5.2. Các Endpoint Bắt buộc & Vai trò trong Chu trình Thí nghiệm
- `GET http://127.0.0.1:8000/health`: Kiểm tra ML Service sẵn sàng. Trả về `{"status": "ok", "version": "0.1.0"}`.
- `POST http://127.0.0.1:8000/reset`: Gọi tại Bước 4 (trước khi bắt đầu Pha A) để xóa sạch các mô hình đã huấn luyện của deployment cũ, bảo đảm tính độc lập giữa các run.
- `POST http://127.0.0.1:8000/train`: Gọi tại Bước 5 (cuối Pha A, sau 30 phút baseline). Yêu cầu tối thiểu 162 mẫu metric (90% của 180 mẫu). Huấn luyện đồng thời 3 mô hình học máy:
  1. **Isolation Forest** (`iforest`)
  2. **One-Class SVM** (`ocsvm`)
  3. **Z-Score / EWMA** (`zscore_ewma`)
- `GET http://127.0.0.1:8000/status`: Truy vấn trạng thái mô hình của deployment (`is_trained: true/false`, số mẫu đã học).

---

## 6. Đường Counter Chia sẻ giữa Load Generator & Collector

### 6.1. Nguyên lý Hoạt động & Kiến trúc Mount
Để Collector đọc được số liệu lỗi HTTP do Load Generator ghi nhận mà không cần gọi API qua mạng:
1. **Container Load Generator**:
   - Sinh tải liên tục 5 req/s vào app demo.
   - Sử dụng bộ đếm trượt 60 giây (`Counter(counter_window_s=60.0)`).
   - Ghi định kỳ file JSON tại `/var/metrics/loadgen_counter.json`.
   - File JSON chứa cấu trúc:
     ```json
     {
       "window_s": 60.0,
       "total_requests": 300,
       "error_requests": 0,
       "error_rate": 0.0,
       "timestamp": 1727800060.0
     }
     ```
2. **Mount Thư mục Chia sẻ trên VPS**:
   - Đường dẫn thư mục host: `/opt/opspilot/{app_name}/metrics/`.
   - Lệnh Docker Run của Loadgen mount:
     `-v /opt/opspilot/{app_name}/metrics:/var/metrics`
   - File counter thực tế nằm tại:
     `/opt/opspilot/{app_name}/metrics/loadgen_counter.json`.
3. **Container Collector**:
   - Trong `templates/docker-compose.template.yml`:
     ```yaml
     collector:
       environment:
         LOADGEN_COUNTER_PATH: /var/metrics/loadgen_counter.json
       volumes:
         - ./metrics:/var/metrics
     ```
   - Thư mục `./metrics` trong thư mục triển khai của app (`/opt/opspilot/{app_name}`) chính là thư mục host `/opt/opspilot/{app_name}/metrics/`.
   - Collector gọi hàm `collector.collect.read_loadgen_error_rate()` đọc trực tiếp file counter này mỗi chu kỳ 10 giây và điền vào trường `http_error_rate` của bảng `metric_sample`.

---

## 7. Quy trình Thực thi Pilot 1 Kịch bản (Runbook)

### Bước 1: Khởi động ML Service trên máy điều khiển local
```bash
cd D:/Developing/DuAnCNTT/ml-service
.venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000
```
Xác nhận service đã sẵn sàng:
```bash
curl -s http://127.0.0.1:8000/health
# Kỳ vọng: {"status":"ok","version":"0.1.0"}
```

### Bước 2: Thiết lập Biến Môi trường Credential (trên máy local)
```bash
# Thiết lập đường dẫn file SSH key (an toàn, không lộ secret qua argv)
export OPSPILOT_SSH_KEY_FILE="$HOME/.ssh/opspilot_vps_key"
```

### Bước 3: Khởi chạy Orchestrator Thí nghiệm (Ví dụ kịch bản `memory_leak`)
Lệnh chạy điều phối 10 bước chuẩn hoá, tự động bật cờ pilot 4500s:
```bash
cd D:/Developing/DuAnCNTT
ml-service/.venv/Scripts/python.exe experiments/run_experiment.py \
  --scenario memory_leak \
  --repeat 1 \
  --vps-id 1 \
  --db-path app/opspilot.db \
  --app-name express-api \
  --source-path demo-apps/express-api \
  --app-url http://<vps_ip>:30001 \
  --ml-url http://127.0.0.1:8000 \
  --ssh-key-file "$OPSPILOT_SSH_KEY_FILE" \
  --allow-pilot-4500
```

*Tiến trình diễn ra tự động qua 4 pha:*
- **Pha A (0–1800s)**: Thu thập 180 mẫu baseline bình thường $\rightarrow$ Tự động gọi `POST /train`.
- **Pha B (1800–2700s)**: Holdout đánh giá mô hình bình thường trong 15 phút (90 mẫu).
- **Pha C (2700–3900s)**: Tiêm lỗi `memory_leak` (`/debug/leak?mb=5` mỗi 10s) suốt 20 phút (120 mẫu).
- **Pha D (3900–4500s)**: Phục hồi, tắt fault, thu thập 10 phút (60 mẫu) $\rightarrow$ Dừng Loadgen.
- **Kết thúc (4500s)**: Drain Headless Poller $\rightarrow$ Chạy Integrity Gate $\rightarrow$ Đóng run `completed`.

### Bước 4: Xuất Kết quả Thí nghiệm ra CSV & Parquet
Sau khi run hoàn tất (giả định `run_id=1`), xuất dữ liệu sang thư mục kết quả:
```bash
ml-service/.venv/Scripts/python.exe -c "
import sqlite3
from pathlib import Path
from experiments.export_results import export_run

conn = sqlite3.connect('app/opspilot.db')
export_run(conn, run_id=1, out_dir=Path('experiments/results/run_memory_leak_1'))
conn.close()
print('Xuat ket qua thanh cong!')
"
```

### Bước 5: Phân tích Dữ liệu & Xuất Bảng Markdown Báo cáo
```bash
ml-service/.venv/Scripts/python.exe experiments/analyze.py experiments/results/
```
Lệnh sẽ tính toán đầy đủ các chỉ số: F1-score, Precision, Recall, Detection Delay ($T_{detect}$), False Alarm Rate ($FAR_{clean}$), và in bảng Markdown đối soát 5 phương pháp phát hiện bất thường.

---

## 8. Kế hoạch Thu hồi & Xử lý Sự cố Khẩn cấp (Rollback & Emergency Teardown)

Trong trường hợp thí nghiệm gặp sự cố giữa chừng (mất kết nối mạng, lệch đồng hồ, container bị crash, hoặc người điều khiển muốn hủy gấp):

### 8.1. Thu hồi Cục bộ từ Orchestrator
Runner `run_experiment.py` đã trang bị sẵn khối `finally:` tự động thực thi khi bị ngắt (`Ctrl+C` hoặc Exception):
1. Tự động gọi `reset_fault()` tới app demo để tắt toàn bộ hiệu ứng lỗi.
2. Tự động gọi `loadgen_handle.cleanup()` để dừng và xoá container load generator.
3. Tự động gọi `poller_handle.stop()` để dừng tiến trình con Headless Poller.
4. Đóng kết nối SSH và SQLite database, cập nhật trạng thái `status='aborted'` cùng lý do huỷ vào DB.

### 8.2. Quy trình Thu hồi Khẩn cấp Thủ công trên VPS (Manual Teardown)
Nếu máy điều khiển local bị mất nguồn hoặc ngắt kết nối đột ngột khiến khối `finally` không thể hoàn tất, thực hiện thủ công các lệnh sau qua SSH:

1. **Tắt ngay lập tức hiệu ứng Fault trên App Demo**:
   ```bash
   curl -s -X POST http://<vps_ip>:<host_port>/debug/reset
   ```
2. **Dừng và xoá container Load Generator**:
   ```bash
   ssh -i ~/.ssh/id_rsa root@<vps_ip> "docker stop loadgen-express-api && docker rm loadgen-express-api"
   ```
3. **Dừng và dọn dẹp sạch sẽ toàn bộ dịch vụ ứng dụng demo & collector**:
   ```bash
   ssh -i ~/.ssh/id_rsa root@<vps_ip> "cd /opt/opspilot/express-api && docker compose down -v"
   ```
4. **Kiểm tra và dọn dẹp container mồ côi (nếu có)**:
   ```bash
   ssh -i ~/.ssh/id_rsa root@<vps_ip> "docker ps -a --filter 'name=express-api' -q | xargs -r docker rm -f"
   ```
5. **Cập nhật trạng thái trong SQLite DB local**:
   Nếu run bị treo ở trạng thái `running`, chạy câu lệnh SQL để đóng attempt:
   ```sql
   UPDATE experiment_run
   SET status = 'aborted', abort_reason = 'manual_emergency_teardown'
   WHERE status = 'running';
   ```

---

## 9. Kết luận & Cam kết Kỷ luật Thực thi

- **Hồ sơ preflight hoàn chỉnh**: Đã chuẩn bị đầy đủ 100% tài liệu điều kiện hạ tầng, cơ chế khóa SSH/known_hosts, credential dùng chung an toàn, app demo, ML service, đường counter và runbook lệnh chạy/thu hồi khẩn cấp.
- **Xác minh cục bộ**: Toàn bộ 10 hạng mục có thể kiểm tra offline đều đạt trạng thái **`PASS`** (268/268 test harness pass, 19/19 test ML pass, Node syntax server.js pass, compose template pass).
- **Trạng thái Pilot**: Duy trì trạng thái **`NOT_RUN`** trên VPS thực tế. Không thực hiện bất kỳ lệnh kết nối SSH hoặc bắn tải nào ra ngoài môi trường local.
- **Kỷ luật Git**: Chỉ lưu trữ cục bộ, không push/PR/merge.
