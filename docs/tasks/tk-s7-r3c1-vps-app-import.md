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
- HANDOFF-LOCAL 12/10 — Code commit `e901b0c` · gate Node 22 pass như trên · live VPS NOT_RUN; app nhập bị giới hạn thao tác quản lý chưa chứng minh an toàn.
- FOLLOW-UP 12/10 — `docs/contracts/schema.sql` đồng bộ migration 009. Bổ sung kiểm chứng v8→v9 giữ ID/dữ liệu cho activation, metric, score, alert, doctor run/action và experiment, `foreign_key_check` sạch; lỗi giữa migration rollback đủ. Import UI yêu cầu xác nhận và hiển thị app/image/version/port cùng nhãn “Chỉ đọc sau khi nhập”; test hủy/xác nhận và copy 4 locale pass. Đã xử lý 459 cảnh báo lint trong ba file checkpoint (15 `index.test.ts`, 427 test UI, 17 `strings.ts`); cảnh báo còn lại toàn repo 6.086, 0 trong file checkpoint đã sửa. Node 22.23.3: focused 17/17; full Vitest 751/751; typecheck/build/diff check pass; lint 0 errors, 6.086 warnings. Live VPS NOT_RUN.
- HANDOFF-LOCAL 12/10 — Follow-up commit `84ff9c8` · focused 17/17, full Vitest 751/751, typecheck/build/diff check PASS, lint 0 errors / 6.086 warnings ngoài file checkpoint · live VPS NOT_RUN; chưa push.

## Lệnh tái hiện

Node 22.23.3 trong PATH; `pnpm --filter @opspilot/app exec vitest run src/main/db/index.test.ts src/renderer/src/components/VpsAppsTab.test.tsx`, `pnpm --filter @opspilot/app exec vitest run --maxWorkers=2`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, `git diff --check`.

## PR

Chưa mở theo yêu cầu.

- MONITOR-GUARD 12/10/2026 - Repository listTargets/getTarget exclude imported_from_vps=1 and vps_import baselines; pollAll reconciliation, getSetting/setSetting, alert labeling and manual train paths are guarded. Migration-009-backed test proves pollAll reads metrics only for a normal OpsPilot app, imported baseline rows/offset/activations remain unchanged, direct poll does not read source, and manual training is rejected. Focused monitor/import tests 49/49; Node 22.23.3 typecheck PASS; scoped ESLint 0 warnings; full lint 0 errors / 6,081 warnings (remaining outside changed files); full Vitest/build pending at note time; git diff --check PASS. No live VPS operations.
- FINAL-GATES 12/10/2026 - Node 22.23.3: focused 54/54, full Vitest 752/752 (75 files), typecheck PASS, full lint 0 errors / exactly 6,081 warnings, build PASS, git diff --check PASS. Scoped ESLint for changed source/test files: 0 warnings. Committed locally; no push/PR/merge and no live VPS access.
