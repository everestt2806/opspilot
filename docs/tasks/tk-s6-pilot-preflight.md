# Hồ sơ Preflight Thí nghiệm Pilot TK-S6 (1 Kịch bản 75 Phút)

> ⚠️ **TRẠNG THÁI HIỆN TẠI: NOT_RUN (CỤC BỘ ĐÃ SẴN SÀNG / VPS & PILOT CHƯA CHẠY)**
> - **Mức mã nguồn & kiểm thử cục bộ**: Đã khắc phục hoàn toàn cả 02 Runtime Gaps: **Runtime Gap 1** (P2d-6a: tự động truyền `ENABLE_FAULT_ENDPOINTS=true` khi pilot `express-api`) và **Runtime Gap 2** (P2d-6b: tự động đọc và cấp phát credential từ `--ssh-key-file` sang cả `DeployAdapter` và `PollerAdapter`, override secret môi trường cũ). Toàn bộ 12/12 điều kiện preflight cục bộ đạt PASS (279/279 tests).
> - **NOT_RUN**: Toàn bộ hạ tầng VPS thật (5/5 hạng mục) và bài kiểm tra tải 75 phút được giữ nghiêm ngặt ở trạng thái `NOT_RUN` (không mở kết nối SSH thật, không phát tải thực tế, không đổi trạng thái).
> - **Cam kết Git**: Chỉ lưu trữ cục bộ trên nhánh `feat/deploy-reachability`, tuyệt đối không tự ý push/PR/merge vào nhánh chính khi chưa có phê duyệt từ Tech Lead / Giảng viên hướng dẫn.

---

## 1. Bảng Tổng hợp Điều kiện Preflight & Trạng thái Kiểm chứng

### 1.1. Bảng Đánh giá Điều kiện Kỹ thuật

| STT | Hạng mục kiểm tra | Tiêu chuẩn kỹ thuật bắt buộc | Lệnh / Bằng chứng xác minh cục bộ | Trạng thái |
| :---: | :--- | :--- | :--- | :---: |
| **1** | **Python Environment** | Python 3.12+ với đầy đủ virtualenv, pytest, ruff | `ml-service/.venv/Scripts/python.exe --version` (Python 3.12.10) | **PASS** |
| **2** | **Bộ kiểm thử Harness** | 279/279 unit & integration tests experiments + collector pass | `pytest experiments/ collector/tests/` (279 passed in 50.83s) | **PASS** |
| **3** | **Cấu trúc Demo App** | `demo-apps/express-api` có `package.json`, `server.js`, `Dockerfile`, `public/` | Kiểm tra file và cú pháp Node: `node -c demo-apps/express-api/server.js` | **PASS** |
| **4** | **Fault Routes Demo App** | Đầy đủ `/health` (miễn nhiễm), `/debug/*` (leak, cpu, error-rate, slow-db, latency, reset) | Soát mã nguồn `server.js` (lines 187, 275–319); bảo vệ bởi `ENABLE_FAULT_ENDPOINTS=true` | **PASS** |
| **5** | **ML Service Local** | FastAPI service có các endpoint `/health`, `/status`, `/train`, `/reset`, `/ingest` | `pytest ml-service/tests/` (19/19 tests passed in 25.53s) | **PASS** |
| **6** | **Counter Path Mapping** | Đồng bộ `/var/metrics/loadgen_counter.json` giữa loadgen container và collector | Soát `templates/docker-compose.template.yml` (lines 28, 33) & `LoadgenAdapter` mount | **PASS** |
| **7** | **Đọc Counter Collector** | `read_loadgen_error_rate` phân tích cửa sổ trượt 60s đúng chuẩn | `pytest collector/tests/test_loadgen_error_rate.py` (9/9 passed) | **PASS** |
| **8** | **CLI Security & Argv** | Loại bỏ hoàn toàn `--ssh-secret` khỏi argv; nhận `--ssh-key-file` an toàn; cấp credential tự động cho Deploy/Poller; cờ `--allow-pilot-4500` | `pytest experiments/tests/test_runner_e2e.py` (33/33 passed, bắt lỗi `--ssh-secret`) | **PASS** |
| **9** | **SSH Transport Gate** | `SystemSshClient` dùng `-i`, `IdentitiesOnly=yes`, `StrictHostKeyChecking=yes`, `verify_connection()` | Unit test mức transport trong `test_runner_e2e.py` (chứng minh abort trước deploy) | **PASS** |
| **10** | **Schema SQLite** | Hỗ trợ bảng `experiment_run`, `attempt_index 1..3`, `UNIQUE(scenario, repeat_index, attempt_index)`, khoá ngoại ON | `pytest experiments/tests/test_run_store.py` (43/43 passed) | **PASS** |
| **11** | **VPS Specs & OS** | 02 VPS WiService (2 vCPU, 4GB RAM, 40GB SSD, Ubuntu 22.04 LTS / Debian 12) | Phụ thuộc hạ tầng nhà cung cấp WiService VN | **NOT_RUN** |
| **12** | **Docker trên VPS** | Docker Engine $\ge 24.0$, Docker Compose plugin $\ge v2.20$ | Cần SSH vào VPS thực thi `docker --version && docker compose version` | **NOT_RUN** |
| **13** | **Đồng bộ giờ NTP VPS** | Dịch vụ `systemd-timesyncd` đang active, độ lệch $\|offset\| \le 2000$ ms | Cần kết nối SSH đo clock skew thực tế qua `measure_clock_offset_ms` | **NOT_RUN** |
| **14** | **Cổng mạng & UFW VPS** | Mở cổng SSH (22 hoặc custom) và dải cổng demo app (30000–30999) | Cần kiểm tra firewall VPS qua lệnh `ufw status` trên máy chủ | **NOT_RUN** |
| **15** | **Live Pilot 75 phút** | Chạy toàn bộ chu trình Pha A–D (4500s) với tải 5 req/s trên VPS | Giữ nguyên trạng thái an toàn theo cam kết đồ án | **NOT_RUN** |
| **16** | **Runtime Gap 1: Env App** | Runner truyền `ENABLE_FAULT_ENDPOINTS=true` khi pilot tường minh cho `express-api`, từ chối app khác | Đã giải quyết (P2d-6a): `experiments/run_experiment.py` truyền `env_vars={"ENABLE_FAULT_ENDPOINTS": "true"}` qua `DeployAdapter.deploy()`, kiểm thử 26/26 tests e2e pass | **PASS** |
| **17** | **Runtime Gap 2: Credential** | Cờ `--ssh-key-file` tự động đọc private key và cấp phát đồng bộ cho `DeployAdapter` & `PollerAdapter` | Đã giải quyết (P2d-6b): `experiments/run_experiment.py` đọc key file an toàn, nạp vào `ssh_secret` của cả 2 adapter, override env cũ; 33/33 tests e2e pass | **PASS** |

### 1.2. Chi tiết 02 Khoảng trống Runtime (Runtime Gaps)

1. **Runtime Gap 1 — Biến môi trường `ENABLE_FAULT_ENDPOINTS` khi deploy (ĐÃ KHẮC PHỤC - P2d-6a)**:
   - *Thực trạng trước sửa đổi*: Khi `run_experiment.py` thực hiện Bước 3 gọi `deploy_adapter.deploy()`, adapter này kích hoạt `deploy-cli.ts` để sinh file `.env` và `docker-compose.yml` trên VPS. Trước đây runner không truyền biến môi trường `ENABLE_FAULT_ENDPOINTS=true` vào cấu hình triển khai của ứng dụng.
   - *Hậu quả*: Mã nguồn [`demo-apps/express-api/server.js`](file:///D:/Developing/DuAnCNTT/demo-apps/express-api/server.js) kiểm tra `if (process.env.ENABLE_FAULT_ENDPOINTS !== 'true') return res.status(404)`. Do thiếu biến này, toàn bộ các request tiêm lỗi `/debug/*` trong Pha C sẽ nhận mã HTTP 404, khiến thí nghiệm không thể kích hoạt fault theo đúng kế hoạch.
   - *Giải pháp đã triển khai (P2d-6a)*: Khi chạy pilot tường minh (`allow_pilot_4500=True`) cho `express-api`, `run_attempt` tự động truyền `env_vars={"ENABLE_FAULT_ENDPOINTS": "true"}` vào `DeployAdapter.deploy()`. `DeployAdapter` truyền biến qua `OPSPILOT_APP_ENV_JSON` môi trường (không đưa vào `argv`), và khử secret khỏi log/error. Với các ứng dụng khác (`app_name != "express-api"`), runner dừng trước deploy với lỗi `UnsupportedAppError` (`unsupported_pilot_app`). Nếu chưa bật cờ pilot tường minh, mặc định dừng trước deploy với lỗi `pilot_mode_required`.

2. **Runtime Gap 2 — Cơ chế cấp phát Credential giữa Runner, DeployAdapter và PollerAdapter (ĐÃ KHẮC PHỤC - P2d-6b)**:
   - *Thực trạng trước sửa đổi*: Tham số `--ssh-key-file` trên CLI của `run_experiment.py` chỉ nạp cho `SystemSshClient` của runner. `DeployAdapter` và `PollerAdapter` hoạt động độc lập và lấy SSH secret từ biến môi trường `OPSPILOT_SSH_SECRET` hoặc giải mã bản ghi VPS trong SQLite DB. Do không có cầu nối tự động, việc chỉ truyền `--ssh-key-file` khiến deploy/poller thiếu credential và attempt bị abort ở Bước 3 nếu chưa thiết lập thủ công biến môi trường.
   - *Hậu quả*: Runner có thể SSH thành công vào VPS để kiểm tra đồng hồ, nhưng ngay sau đó tiến trình deploy hoặc poller thất bại vì không có private key tương ứng.
   - *Giải pháp đã triển khai (P2d-6b)*: Khi `--ssh-key-file` được chỉ định (hoặc qua `OPSPILOT_SSH_KEY_FILE`), hàm `read_ssh_key_file` đọc nội dung private key an toàn (tự động kiểm tra file tồn tại, không rỗng, kiểm soát quyền đọc). Key file tường minh này luôn thắng (`override`) mọi secret cũ kế thừa từ biến môi trường (`OPSPILOT_SSH_SECRET` / `OPSPILOT_DEPLOY_SECRET`), và được chuyển qua kênh `ssh_secret` an toàn cho cả `DeployAdapter.deploy()` lẫn `PollerAdapter.start()`. Runner tiếp tục sử dụng key file cho `SystemSshClient`. Nếu file thiếu, rỗng hoặc không đọc được, runner lập tức abort trước deploy với lỗi `SshKeyFileError` (`ssh_key_file_error`) mà không ghi nội dung key vào argv, log, exception hay SQLite. Luồng credential cũ khi không truyền key file vẫn được bảo toàn nguyên vẹn.

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
5. **Cấu hình Bản ghi VPS trong SQLite (`vps` table) với Credential Mã hoá Hợp lệ**:
   - Bảng `vps` sử dụng cơ chế bảo mật khóa mã hoá `aes_256_gcm` ([`app/src/main/crypto/credentials.ts`](file:///D:/Developing/DuAnCNTT/app/src/main/crypto/credentials.ts)). Cột `encrypted_secret` bắt buộc phải là dữ liệu nhị phân (BLOB) được mã hoá bằng master key của OpsPilot, đi kèm giá trị khởi tạo `iv` (12 bytes) và mã xác thực `auth_tag` (16 bytes).
   - **Tuyệt đối không chèn giá trị giả lập như `X'00'`**: Nếu chèn dữ liệu thô hoặc dummy hex, hàm giải mã `loadSecret()` sẽ ném lỗi `SSH_AUTH_FAILED` và dừng toàn bộ tiến trình.
   - **Quy trình chuẩn bị bản ghi**:
     - *Cách 1 (Khuyến nghị)*: Mở giao diện OpsPilot UI, vào mục *Cài đặt (Settings) -> Quản lý VPS* và nhấn *Thêm VPS*. Nhập IP, port, user và private key; hệ thống sẽ tự động gọi `createCredentialCipher()` để mã hoá an toàn vào cơ sở dữ liệu.
     - *Cách 2 (Script)*: Sử dụng hàm mã hoá `AesGcmCredentialCipher.encrypt(secret)` từ master key của ứng dụng để chèn bản ghi với đầy đủ `crypto_scheme='aes_256_gcm'`, `encrypted_secret`, `iv`, và `auth_tag`.

---

## 3. SSH Key, Known Hosts & Cơ chế Credential Dùng chung

### 3.1. Cấu hình Khóa SSH & Xác thực Host Key Bắt buộc (Quy trình Quét Riêng ed25519)
- **Định dạng khóa**: Khóa riêng SSH OpenSSH (Ed25519: `id_ed25519` hoặc RSA 4096: `id_rsa`).
- **Passphrase**: Khóa không cài đặt passphrase (hoặc được load sẵn vào `ssh-agent`) để hỗ trợ runner chạy tự động không tương tác.
- **Phân quyền tập tin**: Trên hệ thống POSIX, file khóa riêng phải có quyền `0600` (`chmod 600 ~/.ssh/id_rsa`). Trên Windows, chỉ cho phép tài khoản người dùng hiện tại có quyền đọc (`icacls`).
- **Quy trình Quét Riêng ed25519, Đối soát Fingerprint & Ghi Nhận An toàn**:
  - `StrictHostKeyChecking=yes` luôn được bật; runner không bao giờ chuyển hướng `UserKnownHostsFile` về `/dev/null`.
  - **Chống MITM bằng cơ chế 1 lần quét riêng biệt**: Quét riêng loại khóa `ed25519` bằng cờ `-t ed25519`, lưu kết quả duy nhất vào tệp tạm thời, kiểm tra tệp quét có dữ liệu, trích xuất chuỗi SHA256 fingerprint và đối chiếu trực tiếp với fingerprint chính thức được cấp từ WiService console ngoài luồng. **Chỉ khi trùng khớp 100%, mới được ghi nhận chính khóa ed25519 này vào `known_hosts`**:

  ```powershell
  $VPS_HOST = "<vps_ip>"
  $VPS_PORT = 22
  $tempScannedKey = "$HOME\.ssh\temp_scanned_key_ed25519.pub"
  $EXPECTED_FINGERPRINT = "<SHA256_fingerprint_lay_tu_wiservice_console>"

  # Bước 0: Đảm bảo thư mục ~/.ssh tồn tại
  if (-not (Test-Path "$HOME\.ssh")) {
      New-Item -ItemType Directory -Path "$HOME\.ssh" -Force | Out-Null
  }

  # Bước 1: Quét RIÊNG khóa ed25519 đúng MỘT lần và lưu vào tệp tạm thời
  & ssh-keyscan -t ed25519 -p $VPS_PORT $VPS_HOST | Out-File -FilePath $tempScannedKey -Encoding ascii
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $tempScannedKey) -or (Get-Item $tempScannedKey).Length -eq 0) {
      Write-Error "ssh-keyscan thất bại hoặc không nhận được khóa ed25519 từ máy chủ ${VPS_HOST}:${VPS_PORT}!"
      Remove-Item $tempScannedKey -ErrorAction SilentlyContinue
      exit 1
  }

  # Bước 2: Chỉ chấp nhận ĐÚNG MỘT dòng ed25519 cho host/port đã chọn.
  # So khớp toàn bộ token host, kết thúc bằng khoảng trắng trước ssh-ed25519 (không dùng \b sau host/port).
  # Với port 22, token host là $VPS_HOST hoặc [$VPS_HOST]:22.
  # Với port khác 22, chỉ nhận đúng dạng [$VPS_HOST]:$VPS_PORT, không nhận dòng host trần.
  $expectedHostPattern = if ([int]$VPS_PORT -eq 22) {
      "^(?:$([regex]::Escape($VPS_HOST))|$([regex]::Escape("[$VPS_HOST]:22")))\s+ssh-ed25519\b"
  } else {
      "^$([regex]::Escape("[$VPS_HOST]:$VPS_PORT"))\s+ssh-ed25519\b"
  }
  $keyLines = @(Get-Content $tempScannedKey | Where-Object {
      $_ -notmatch '^\s*#' -and ($_ -match $expectedHostPattern)
  })

  if ($keyLines.Count -ne 1) {
      Write-Error "Kết quả quét không hợp lệ: kỳ vọng đúng 1 dòng ed25519 cho ${VPS_HOST}:${VPS_PORT}, nhưng nhận được $($keyLines.Count) dòng!"
      Remove-Item $tempScannedKey -ErrorAction SilentlyContinue
      exit 1
  }
  $verifiedLine = $keyLines[0]
  # Ghi đè đúng dòng khóa duy nhất này vào tệp tạm để phân tích
  $verifiedLine | Out-File -FilePath $tempScannedKey -Encoding ascii

  # Bước 3: Kiểm tra exit code của ssh-keygen và trích xuất chuỗi fingerprint
  $fpOutput = & ssh-keygen -lf $tempScannedKey 2>&1
  if ($LASTEXITCODE -ne 0) {
      Write-Error "ssh-keygen thất bại (exit code $LASTEXITCODE) khi đọc khóa ed25519: $fpOutput"
      Remove-Item $tempScannedKey -ErrorAction SilentlyContinue
      exit $LASTEXITCODE
  }
  $fpMatch = [regex]::Match($fpOutput, 'SHA256:[A-Za-z0-9+/=]+')
  if (-not $fpMatch.Success) {
      Write-Error "Không thể trích xuất chuỗi SHA256 fingerprint từ output ssh-keygen: $fpOutput"
      Remove-Item $tempScannedKey -ErrorAction SilentlyContinue
      exit 1
  }
  $ACTUAL_FINGERPRINT = $fpMatch.Value
  Write-Host "Fingerprint ed25519 quét được: $ACTUAL_FINGERPRINT"

  # Bước 4: Đối chiếu với fingerprint chính thức được cấp qua kênh tin cậy ngoài luồng
  #         (Lệnh trên VPS console: ssh-keygen -l -f /etc/ssh/ssh_host_ed25519_key.pub)
  if ($ACTUAL_FINGERPRINT -ne $EXPECTED_FINGERPRINT) {
      Write-Error "CẢNH BÁO NGUY HIỂM: Fingerprint KHÔNG KHỚP! Kỳ vọng: $EXPECTED_FINGERPRINT, thực tế: $ACTUAL_FINGERPRINT. Nguy cơ Man-In-The-Middle! Hủy bỏ quy trình."
      Remove-Item $tempScannedKey -ErrorAction SilentlyContinue
      exit 1
  }

  # Bước 5: CHỈ KHI TRÙNG KHỚP 100%, mới ghi ĐÚNG dòng ed25519 đã xác minh này vào known_hosts:
  $verifiedLine | Out-File -Append -Encoding ascii "$HOME\.ssh\known_hosts"
  Remove-Item $tempScannedKey -ErrorAction SilentlyContinue
  Write-Host "Đã xác thực và ghi nhận chính xác 1 dòng host key ed25519 vào known_hosts thành công." -ForegroundColor Green
  ```

### 3.2. Cơ chế Credential Dùng chung & Giải pháp Cầu nối
1. **Loại bỏ hoàn toàn `--ssh-secret` khỏi dòng lệnh (`argv`)**:
   - Runner CLI chỉ chấp nhận `--ssh-key-file <duong_dan_file_key>`.
   - Ngăn chặn nguy cơ lộ bí mật qua bảng tiến trình hệ thống (`Get-Process`, `ps`).
2. **Cơ chế cấp phát credential tự động cho Runtime Gap 2 (Đã hoàn thành trong P2d-6b)**:
   - Khi truyền `--ssh-key-file <path>` (hoặc cấu hình qua `$env:OPSPILOT_SSH_KEY_FILE`), `run_experiment.py` tự động đọc file private key an toàn và nạp trực tiếp vào tham số `ssh_secret` của cả `DeployAdapter.deploy()` lẫn `PollerAdapter.start()`.
   - Key file tường minh được ưu tiên tuyệt đối so với các biến môi trường cũ (`OPSPILOT_SSH_SECRET`, `OPSPILOT_DEPLOY_SECRET`).
   - Private key được truyền vào tiến trình con qua biến môi trường nội bộ của tiến trình, hoàn toàn không xuất hiện trên dòng lệnh (`argv`) hay log hệ thống.
   - Người vận hành chỉ cần truyền một tham số duy nhất `--ssh-key-file` mà không cần export thủ công `$env:OPSPILOT_SSH_SECRET`.
3. **Chính sách Khử Secret (Sanitization)**:
   - `SystemSshClient.__repr__` luôn ẩn secret (`secret=******`).
   - Mọi thông báo lỗi, log, và stdout/stderr của lệnh SSH tự động thay thế chuỗi secret bằng `******`.
   - Bảng `experiment_run` (cột `abort_reason`, `notes`, `fault_params_json`) và bảng `deployment` cam kết không chứa chuỗi secret thô.

---

## 4. Ứng dụng Demo (`express-api`) & Phân tích Rủi ro Kịch bản Lỗi

### 4.1. Cấu trúc Mã nguồn Cục bộ
Thư mục: [`demo-apps/express-api/`](file:///D:/Developing/DuAnCNTT/demo-apps/express-api)
- `package.json`: Khai báo phụ thuộc `express`, `pg`.
- `server.js`: Web server xử lý logic API sản phẩm, phân trang, seed dữ liệu mẫu.
- `Dockerfile`: Multi-stage lightweight Node.js runtime.
- `public/`: Giao diện web tĩnh HTML/JS kiểm tra trực quan.

### 4.2. Yêu cầu Biến Môi trường & Khắc phục Runtime Gap 1 (Đã hoàn thành trong P2d-6a)
Để kích hoạt các route `/debug/*`, ứng dụng bắt buộc phải có biến môi trường:
```bash
ENABLE_FAULT_ENDPOINTS=true
PORT=3000
```
Trong P2d-6a, runner `experiments/run_experiment.py` đã tự động cấu hình truyền `env_vars={"ENABLE_FAULT_ENDPOINTS": "true"}` qua `DeployAdapter.deploy()` khi chạy pilot tường minh cho `express-api`. Biến môi trường được truyền an toàn qua biến tiến trình `OPSPILOT_APP_ENV_JSON` tới CLI TypeScript, không lộ ra dòng lệnh (`argv`), và tự động bị từ chối nếu deploy ứng dụng khác (`UnsupportedAppError`). Mặc định khi chưa bật cờ pilot tường minh (`allow_pilot_4500=False`), runner huỷ run trước deploy (`pilot_mode_required`).

### 4.3. Bảng Phân tích 5 Kịch bản Lỗi & Cảnh báo Rủi ro OOM

| Kịch bản (`--scenario`) | Endpoint tác động | Tham số & Quy luật tác động (Pha C: 1200 giây) | Mức độ rủi ro hệ thống |
| :--- | :--- | :--- | :---: |
| **`cpu_spike`** *(Khuyến nghị số 1)* | `/debug/cpu?ms=x` | Ramp tuyến tính 20ms $\rightarrow$ 400ms (+20ms mỗi phút). Tăng tải event loop. | **Thấp** (Rất an toàn, không sập container) |
| **`latency_creep`** *(Khuyến nghị số 2)* | `/debug/latency?ms=x` | Tăng dần +50ms mỗi phút, trần 2500ms qua `setTimeout`. | **Thấp** (An toàn, mô phỏng nghẽn mạng) |
| **`slow_db`** | `/debug/slow-db?sec=x` | Ramp 0.05s $\rightarrow$ 1.5s mỗi phút chèn `pg_sleep`. | **Trung bình** (Phụ thuộc DB PostgreSQL) |
| **`error_burst`** | `/debug/error-rate?p=0.3` | Bật một lần duy nhất tại phút 0 của Pha C, 30% request trả HTTP 500. | **Thấp** (An toàn, kiểm tra bộ đếm lỗi) |
| **`memory_leak`** *(Nguy cơ OOM)* | `/debug/leak?mb=5` | Cấp phát 5MB mỗi 10 giây (120 lần, tổng cộng 600MB). | **RẤT CAO (Nguy cơ OOM Killer)** |

> ⚠️ **CẢNH BÁO RỦI RO OOM CHO KỊCH BẢN `memory_leak`**:
> - Kịch bản `memory_leak` cấp phát tổng cộng **600 MB** trong 1200 giây của Pha C.
> - Nếu container ứng dụng áp dụng giới hạn bộ nhớ tiêu chuẩn **512 MB** (`mem_limit: 512m`), container sẽ chạm ngưỡng trần cgroup ở khoảng giây thứ 1000 (khoảng lần tiêm thứ 85).
> - Khi đó, cơ chế Linux Kernel OOM Killer sẽ gửi tín hiệu `SIGKILL` hủy diệt ngay lập tức tiến trình Node.js!
> - Hậu quả: Ứng dụng sập hoàn toàn (connection refused), không thể quan sát quá trình suy thoái tiệm tiến và làm gãy hoàn toàn việc đánh giá khả năng tự phục hồi trong Pha D (3900–4500s).
> - **Khuyến nghị**: Đối với lượt chạy pilot đầu tiên trên VPS thật, **bắt buộc lựa chọn kịch bản `cpu_spike` hoặc `latency_creep`** để bảo đảm tính ổn định của hạ tầng và hoàn thành trọn vẹn 75 phút thử nghiệm.

---

## 5. Dịch vụ Học máy (ML Service)

### 5.1. Khởi động Dịch vụ Cục bộ
Dịch vụ ML Service chạy trên máy điều khiển local:
```powershell
cd D:\Developing\DuAnCNTT\ml-service
& ".\.venv\Scripts\python.exe" -m uvicorn main:app --host 127.0.0.1 --port 8000
```

### 5.2. Các Endpoint Bắt buộc
- `GET http://127.0.0.1:8000/health`: Kiểm tra sẵn sàng (`{"status": "ok", "version": "0.1.0"}`).
- `POST http://127.0.0.1:8000/reset`: Xóa sạch mô hình cũ trước khi bắt đầu Pha A.
- `POST http://127.0.0.1:8000/train`: Huấn luyện tại cuối Pha A (yêu cầu $\ge 162$ mẫu metric sạch).
- `GET http://127.0.0.1:8000/status`: Kiểm tra trạng thái mô hình (`is_trained: true/false`).

---

## 6. Đường Counter Chia sẻ giữa Load Generator & Collector

1. **Container Load Generator**:
   - Tên container thực tế khi triển khai: `opspilot-loadgen-express-api`.
   - Sinh tải liên tục 5 req/s với bộ đếm trượt 60 giây (`Counter(counter_window_s=60.0)`).
   - Ghi định kỳ file JSON tại `/var/metrics/loadgen_counter.json`.
2. **Mount Thư mục Chia sẻ trên VPS**:
   - Thư mục host: `/opt/opspilot/{app_name}/metrics/`.
   - Lệnh Docker Run mount: `-v /opt/opspilot/{app_name}/metrics:/var/metrics`.
   - File counter thực tế: `/opt/opspilot/{app_name}/metrics/loadgen_counter.json`.
3. **Container Collector**:
   - Collector mount `./metrics:/var/metrics` với biến `LOADGEN_COUNTER_PATH=/var/metrics/loadgen_counter.json`.
   - Gọi hàm [`read_loadgen_error_rate`](file:///D:/Developing/DuAnCNTT/collector/collect.py#L32-L47) đọc file trực tiếp mỗi 10 giây.

---

## 7. Quy trình Thực thi Pilot 1 Kịch bản bằng PowerShell (Runbook)

Toàn bộ các lệnh dưới đây được viết bằng **PowerShell** tương thích trực tiếp với môi trường Windows hiện tại, thực thi Python ổn định qua cơ chế pipe:

### Bước 1: Khởi động ML Service trên máy điều khiển local
```powershell
cd D:\Developing\DuAnCNTT\ml-service
& ".\.venv\Scripts\python.exe" -m uvicorn main:app --host 127.0.0.1 --port 8000
```
Kiểm tra phản hồi:
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/health"
# Kỳ vọng: @{ status = "ok"; version = "0.1.0" }
```

### Bước 2: Xác nhận Đường dẫn SQLite DB Thật từ Electron userData & Thiết lập Credential
> ⚠️ **LƯU Ý VỀ ĐƯỜNG DẪN DATABASE**:
> Khi người vận hành thêm VPS thông qua OpsPilot UI, bản ghi VPS và khóa credential đã mã hoá được lưu tại database của Electron (`app.getPath('userData')/opspilot.db`).
> Tuyệt đối không dùng mặc định `app/opspilot.db` nếu chưa xác nhận đó là file DB đang dùng, vì sẽ gây lỗi không tìm thấy VPS hoặc thiếu khóa mã hoá!

```powershell
cd D:\Developing\DuAnCNTT

# 1. Xác nhận đường dẫn DB thực tế từ Electron userData (hoặc biến OPSPILOT_USER_DATA_DIR)
$DB_PATH = "$env:APPDATA\opspilot\opspilot.db"
if (-not (Test-Path $DB_PATH)) {
    # Fallback cho môi trường test/dev nếu dùng đường dẫn khác:
    $DB_PATH = "app\opspilot.db"
}
if (-not (Test-Path $DB_PATH)) {
    Write-Error "Không tìm thấy cơ sở dữ liệu OpsPilot tại: $DB_PATH. Vui lòng mở OpsPilot Desktop để khởi tạo hoặc kiểm tra APPDATA."
    exit 1
}
Write-Host ">>> Sử dụng cơ sở dữ liệu: $DB_PATH" -ForegroundColor Green

# 2. Thiết lập đường dẫn file khóa SSH và nạp biến môi trường cho DeployAdapter & PollerAdapter
$env:OPSPILOT_SSH_KEY_FILE = "$HOME\.ssh\opspilot_vps_key"
$env:OPSPILOT_SSH_SECRET = (Get-Content -Raw "$env:OPSPILOT_SSH_KEY_FILE")
```

### Bước 3: Khởi chạy Orchestrator Thí nghiệm (Kịch bản khuyến nghị: `cpu_spike`)
```powershell
$SCENARIO = "cpu_spike"
$REPEAT = 1
$VPS_ID = 1
$VPS_HOST = "<vps_ip>"
$APP_PORT = 30001

Write-Host ">>> Bắt đầu thực thi pilot: scenario=$SCENARIO, repeat=$REPEAT, vps_id=$VPS_ID" -ForegroundColor Cyan

# Thực thi runner và bắt toàn bộ output + exit code
$runnerOutput = & ".\ml-service\.venv\Scripts\python.exe" experiments\run_experiment.py `
  --scenario $SCENARIO `
  --repeat $REPEAT `
  --vps-id $VPS_ID `
  --db-path $DB_PATH `
  --app-name express-api `
  --source-path demo-apps\express-api `
  --app-url "http://${VPS_HOST}:${APP_PORT}" `
  --ml-url "http://127.0.0.1:8000" `
  --ssh-key-file "$env:OPSPILOT_SSH_KEY_FILE" `
  --allow-pilot-4500 2>&1
$runnerExitCode = $LASTEXITCODE

# Hiển thị log runner
$runnerOutput | ForEach-Object { Write-Host $_ }
```

### Bước 4: Bắt `run_id` từ Runner, Đối chiếu Database & Xuất Kết quả
Không chọn bản ghi mới nhất chung (`ORDER BY id DESC LIMIT 1` mù quáng); bắt buộc trích xuất đúng `run_id` từ kết quả runner và kiểm tra chéo các trường `scenario`, `repeat_index`, `status` trong bảng `experiment_run`:

```powershell
# 1. Bắt thông tin run_id, attempt và status từ kết quả cuối cùng của runner (RightToLeft để lấy attempt mới nhất khi có retry)
$runnerText = $runnerOutput -join "`n"
$match = [regex]::Match(
    $runnerText,
    'status=(?<status>\w+),\s*attempt=(?<attempt>\d+),\s*run_id=(?<run_id>\d+)',
    [System.Text.RegularExpressions.RegexOptions]::RightToLeft
)

if ($match.Success) {
    $FINAL_STATUS = $match.Groups["status"].Value
    $ATTEMPT_INDEX = [int]$match.Groups["attempt"].Value
    $RUN_ID = [int]$match.Groups["run_id"].Value
} else {
    # Fallback nếu runner bị ngắt bất ngờ trước khi in tổng kết:
    $fallbackMatch = [regex]::Match(
        $runnerText,
        'run_id=(?<run_id>\d+)',
        [System.Text.RegularExpressions.RegexOptions]::RightToLeft
    )
    if (-not $fallbackMatch.Success) {
        Write-Error "Không tìm thấy run_id trong kết quả trả về của runner! ExitCode=$runnerExitCode"
        exit 1
    }
    $RUN_ID = [int]$fallbackMatch.Groups["run_id"].Value
    $FINAL_STATUS = "unknown"
    $ATTEMPT_INDEX = 1
}

Write-Host ">>> Bắt được từ runner: RUN_ID=$RUN_ID (Attempt=$ATTEMPT_INDEX, Status=$FINAL_STATUS, Runner ExitCode=$runnerExitCode)" -ForegroundColor Cyan

# 2. Đối chiếu scenario/repeat/attempt/status trong bảng experiment_run trước khi export
$validatePy = @"
import sys, sqlite3
conn = sqlite3.connect(r'$DB_PATH')
cur = conn.cursor()
cur.execute("SELECT id, scenario, repeat_index, attempt_index, status FROM experiment_run WHERE id = ?", (${RUN_ID},))
row = cur.fetchone()
conn.close()

if not row:
    print(f"LỖI: Không tìm thấy run_id=${RUN_ID} trong bảng experiment_run!", file=sys.stderr)
    sys.exit(1)

r_id, sc, rep, att, st = row
if sc != '$SCENARIO' or rep != ${REPEAT}:
    print(f"LỖI: Bản ghi run {r_id} (scenario={sc}, repeat={rep}) không khớp tham số chạy ('$SCENARIO', ${REPEAT})!", file=sys.stderr)
    sys.exit(2)

if att != ${ATTEMPT_INDEX}:
    print(f"LỖI: Attempt trong DB ({att}) không khớp attempt từ runner (${ATTEMPT_INDEX})!", file=sys.stderr)
    sys.exit(3)

if $runnerExitCode != 0 or st != 'completed':
    print(f"CẢNH BÁO: Run {r_id} chưa đạt completed (runner_exit=$runnerExitCode, status='{st}'). Huỷ export!", file=sys.stderr)
    sys.exit(4)

print(f"ĐỐI CHIẾU HỢP LỆ: run_id={r_id}, scenario={sc}, repeat_index={rep}, attempt_index={att}, status={st}")
"@
$validatePy | & ".\ml-service\.venv\Scripts\python.exe" -
if ($LASTEXITCODE -ne 0) {
    Write-Error "Đối chiếu dữ liệu cơ sở dữ liệu thất bại! Dừng quy trình xuất kết quả."
    exit 1
}

# 3. Xuất kết quả sang thư mục artifact riêng biệt
Write-Host ">>> Đang xuất dữ liệu artifact cho Run ID: $RUN_ID" -ForegroundColor Cyan
$exportPy = @"
import sqlite3
from pathlib import Path
from experiments.export_results import export_run

conn = sqlite3.connect(r'$DB_PATH')
out_dir = Path('experiments/results/run_${SCENARIO}_${RUN_ID}')
export_run(conn, run_id=${RUN_ID}, out_dir=out_dir)
conn.close()
print(f'Xuất kết quả thành công vào thư mục: {out_dir}')
"@
$exportPy | & ".\ml-service\.venv\Scripts\python.exe" -
if ($LASTEXITCODE -ne 0) {
    Write-Error "Xuất kết quả thất bại!"
    exit 1
}
```

### Bước 5: Phân tích Dữ liệu & Xuất Báo cáo So sánh
```powershell
& ".\ml-service\.venv\Scripts\python.exe" experiments\analyze.py experiments\results\
```

---

## 8. Kế hoạch Thu hồi & Xử lý Sự cố Khẩn cấp (Rollback & Emergency Teardown)

### 8.1. Thu hồi Cục bộ Tự động qua Khối `finally` của Runner
Khi runner gặp ngoại lệ hoặc bị ngắt (`Ctrl+C`), khối `finally` sẽ:
1. Gọi `reset_fault()` tắt toàn bộ hiệu ứng lỗi trên app demo.
2. Gọi `loadgen_handle.cleanup()` dừng và xoá container `opspilot-loadgen-express-api`.
3. Gọi `poller_handle.stop()` dừng tiến trình Headless Poller.
4. Cập nhật `status='aborted'` và lưu lý do huỷ vào SQLite.

### 8.2. Quy trình Thu hồi Khẩn cấp Thủ công Độc lập trên VPS bằng PowerShell (Standalone Manual Teardown)
Nếu máy local bị ngắt đột ngột hoặc phiên chạy gặp sự cố nghiêm trọng cần dừng ngay lập tức, người vận hành thực thi kịch bản PowerShell dưới đây. Kịch bản này được thiết kế **hoàn toàn độc lập** (không phụ thuộc vào biến môi trường hay state từ các bước trước), **chỉ thao tác đúng tài nguyên của pilot**:
- **Tự động xác định Repo Root & đường dẫn SQLite DB thật** khi mở cửa sổ PowerShell mới ở bất kỳ thư mục nào (tìm kiếm thư mục gốc dự án chứa `experiments/run_store.py` và `ml-service/.venv`, ưu tiên Electron `userData`).
- **Xác minh tiền điều kiện TRƯỚC MỌI LỆNH HTTP/SSH**: kiểm tra `$RUN_ID` là số nguyên dương; `run` đang `running`; `deployment` đang `running` và là `app.current_deployment_id`; `run.vps_id` khớp VPS của app (`app.vps_id`); các thông số `host`, SSH `port`, `username` và `app.host_port` khớp hoàn toàn các biến đích. **Nếu sai hoặc thiếu bất kỳ giá trị nào, kịch bản lập tức dừng, tuyệt đối không gửi HTTP `/debug/reset` hay bất kỳ lệnh SSH nào**.
- **Kiểm tra exit code (`$LASTEXITCODE`) sau từng lệnh SSH**: nếu thao tác dừng container loadgen hoặc dừng app compose thất bại, **lập tức dừng kịch bản (không cập nhật DB)** để người vận hành xử lý trực tiếp.
- **Cập nhật run an toàn qua `abort_run()`**: ghi nhận đồng thời `status = 'aborted'`, `abort_reason = 'manual_emergency_teardown'`, và `run_end_ts` chuẩn ISO 8601 UTC; nếu gặp `InvalidRunStateError`, kịch bản **báo lỗi thất bại và dừng ngay lập tức**, không bao giờ in "hoàn tất an toàn".

```powershell
# ==============================================================================
# QUY TRÌNH THU HỒI KHẨN CẤP THỦ CÔNG ĐỘC LẬP (STANDALONE MANUAL TEARDOWN)
# ==============================================================================

# Cấu hình chính xác đối tượng VPS và phiên pilot cần thu hồi
$VPS_HOST = "<vps_ip>"
$VPS_PORT = 22
$VPS_USER = "root"
$SSH_KEY_FILE = "$HOME\.ssh\opspilot_vps_key"
$APP_PORT = 30001
$RUN_ID = "<run_id_can_thu_hoi>"   # Thay bằng RUN_ID cụ thể (số nguyên dương)

Write-Host ">>> Bắt đầu quy trình thu hồi khẩn cấp độc lập cho run_id=$RUN_ID trên ${VPS_HOST}:${VPS_PORT}..." -ForegroundColor Yellow

# --- BƯỚC 1: Tự động xác định Repo Root & SQLite DB thật khi mở PowerShell mới ---
$REPO_ROOT = $null
$possibleRoots = @(
    (Get-Location).Path,
    $PSScriptRoot,
    "D:\Developing\DuAnCNTT"
)
foreach ($candidate in $possibleRoots) {
    if (-not $candidate) { continue }
    $dir = $candidate
    while ($dir -and (Test-Path $dir)) {
        if ((Test-Path "$dir\experiments\run_store.py") -and (Test-Path "$dir\ml-service\.venv\Scripts\python.exe")) {
            $REPO_ROOT = (Get-Item $dir).FullName
            break
        }
        $parent = Split-Path -Parent $dir
        if (-not $parent -or $parent -eq $dir) { break }
        $dir = $parent
    }
    if ($REPO_ROOT) { break }
}

if (-not $REPO_ROOT) {
    Write-Error "Không thể xác định thư mục gốc của repository OpsPilot! Vui lòng cd vào repo trước khi chạy."
    exit 1
}
$PYTHON_BIN = "$REPO_ROOT\ml-service\.venv\Scripts\python.exe"
if (-not (Test-Path $PYTHON_BIN)) {
    Write-Error "Không tìm thấy môi trường Python ảo tại: $PYTHON_BIN"
    exit 1
}

# Tự động xác định đường dẫn SQLite DB thật từ Electron userData
$DB_PATH = $null
if ($env:OPSPILOT_USER_DATA_DIR -and (Test-Path "$env:OPSPILOT_USER_DATA_DIR\opspilot.db")) {
    $DB_PATH = (Get-Item "$env:OPSPILOT_USER_DATA_DIR\opspilot.db").FullName
} elseif (Test-Path "$env:APPDATA\opspilot\opspilot.db") {
    $DB_PATH = (Get-Item "$env:APPDATA\opspilot\opspilot.db").FullName
} elseif (Test-Path "$REPO_ROOT\app\opspilot.db") {
    $DB_PATH = (Get-Item "$REPO_ROOT\app\opspilot.db").FullName
}

if (-not $DB_PATH -or -not (Test-Path $DB_PATH)) {
    Write-Error "Không thể xác định cơ sở dữ liệu OpsPilot hợp lệ (đã kiểm tra OPSPILOT_USER_DATA_DIR, APPDATA\opspilot\opspilot.db, $REPO_ROOT\app\opspilot.db)!"
    exit 1
}
Write-Host "1/6: Đã xác định Repo Root: $REPO_ROOT" -ForegroundColor Green
Write-Host "     Đã xác định Cơ sở dữ liệu: $DB_PATH" -ForegroundColor Green

# --- BƯỚC 2: Kiểm tra RUN_ID & Xác minh tiền điều kiện trong DB TRƯỚC MỌI LỆNH HTTP/SSH ---
$parsedRunId = 0
if (-not [int]::TryParse($RUN_ID, [ref]$parsedRunId) -or $parsedRunId -le 0) {
    Write-Error "RUN_ID không hợp lệ: '$RUN_ID'. RUN_ID bắt buộc phải là một số nguyên dương cụ thể!"
    exit 1
}

# Tiền điều kiện an toàn: TRƯỚC KHI GỬI BẤT KỲ LỆNH HTTP HOẶC SSH NÀO:
# - Run phải có status = 'running' (nếu completed/aborted -> DỪNG NGAY)
# - Deployment phải đang running và là app.current_deployment_id
# - run.vps_id phải khớp VPS của app (app.vps_id)
# - App phải đúng tên 'express-api'
# - Các biến đích host, SSH port, username, app.host_port phải khớp hoàn toàn cấu hình trong DB
# Sai hoặc thiếu bất kỳ giá trị nào -> DỪNG NGAY LẬP TỨC!
$precheckPy = @"
import sys, sqlite3
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')
run_id = int(sys.argv[1])
db_path = sys.argv[2]
target_host = sys.argv[3]
target_ssh_port = int(sys.argv[4])
target_user = sys.argv[5]
target_app_port = int(sys.argv[6])
expected_app = "express-api"

conn = sqlite3.connect(db_path)
cur = conn.cursor()
cur.execute('''
    SELECT
        r.id,
        r.status,
        r.vps_id,
        r.deployment_id,
        d.id,
        d.status,
        a.id,
        a.vps_id,
        a.name,
        a.host_port,
        a.current_deployment_id,
        v.id,
        v.host,
        v.port,
        v.username
    FROM experiment_run r
    LEFT JOIN deployment d ON r.deployment_id = d.id
    LEFT JOIN app a ON d.app_id = a.id
    LEFT JOIN vps v ON a.vps_id = v.id
    WHERE r.id = ?
''', (run_id,))
row = cur.fetchone()
conn.close()

if not row:
    print(f"PRECHECK_FAILED: Không tìm thấy run_id={run_id} trong bảng experiment_run", file=sys.stderr)
    sys.exit(2)

(
    r_id, r_status, r_vps_id, r_dep_id,
    d_id, d_status,
    a_id, a_vps_id, a_name, a_host_port, a_curr_dep_id,
    v_id, v_host, v_port, v_user
) = row

# 1. Xác nhận run đang running
if r_status != 'running':
    print(f"PRECHECK_FAILED: Run {run_id} đang ở trạng thái '{r_status}' (không phải 'running'). Tuyệt đối không thu hồi từ xa!", file=sys.stderr)
    sys.exit(3)

# 2. Xác nhận deployment tồn tại và đang running
if r_dep_id is None or d_id is None:
    print(f"PRECHECK_FAILED: Run {run_id} chưa được gắn deployment_id. Không xác định được phiên deploy để thu hồi!", file=sys.stderr)
    sys.exit(4)

if d_status != 'running':
    print(f"PRECHECK_FAILED: Deployment {d_id} của run {run_id} đang ở trạng thái '{d_status}' (không phải 'running')!", file=sys.stderr)
    sys.exit(5)

# 3. Xác nhận deployment là app.current_deployment_id
if a_curr_dep_id is None or a_curr_dep_id != d_id:
    print(f"PRECHECK_FAILED: Deployment {d_id} không phải là current_deployment_id của app (app.current_deployment_id='{a_curr_dep_id}')!", file=sys.stderr)
    sys.exit(6)

# 4. Xác nhận đúng app express-api
if a_name != expected_app:
    print(f"PRECHECK_FAILED: Run {run_id} thuộc app '{a_name}' (kỳ vọng '{expected_app}'). Dừng để tránh xoá nhầm app khác!", file=sys.stderr)
    sys.exit(7)

# 5. Xác nhận run.vps_id khớp VPS của app (app.vps_id)
if r_vps_id is None or a_vps_id is None or r_vps_id != a_vps_id:
    print(f"PRECHECK_FAILED: run.vps_id ({r_vps_id}) không khớp app.vps_id ({a_vps_id}) hoặc bị thiếu!", file=sys.stderr)
    sys.exit(8)

# 6. Xác nhận vps.host khớp biến đích
if not v_host or v_host != target_host:
    print(f"PRECHECK_FAILED: VPS host trong DB '{v_host}' không khớp biến đích '{target_host}'!", file=sys.stderr)
    sys.exit(9)

# 7. Xác nhận vps.port (SSH port) khớp biến đích
if v_port is None or int(v_port) != target_ssh_port:
    print(f"PRECHECK_FAILED: VPS SSH port trong DB '{v_port}' không khớp biến đích '{target_ssh_port}'!", file=sys.stderr)
    sys.exit(10)

# 8. Xác nhận vps.username khớp biến đích
if not v_user or v_user != target_user:
    print(f"PRECHECK_FAILED: VPS username trong DB '{v_user}' không khớp biến đích '{target_user}'!", file=sys.stderr)
    sys.exit(11)

# 9. Xác nhận app.host_port khớp biến đích
if a_host_port is None or int(a_host_port) != target_app_port:
    print(f"PRECHECK_FAILED: App host_port trong DB '{a_host_port}' không khớp biến đích '{target_app_port}'!", file=sys.stderr)
    sys.exit(12)

print(f"PRECHECK_PASSED: Run {run_id} và Deployment {d_id} running, app='{a_name}:{a_host_port}', vps='{v_user}@{v_host}:{v_port}' (vps_id={r_vps_id})")
"@

$env:PYTHONPATH = "$REPO_ROOT;$REPO_ROOT\experiments"
$precheckResult = $precheckPy | & $PYTHON_BIN - $parsedRunId $DB_PATH $VPS_HOST $VPS_PORT $VPS_USER $APP_PORT
if ($LASTEXITCODE -ne 0) {
    Write-Error "Tiền điều kiện thu hồi thất bại (exit code $LASTEXITCODE)! Dừng toàn bộ quy trình, không gửi lệnh HTTP hoặc SSH từ xa."
    exit $LASTEXITCODE
}
Write-Host "2/6: $precheckResult" -ForegroundColor Green

# --- BƯỚC 3: Tắt hiệu ứng fault trên app demo qua HTTP (best-effort) ---
try {
    Invoke-RestMethod -Method Post -Uri "http://${VPS_HOST}:${APP_PORT}/debug/reset" -TimeoutSec 5
    Write-Host "3/6: Đã gửi lệnh reset fault tới app demo thành công." -ForegroundColor Green
} catch {
    Write-Warning "3/6: Không thể gọi /debug/reset (app có thể đã dừng): $_"
}

# --- BƯỚC 4: Dừng & xoá container loadgen (kiểm tra exit code và dừng nếu lỗi) ---
if (-not (Test-Path $SSH_KEY_FILE)) {
    Write-Error "Không tìm thấy file khóa SSH tại: $SSH_KEY_FILE"
    exit 1
}
$sshBaseArgs = @("-i", $SSH_KEY_FILE, "-p", $VPS_PORT, "-o", "StrictHostKeyChecking=yes", "${VPS_USER}@${VPS_HOST}")

Write-Host "4/6: Đang dừng container loadgen opspilot-loadgen-express-api..."
& ssh @sshBaseArgs "docker stop opspilot-loadgen-express-api && docker rm opspilot-loadgen-express-api"
if ($LASTEXITCODE -ne 0) {
    Write-Error "Lỗi SSH: Dừng/xoá container loadgen opspilot-loadgen-express-api thất bại (exit code $LASTEXITCODE). Dừng quy trình thu hồi khẩn cấp (không cập nhật DB)!"
    exit $LASTEXITCODE
}
Write-Host "4/6: Dừng và xoá container loadgen thành công." -ForegroundColor Green

# --- BƯỚC 5: Dừng app demo bảo lưu volume (kiểm tra exit code và dừng nếu lỗi) ---
Write-Host "5/6: Đang dừng compose service của app demo (bảo lưu volume)..."
& ssh @sshBaseArgs "cd /opt/opspilot/express-api && docker compose down"
if ($LASTEXITCODE -ne 0) {
    Write-Error "Lỗi SSH: Dừng app demo docker compose thất bại (exit code $LASTEXITCODE). Dừng quy trình thu hồi khẩn cấp (không cập nhật DB)!"
    exit $LASTEXITCODE
}
Write-Host "5/6: Dừng compose service thành công (đã bảo lưu volume)." -ForegroundColor Green

# --- BƯỚC 6: Cập nhật abort_run() kèm run_end_ts chuẩn ISO UTC ---
Write-Host "6/6: Đang cập nhật trạng thái aborted kèm run_end_ts cho run_id=$parsedRunId qua abort_run()..."
$abortPy = @"
import sys
import sqlite3
from datetime import datetime, timezone

sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')
run_id = int(sys.argv[1])
db_path = sys.argv[2]

from experiments.run_store import abort_run, InvalidRunStateError, RunNotFoundError

conn = sqlite3.connect(db_path)
try:
    abort_run(
        conn=conn,
        run_id=run_id,
        reason='manual_emergency_teardown',
        run_end_ts=datetime.now(timezone.utc),
        auto_commit=True,
    )
    print(f"ABORT_SUCCESS: Đã cập nhật aborted và run_end_ts cho run_id={run_id}")
except InvalidRunStateError as e:
    print(f"ABORT_FAILED: Thất bại do run_id={run_id} không ở trạng thái running ({e})", file=sys.stderr)
    sys.exit(1)
except Exception as e:
    print(f"ABORT_FAILED: Lỗi cập nhật run: {e}", file=sys.stderr)
    sys.exit(1)
finally:
    conn.close()
"@

$abortResult = $abortPy | & $PYTHON_BIN - $parsedRunId $DB_PATH
if ($LASTEXITCODE -ne 0) {
    Write-Error "Cập nhật abort_run() trong cơ sở dữ liệu THẤT BẠI (exit code $LASTEXITCODE)!"
    exit $LASTEXITCODE
}
Write-Host "$abortResult" -ForegroundColor Green
Write-Host ">>> Quy trình thu hồi khẩn cấp hoàn tất an toàn." -ForegroundColor Green
```

---

## 9. Kết luận & Điều kiện Tiên quyết trước khi Kích hoạt Pilot

1. **Trạng thái Pilot & Hạ tầng VPS**: Duy trì nghiêm ngặt **`NOT_RUN`**.
2. **Tiến độ chuẩn bị điều kiện**:
   - Khắc phục **Runtime Gap 1**: **ĐÃ HOÀN THÀNH** (P2d-6a: runner tự động truyền `ENABLE_FAULT_ENDPOINTS=true` khi pilot `express-api` và từ chối app khác).
   - Khắc phục **Runtime Gap 2**: **ĐÃ HOÀN THÀNH** (P2d-6b: tự động đọc và cấp phát credential từ `--ssh-key-file` đồng bộ cho cả `DeployAdapter` và `PollerAdapter`, override secret môi trường cũ).
   - Xác minh fingerprint khóa máy chủ VPS qua kênh tin cậy ngoài luồng và lưu vào `known_hosts` theo quy trình 1 lần quét an toàn (Mục 3.1).
   - Chuẩn bị bản ghi VPS hợp lệ đã mã hoá trong SQLite database hoặc file key an toàn (Mục 2.5).
   - Chọn kịch bản an toàn `cpu_spike` hoặc `latency_creep` cho lượt chạy đầu tiên (tránh kịch bản `memory_leak` vượt trần 512 MB gây OOM).
