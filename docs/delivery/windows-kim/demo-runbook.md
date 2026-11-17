# Runbook Vận hành Người dùng Cuối, Sao lưu Dữ liệu & Kịch bản Demo 8–10 Phút (CP4)

Tài liệu hoàn thiện cho Checkpoint CP4: Cung cấp hướng dẫn cài đặt, sao lưu/phục hồi dữ liệu, làm sạch nhật ký (log redaction), xử lý sự cố installer, và kịch bản trình diễn (demo script) 8–10 phút dựa trên các tính năng đã được kiểm chứng ở baseline.

---

## 1. Hướng dẫn Người dùng Cuối (End-User Setup)

### 1.1. Yêu cầu Hệ thống Tối thiểu
- **Hệ điều hành**: Windows 10 (version 1809 trở lên) hoặc Windows 11, kiến trúc 64-bit (x64).
- **Bộ nhớ (RAM)**: Tối thiểu 4 GB (khuyến nghị 8 GB trở lên).
- **Ổ đĩa trống**: Tối thiểu 1 GB dung lượng khả dụng trên ổ hệ thống (ổ C:).
- **Phần mềm phụ thuộc**: **Không yêu cầu người dùng cài đặt trước Node.js hay Python**. Bản cài đặt đóng gói sẵn toàn bộ runtime cần thiết (`python.exe`, standard libraries, bundled ML models và SQLite drivers).

### 1.2. Các bước Cài đặt
1. Tải bộ cài chính thức `OpsPilot-0.2.0-setup.exe` từ nguồn phát hành được phê duyệt.
2. Kiểm tra mã băm SHA256 trước khi chạy:
   ```powershell
   Get-FileHash .\OpsPilot-0.2.0-setup.exe -Algorithm SHA256
   ```
3. Nhấp đúp vào file `.exe` để tiến hành cài đặt.
   - Thư mục cài đặt mặc định: `%LocalAppData%\Programs\OpsPilot`.
   - Ứng dụng tự động đăng ký shortcut trong Start Menu.
4. Mở ứng dụng từ Start Menu hoặc shortcut trên Desktop.
   - Trong lần khởi động đầu tiên, OpsPilot sẽ tự động khởi tạo cơ sở dữ liệu SQLite và sinh master encryption key được bảo vệ bởi Windows DPAPI (`safeStorage`).

---

## 2. Quy trình Sao lưu & Phục hồi Dữ liệu Người dùng (Backup & Restore)

Dữ liệu cục bộ của người dùng được tách biệt hoàn toàn khỏi thư mục cài đặt phần mềm.

### 2.1. Vị trí Dữ liệu Cục bộ
- **Đường dẫn thư mục Profile**:
  `%AppData%\OpsPilot\` (thực tế: `C:\Users\<Username>\AppData\Roaming\OpsPilot\`)
- **Các thành phần quan trọng**:
  - `opspilot.db`: Cơ sở dữ liệu SQLite chứa cấu hình, lịch sử deployment, VPS records, schema version (hiện tại schema 38).
  - `credential-master-key.protected`: Khóa mã hóa chính được bảo vệ bởi DPAPI của Windows người dùng hiện hành.
  - `models/`: Thư mục chứa trọng số mô hình ML được huấn luyện cục bộ.

### 2.2. Quy trình Sao lưu (Backup)
Trước khi nâng cấp phiên bản hoặc bảo trì máy tính:
1. Đóng hoàn toàn ứng dụng OpsPilot (đảm bảo không còn tiến trình `OpsPilot.exe` chạy ngầm).
2. Mở PowerShell và tạo thư mục sao lưu lưu trữ an toàn:
   ```powershell
   $BACKUP_DIR = "D:\OpsPilot_Backup_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
   New-Item -ItemType Directory -Path $BACKUP_DIR -Force
   
   # Sao lưu cơ sở dữ liệu và models
   Copy-Item "$env:APPDATA\OpsPilot\opspilot.db" -Destination "$BACKUP_DIR\opspilot.db"
   if (Test-Path "$env:APPDATA\OpsPilot\models") {
       Copy-Item "$env:APPDATA\OpsPilot\models" -Destination "$BACKUP_DIR\models" -Recurse
   }
   
   # Ghi lại checksum của dữ liệu đã sao lưu
   Get-FileHash "$BACKUP_DIR\opspilot.db" -Algorithm SHA256 | Out-File "$BACKUP_DIR\checksums.txt"
   ```

> [!WARNING]
> Tệp `credential-master-key.protected` được mã hóa gắn liền với tài khoản Windows người dùng hiện hành (`CryptProtectData`). Sao lưu file này sang máy tính khác hoặc tài khoản Windows khác sẽ không thể giải mã được nếu không có khóa dự phòng.

### 2.3. Quy trình Phục hồi (Restore)
1. Đảm bảo OpsPilot đã tắt.
2. Khôi phục file cơ sở dữ liệu:
   ```powershell
   Copy-Item "$BACKUP_DIR\opspilot.db" -Destination "$env:APPDATA\OpsPilot\opspilot.db" -Force
   if (Test-Path "$BACKUP_DIR\models") {
       Copy-Item "$BACKUP_DIR\models" -Destination "$env:APPDATA\OpsPilot\models" -Recurse -Force
   }
   ```
3. Mở lại ứng dụng OpsPilot. Ứng dụng sẽ tự động kiểm tra tính toàn vẹn `PRAGMA integrity_check` và áp dụng các migration cần thiết.

---

## 3. Quy chuẩn Làm sạch Nhật ký (Log Redaction Guidelines)

Trước khi gửi logs chẩn đoán cho đội ngũ hỗ trợ kỹ thuật hoặc coordinator, người dùng và kỹ sư hỗ trợ **bắt buộc** phải tuân thủ quy tắc khử dữ liệu nhạy cảm:

### 3.1. Các thông tin BẮT BUỘC phải che (Redacted)
- **Private SSH Keys**: Bất kỳ khối `-----BEGIN OPENSSH PRIVATE KEY-----` hoặc RSA private key.
- **Passwords & Passphrases**: Mật khẩu VPS, mật khẩu cơ sở dữ liệu PostgreSQL.
- **Database Connection Strings**: Chuỗi `postgres://user:password@host:port/dbname` phải được thay thế thành `postgres://user:[REDACTED]@host:port/dbname`.
- **API Tokens / Secrets**: Các token Bearer, JWT, webhook secrets.
- **Tên miền hoặc IP nội bộ nhạy cảm**: Nếu có yêu cầu bảo mật từ phía khách hàng.

### 3.2. Công cụ Khử Tự động
Ứng dụng OpsPilot tích hợp module `maskSecrets` (trong `src/main/logger.ts`), tự động lọc các chuỗi nhạy cảm khi ghi log. Khi thu thập file log thủ công (`%AppData%\OpsPilot\logs\`), có thể chạy lệnh làm sạch:
```powershell
(Get-Content "$env:APPDATA\OpsPilot\logs\main.log") `
    -replace '(?i)(password|secret|token|key)\s*[:=]\s*["'']?[^"''\s]+', '$1=[REDACTED]' `
    -replace 'postgres://([^:]+):([^@]+)@', 'postgres://$1:[REDACTED]@' `
    | Set-Content "$env:APPDATA\OpsPilot\logs\main-sanitized.log"
```

---

## 4. Xử lý Sự cố Cài đặt & Phục hồi khi Installer Lỗi

### 4.1. Sự cố: Installer báo lỗi "File in use / Tiến trình đang chạy"
- **Nguyên nhân**: Phiên bản cũ của `OpsPilot.exe` hoặc tiến trình con Python ML service chưa thoát hoàn toàn.
- **Khắc phục**:
  ```powershell
  Stop-Process -Name "OpsPilot" -Force -ErrorAction SilentlyContinue
  Stop-Process -Name "python" -Force -ErrorAction SilentlyContinue
  ```
  Sau đó chạy lại bộ cài đặt.

### 4.2. Sự cố: Màn hình trắng (Blank Screen) hoặc lỗi GPU Hardware Acceleration
- **Nguyên nhân**: Driver card màn hình trên Windows không tương thích với WebGL/ANGLE của Chromium.
- **Khắc phục**: Chạy ứng dụng với cờ vô hiệu hóa tăng tốc phần cứng:
  ```powershell
  & "$env:LOCALAPPDATA\Programs\OpsPilot\OpsPilot.exe" --disable-gpu
  ```

### 4.3. Sự cố: Cơ sở dữ liệu bị hỏng (Database Malformed)
- **Nguyên nhân**: Máy tính bị tắt nguồn đột ngột khi đang ghi transaction.
- **Khắc phục**:
  1. Kiểm tra trạng thái:
     ```powershell
     # Kiểm tra tính toàn vẹn bằng sqlite3 CLI
     sqlite3 "$env:APPDATA\OpsPilot\opspilot.db" "PRAGMA integrity_check;"
     ```
  2. Nếu hỏng, đổi tên `opspilot.db` thành `opspilot.db.corrupt` và khôi phục từ bản sao lưu gần nhất.

---

## 5. Kịch bản Trình diễn Thực tế (Demo Script 8–10 Phút)

Kịch bản trình diễn được thiết kế dựa trên các tính năng đã kiểm chứng ở baseline (không phụ thuộc vào mock, không bịa đặt tính năng chưa có):

### Phút 0:00 – 1:30: Khởi động Ứng dụng & Giới thiệu Giao diện Cục bộ
- **Hành động**: Mở OpsPilot từ Start Menu.
- **Điểm nhấn trình bày**:
  - Ứng dụng khởi động mượt mà, khung viền Mica/Aero native trên Windows (`windowOptions.ts`).
  - Giao diện Dashboard hiển thị trạng thái hệ thống: Apps, Servers (VPS), Deployments.
  - Chuyển đổi Theme (Dark/Light) và Ngôn ngữ (English/Vietnamese) trong Settings: cài đặt lưu trữ tức thì và giữ nguyên khi khởi động lại.

### Phút 1:30 – 3:30: Cơ chế Bảo mật Cục bộ & Schema Độc lập
- **Hành động**: Giới thiệu kiến trúc lưu trữ dữ liệu an toàn.
- **Điểm nhấn trình bày**:
  - Dữ liệu hoàn toàn nằm trên máy người dùng (`%AppData%\OpsPilot`), không gửi credential lên đám mây của bên thứ ba.
  - Sử dụng SQLite Desktop schema phiên bản 38, thực thi 37 migrations chuẩn, bảo toàn toàn vẹn dữ liệu.
  - Master key được bảo vệ bởi Windows Data Protection API (DPAPI).

### Phút 3:30 – 6:00: Dịch vụ Máy học Cục bộ (Bundled ML Service)
- **Hành động**: Kiểm tra endpoint sức khỏe và suy luận mô hình ML.
- **Điểm nhấn trình bày**:
  - Mở PowerShell kiểm tra endpoint nội bộ: `Invoke-RestMethod http://127.0.0.1:8765/health`.
  - Tiến trình Python hoàn toàn khép kín trong `resources/ml-runtime`, không làm ảnh hưởng hay xung đột với bất kỳ phiên bản Python nào khác trên máy khách hàng.
  - Trình diễn khả năng tính toán điểm đánh giá rủi ro deployment (Risk Scoring) dựa trên 4 thuật toán suy luận cục bộ.

### Phút 6:00 – 8:00: Quản lý Máy chủ & Chuẩn bị Triển khai (VPS & Deployment Readiness)
- **Hành động**: Vào trang Servers / VPS và Deployments.
- **Điểm nhấn trình bày**:
  - Quản lý danh sách VPS với SSH Fingerprint xác thực và bộ lọc cổng an toàn (Port Policy).
  - Khả năng kiểm tra trạng thái ingress Caddy và chứng chỉ HTTPS độc lập.
  - Terminal stream hiển thị log trực tiếp với cơ chế che giấu dữ liệu nhạy cảm (Secret Masking).

### Phút 8:00 – 10:00: Đóng Ứng dụng & Dọn dẹp Tiến trình Hoàn hảo
- **Hành động**: Đóng cửa sổ ứng dụng OpsPilot.
- **Điểm nhấn trình bày**:
  - Kiểm tra Task Manager / PowerShell: Xác nhận toàn bộ tiến trình con `OpsPilot.exe` và `python.exe` đều đã được thu hồi (reaped) sạch sẽ, giải phóng hoàn toàn các cổng 8765-8767, không để lại tiến trình mồ côi (orphan process).
  - Mở lại ứng dụng: Toàn bộ phiên làm việc, trạng thái theme, và lịch sử cơ sở dữ liệu được phục hồi hoàn hảo (Cold Reopen Preservation).
