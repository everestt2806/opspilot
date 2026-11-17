# Hướng dẫn chạy Preflight & Báo cáo Kiểm kê Prerequisite (CP0)

Tài liệu hướng dẫn gọi CLI preflight inventory tự động của Windows Delivery, giải thích các cổng kiểm tra (gates), dữ liệu đầu ra và các điều kiện gỡ chặn (unblock conditions).

---

## 1. Mục đích và Quy tắc Bất biến

- **Readonly mặc định**: CLI `app/scripts/windows-delivery/preflight.mjs` chỉ thực hiện kiểm tra đọc. Không tự spawn ứng dụng hay tiến trình ML, không tự tải file, không tự ghi đè environment/venv có sẵn và không tự tạo/phê duyệt artifact giả.
- **Không hardcode đường dẫn**: Tự động suy ra thư mục gốc repository (`REPO_ROOT`) từ vị trí của script (`import.meta.dirname`), an toàn tuyệt đối với đường dẫn có dấu tiếng Việt và khoảng trắng (ví dụ `D:\Dự án CNTT\Tool Deploy\opspilot`).
- **Phân định rõ ranh giới**: Phân biệt tường minh giữa `source_ready` (đủ điều kiện chạy typecheck/tests mã nguồn), `package_ready` (đủ prerequisite đóng gói NSIS/ASAR) và `clean_windows_ready` (môi trường Windows độc lập không có dev tools).

---

## 2. Hướng dẫn Lệnh Gọi CLI

Chạy từ thư mục gốc của repository với Node 22:

### 2.1. Kiểm kê tổng quát (In báo cáo dạng bảng dễ đọc)

```powershell
node app/scripts/windows-delivery/preflight.mjs
```

Lệnh luôn trả mã thoát `0` khi hoàn tất việc kiểm kê và xuất hiện đầy đủ thông tin môi trường, dependencies, resources và blockers.

### 2.2. Xuất dữ liệu Evidence dạng JSON

```powershell
# In trực tiếp JSON ra stdout:
node app/scripts/windows-delivery/preflight.mjs --json

# Lưu evidence JSON vào thư mục out-scripts (bị git ignore):
node app/scripts/windows-delivery/preflight.mjs --out app/.out-scripts/windows-delivery/inventory.json
```

### 2.3. Kiểm tra chốt chặn (Gate Enforcement)

Dùng trong script CI hoặc pre-commit guard để kiểm tra điều kiện tiên quyết:

```powershell
# Kiểm tra điều kiện source (Node 22, pnpm 11, đúng nhánh):
node app/scripts/windows-delivery/preflight.mjs --gate source
# Exit 0 nếu đạt; Exit 1 nếu không đạt.

# Kiểm tra điều kiện package (cần Python 3.12.10, locked packages, ml-runtime, controller-releases):
node app/scripts/windows-delivery/preflight.mjs --gate package
# Exit 0 nếu đủ; Exit 1 nếu còn thiếu prerequisite.

# Kiểm tra môi trường Windows độc lập (WindowsSandbox/VM):
node app/scripts/windows-delivery/preflight.mjs --gate clean_os

# Kiểm tra toàn bộ mọi gate:
node app/scripts/windows-delivery/preflight.mjs --gate all
```

### 2.4. Kiểm thử đơn vị cho chính CLI Preflight

```powershell
node app/scripts/windows-delivery/preflight.test.mjs
```

---

## 3. Kết quả Kiểm kê Thực tế tại Baseline (17/11/2026)

| Hạng mục | Thực tế máy dev | Yêu cầu chuẩn | Đánh giá | Ghi chú |
|---|---|---|---|---|
| **Hệ điều hành** | Windows 10/11 x64 (10.0.26200) | Windows x64 | **PASS** | Môi trường máy phát triển |
| **Git Branch** | `feat/kim-windows-delivery-20261116` | Đúng nhánh giao | **PASS** | HEAD `7cec5884`, ancestor `f699615` |
| **Node.js** | v22.17.0 | v22.x | **PASS** | Đạt yêu cầu Node 22 |
| **pnpm** | 11.5.1 | 11.1.0 (11.x) | **PASS** | Đạt yêu cầu pnpm 11 |
| **Python** | 3.12.7 | 3.12.10 | **BLOCKED** | Lệch patch version so với lock |
| **Windows Sandbox** | Không có (`WindowsSandbox.exe` absent) | Disposable clean OS | **NOT_RUN** | Chưa có VM/Sandbox độc lập |
| **ML Dependencies** | 10/20 khớp phiên bản | 20/20 theo runtime-lock.json | **BLOCKED** | 10 package lệch (chi tiết mục 4) |
| **ML Runtime Res** | `MISSING` | `app/resources/ml-runtime` | **BLOCKED** | Chưa có runtime bundled |
| **Controller Res** | `CATALOG_MISSING` | 9 descriptors đã duyệt | **BLOCKED** | Chưa có catalog & release binaries |
| **Schema Harness** | Desktop 38 (37 migrations applied) | Desktop 38, bỏ 037 controller | **PASS** | Đã sửa `windows-release-lab.mjs` |
| **Ports 8765-8767** | Tất cả đều FREE (không bị chiếm) | Không tiến trình nào nghe | **PASS** | Sẵn sàng cho app/ML service |

---

## 4. Bảng Chi tiết 10 Package Lệch Phiên bản vs `runtime-lock.json`

| Package | Yêu cầu trong `runtime-lock.json` | Hiện tại trên máy dev | Trạng thái |
|---|---|---|---|
| `annotated-types` | `0.8.0` | `0.7.0` | MISMATCH |
| `anyio` | `4.14.2` | `4.13.0` | MISMATCH |
| `click` | `8.4.2` | `8.3.2` | MISMATCH |
| `idna` | `3.18` | `3.11` | MISMATCH |
| `narwhals` | `2.24.0` | `2.19.0` | MISMATCH |
| `numpy` | `2.5.1` | `2.4.4` | MISMATCH |
| `scikit-learn` | `1.9.0` | `1.8.0` | MISMATCH |
| `scipy` | `1.18.0` | `1.17.1` | MISMATCH |
| `typing-extensions` | `4.16.0` | `4.15.0` | MISMATCH |
| `uvicorn` | `0.52.1` | `0.52.4` | MISMATCH |

> [!WARNING]
> Tuyệt đối không chạy `pip install -U` hoặc sửa `ml-service/runtime-lock.json` để ép lock theo máy dev. Cần dựng venv Python 3.12.10 riêng cài đặt chính xác các phiên bản đã pin.

---

## 5. Danh sách Blockers Đang Mở và Điều Kiện Gỡ Chặn

| Mã Blocker | Gate | Mô tả | Người phụ trách | Điều kiện gỡ chặn (Unblock Condition) |
|---|---|---|---|---|
| `PYTHON_VERSION_MISMATCH` | `package` | Python hiện tại là 3.12.7; runtime-lock yêu cầu 3.12.10 | Kim / Coordinator | Dựng môi trường Python 3.12.10 riêng khớp runtime lock |
| `PYTHON_DEPENDENCIES_MISMATCH` | `package` | 10 package lệch phiên bản so với runtime-lock.json | Kim / Coordinator | Cài đúng exact 20 packages vào venv Python 3.12.10 |
| `ML_RUNTIME_RESOURCE_MISSING` | `package` | `app/resources/ml-runtime` chưa tồn tại | Kim / Coordinator | Chạy `build-ml-runtime.py` với venv Python 3.12.10 đã chuẩn bị |
| `CONTROLLER_RELEASES_MISSING` | `package` | `app/resources/controller-releases` thiếu catalog và binary | Coordinator (Sơn) | Cung cấp release binaries và installer.cjs khớp 9 descriptors |
| `DISPOSABLE_WINDOWS_ENVIRONMENT_UNAVAILABLE` | `clean_os` | Máy dev không có WindowsSandbox.exe; cần máy/VM độc lập | Kim | Thiết lập máy ảo Windows hoặc máy độc lập không dev tools |
