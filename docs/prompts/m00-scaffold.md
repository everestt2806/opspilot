# M00 — Khởi tạo repo & cấu hình build · Người A · Tuần 1

## Mục tiêu
Dựng bộ khung chạy được: `pnpm dev` mở cửa sổ Electron trắng có React, SQLite mở được, ML
service được spawn và `/health` trả 200. Không có nghiệp vụ nào.

## Đọc trước
- `docs/09-moi-truong-dev.md` (mục 2 dependency đã duyệt, mục 3 lệnh khởi tạo, mục 4 bẫy)
- `docs/contracts/schema.sql`

## Việc cần làm

1. **Scaffold Electron**
   ```
   pnpm create @quick-start/electron app --template react-ts
   ```
   Cài đúng danh sách dependency ở `09` mục 2. Chạy `electron-rebuild` cho `better-sqlite3`.

2. **Cấu trúc thư mục** theo `docs/01-ke-hoach.md` PHẦN 2 — tạo thư mục rỗng kèm `.gitkeep`
   cho các module chưa làm, để người kia biết chỗ nào là của mình.

3. **Copy contract sang code** (giữ nội dung **giống hệt**):
   | Nguồn | Đích |
   |---|---|
   | `docs/contracts/schema.sql` | `app/src/main/db/migrations/001_init.sql` |
   | `docs/contracts/ipc-contract.ts` | `app/src/shared/ipc.ts` |
   | `docs/contracts/detector-contract.ts` | `app/src/main/detectors/types.ts` |

4. **Lớp DB** `app/src/main/db/index.ts`
   - Mở SQLite tại `app.getPath('userData')/opspilot.db`
   - `PRAGMA journal_mode=WAL`, `PRAGMA foreign_keys=ON`
   - Chạy migration theo thứ tự tên file, ghi `schema_version`, bỏ qua file đã chạy
   - Export `db` (instance `better-sqlite3`) — dùng đồng bộ, **không** bọc async

5. **Vòng đời ML service** `app/src/main/mlClient.ts`
   - `spawn` `.venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 8765`
   - Poll `GET /health` tối đa 30 giây; thất bại → phát event `system:ml-status {running:false}`
   - Port bận → thử 8766, 8767 rồi báo lỗi rõ ràng
   - **Kill cây tiến trình** khi `before-quit` **và** `process.on('exit')`; trên Windows dùng
     `taskkill /pid <pid> /T /F` (xem `09` mục 4.4)

6. **Khung IPC** `app/src/main/ipc.ts`
   - Hàm `handle<K extends keyof IpcInvokeMap>(channel, fn)` bọc mọi handler trong try/catch,
     luôn trả `IpcResult`, **không bao giờ throw qua ranh giới IPC**
   - `preload.ts` expose `window.api` typed theo `IpcInvokeMap` + `IpcEventMap`
   - `contextIsolation: true`, `nodeIntegration: false`

7. **Khung UI** — `ConfigProvider` dark algorithm + design token ở `docs/02-ui-ux-spec.md` mục 1,
   layout sidebar/topbar ở mục 2, 7 trang rỗng, file `strings.ts` rỗng có sẵn cấu trúc.

8. **Logger** `app/src/main/logger.ts` theo `docs/10-quy-uoc-code.md` mục 4, kèm hàm
   `maskSecrets()` che password/key trong chuỗi log.

9. **Script** trong `package.json`: `dev`, `build`, `test`, `lint`, và các `try:*` (rỗng, thêm dần).

10. **`electron-builder.yml`**: target Windows NSIS, `asarUnpack` cho `better-sqlite3`,
    `extraResources` cho `ml-service/` và `templates/`.

## Định nghĩa xong
- [ ] `pnpm dev` mở app, không lỗi console
- [ ] File SQLite được tạo, `schema_version` = 1, `sqlite3 .tables` thấy đủ 11 bảng theo contract hiện tại
- [ ] Dot ML service ở topbar **xanh**; kill tiến trình python bằng tay → dot chuyển **đỏ**
- [ ] Thoát app → **không còn** tiến trình python mồ côi (kiểm tra Task Manager)
- [ ] `pnpm build` ra file cài đặt, cài lên máy chạy được (chưa cần có tính năng)
- [ ] `pnpm test` chạy (0 test cũng được)

## Cạm bẫy
- Quên `electron-rebuild` → `NODE_MODULE_VERSION mismatch` khi mở DB.
- Quên `asarUnpack` → bản dev chạy tốt, bản đóng gói crash.
- Quên kill tiến trình con → mở app lần 2 báo port 8765 đang dùng.
