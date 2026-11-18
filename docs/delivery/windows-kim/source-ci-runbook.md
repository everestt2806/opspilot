# Runbook Source CI & Quy trình Kiểm thử Mã nguồn Windows (CP1 / R1-R7 & S4-S5)

Tài liệu hướng dẫn vận hành workflow CI nguồn `.github/workflows/windows-delivery-source.yml` và quy trình chạy runner thống nhất (`source-check.mjs`) được cập nhật theo kết quả review ngày 18/11/2026 của Leader (S4, S5, R7).

---

## 1. Giới thiệu Workflow GitHub Actions

Workflow `.github/workflows/windows-delivery-source.yml` được thiết kế cho luồng phát triển Windows Delivery:
- **Runner**: Windows Server (`windows-latest`).
- **Trigger**: `workflow_dispatch` (ưu tiên kích hoạt thủ công khi cần), hoặc `push`/`pull_request` trên các nhánh `feat/kim-windows-delivery-*`.
- **Phạm vi bảo mật**: Quyền hạn tối thiểu `contents: read`. Không sử dụng secrets, không kết nối production database/VPS, không publish release artifact.
- **Single Shared Runner Execution (R2)**: Workflow gọi trực tiếp entrypoint thống nhất `node app/scripts/windows-delivery/source-check.mjs` để thực hiện toàn bộ kiểm tra và thu thập evidence tập trung.
- **Thu thập chẩn đoán toàn diện (R7)**: Luôn upload toàn bộ thư mục evidence `app/.out-scripts/windows-delivery/` (bao gồm raw logs per-step, inventory JSON, vitest results JSON, và checksum manifest `SHA256SUMS`) với điều kiện `if: always()`, lưu trữ 14 ngày.

> [!NOTE]
> Thành công ở Source CI (Source Build & Gates) xác nhận tính toàn vẹn của mã nguồn và tooling, nhưng **chưa đồng nghĩa với việc đóng gói sản phẩm (Packaging) đạt PASS**. Packaging chỉ được nghiệm thu khi đã có đủ các tài nguyên đã phê duyệt ở CP2.

---

## 2. Quy trình Thực thi của Unified Runner (`source-check.mjs`)

Runner thống nhất thực hiện tuần tự 8 bước chốt chặn nghiêm ngặt:

| Bước | Tên bước | Lệnh thực thi | Thư mục | Mục đích & Ràng buộc (S4/S5) |
|---|---|---|---|---|
| **1** | `git_diff_check` | `git diff --check` | `REPO_ROOT` | Đảm bảo không có whitespace conflicts, trailing spaces hoặc merge markers. |
| **2** | `scoped_eslint` | `pnpm.cmd exec eslint scripts/windows-delivery scripts/windows-release-lab.mjs --max-warnings=0` | `APP_DIR` | Kiểm tra linting và formatting cho toàn bộ script thuộc quyền sở hữu của Kim (0 errors, 0 warnings). |
| **3** | `preflight_source_gate` | `node app/scripts/windows-delivery/preflight.mjs --gate source --out <runDir>/preflight-inventory.json --overwrite` | `REPO_ROOT` | **(S4 Mandatory Gate)**: Xác minh điều kiện tiên quyết nhánh, baseline commit, exact pnpm version (11.1.0), và xuất file kê khai inventory. |
| **4** | `preflight_standalone_checks` | `node app/scripts/windows-delivery/preflight-check.mjs` | `REPO_ROOT` | **12 probes độc lập**: CLI guards, sentinel overwrite protection, contract parity cho ML và Controller releases, và profile backup round-trip. |
| **5** | `typecheck_node_and_web` | `pnpm.cmd typecheck` | `APP_DIR` | Kiểm tra kiểu TypeScript cho Main, Preload và Renderer. |
| **6** | `typecheck_scripts` | `pnpm.cmd exec tsc -p tsconfig.scripts.json --noEmit` | `APP_DIR` | Kiểm tra kiểu TypeScript cho toàn bộ tool scripts. |
| **7** | `source_build_compilation` | `pnpm.cmd build` | `APP_DIR` | Biên dịch bundle Main (`out/main`), Preload (`out/preload`), Renderer (`out/renderer`). |
| **8** | `vitest_full_suite` | `pnpm.cmd exec vitest run --reporter=default --reporter=json ...` | `APP_DIR` | Chạy toàn bộ test suites. Ghi nhận `signal`, `error`, và timeout; phân loại lỗi delivery vs lỗi ngoài phạm vi (`outside_scope_failures`). |

---

## 3. Lệnh Chạy Cục bộ & Phân biệt Chế độ Chạy (S4)

### 3.1. Chế độ Đầy đủ Nghiệm thu (Full Acceptance Mode)
Bắt buộc chạy toàn bộ 8 bước (bao gồm full Vitest suite):
```powershell
node app/scripts/windows-delivery/source-check.mjs
```
- Khi chạy hoàn tất, runner tạo một thư mục nonce độc lập chứa đầy đủ bằng chứng và `SHA256SUMS`.
- **Exit Code**:
  - `0`: Toàn bộ 8 bước PASS (tất cả tests của hệ thống đều xanh).
  - `1`: Bước kiểm tra thất bại, hoặc 0 test delivery thất bại nhưng có lỗi ngoài phạm vi (`PARTIAL_OUTSIDE_SCOPE_FAILURES`).
  - `2`: Lỗi tham số CLI hoặc lỗi cấu hình.

### 3.2. Chế độ Kiểm tra Nhanh Cục bộ (Fast Mode - Không dùng cho Nghiệm thu CI)
Dành cho vòng lặp sửa code nhanh giữa các file script:
```powershell
node app/scripts/windows-delivery/source-check.mjs --skip-vitest
```
- **Ràng buộc Chế độ Nhanh (S4)**:
  - Bước 8 (`vitest_full_suite`) được đánh dấu trạng thái `NOT_RUN`.
  - Trạng thái tổng thể được ghi là `INCOMPLETE_FAST_MODE` (không được ghi `PASS`).
  - Phạm vi (`scope`) ghi rõ `windows_delivery_fast_mode`.
  - Quy trình CI chính thức **tuyệt đối không được sử dụng `--skip-vitest`**.

---

## 4. Xử lý Lỗi Ngắt quãng & Bất thường của Vitest (S5)

Theo yêu cầu S5 của Leader Review:
1. **Ghi nhận Tín hiệu & Lỗi Chi tiết**:
   - `runStep` ghi nhận `result.status`, `result.signal`, `result.error` và cờ `timed_out` (nếu timeout).
2. **Không Tự ý Kết luận Baseline khi Test Bị Ngắt**:
   - Nếu Vitest kết thúc bất thường (exit code null, bị kill bởi signal, timeout, hoặc không tạo ra file JSON tổng hợp hợp lệ), bước 8 được đánh dấu `ABNORMAL_TERMINATION_OR_TIMEOUT`.
   - Báo cáo ghi nhận `overall_status = "FAIL"`, `delivery_failures_count = null`, và **tuyệt đối không ghi `REGRESSION: NONE` hay `PARTIAL_BLOCKED_ON_BASELINE`**.
3. **Phân loại Lỗi Khách quan (Outside Scope Failures)**:
   - Khi toàn bộ test hoàn thành và file kết quả JSON hợp lệ:
     - Nếu số test delivery thất bại = 0, nhưng có test trong `src/**` thất bại: báo cáo phân loại là `outside_scope_failures` (`outside_scope_unverified_baseline`), ghi rõ `delivery_status: "DELIVERY_PASS_OUTSIDE_SCOPE_FAILURES"` và `overall_status: "PARTIAL_OUTSIDE_SCOPE_FAILURES"`.

---

## 5. Cấu trúc Bằng chứng & Báo cáo Nonce (R7 & S4)

Mỗi lần chạy của runner tạo một thư mục nonce độc lập:
`app/.out-scripts/windows-delivery/source-runs/<run-nonce>/`

Cấu trúc thư mục:
```text
source-runs/<run-nonce>/
├── source-check-report.json      # Báo cáo tổng thể JSON kèm provenance (SHA, branch, dirty hash)
├── preflight-inventory.json      # Kết quả kiểm tra inventory nguồn (Step 3 - S4)
├── SHA256SUMS                    # Checksums manifest cho toàn bộ artifact sinh ra
├── vitest-results.json           # Dữ liệu JSON chi tiết của Vitest (nếu chạy bước 8)
└── logs/
    ├── git_diff_check.stdout.log
    ├── git_diff_check.stderr.log
    ├── scoped_eslint.stdout.log
    ├── scoped_eslint.stderr.log
    ├── preflight_source_gate.stdout.log
    ├── preflight_source_gate.stderr.log
    ├── preflight_standalone_checks.stdout.log
    ├── preflight_standalone_checks.stderr.log
    ├── typecheck_node_and_web.stdout.log
    ├── typecheck_node_and_web.stderr.log
    ├── typecheck_scripts.stdout.log
    ├── typecheck_scripts.stderr.log
    ├── source_build_compilation.stdout.log
    ├── source_build_compilation.stderr.log
    ├── vitest_full_suite.stdout.log
    └── vitest_full_suite.stderr.log
```

Runner đồng thời cập nhật:
- `app/.out-scripts/windows-delivery/source-check-latest.json`: Con trỏ đến thư mục run mới nhất.
- `app/.out-scripts/windows-delivery/source-check-evidence.json`: Bản sao report mới nhất cho các công cụ CI đọc cố định.
- **Bảo vệ Ghi đè (R7)**: Nếu người dùng truyền `--out-dir` tùy chỉnh trỏ tới một thư mục đã tồn tại, runner sẽ từ chối ghi đè và thoát với mã `2` trừ khi cờ `--overwrite` được truyền kèm.
