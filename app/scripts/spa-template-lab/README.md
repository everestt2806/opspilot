# R7a — Template Vite SPA qua Docker, HTTP và trình duyệt

```powershell
. ./tools/enter-node22.ps1
docker.exe desktop start --detach
node app/scripts/spa-template-lab.mjs --baseline
node app/scripts/spa-template-lab.mjs --run
pnpm.cmd --prefix app exec tsc -p scripts/spa-template-lab/tsconfig.json
```

CLI yêu cầu Windows/Node22 và Docker Linux daemon. Baseline đọc đúng `templates/static-spa.Dockerfile` tại commit `b7163d92e4fc7580b8dca5f388f47b78c5bb072c` bằng Git readonly, không checkout/reset working tree. Hai lỗi phải được tái hiện: index và asset thật200 nhưng direct client-route404; source build bỏ index vẫn build image và trả trang “Welcome to nginx”200. Nếu clone thiếu commit lịch sử này thì baseline dừng, không dùng template mới để giả lỗi cũ.

Chế độ `--run` dùng template hiện hành. Subject bundle gọi production `buildSourceTree`, detector registry, `renderBuildArgs`, `renderDockerfile` và Git snapshot helper. Fixture Vite dùng package/lock đã có trong `demo-apps/tiem-doc-spa`, index/main riêng có route dựa trên pathname/query để kiểm execution; không thêm dependency. Local source và local Git repository thật/fullSHA đều build image riêng và HTTP probe thật. Snapshot dùng `createGitSnapshotFromLocalFixture` (cùng implementation acquisition có guard nhưng local URL được cho phép cho lab); **không chứng minh truy cập public GitHub, deploy UI hoặc controller Product/VPS**.

Các kiểm tra: root200 đúng artifact; deep-link/query trả cùng index; HEADdeep200khôngbody; assetJS thật200/MIMEjavascript; missing asset dưới `/assets/`, missingJS/CSS trả404; index/deep fallback no-cache. Hai nguồn phải có cùng HTML/bundle hash. Actual sandboxed Electron BrowserWindow tải direct route, chạy bundle và reload vẫn giữ pathname/query, không dùng jsdom. Browser host này không phải full OpsPilot, không khởi tạo DB/profile/SSH/ML của sản phẩm. Bản build cố ý xóa `dist/index.html` phải bị Docker build từ chối; không để nginx welcome page làm deployment trông healthy.

Config nginx được viết ngay trong Dockerfile bằng printf có single quotes để giữ `$uri`, kiểm `nginx -t` lúc build. Không cần thêm file upload, sửa contract hoặc yêu cầu user chép config/mở firewall cho bài thử local. Đây là SPA chuẩn với Vite `dist`; custom output/subpath/API proxy/secret env/Next/Express/DB và Product parity có gate riêng. Asset404 áp dụng `/assets/` và các phần mở rộng static được khai báo; client routes còn lại fallback index.

Native record đầu `3d489af9ebf0` đã qua local/Git HTTP nhưng browser driver chờ `await app.whenReady()` ở top-level ESM và hết timer. Minimal native probe trên cùng host: awaitbranch timeout5s/readyfalse, thenbranch exit0/readytrue. Driver chuyển sang `app.whenReady().then(...)`, giữ nguyên template và browser assertions; final full native run đạt5checks. Đây là sửa test driver, không phải bỏ browser gate hoặc sửa nginx để che lỗi. Cơ chế ESM/ready đối chiếu [Electron docs](https://www.electronjs.org/docs/latest/tutorial/esm); không suy mọi trường hợp top-level await đều lỗi từ một probe này.

Mỗi record nằm trong ignored `app/.out-scripts/spa-template-lab/<nonce>/`: source/render subject/log/result/screenshot. Source/context/snapshot/browserprofile được dọn sau chạy; container/image chỉ được xóa khi labels checkpoint/nonce khớp. Binding chỉ loopback/ephemeral port, không global Docker prune hoặc đụng app khác. Build cache/images nền do Docker quản lý có thể được giữ; CLI không xóa shared cache. Docker Desktop được bật cho phiên này và giữ sẵn cho phát triển tiếp.

[Ledger và bằng chứng](../../../docs/tasks/tk-s7-release-r7a-spa-routing.md). R7 tổng vẫn OPEN, Product hiện vẫn Express-only. Code template đã kiểm local Docker, chưa có live VPS/Electron deploy wizard/installed controller rollout hay installer mới chứa fix này.
