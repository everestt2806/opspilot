# Hướng dẫn Chạy Preflight & Báo cáo Kiểm kê Prerequisite (CP0 / R1-R7)

Tài liệu hướng dẫn gọi CLI preflight inventory tự động của Windows Delivery, giải thích các cổng kiểm tra (gates), dữ liệu đầu ra và các điều kiện gỡ chặn (unblock conditions) đã được nâng cấp theo phản hồi review của Leader (17/11/2026).

---

## 1. Mục đích và Quy tắc Bất biến

- **Readonly & Phân giải Tường minh**: CLI `app/scripts/windows-delivery/preflight.mjs` chỉ thực hiện kiểm tra đọc. Không tự spawn ứng dụng hay tiến trình ML, không tự tải file, không tự ghi đè environment/venv có sẵn và không tự tạo/phê duyệt artifact giả.
- **Bảo vệ Ghi đè & Kiểm tra Tham số Chặt chẽ (R5)**: Kiểm tra toàn bộ cờ CLI trước khi chạy probe hay ghi file. Bất kỳ tham số không xác định, thiếu giá trị hoặc gate sai tên đều trả mã thoát `2` và không chạm/ghi đè lên file đích đã có. Khi ghi bằng `--out`, nếu file đã tồn tại bắt buộc phải có `--overwrite` để chống ghi đè vô tình.
- **Phân định rõ Ranh giới**:
  - `source_ready`: Đủ điều kiện chạy typecheck/lint/tests mã nguồn (Node 22, pnpm 11.1.0 exact pin, Windows x64, Git baseline ancestry `f699615`, đúng branch hoặc detached ref hợp lệ của CI).
  - `package_ready`: Đủ prerequisite đóng gói (bao gồm `source_ready`, Python 3.12.10, locked packages, content/hash-verified `ml-runtime`, verified `controller-releases`, và release lab audit khớp schema 38).
  - `clean_windows_discovery` vs `clean_windows_gate`: Tách biệt việc phát hiện công cụ (`WindowsSandbox.exe`) khỏi việc nghiệm thu lifecycle (`NOT_RUN` khi chưa thực hiện chạy thực tế trên VM độc lập).

---

## 2. Hướng dẫn Lệnh Gọi CLI

Chạy từ thư mục gốc của repository với Node 22:

### 2.1. Kiểm kê tổng quát (In báo cáo dạng bảng dễ đọc)

```powershell
node app/scripts/windows-delivery/preflight.mjs
```

Lệnh trả mã thoát `0` khi hoàn tất kiểm kê và xuất hiện đầy đủ thông tin môi trường, dependencies, resources và blockers.

### 2.2. Xuất dữ liệu Evidence dạng JSON

```powershell
# In trực tiếp JSON ra stdout:
node app/scripts/windows-delivery/preflight.mjs --json

# Lưu evidence JSON vào đường dẫn chỉ định (bảo vệ chống ghi đè nếu không có --overwrite):
node app/scripts/windows-delivery/preflight.mjs --out app/.out-scripts/windows-delivery/inventory.json --overwrite
```

### 2.3. Kiểm tra Chốt chặn (Gate Enforcement)

```powershell
# Kiểm tra điều kiện source (Node 22, pnpm 11.1.0, Windows x64, Git ancestry/ref):
node app/scripts/windows-delivery/preflight.mjs --gate source
# Exit 0 nếu đạt; Exit 1 nếu không đạt.

# Kiểm tra điều kiện package:
node app/scripts/windows-delivery/preflight.mjs --gate package
# Exit 0 nếu đủ; Exit 1 nếu còn thiếu prerequisite hoặc tài nguyên chưa xác thực.

# Kiểm tra môi trường Windows độc lập:
node app/scripts/windows-delivery/preflight.mjs --gate clean_os
# Trả exit 1 (NOT_RUN) khi chưa chạy trên disposable VM.

# Kiểm tra toàn bộ:
node app/scripts/windows-delivery/preflight.mjs --gate all
```

### 2.4. Tùy chọn Môi trường Python & pnpm (R6)

```powershell
# Chỉ định build interpreter cụ thể (thay vì tự động phát hiện venv hoặc system python):
node app/scripts/windows-delivery/preflight.mjs --python ml-service/.venv/Scripts/python.exe

# Hoặc thiết lập qua biến môi trường:
$env:OPSPILOT_PYTHON = "D:\Dự án CNTT\Tool Deploy\opspilot\ml-service\.venv\Scripts\python.exe"
node app/scripts/windows-delivery/preflight.mjs
```

### 2.5. Bộ Kiểm thử Đơn vị Độc lập (R1 / Standalone Check Suite)

```powershell
node app/scripts/windows-delivery/preflight-check.mjs
```
File này chạy trực tiếp bằng Node và độc lập hoàn toàn với Vitest pattern, đảm bảo 11/11 standalone probes pass mà không gây regression "No test suite found".

---

## 3. Kết quả Kiểm kê Thực tế tại Baseline (Cập nhật sau Review 17/11)

| Hạng mục | Thực tế máy dev | Yêu cầu chuẩn | Đánh giá | Ghi chú |
|---|---|---|---|---|
| **Hệ điều hành** | Windows 10/11 x64 (10.0.26200) | Windows x64 | **PASS** | Môi trường máy phát triển |
| **Git Baseline & Ref** | `feat/kim-windows-delivery-20261116` | Ancestor `f699615`, delivery branch / detached CI | **PASS** | Đạt ancestry & ref verification |
| **Node.js** | v22.17.0 | v22.x | **PASS** | Đạt yêu cầu Node 22 |
| **pnpm** | 11.5.1 | Exact `11.1.0` (theo `packageManager`) | **MISMATCH (BLOCKED)** | Lệch minor vs exact pin `11.1.0` |
| **Build Python** | 3.12.7 (`ml-service/.venv/Scripts/python.exe`) | Exact `3.12.10` | **BLOCKED** | Tự động phân giải venv, lệch patch vs lock |
| **System Python** | 3.12.7 (`Python312\python.exe`) | Không dùng làm build interpreter | **INSPECTED** | Báo cáo tách bạch venv vs global |
| **ML Dependencies** | 15/20 khớp trong venv (5 lệch) | 20/20 theo runtime-lock.json | **BLOCKED** | 5 package lệch trong venv: `anyio`, `idna`, `numpy`, `scipy`, `uvicorn` |
| **ML Runtime Res** | `MISSING` | `app/resources/ml-runtime` (hash-verified) | **BLOCKED** | Chưa có runtime bundled thật |
| **Controller Res** | `CATALOG_INVALID_OR_MISSING` | 9 descriptors đã duyệt + catalog format 1 | **BLOCKED** | Chưa có release binaries thật |
| **Schema Harness** | Desktop 38 + exact migrations `[1..36, 38]` | Exact array 37 migrations | **PASS** | Đã sửa `windows-release-lab.mjs` assert exact array |
| **Windows Sandbox** | Không có (`WindowsSandbox.exe` absent) | Disposable clean OS VM | **NOT_RUN** | Discovery: ABSENT; Gate: NOT_RUN |
| **Ports 8765-8767** | Tất cả đều FREE | Không tiến trình nào chiếm | **PASS** | Sẵn sàng cho app/ML service |

---

## 4. Xác minh Toàn vẹn Tài nguyên (R4)

Preflight không chỉ kiểm tra sự tồn tại của file:
1. **ML Runtime**:
   - Yêu cầu `manifest.json` có `format: 1`, `python_version: '3.12.10'`, và danh sách `files`.
   - Bắt buộc đủ 8 file chuẩn: `python.exe`, `python312.dll`, `python312.zip`, `python312._pth`, `service/main.py`, `service/config.py`, `service/features.py`, `service/store.py`.
   - Toàn bộ file bắt buộc phải có dung lượng `size > 0` và SHA256 khớp với manifest.
   - Nội dung file `python312._pth` bắt buộc khớp `python312.zip\n.\nservice\n`.
   - File rỗng 0-byte hoặc sai hash bị từ chối ngay lập tức với trạng thái `INVALID_MANIFEST` hoặc `TAMPERED_OR_CORRUPT`.
2. **Controller Releases**:
   - `catalog.json` bắt buộc có `format: 1` và danh sách releases hợp lệ.
   - Từng release phải có `installer.cjs` khớp `desc.installer_sha256`, `release/manifest.json` khớp `desc.release_sha256`, và payload files khớp kích thước và checksum.
