# Runbook Source CI & Quy trình Kiểm thử Mã nguồn Windows (CP1 / R1-R7)

Tài liệu hướng dẫn vận hành workflow CI nguồn `.github/workflows/windows-delivery-source.yml` và quy trình chạy runner thống nhất (`source-check.mjs`) được cập nhật theo kết quả review ngày 17/11/2026 của Leader.

---

## 1. Giới thiệu Workflow GitHub Actions

Workflow `.github/workflows/windows-delivery-source.yml` được thiết kế cho luồng phát triển Windows Delivery:
- **Runner**: Windows Server (`windows-latest`).
- **Trigger**: `workflow_dispatch` (ưu tiên kích hoạt thủ công khi cần), hoặc `push`/`pull_request` trên các nhánh `feat/kim-windows-delivery-*`.
- **Phạm vi bảo mật**: Quyền hạn tối thiểu `contents: read`. Không sử dụng secrets, không kết nối production database/VPS, không publish release artifact.
- **Single Shared Runner Execution (R2)**: Không chạy lặp lại các bước typecheck/test/build hai lượt. Workflow gọi trực tiếp entrypoint thống nhất `node app/scripts/windows-delivery/source-check.mjs` để thực hiện toàn bộ kiểm tra và thu thập evidence tập trung.
- **Thu thập chẩn đoán toàn diện (R7)**: Luôn upload toàn bộ thư mục evidence `app/.out-scripts/windows-delivery/` (bao gồm raw logs per-step, vitest results JSON, và checksum manifest `SHA256SUMS`) với điều kiện `if: always()`, lưu trữ 14 ngày.

> [!NOTE]
> Thành công ở Source CI (Source Build & Gates) xác nhận tính toàn vẹn của mã nguồn và tooling, nhưng **chưa đồng nghĩa với việc đóng gói sản phẩm (Packaging) đạt PASS**. Packaging chỉ được nghiệm thu khi đã có đủ các tài nguyên đã phê duyệt ở CP2.

---

## 2. Quy trình Thực thi của Unified Runner (`source-check.mjs`)

Runner thống nhất thực hiện tuần tự 7 bước chốt chặn:

| Bước | Tên bước | Lệnh thực thi | Thư mục | Mục đích & Ràng buộc |
|---|---|---|---|---|
| **1** | `git_diff_check` | `git diff --check` | `REPO_ROOT` | Đảm bảo không có whitespace conflicts, trailing spaces hoặc merge markers. |
| **2** | `scoped_eslint` | `pnpm.cmd exec eslint scripts/windows-delivery scripts/windows-release-lab.mjs` | `APP_DIR` | Kiểm tra linting và formatting cho toàn bộ file thay đổi thuộc phạm vi Kim (0 errors, 0 warnings). |
| **3** | `preflight_standalone_checks` | `node app/scripts/windows-delivery/preflight-check.mjs` | `REPO_ROOT` | 11 probes kiểm tra tính năng CLI, cờ `--gate`, bảo vệ ghi đè sentinel, và xác minh tài nguyên rỗng/tamper. |
| **4** | `typecheck_node_and_web` | `pnpm.cmd typecheck` | `APP_DIR` | Kiểm tra TypeScript cho Main, Preload và Renderer. |
| **5** | `typecheck_scripts` | `pnpm.cmd exec tsc -p tsconfig.scripts.json --noEmit` | `APP_DIR` | Kiểm tra TypeScript cho toàn bộ tool scripts. |
| **6** | `source_build_compilation` | `pnpm.cmd build` | `APP_DIR` | Biên dịch bundle Main (`out/main`), Preload (`out/preload`), Renderer (`out/renderer`). |
| **7** | `vitest_full_suite` | `pnpm.cmd exec vitest run --reporter=default --reporter=json ...` | `APP_DIR` | Chạy toàn bộ 184 test files (2653 tests) của dự án. Phân tích kết quả tách bạch lỗi delivery (0 fail) vs lỗi baseline ngoài phạm vi. |

---

## 3. Lệnh Chạy Cục bộ

```powershell
# Chạy đầy đủ toàn bộ 7 bước (bao gồm full Vitest suite ~3-4 phút):
node app/scripts/windows-delivery/source-check.mjs

# Chạy nhanh 6 bước đầu bỏ qua full Vitest (dành cho vòng lặp code nhanh cục bộ):
node app/scripts/windows-delivery/source-check.mjs --skip-vitest
```

---

## 4. Cấu trúc Bằng chứng & Báo cáo Nonce (R7)

Mỗi lần chạy của runner tạo một thư mục nonce độc lập:
`app/.out-scripts/windows-delivery/source-runs/<run-nonce>/`

Cấu trúc thư mục:
```text
source-runs/<run-nonce>/
├── source-check-report.json      # Báo cáo tổng thể JSON kèm provenance (SHA, branch, dirty hash)
├── SHA256SUMS                    # Checksums manifest cho toàn bộ artifact sinh ra
├── vitest-results.json           # Dữ liệu JSON chi tiết của Vitest (nếu chạy bước 7)
└── logs/
    ├── git_diff_check.stdout.log
    ├── git_diff_check.stderr.log
    ├── scoped_eslint.stdout.log
    ├── scoped_eslint.stderr.log
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

---

## 5. Lan truyền Mã thoát (Exit Code Propagation)

- **Exit 0**: Khi toàn bộ 7 bước đều đạt `PASS` (bao gồm full test suite).
- **Exit 1**: Khi có bất kỳ bước nào thất bại. Nếu toàn bộ bước của Kim đạt nhưng full Vitest bị chặn bởi baseline test failures ngoài phạm vi, trạng thái được ghi là `PARTIAL_BLOCKED_ON_BASELINE` và runner vẫn trả exit `1` để không đánh lừa pipeline CI là đã xanh toàn bộ.
- **Exit 2**: Lỗi tham số hoặc lỗi thực thi nghiêm trọng.
