# Cấu hình Product trong Electron — R7h-2b

```powershell
. ./tools/enter-node22.ps1
node app/scripts/product-environment-desktop-lab/run.mjs --confirm-local-environment-ui
```

Cần production build hiện hành (`pnpm --prefix app build`) để dùng preload thật.
Runner tạo profile riêng trong `.out-scripts`, không mở userData của người dùng.
Main service, vault/journal và hai SQLite DB chạy thật; SSH channel và controller
transport là fixture nội bộ, không kết nối VPS. Server staging gọi repository
production với crypto thật; không giả lập kết quả ghi revision.

Gate kiểm chứng:

- Component sản phẩm qua preload typed IPC/Main service, bốn locale và dark/light,
  1280×800 cùng 1366×768; không cuộn ngang cửa sổ/modal.
- Nhập biến runtime bằng password input, prepare mã hóa; form xóa giá trị, chưa gửi
  remote và không lưu giá trị trong localStorage hoặc các SQLite file.
- Mất reply sau controller commit: UI báo unknown; đóng/reopen DB và Main service,
  tra metadata bằng cùng UUID trả đúng một revision đã lưu, không tạo deployment.
- Chỉ metadata/tên biến xuất hiện trong UI. Ảnh chụp sau xóa form, không giá trị.

Ảnh tại `docs/ui-redesign/screenshots/r7h2b/<nonce>/`; proof tại
`app/.out-scripts/product-environment-desktop-lab/<nonce>/result.json`.
Electron đóng cửa sổ/DB trước, runner chỉ dọn đúng profile thuộc nonce sau khi
process thoát vì Chromium giữ khóa profile khi đang chạy. Không xóa profile lạ.

`fixture.ts` chỉ được dùng bởi tests/lab, không bundle vào app sản phẩm. Không gọi
native Electron test này là SSH/VPS/reboot/controller-upgrade gate. Installed
release cũ chưa có operation/schema mới; rollout cần checkpoint độc lập. Config
vẫn staged, chưa source activation/deploy env/PostgreSQL.
