# Biên bản Kiểm tra Chỉ đọc Hạ tầng VPS Mục tiêu (Task P2d-7)

> **Mục tiêu**: Đối chiếu runbook và kiểm tra chỉ đọc trên VPS mục tiêu (VM02 `221.121.1.80` / VM01 `221.121.1.79`) phục vụ thí nghiệm Pilot TK-S6.
> **Thời điểm thực hiện**: 2026-10-03 (phiên làm việc cục bộ).
> **Nguyên tắc an toàn**: Fail-closed tuyệt đối. Nếu thiếu host reachability, credential hợp lệ hoặc fingerprint tin cậy ngoài luồng, dừng ngay và báo đúng điều kiện thiếu. Không tự ý chấp nhận host key, không sửa đổi firewall, không deploy ứng dụng, không chạy tải hay ghi dữ liệu vào SQLite DB.

---

## 1. Bảng Tổng hợp Kết quả Kiểm tra Chỉ đọc (P2d-7)

| STT | Hạng mục kiểm tra | Tiêu chuẩn kỹ thuật bắt buộc | Kết quả kiểm tra / Bằng chứng (Đã khử secret) | Trạng thái |
| :---: | :--- | :--- | :--- | :---: |
| **1** | **Xác minh Host/Port qua kênh tin cậy** | Host `221.121.1.80:22` (hoặc `221.121.1.79:22`) phản hồi TCP | `Test-NetConnection -ComputerName 221.121.1.80 -Port 22` trả về `TcpTestSucceeded: False`, `TimedOut`. Host không phản hồi mạng TCP. | **BLOCKED** |
| **2** | **Fingerprint ed25519 qua kênh tin cậy** | Đối soát fingerprint ed25519 khớp 100% với kênh ngoài luồng WiService console | Runbook Mục 3.1 yêu cầu `$EXPECTED_FINGERPRINT`, nhưng chưa có chuỗi fingerprint chính thức được cấp qua kênh tin cậy. Dù `known_hosts` cục bộ có hash `SHA256:Qr5s2eWoQOuAgFvezXnTMn+rQ0kfdsW0GDYfWlFR2F8`, quy tắc nghiêm cấm tự chấp nhận host key mù khi chưa xác minh ngoài luồng. | **BLOCKED** |
| **3** | **Cấu hình Credential VPS** | Khóa riêng OpenSSH (ed25519/rsa) hợp lệ, cấp quyền đăng nhập tài khoản đích | Bản ghi DB `vps` id=2 hiện lưu `auth_type='password'` (runner chỉ hỗ trợ `key`). File `~/.ssh/opspilot_ed25519` có trên máy nhưng chưa được cấu hình làm key cho `root` trong DB; chưa có biến môi trường `OPSPILOT_SSH_KEY_FILE`. | **BLOCKED** |
| **4** | **Cấu hình phần cứng & OS VPS** | Tối thiểu 2 vCPU, 4GB RAM, Ubuntu 22.04 LTS / Debian 12 | Bị chặn bởi bước kết nối mạng và xác thực host key. (Bằng chứng lịch sử C00: RAM ~3.9GB, 3.2GB available). | **NOT_RUN** |
| **5** | **Dung lượng lưu trữ (Storage)** | Tối thiểu 40GB SSD, phân vùng root `/` đủ chỗ cho images & metrics | Bị chặn bởi bước kết nối mạng và xác thực host key. (Bằng chứng lịch sử C00: `/dev/sda2` 39.7GB, 31.7GB available). | **NOT_RUN** |
| **6** | **Docker Engine & Compose Plugin** | Docker Engine $\ge 24.0.0$, Compose Plugin $\ge v2.20.0$ | Bị chặn bởi bước kết nối mạng và xác thực host key. (Bằng chứng lịch sử C00: Docker 29.7.2, Compose v5.5.0). | **NOT_RUN** |
| **7** | **Đồng bộ thời gian NTP** | `systemd-timesyncd` active, độ lệch đồng hồ $\|offset\| < 2000$ ms | Bị chặn bởi bước kết nối mạng và xác thực host key. Không thể thực thi `date +%s%3N` qua SSH. | **NOT_RUN** |
| **8** | **Trạng thái tường lửa (UFW / Firewall)** | Port 22 mở, dải port `30000:30999/tcp` cho phép traffic | Probe bên ngoài xác nhận port 22 không phản hồi TCP (`TcpTestSucceeded: False`). Không thể kiểm tra lệnh `ufw status` nội bộ trên VPS. | **BLOCKED** |

---

## 2. Chi tiết Kết quả Đối chiếu Runbook & Bằng chứng Khử Nhạy cảm

### 2.1. Đối chiếu Database & Cấu hình Đích
- **Đường dẫn Database**: `C:\Users\everestt28\AppData\Roaming\opspilot\opspilot.db` (Electron `userData`).
- **Truy vấn bản ghi ứng dụng (`app` table)**:
  - App `express-api` (id 1): `vps_id = 2`, `current_deployment_id = 1`.
- **Truy vấn bản ghi VPS (`vps` table)**:
  - VPS id 2 (`VM02`): `host = '221.121.1.80'`, `port = 22`, `username = 'root'`, `auth_type = 'password'`.
  - VPS id 1 (`VM01`): `host = '221.121.1.79'`, `port = 22`, `username = 'root'`, `auth_type = 'password'`.
- **Đánh giá tương thích**:
  - Bản ghi VPS trong DB hiện có `auth_type = 'password'`. Tuy nhiên, kiến trúc an toàn của runner (`SystemSshClient`) chỉ hỗ trợ `auth_type = 'key'` để loại bỏ mật khẩu thô và đảm bảo chạy tự động không tương tác.
  - Cần chuyển đổi bản ghi sang `auth_type = 'key'` hoặc cấu hình `--ssh-key-file` kèm tài khoản SSH tương ứng (`deploy` hoặc `root`).

### 2.2. Kiểm tra Mạng & Khả năng Tiếp cận Host (Reachability Probe)
Thực thi lệnh kiểm tra TCP probe từ PowerShell điều khiển:
```powershell
Test-NetConnection -ComputerName 221.121.1.80 -Port 22 -InformationLevel Detailed
```
**Bằng chứng thu thập**:
```text
WARNING: TCP connect to (221.121.1.80 : 22) failed
WARNING: Ping to 221.121.1.80 failed with status: TimedOut

ComputerName            : 221.121.1.80
RemoteAddress           : 221.121.1.80
RemotePort              : 22
TcpTestSucceeded        : False
PingSucceeded           : False
PingReplyDetails (RTT)  : 0 ms
```
Thực thi kiểm tra với máy chủ phụ VM01 (`221.121.1.79:22`):
```text
WARNING: TCP connect to (221.121.1.79 : 22) failed
WARNING: Ping to 221.121.1.79 failed with status: TimedOut

ComputerName            : 221.121.1.79
TcpTestSucceeded        : False
PingSucceeded           : False
```
**Kết luận**: Cả hai địa chỉ máy chủ đều không phản hồi TCP trên cổng SSH 22 tại thời điểm kiểm tra.

### 2.3. Kiểm tra Fingerprint & Chính sách Chống MITM (Single-Scan Gate)
- Runbook Mục 3.1 quy định: Trước khi kết nối hoặc ghi nhận máy chủ vào `known_hosts`, bắt buộc phải quét riêng khóa ed25519 (`ssh-keyscan -t ed25519`), trích xuất SHA256 fingerprint và đối soát với `$EXPECTED_FINGERPRINT` được cấp từ WiService console ngoài luồng.
- **Thực trạng**:
  1. Lệnh `ssh-keyscan` không thể thực hiện do kết nối TCP tới `221.121.1.80:22` bị timeout.
  2. Chưa có giá trị `$EXPECTED_FINGERPRINT` chính thức từ WiService console trong hồ sơ preflight (`docs/tasks/tk-s6-pilot-preflight.md` vẫn giữ placeholder `<SHA256_fingerprint_lay_tu_wiservice_console>`).
  3. Mặc dù tệp `~/.ssh/known_hosts` trước đây có lưu bản ghi ed25519 của `221.121.1.80` với fingerprint `SHA256:Qr5s2eWoQOuAgFvezXnTMn+rQ0kfdsW0GDYfWlFR2F8`, quy chuẩn bảo mật nghiêm cấm việc tự suy diễn hoặc tự động chấp nhận khi chưa có xác nhận từ kênh tin cậy ngoài luồng.
- **Hành động tuân thủ**: DỪNG TOÀN BỘ CÁC LỆNH KẾT NỐI TỪ XA. Trạng thái: **BLOCKED**.

---

## 3. Điều kiện Thiếu Cần Tháo Gỡ trước khi Mở lại Khảo sát Trực tiếp VPS

Để có thể thực hiện kiểm tra chỉ đọc trực tiếp trên hệ điều hành VPS và chuyển các mục `NOT_RUN` sang `PASS`:

1. **Khôi phục Tiếp cận Mạng (Network Reachability)**:
   - Nhà cung cấp WiService hoặc quản trị viên hệ thống cần bật máy chủ VM02 (`221.121.1.80`) / VM01 (`221.121.1.79`) và bảo đảm firewall lớp mạng cho phép traffic TCP đến cổng 22.
2. **Cung cấp Fingerprint Tin cậy Ngoài luồng (Out-of-band Fingerprint)**:
   - Quản trị viên cần trích xuất SHA256 fingerprint của khóa host ed25519 từ WiService console (hoặc màn hình VNC quản trị máy chủ) và bàn giao qua kênh tin cậy để nạp vào biến `$EXPECTED_FINGERPRINT`.
3. **Đồng bộ Khóa SSH Credential vào Database & Runner**:
   - Cập nhật bản ghi VPS của `express-api` trong SQLite sang `auth_type = 'key'`, cấu hình đúng `username` (ví dụ `deploy` hoặc `root`) đã được cấp public key tương ứng trong `~/.ssh/authorized_keys` trên VPS.
   - Chỉ định đường dẫn private key qua tham số `--ssh-key-file` hoặc `$env:OPSPILOT_SSH_KEY_FILE = "$HOME\.ssh\opspilot_ed25519"`.

---

## 4. Cam kết Thực hiện

- Không deploy bất kỳ container hoặc ứng dụng nào lên VPS.
- Không chỉnh sửa firewall (UFW hay iptables) trên VPS.
- Không khởi chạy load generator hoặc thí nghiệm pilot 75 phút.
- Không ghi dữ liệu hoặc sửa đổi cơ sở dữ liệu SQLite trong phiên khảo sát.
- Không tự ý push, mở Pull Request hay merge vào nhánh chính.
- Duy trì trạng thái tổng thể của Pilot: **`NOT_RUN`**.
