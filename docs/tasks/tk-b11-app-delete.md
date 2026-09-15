# TK-B11 — Tính năng xóa app (`app:delete`): xóa mềm, dọn VPS, giải phóng port, giữ data train ML

> Quy trình, vòng đời và quy tắc cập nhật bắt buộc: [`README.md`](README.md).
> Trạng thái nằm ở [`board.md`](board.md) — file này chỉ giữ hồ sơ và nhật ký.

| Chủ | Hạn | Branch | Brief | Ưu tiên |
|---|---|---|---|---|
| B (A review) | 24/09/2026 | `feat/app-delete` (từ `main`) | Tính năng mới — làm SAU TK-B12 | P1 |

## Mục tiêu

Tool hiện **không có cách nào xóa app**: không có kênh IPC `app:delete`, không có method xóa
trong `AppRepository`, không có nút ở UI. Hệ quả: app migrate hỏng chiếm port (30000-30999)
vĩnh viễn; mỗi lần test lại app mới chiếm port mới, phải chỉnh port forwarding trên panel nhà
cung cấp.

Quyết định sản phẩm (B chốt 15/09):
1. **Xóa mềm**: xóa = dọn container/thư mục trên VPS + ẩn khỏi UI + trả port, nhưng **toàn bộ
   dữ liệu DB giữ nguyên** (metric_sample, score_sample, alert, deployment, migration_job) vì
   ML cần dữ liệu thật để train.
2. **Chỉ xóa khi VPS online**: dọn remote thành công thì mới đánh dấu xóa.
3. **Ghi 1 dòng `app_delete` vào action_log** (trang Lịch sử).

Làm trên nhánh riêng `feat/app-delete` (từ `main`), không đụng nhánh fix migrate. Thay đổi
contract theo quy trình CLAUDE.md mục 5 (tiền lệ: dòng DECISIONS 2026-08-24 thêm `vps:scan` +
`db:*`).

## Thiết kế đã chốt

### 1. Migration + schema (contract change)

- `app/src/main/db/migrations/004_soft_delete_app.sql` (mới, KHÔNG sửa 001-003):
  - `ALTER TABLE app ADD COLUMN deleted_at TEXT;`
  - Rebuild `action_log` vì SQLite không ALTER được CHECK (giá trị CHECK tại `schema.sql:267-272`
    chưa có `app_delete`): tạo `action_log_new` đúng định nghĩa cũ + thêm `'app_delete'` vào
    CHECK → `INSERT INTO action_log_new SELECT * FROM action_log` → DROP cũ → RENAME.
- `app/src/main/db/index.ts`: import + đăng ký migration 004.
- `docs/contracts/schema.sql`: thêm cột `deleted_at TEXT` vào bảng `app` + thêm `'app_delete'`
  vào CHECK của `action_log`.
- Type `App` (`app/src/shared/ipc.ts`): thêm `deleted_at?: string | null`.

### 2. Repository

- `app/src/main/db/appRepository.ts`:
  - `softDelete(id, deletedAt)` — `UPDATE app SET deleted_at=? WHERE id=?`.
  - `listAll()` / `listByVps()` / `usedPorts()` (dòng ~88-93): thêm `WHERE deleted_at IS NULL`
    → port tự giải phóng vì `allocatePort` đọc từ `usedPorts`.
  - `getById` giữ nguyên (trả cả app đã xóa — phục vụ xem data cũ).
- `app/src/main/db/deploymentRepository.ts`: thêm `inFlightForApp(appId)` —
  `SELECT 1 FROM deployment WHERE app_id=? AND status IN ('building','deploying') LIMIT 1`.

### 3. Service — `DeployService.deleteApp(appId)` (`app/src/main/deploy/service.ts`)

Constructor thêm `MigrationRepository` + `ActionLogRepository`. Flow:

1. `getById` — VALIDATION nếu không có / đã xóa rồi.
2. Guard trong `withAppLock(appId, ...)` (`monitor/appLock.ts`): migration active → VALIDATION;
   deployment in-flight → VALIDATION.
3. Dọn remote — lệnh copy nguyên từ `MigrateService.cleanupTarget` (`migrate/service.ts:869-887`):
   `target_dir=...; if [ -f "$target_dir/docker-compose.yml" ]; then cd "$target_dir" && docker
   compose down -v; fi; rm -rf -- "$target_dir"` (`shellQuote`, `retryOnReconnect: false`,
   `timeoutMs: 120_000`). Thư mục không tồn tại thì `rm -rf` vẫn exit 0. SSH fail / exit ≠ 0 →
   AppError tiếng Việt, KHÔNG đánh dấu xóa.
4. Thành công → transaction: `softDelete(appId, ISO-8601-UTC)` + `actionLog.insert({ action:
   'app_delete', status: 'success', vps_id, app_id, detail_json })`.

Đã loại: KHÔNG mượn CLEAN_COMMAND của `clean-demo-vms.ts` (filter compose label quét toàn VPS).

### 4. Chặn rò rỉ app đã xóa vào luồng khác

- `app/src/main/monitor/repository.ts` `listTargets` (dòng 71-77): thêm
  `AND a.deleted_at IS NULL` — không thì poller spam lỗi vào app đã dọn.
- `app/src/main/migrate/service.ts` `validateInput` (dòng 208-223): chặn migrate app nguồn đã
  xóa mềm.
- `app:list` đã qua `listByVps` filter → UI Deploy/Migrate tự không thấy app đã xóa.

### 5. IPC

- `docs/contracts/ipc-contract.ts` (khối App, sau dòng 176):
  `'app:delete': (appId: number) => IpcResult<void>;`
- `app/src/shared/ipc.ts` (mirror y hệt).
- `app/src/main/ipc.ts` (sau dòng 109):
  `handle('app:delete', (appId) => deployService.deleteApp(appId))`.
- Preload generic — không đổi; `app/src/main/index.ts` không đổi.

### 6. UI (`app/src/renderer/src/components/VpsAppsTab.tsx`)

- Nút danger "Xóa" (`DeleteOutlined`, `size small`, `danger`) vào cột actions (dòng 158-182),
  cột 180 → 240.
- Confirm 2 lớp copy pattern `VpsPage.deleteVps` (`VpsPage.tsx:99-131`): `Modal.useModal()` +
  2 `modal.confirm` lồng, `okButtonProps: { danger: true }`; lỗi hiện trong modal, thành công →
  `await load()`.
- Cảnh báo: xóa vĩnh viễn container/volume/thư mục trên VPS; cổng được cấp lại; **dữ liệu
  metric/lịch sử giữ lại phục vụ train ML**.
- State `deletingId` cho loading; strings vào `app/src/renderer/src/strings.ts` dưới
  `vpsControl.apps.delete` — tiếng Việt.

### 7. Docs

- `DECISIONS.md` (sau dòng 40): 1 dòng về `app:delete` xóa mềm + lý do giữ metric train ML +
  CHECK action_log.
- `docs/02-ui-ux-spec.md` (dòng 86-87): + 1 câu nút xóa app.
- Task file này + dòng board (đã có).

## Test

- `appRepository.test.ts`: softDelete + filter listAll/listByVps/usedPorts.
- `deploy/service.test.ts` describe `deleteApp`: migration active → VALIDATION; deployment
  building → VALIDATION; SSH throw → không xóa; exec exit 1 → không xóa; thành công →
  deleted_at set + action_log `app_delete` + usedPorts hết port cũ + deployment/metric rows vẫn
  còn; xóa 2 lần → VALIDATION.
- `ipc.test.ts`: handler map đúng service.
- Monitor test: listTargets bỏ app đã xóa mềm.
- UI test (nếu theo pattern VpsPage.test.tsx): double-confirm + invoke + reload.

## Verification

1. `pnpm exec vitest run && pnpm run typecheck && pnpm run build` — xanh.
2. Mở demo CMD: VM01 → tab Ứng dụng → xóa 2 app Vite hỏng → biến mất; SSH kiểm tra hết
   container/thư mục.
3. Deploy app mới lên VM01 → được cấp port 30000.
4. Trang Lịch sử có dòng `app_delete`; `SELECT COUNT(*) FROM metric_sample ...` của app đã xóa
   vẫn > 0.

## Nhật ký

- START 15/09 — B chốt yêu cầu + thiết kế sau Q&A (xóa mềm giữ data ML, chỉ xóa khi VPS online,
  log action_log). Ghi plan để build sau TK-B12.

## Lệnh tái hiện

Chưa có code — thực hiện theo phần Thiết kế.

## PR

Chưa mở — làm sau TK-B12, chờ A duyệt push theo quy ước nhóm.
