# Hướng dẫn Chạy Preflight & Báo cáo Kiểm kê Prerequisite (CP0 / R1-R7 & S1-S5)

Tài liệu hướng dẫn gọi CLI preflight inventory tự động của Windows Delivery, giải thích các cổng kiểm tra (gates), dữ liệu đầu ra và các điều kiện gỡ chặn (unblock conditions) đã được nâng cấp theo phản hồi review của Leader ngày 18/11/2026 (S1–S5).

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

### 2.5. Bộ Kiểm thử Độc lập (R1 / Standalone Check Suite - 12 Probes)

```powershell
node app/scripts/windows-delivery/preflight-check.mjs
```
File này chạy trực tiếp bằng Node và độc lập hoàn toàn với Vitest pattern, thực hiện 12 probes nghiêm ngặt:
1. Default invocation produces inventory report with exit code 0.
2. `--help` produces usage instructions.
3. `--json` outputs valid schema-compliant JSON with schema 38 verification.
4. `--out` successfully exports structured evidence to disk.
5. Unknown CLI options exit 2 and preserve existing files.
6. Invalid `--gate` argument returns exit 2 and preserves target file.
7. Missing `--gate` argument value returns exit 2.
8. Overwrite guard protects existing files unless `--overwrite` is passed.
9. **S3 Check**: Empty/zero-byte ML resource fixture rejected as unverified.
10. **S3 Check**: Production contract parity (positive contract fixture accepted by production `verifyMlRuntime`, negative wrong-pth rejected by both).
11. **S1 Check**: Synthetic profile backup & restore round-trip preserved all 5 items with matching hashes.
12. **R6 Check**: Explicit `--python` argument sets resolved executable without ambiguity.

---

## 3. Khớp Nối Contract Tài nguyên Sản xuất (S3 Parity)

Sau vòng review 18/11/2026, preflight đã căn chỉnh khớp hoàn toàn với contract sản phẩm (`src/main/mlRuntime.ts` và `docs/contracts/product-controller-release.ts`):

### 3.1. Tiêu chuẩn ML Runtime Bundle (`app/resources/ml-runtime`)
- **Tập hợp tệp bắt buộc (15 tệp)**:
  1. `python.exe`
  2. `python312.dll`
  3. `python312.zip`
  4. `python312._pth`
  5. `service/main.py`
  6. `service/config.py`
  7. `service/features.py`
  8. `service/store.py`
  9. `Lib/site-packages/fastapi/__init__.py`
  10. `Lib/site-packages/uvicorn/__init__.py`
  11. `Lib/site-packages/pydantic/__init__.py`
  12. `Lib/site-packages/sklearn/__init__.py`
  13. `Lib/site-packages/numpy/__init__.py`
  14. `Lib/site-packages/scipy/__init__.py`
  15. `Lib/site-packages/joblib/__init__.py`
- **Nội dung tệp `.pth` bắt buộc**:
  Phải khớp chính xác chuỗi `ML_RUNTIME_PATHS`:
  `python312.zip\nDLLs\nLib/site-packages\nservice\n`
- **Cấu trúc Manifest**:
  `format: 1`, `platform: 'win32-x64'`, `python_version` khớp tiền tố `3.12.`, và bảng kê toàn bộ tệp với dung lượng `size > 0` và SHA256 chính xác.
- **Ràng buộc Toàn vẹn**:
  Không chứa symlinks. Duyệt đệ quy thư mục để đảm bảo không có tệp dư thừa ngoài danh sách manifest.

### 3.2. Tiêu chuẩn Controller Releases (`app/resources/controller-releases`)
- **Tên tệp Manifest**:
  Phải là `release/release-manifest.json` (không phải `release/manifest.json`), đúng theo contract `docs/contracts/product-controller-release.ts:2`.
- **Bố cục Thư mục**:
  Thư mục release `<release_id>` chỉ được phép chứa chính xác:
  `installer.cjs` và thư mục `release/`.
- **Kiểm định Catalog**:
  `catalog.json` bắt buộc có `format: 1` và danh sách release descriptors hợp lệ. Từ chối các object rỗng `{}` hoặc descriptors thiếu trường bắt buộc.
- **Xác thực Băm**:
  Mã băm SHA256 của `release-manifest.json` phải khớp `desc.release_sha256`; mã băm của `installer.cjs` phải khớp `desc.installer_sha256`.

---

## 4. Kết quả Kiểm kê Thực tế tại Baseline Hiện tại

| Hạng mục | Thực tế máy dev | Yêu cầu chuẩn | Đánh giá | Ghi chú |
|---|---|---|---|---|
| **Hệ điều hành** | Windows 10/11 x64 (10.0.26200) | Windows x64 | **PASS** | Môi trường máy phát triển |
| **Git Baseline & Ref** | `feat/kim-windows-delivery-20261116` | Ancestor `f699615`, delivery branch / detached CI | **PASS** | Đạt ancestry & ref verification |
| **Node.js** | v22.17.0 | v22.x | **PASS** | Đạt yêu cầu Node 22 |
| **pnpm** | 11.5.1 | Exact `11.1.0` (theo `packageManager`) | **MISMATCH (BLOCKED)** | Lệch minor vs exact pin `11.1.0` |
| **Build Python** | 3.12.7 (`ml-service/.venv/Scripts/python.exe`) | Exact `3.12.10` | **BLOCKED** | Tự động phân giải venv, lệch patch vs lock |
| **System Python** | 3.12.7 (`Python312\python.exe`) | Không dùng làm build interpreter | **INSPECTED** | Báo cáo tách bạch venv vs global |
| **ML Dependencies** | 15/20 khớp trong venv (5 lệch) | 20/20 theo runtime-lock.json | **BLOCKED** | 5 package lệch trong venv |
| **ML Runtime Res** | `MISSING` | `app/resources/ml-runtime` (15 files, contract .pth, hash-verified) | **BLOCKED** | Chưa có runtime bundled thật |
| **Controller Res** | `CATALOG_INVALID_OR_MISSING` | 9 descriptors đã duyệt + release-manifest.json | **BLOCKED** | Chưa có release binaries thật |
| **Schema Harness** | Desktop 38 + exact migrations `[1..36, 38]` | Exact array 37 migrations | **PASS** | `windows-release-lab.mjs` assert exact array |
| **Windows Sandbox** | Không có (`WindowsSandbox.exe` absent) | Disposable clean OS VM | **NOT_RUN** | Discovery: ABSENT; Gate: NOT_RUN |
| **Ports 8765-8767** | Tất cả đều FREE | Không tiến trình nào chiếm | **PASS** | Sẵn sàng cho app/ML service |
