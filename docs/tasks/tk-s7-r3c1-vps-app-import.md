# TK-S7 R3c-1 — Nhập app từ VPS

| Chủ | Hạn | Branch | Brief | Ưu tiên |
|---|---|---|---|---|
| Worker | 12/10/2026 | `feat/deploy-reachability` | Checkpoint backend nhập app từ VPS | P1 |

## Mục tiêu

Cho phép nhập ứng viên R3b đã xác minh thành app được quản lý cục bộ. Backend quét lại trạng thái Docker và manifest ngay trước khi ghi, rồi ghi app cùng deployment baseline trong một transaction.

## Được sửa

Phần backend VPS import, DB/migration và repository, IPC, UI liên quan, test, contract IPC và hồ sơ task.

## Không được sửa

Không sửa VPS thật; không push, mở PR hoặc merge. Không thêm dữ liệu deployment, Git, env, secret hoặc đường dẫn local giả. Không bật quản lý dựa trên ID cũ nếu chưa chứng minh an toàn.

## Definition of Done

- [x] Chỉ nhập ứng viên `verified`, xác minh lại bằng chứng Docker/manifest và từ chối snapshot cũ, VPS không tin cậy, app/cổng trùng.
- [x] Ghi app và baseline deployment atomic, provenance riêng, current deployment đúng, deploy kế tiếp dùng N+1; không lưu secret/dữ liệu giả.
- [x] Test nhập thành công, snapshot thay đổi, trùng app/cổng, rollback transaction, gọi lặp, N+1 và dữ liệu không có secret.
- [x] Rà soát thao tác phụ thuộc ID cũ; thao tác không chứng minh an toàn bị khóa.
- [x] Node 22: focused tests, full Vitest, typecheck, lint, build và `git diff --check` pass.
- [x] Commit cục bộ; không push/PR/merge.

## Nhật ký

- START 12/10 — Tiếp tục triển khai R3c-1 đã có trong working tree; chạy lại toàn bộ gate bằng Node 22, hoàn thiện hồ sơ và commit cục bộ.
- UPDATE 12/10 — Focused import/DB/deploy/discovery/UI tests 59/59; monitor 22/22, MigratePage 20/20, DashboardPage 8/8. Full Vitest 747/747 với `--maxWorkers=2`; typecheck, lint, build và `git diff --check` PASS trên Node 22.23.3. Lint có 0 errors và 6480 warnings về format/CRLF. Không kết nối hoặc sửa VPS thật.

## Lệnh tái hiện

Node 22.23.3 trong PATH; `pnpm --filter @opspilot/app exec vitest run src/main/vps/importService.test.ts src/main/db/index.test.ts src/main/db/appRepository.test.ts src/main/deploy/service.test.ts src/main/vps/discovery.test.ts src/renderer/src/components/VpsAppsTab.test.tsx src/renderer/src/pages/AppsPage.test.tsx`, `pnpm --filter @opspilot/app exec vitest run --maxWorkers=2`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `git diff --check`.

## PR

Chưa mở theo yêu cầu.
