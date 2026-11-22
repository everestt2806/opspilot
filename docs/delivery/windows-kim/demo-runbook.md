# Runbook Vận hành Người dùng Cuối, Sao lưu Dữ liệu & Kịch bản Demo (CP4 - Draft Specification)

> [!NOTE]
> **Trạng thái Checkpoint CP4**: **DRAFT / SPECIFICATION**.
> Tính đến vòng review 18/11/2026, sản phẩm chưa thực hiện đóng gói NSIS mới trên môi trường Windows độc lập hoàn toàn sạch và chưa có production installer artifact được ký số chính thức. Tài liệu này đóng vai trò đặc tả vận hành chuẩn (target operational specification), cung cấp hướng dẫn cài đặt dự kiến, quy trình sao lưu/phục hồi dữ liệu người dùng đồng bộ, làm sạch nhật ký, quy tắc quản lý tiến trình an toàn, và kịch bản demo đối chiếu với hiện trạng kiểm thử.

---

## 1. Hướng dẫn Người dùng Cuối (End-User Setup - Dự kiến)

### 1.1. Yêu cầu Hệ thống Dự kiến (Target System Requirements)
- **Hệ điều hành**: Windows 10 (version 1809 trở lên) hoặc Windows 11, kiến trúc 64-bit (x64).
- **Bộ nhớ (RAM)**: Tối thiểu 4 GB (khuyến nghị 8 GB trở lên dựa trên yêu cầu phối hợp giữa Electron Main, Renderer và Python ML runtime).
- **Ổ đĩa trống**: Tối thiểu 1.5 GB dung lượng khả dụng trên ổ cài đặt (`%LocalAppData%`) và ổ chứa profile (`%AppData%`).
- **Phần mềm phụ thuộc**: Khi đóng gói hoàn chỉnh theo đặc tả CP3/CP4, bản cài đặt NSIS dự kiến tự chứa:
  - Runtime Python nhúng (`python312.zip`, DLLs, standard libraries, dependencies trong `Lib/site-packages`).
  - Dịch vụ ML cục bộ (`service/`).
  - Driver SQLite native (`better-sqlite3`).
  - Người dùng cuối không cần tự cài đặt riêng Node.js hay Python toàn cục.

### 1.2. Quy trình Cài đặt & Kiểm tra Toàn vẹn
1. Tải bộ cài chính thức (ví dụ: `OpsPilot-Setup-<version>.exe`) từ kênh phát hành được phê duyệt kèm tệp `SHA256SUMS`.
2. Kiểm tra mã băm SHA256 trước khi khởi chạy:
   ```powershell
   Get-FileHash .\OpsPilot-Setup-<version>.exe -Algorithm SHA256
   ```
   So sánh giá trị băm nhận được với giá trị công bố trong thông cáo phát hành.
3. Chạy bộ cài đặt `.exe`:
   - Thư mục cài đặt mặc định: `%LocalAppData%\Programs\OpsPilot`.
   - Tiến trình cài đặt ghi nhận registry key và tạo shortcut Start Menu.
4. Mở ứng dụng lần đầu:
   - Ứng dụng khởi tạo thư mục dữ liệu tại `%AppData%\OpsPilot\`.
   - Sinh master encryption key được bảo vệ bởi Windows DPAPI (`credential-master-key.protected`).
   - Khởi tạo cơ sở dữ liệu SQLite schema 38 (`opspilot.db`) và áp dụng migrations.

---

## 2. Quy trình Sao lưu & Phục hồi Dữ liệu Người dùng (Synchronized Backup & Restore)

Dữ liệu cục bộ của người dùng được tách biệt khỏi thư mục nhị phân cài đặt phần mềm. Để đảm bảo tính toàn vẹn, **tuyệt đối không sao lưu chắp vá chỉ một phần tệp tin**.

### 2.1. Cấu trúc Profile Dữ liệu Người dùng (`%AppData%\OpsPilot\`)
Đường dẫn đầy đủ: `C:\Users\<Username>\AppData\Roaming\OpsPilot\`
Bao gồm 4 nhóm thành phần phụ thuộc chặt chẽ:
1. **Cơ sở dữ liệu SQLite**:
   - `opspilot.db`: Chứa toàn bộ cấu hình, lịch sử deployment, servers, metadata và schema version 38.
   - `opspilot.db-wal` & `opspilot.db-shm` (nếu có khi app đang ở chế độ WAL): Nhật ký transaction ghi tạm.
2. **Khóa bảo vệ chứng chỉ (DPAPI)**:
   - `credential-master-key.protected`: Khóa đối xứng được bảo vệ bởi Windows Data Protection API (`CryptProtectData`). Mất khóa này, toàn bộ VPS password và SSH private key lưu trong `opspilot.db` sẽ **không thể giải mã**.
3. **Trạng thái Dịch vụ ML (ML State)**:
   - Thư mục `ml-state/`: Lưu trữ các mô hình và trạng thái huấn luyện cục bộ theo cấu trúc:
     `ml-state/<deployment_id>/state.pkl` và `ml-state/<deployment_id>/meta.json`.
     *(Lưu ý: Ứng dụng sử dụng đường dẫn `userData/ml-state`, không dùng thư mục `userData/models`)*.
4. **Trạng thái Giao diện Cục bộ (UI Local Storage)**:
   - Thư mục `Local Storage/`: Lưu cache giao diện, session tokens tạm, và các cài đặt người dùng trên renderer.

> [!IMPORTANT]
> **Ranh giới Bảo mật Windows DPAPI**:
> Tệp `credential-master-key.protected` được mã hóa gắn liền với **tài khoản người dùng Windows cụ thể trên máy tính vật lý cụ thể**.
> Bản sao lưu chứa khóa này chỉ có thể giải mã thành công khi khôi phục lại trên **cùng tài khoản người dùng và cùng máy tính**. Không thể chuyển profile sang máy tính khác hoặc user khác mà vẫn giữ khả năng giải mã credentials tự động trừ khi có quy trình xuất chứng chỉ chủ động (re-key/export).

---

### 2.2. Kịch bản Sao lưu Toàn vẹn (Synchronized Backup Script)

Trước khi sao lưu:
1. Đóng ứng dụng OpsPilot hoàn toàn qua giao diện (Menu -> Exit hoặc đóng cửa sổ chính).
2. Đảm bảo tiến trình ứng dụng và tiến trình ML con đã dừng (xem Mục 4 để kiểm tra an toàn theo PID).

Script PowerShell thực hiện sao lưu đồng bộ kèm tệp kê khai `backup-manifest.json` (sử dụng implementation chính thức tại `app/scripts/windows-delivery/backup-profile.ps1`):

```powershell
# Gọi script sao lưu profile chính thức:
& "$PSScriptRoot\..\..\..\app\scripts\windows-delivery\backup-profile.ps1" `
    -SourceProfile "$env:APPDATA\OpsPilot" `
    -BackupTarget "D:\OpsPilot_Backups\Backup_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
```

Chi tiết luồng xử lý bên trong `backup-profile.ps1`:
1. Kiểm tra profile nguồn hợp lệ, từ chối symlink/reparse point.
2. Sao lưu nhất quán `opspilot.db`, WAL/SHM (nếu có), `credential-master-key.protected` (DPAPI key).
3. Sao lưu mô hình ML (`ml-state`): kiểm tra bắt buộc phải đủ cặp `state.pkl` và `meta.json` cho từng model.
4. Sao lưu `Local Storage` (UI settings).
5. Tạo `backup-manifest.json` định dạng chuẩn (format: 1, mã băm SHA-256 từng tệp, đường dẫn tương đối POSIX, không chứa tệp lạ).

---

### 2.3. Quy trình Phục hồi An toàn (Safe Profile Restore)

> [!CAUTION]
> **Nguyên tắc Phục hồi**:
> - **KHÔNG ĐƯỢC** ghi đè trực tiếp (`Copy-Item -Force`) vào profile đang hoạt động hoặc ghép dữ liệu cũ với khóa mới.
> - **BẮT BUỘC** lưu giữ bản sao lưu dự phòng của profile hiện hữu (`OpsPilot_PreRestore_<timestamp>`) trước khi khôi phục.
> - **BẮT BUỘC** kiểm tra toàn vẹn băm của bản sao lưu dựa trên `backup-manifest.json` trước khi tiến hành copy.

Script PowerShell phục hồi an toàn (sử dụng implementation chính thức tại `app/scripts/windows-delivery/restore-profile.ps1`):

```powershell
# Gọi script phục hồi an toàn:
& "$PSScriptRoot\..\..\..\app\scripts\windows-delivery\restore-profile.ps1" `
    -BackupDir "D:\OpsPilot_Backups\Backup_20261122_120000" `
    -TargetProfile "$env:APPDATA\OpsPilot"
```

Chi tiết luồng bảo vệ nghiêm ngặt của `restore-profile.ps1`:
1. **Xác thực toàn diện trước khi đụng vào profile**:
   - Kiểm tra `backup-manifest.json` tồn tại, định dạng `format: 1`.
   - Danh sách `items` không rỗng và bắt buộc phải chứa `opspilot.db` cùng `credential-master-key.protected`.
   - Kiểm tra mọi cặp mô hình ML trong manifest (`state.pkl` đi kèm `meta.json`).
   - Kiểm tra mã băm SHA-256 và dung lượng của từng tệp trên đĩa khớp hoàn toàn manifest.
   - **Chống Unlisted Files / Data Injection**: Quét toàn bộ tệp trong thư mục backup; nếu phát hiện tệp lạ trên đĩa mà không có trong manifest (ví dụ key/model chưa xác minh), từ chối và thoát ngay lập tức!
   - Từ chối symlink / path traversal.
2. **Không thay đổi profile nếu có bất kỳ lỗi xác thực nào**:
   - Nếu kiểm tra thất bại, script dừng ngay lập tức; profile hiện tại giữ nguyên 100% vị trí và mã băm.
3. **Thao tác phục hồi an toàn qua Staging**:
   - Chỉ khi mọi kiểm tra đạt, copy đúng các tệp trong manifest vào thư mục staging tạm.
   - Di chuyển profile hiện tại sang thư mục lưu giữ dự phòng `OpsPilot_PreRestore_<timestamp>`.
   - Đưa thư mục staging thành profile chính thức. Khởi động lại ứng dụng OpsPilot để nạp dữ liệu.

---

## 3. Quy chuẩn Thu thập & Làm sạch Nhật ký (Log Sanitization & Redaction)

### 3.1. Vị trí Nhật ký Thực tế của Ứng dụng
Theo cấu trúc logger sản phẩm (`src/main/logger.ts`):
- Nhật ký ghi vào thư mục home của người dùng:
  `~/.opspilot/logs/app-YYYY-MM-DD.log`
  (Thực tế trên Windows: `C:\Users\<Username>\.opspilot\logs\app-YYYY-MM-DD.log`).
- *Lưu ý: Không tìm log tại đường dẫn sai `%AppData%\OpsPilot\logs\main.log`.*

### 3.2. Quy tắc Khử Dữ liệu Nhạy cảm Đa dòng (Multiline Redaction)
Module `maskSecrets` trong mã nguồn ứng dụng tự động che giấu chuỗi nhạy cảm khi ghi log trực tiếp. Tuy nhiên, trước khi gửi file log ra bên ngoài hỗ trợ, bắt buộc tạo một bản copy riêng đã làm sạch và **kiểm tra lại thủ công (manual human review)**.

Script PowerShell khử dữ liệu nhạy cảm đa dòng (xử lý OpenSSH private key, Authorization headers, connection strings):

```powershell
# sanitize-logs.ps1
param (
    [string]$LogDate = (Get-Date -Format 'yyyy-MM-dd')
)

$USER_HOME = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::UserProfile)
$LOG_FILE = Join-Path $USER_HOME ".opspilot\logs\app-$LogDate.log"

if (-not (Test-Path $LOG_FILE)) {
    Write-Warning "Không tìm thấy file log ngày hôm nay tại: $LOG_FILE"
    exit 0
}

$SANITIZED_FILE = Join-Path $USER_HOME ".opspilot\logs\app-$LogDate-sanitized.log"
$content = [System.IO.File]::ReadAllText($LOG_FILE, [System.Text.Encoding]::UTF8)

# 1. Khử khối khóa OpenSSH / RSA Private Key đa dòng
$content = [System.Text.RegularExpressions.Regex]::Replace(
    $content,
    '(?s)-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----',
    '[REDACTED_PRIVATE_KEY]'
)

# 2. Khử PostgreSQL Connection Strings chứa thông tin đăng nhập
$content = [System.Text.RegularExpressions.Regex]::Replace(
    $content,
    'postgres://([^:]+):([^@]+)@',
    'postgres://$1:[REDACTED]@'
)

# 3. Khử Bearer tokens, API keys, JWT, passwords
$content = [System.Text.RegularExpressions.Regex]::Replace(
    $content,
    '(?i)(password|secret|token|bearer|key)\s*[:=]\s*["'']?[A-Za-z0-9_\-\.\=\+/]{8,}["'']?',
    '$1=[REDACTED]'
)

# 4. Khử Authorization headers
$content = [System.Text.RegularExpressions.Regex]::Replace(
    $content,
    '(?i)authorization\s*:\s*Bearer\s+[A-Za-z0-9_\-\.]+',
    'Authorization: Bearer [REDACTED]'
)

[System.IO.File]::WriteAllText($SANITIZED_FILE, $content, [System.Text.Encoding]::UTF8)
Write-Host "Đã xuất file log làm sạch tại: $SANITIZED_FILE"
Write-Host "QUAN TRỌNG: Hãy mở file log kiểm tra lại bằng mắt trước khi chia sẻ ra ngoài."
```

---

## 4. Quy tắc Quản lý Tiến trình & Xử lý Sự cố An toàn (Process Ownership & Troubleshooting)

> [!CAUTION]
> **Chính sách Sở hữu Tiến trình (Process Ownership Policy)**:
> - **NGHIÊM CẤM** sử dụng lệnh `Stop-Process -Name "python"` hoặc `Stop-Process -Name "OpsPilot"`.
>   Việc này có thể làm gián đoạn các môi trường phát triển (VS Code, Jupyter, IDE), tiến trình AI/ML khác của máy người dùng, hoặc các phiên bản OpsPilot độc lập khác.
> - **Luôn đóng ứng dụng bình thường (Graceful Close) trước**.
> - Nếu ứng dụng bị treo, **chỉ dừng đúng tiến trình con thuộc thư mục cài đặt OpsPilot** dựa trên PID hoặc cổng lắng nghe nội bộ 8765.

### 4.1. Dừng An toàn Tiến trình Theo Cổng & Đường dẫn Nhị phân (Targeted Teardown)

Nếu cổng dịch vụ ML nội bộ 8765 bị chiếm dụng sau khi đóng app:
Script PowerShell quản lý tiến trình an toàn (sử dụng implementation chính thức tại `app/scripts/windows-delivery/manage-process.ps1`):

```powershell
# 1. Tra cứu và kiểm tra quyền sở hữu tiến trình trên cổng 8765 (Mặc định: Inspect chỉ đọc)
& "$PSScriptRoot\..\..\..\app\scripts\windows-delivery\manage-process.ps1" `
    -Action Inspect `
    -Port 8765 `
    -InstallDir "$env:LOCALAPPDATA\Programs\OpsPilot"

# 2. Dừng an toàn tiến trình (Chỉ thực hiện nếu tiến trình được chứng minh thuộc OpsPilot)
& "$PSScriptRoot\..\..\..\app\scripts\windows-delivery\manage-process.ps1" `
    -Action Stop `
    -Port 8765 `
    -InstallDir "$env:LOCALAPPDATA\Programs\OpsPilot"
```

> [!NOTE]
> Quy tắc kiểm tra sở hữu của `manage-process.ps1`:
> - Lấy đường dẫn thực thi canonical của PID lắng nghe cổng 8765.
> - So khớp nghiêm ngặt tiền tố đường dẫn với thư mục cài đặt gốc: `$procCanonical.StartsWith($installPrefix)`.
> - **Tuyệt đối không dùng substring `*ml-runtime*`**: Bất kỳ tiến trình nào ngoài thư mục cài đặt (ví dụ: `D:\UnrelatedApp\ml-runtime\python.exe`) đều bị từ chối can thiệp và script trả về lỗi cảnh báo mà không dừng tiến trình lạ.

### 4.2. Khắc phục Sự cố Màn hình Trắng (Blank Screen / GPU ANGLE Crash)
Chạy ứng dụng với cờ tắt tăng tốc đồ họa phần cứng:
```powershell
& "$env:LOCALAPPDATA\Programs\OpsPilot\OpsPilot.exe" --disable-gpu
```

### 4.3. Khắc phục Sự cố Cơ sở Dữ liệu Hỏng (Database Malformed)
- Khi gặp lỗi SQLite hỏng do máy tính mất điện đột ngột:
  1. Kiểm tra sao lưu gần nhất trong thư mục `D:\OpsPilot_Backups\`.
  2. Thực hiện quy trình phục hồi tại Mục 2.3. Không yêu cầu người dùng phải tự cài đặt bộ công cụ bên thứ ba (`sqlite3` CLI).

---

## 5. Kịch bản Trình diễn Thực tế 8–10 Phút (Demo Script - CP4 Draft)

*Kịch bản này phản ánh các tính năng cốt lõi đã được kiểm chứng trên nhánh `feat/kim-windows-delivery-20261116`:*

### Phút 0:00 – 1:30: Khởi động Ứng dụng & Khung Giao diện Cục bộ
- **Thao tác**: Khởi động OpsPilot từ Start Menu / shortcut.
- **Quan sát & Thuyết minh**:
  - Giao diện nạp Dashboard với thông số trạng thái Apps, Servers, Deployments.
  - Cấu hình theme (Dark/Light) và ngôn ngữ (English/Vietnamese) phản hồi ngay lập tức và được lưu trữ trong SQLite schema 38.

### Phút 1:30 – 3:30: Bảo mật Dữ liệu Cục bộ & Khóa DPAPI
- **Thao tác**: Trình bày kiến trúc lưu trữ dữ liệu tại `%AppData%\OpsPilot`.
- **Quan sát & Thuyết minh**:
  - Cơ sở dữ liệu SQLite schema 38 quản lý trạng thái máy chủ, secret token được mã hóa bằng master key bảo vệ qua Windows DPAPI (`credential-master-key.protected`).
  - Dữ liệu nằm hoàn toàn tại máy trạm, không bị truyền gửi lên các máy chủ quản lý bên ngoài.

### Phút 3:30 – 6:00: Dịch vụ Máy học Nội bộ (Bundled ML Service)
- **Thao tác**: Kiểm tra cổng dịch vụ ML nội bộ:
  ```powershell
  Invoke-RestMethod -Uri "http://127.0.0.1:8765/health" -Method Get
  ```
- **Quan sát & Thuyết minh**:
  - Endpoint trả về trạng thái JSON `{"status": "ok"}` kèm metadata phiên bản runtime.
  - Dịch vụ Python chạy biệt lập trong `resources/ml-runtime`, sử dụng đúng cấu hình `.pth` cô lập (`python312.zip\nDLLs\nLib/site-packages\nservice\n`), bảo đảm không phụ thuộc vào PATH môi trường hệ điều hành.

### Phút 6:00 – 8:00: Quản lý Máy chủ & Nhật ký An toàn (VPS & Log Sanitization)
- **Thao tác**: Truy cập giao diện quản lý VPS và kiểm tra luồng terminal logs.
- **Quan sát & Thuyết minh**:
  - Quản lý cấu hình kết nối SSH, bộ lọc chính sách cổng (Port Policy) và theo dõi trạng thái máy chủ.
  - Cơ chế `maskSecrets` tự động che giấu mật khẩu và SSH private key khỏi luồng hiển thị giao diện và tệp nhật ký `~/.opspilot/logs/`.

### Phút 8:00 – 10:00: Đóng Ứng dụng & Xác minh Giải phóng Tài nguyên
- **Thao tác**: Đóng ứng dụng OpsPilot qua menu Exit.
- **Quan sát & Thuyết minh**:
  - Kiểm tra cổng 8765: xác nhận cổng đã được giải phóng, tiến trình con ML đã kết thúc đồng bộ theo tiến trình cha Electron Main.
  - Không tồn tại tiến trình mồ côi (orphan process). Mở lại ứng dụng để xác nhận toàn bộ cấu hình phiên làm việc được giữ nguyên.
