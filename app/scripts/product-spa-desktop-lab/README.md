# R7b — Product SPA qua Desktop và runtime thật

> Cập nhật R7e13/11: các giới hạn cuối file là phạm vi lịch sử R7b. SPA đã qua
> release/live R7c và auto R7d. R7e thêm Next.js vào source/local gate; installed
> controller vẫn cần release/rollout riêng cho Next, không suy đã có từ code UI.

Sau `. ./tools/enter-node22.ps1`, từ repo root:

```powershell
pnpm.cmd --prefix app build
pnpm.cmd --prefix app exec tsc -p scripts/product-spa-desktop-lab/tsconfig.json
pnpm.cmd --prefix app exec electron scripts/product-spa-desktop-lab/electron.mjs
```

Gate Electron dùng widget production, preload production, typed IPC, Main
DesktopProjectSetups, SQLite031 và encrypted vault riêng. Chỉ controller admin
transport/target là synthetic: không dùng VPS hoặc profile sản phẩm, không gọi
đó là bằng chứng SSH thật. Chọn Vite SPA, kiểm cổng80/path`/`, xem lại và gửi
metadata, kiểm journal giữ framework và response khác framework không được gửi.
4locale×2theme,1280×800; thêm1366×768 cho tiếng Việt. Đo overflow trước từng ảnh.
Private SQLite được đóng/xóa; report/cache fixture nằm trong
`app/.out-scripts/product-spa-desktop-lab/<nonce>/`, ảnh trong
`docs/ui-redesign/screenshots/r7b/<nonce>/`.

Gate runtime riêng trên Linux/WSL, Node22, modules Linux và Docker daemon thật;
đọc [runbook R1](../product-runtime-lab/README.md) trước khi chạy vì gate khởi tạo
sshd riêng và tài nguyên Docker thuộc nonce:

```sh
export OPSPILOT_R1_MODULES=/var/tmp/opspilot-p3e3a-runtime/node_modules
export OPSPILOT_R1_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r7b-lab.cjs
node app/scripts/product-runtime-lab/build.mjs
node app/scripts/product-runtime-lab/run.mjs --spa
# Hồi quy Express: cùng production code và health probe mới.
node app/scripts/product-runtime-lab/run.mjs
```

`--spa` chạy production pipeline/guard/helper qua pinned SSH và scratch SQLite.
Fixture Vite được commit Git/fullSHA và chuyển dưới dạng snapshot đã xác minh;
không thay thế kiểm public GitHub fetch hoặc branch polling.10checks gồm lần đầu,
cập nhật, lỗi build, health403 do artifact không đọc được, khôi phục đúng CID app
và collector cùng metric boundary; first build/health failure và collector build
failure không được chốt giả thành công. Ba kiểm tra HTTP bổ sung xác nhận deep
route bằng index, bundle mang đúng marker và asset thiếu404. Profile Express giữ
7checks cũ. Không prune cache hoặc tài nguyên ngoài namespace.

Controller đã cài/bundled release cũ vẫn Express-only; code checkpoint này chưa
nâng release pin, cài controller hoặc xây installer mới. Cần trusted release,
upgrade và live acceptance riêng trước khi dùng SPA trên VPS. Next, database,
required env và custom Dockerfile vẫn ngoài phạm vi; toàn R7 còn OPEN.

## R7e — Next.js

```powershell
pnpm.cmd --prefix app exec electron scripts/product-spa-desktop-lab/electron.mjs --nextjs
```

Cùng production widget/preload/Main/SQLite và synthetic controller đã ghi rõ,
chọn Next.js: default3000 và `/`, cổng sửa được để khớp script source, review
Next.js và đăng ký giữ framework.4locale×2theme/layout1280×800 và thêm1366×768
cho tiếng Việt; request/response khác framework giữ prepared và không gửi. Không
thay source guards để pass fixture. Report framework=nextjs ở namespace riêng,
ảnh `docs/ui-redesign/screenshots/r7e/<nonce>/`. Runtime Linux tương ứng dùng
`run.mjs --nextjs` theo [runbook](../product-runtime-lab/README.md); native SSH,
build/SSR/asset/rollback/collector/lease gate độc lập với UI synthetic transport.
