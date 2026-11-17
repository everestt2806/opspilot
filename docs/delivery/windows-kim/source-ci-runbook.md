# Runbook Source CI & Quy trình Kiểm thử Mã nguồn Windows (CP1)

Tài liệu hướng dẫn vận hành workflow CI nguồn `.github/workflows/windows-delivery-source.yml` và quy trình chạy tương đương cục bộ (local equivalent) để kiểm chứng trước khi commit/push.

---

## 1. Giới thiệu Workflow GitHub Actions

Workflow `.github/workflows/windows-delivery-source.yml` được thiết kế cho luồng phát triển Windows Delivery của Kim:
- **Runner**: Windows Server (`windows-latest`).
- **Trigger**: `workflow_dispatch` (kích hoạt thủ công khi cần), hoặc `push`/`pull_request` trên các nhánh `feat/kim-windows-delivery-*`.
- **Phạm vi bảo mật**: Quyền hạn tối thiểu `contents: read`. Không sử dụng secrets, không kết nối production database/VPS, không publish release artifact.
- **Mục tiêu**: Xác thực rằng toàn bộ mã nguồn, cấu hình TypeScript, unit tests của delivery, và quá trình biên dịch (Vite Main/Preload/Renderer) hoàn toàn đạt chuẩn trên hệ điều hành Windows runner mà không phụ thuộc vào các binary resources chưa duyệt (`ml-runtime` và `controller-releases`).

> [!NOTE]
> Thành công ở Source CI (Source Build Only) chứng minh tính toàn vẹn của mã nguồn và tooling, nhưng **chưa đồng nghĩa với việc đóng gói sản phẩm (Packaging) đạt PASS**. Packaging chỉ được kích hoạt và đánh giá khi đã có đủ các tài nguyên đã phê duyệt ở CP2.

---

## 2. Lệnh Chạy Cục bộ Tương Đương (Local Equivalent)

Để kiểm chứng toàn bộ các bước CI ngay trên máy phát triển trước khi commit hoặc khi không quan sát được GitHub Actions:

### 2.1. Lệnh duy nhất (Unified Runner)

```powershell
node app/scripts/windows-delivery/source-check.mjs
```

Script này tự động thực thi tuần tự 6 cổng kiểm tra, ghi log chi tiết, xuất kết quả ra file bằng chứng `app/.out-scripts/windows-delivery/source-check-evidence.json`, và lan truyền mã thoát (exit code `0` nếu toàn bộ PASS, `1` nếu có bước thất bại).

### 2.2. Chi tiết từng bước kiểm tra tương ứng trong CI

| Bước trong CI | Lệnh tương đương cục bộ | Thư mục chạy | Mục đích |
|---|---|---|---|
| **1. Git Diff Check** | `git diff --check` | `REPO_ROOT` | Đảm bảo không có xung đột whitespace/merge markers |
| **2. Preflight Source Gate** | `node app/scripts/windows-delivery/preflight.mjs --gate source` | `REPO_ROOT` | Xác nhận Node 22, pnpm 11, đúng nhánh phát triển |
| **3. Typecheck Node/Web** | `pnpm.cmd --prefix app typecheck` | `REPO_ROOT` | Kiểm tra TypeScript cho Main và Renderer |
| **4. Typecheck Scripts** | `pnpm.cmd --prefix app exec tsc -p tsconfig.scripts.json --noEmit` | `REPO_ROOT` | Kiểm tra TypeScript cho các scripts công cụ |
| **5. Delivery Unit Tests** | `node app/scripts/windows-delivery/preflight.test.mjs` | `REPO_ROOT` | Kiểm thử argument, exit code và schema của Preflight CLI |
| **6. Source Compilation** | `pnpm.cmd --prefix app build` | `REPO_ROOT` | Biên dịch bundle Main (`out/main`), Preload (`out/preload`), Renderer (`out/renderer`) |

---

## 3. Dữ liệu Bằng chứng (Evidence Artifacts)

Khi workflow CI chạy (hoặc khi chạy `source-check.mjs` cục bộ), các file sau được sinh ra trong thư mục git-ignored `app/.out-scripts/windows-delivery/`:

1. `source-check-evidence.json`: Tóm tắt trạng thái từng bước, thời gian chạy, mã thoát và log snippet.
2. `cp0-inventory.json`: Kết quả kiểm kê toàn bộ hệ thống, versions, lockfile comparison, và danh sách blockers.

File artifacts trong GitHub Actions được lưu trữ 14 ngày thông qua `actions/upload-artifact@v4` với điều kiện `if: always()`, đảm bảo luôn thu thập được chẩn đoán ngay cả khi có bước thất bại.
