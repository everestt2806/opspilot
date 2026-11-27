# Lab E3 nhận lại dự án và readonly inspector

Node22, native module Electron của app và dependencies đã cài. Không dùng profile
hoặc VPS thật. Đóng các lab GUI khác trước khi chạy.

```powershell
. ./tools/enter-node22.ps1
node app/scripts/run-as-node.js app/scripts/product-project-reconnection-ui-lab/run.mjs --confirm-local-project-reconnection-ui-main
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
pnpm --prefix app exec electron scripts/product-project-reconnection-ui-lab/electron.mjs --confirm-local-project-reconnection-ui
```

Standalone dùng hai SQLite, cipher/vault/consent/inspector class thật; đọc tables,
rows và reopen SQLite; foreign DB, policy drift không được trả data. Admin/target
là synthetic adapter, không SSH/Docker. Không gọi reopen SQLite là OS restart.

Electron dùng production component, preload và Main classes; router lab chỉ nối
năm IPC mới vào các class đó. Đây không phải production service composition hay
installed Root/SSH proof; E2 có proof riêng cho boundary installed, E4 cần release
và serving acceptance. Các unit IPC kiểm wiring service thật riêng.

Fixture có registration nguồn cũ nhưng không có selection receipt PG nguồn2.
E3 dùng consent039 riêng, giữ nguyên setup/ENV/PG receipt cũ; không giả context
registration generation1 để mở inspector. Target response là metadata preflight
thật cộng dữ liệu/instance giả đã ghi rõ trong proof. Không provision PG hay deploy.

GUI kiểm 4locale ×2theme ×2size, explicit consent, mất reply rồi tra lại không
resend, inspector/clear on close và policy drift. Ảnh chụp có kiểm paint/overflow;
raw result và private scratch tại `app/.out-scripts/product-project-reconnection-ui-lab/<nonce>`.
Private SQLite được dọn; ảnh tại `docs/ui-redesign/screenshots/r7h4e3/<nonce>`.
Không ghi token/credential/samples vào proof; journal chỉ lưu consent metadata mã hóa.
