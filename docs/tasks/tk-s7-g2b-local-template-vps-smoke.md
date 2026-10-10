# TK-S7 G2b — Live smoke nguồn thư mục và template trên VPS

> Phụ thuộc: [G2 Git live smoke](tk-s7-g2-live-git-vps-smoke.md) qua review local. Mục tiêu sản phẩm là hai nguồn ngang hàng; G2b kiểm chứng đường **thư mục trên máy** và hai detector/template còn lại. Theo [kế hoạch demo](../29-ke-hoach-demo-14-10.md); kết quả chỉ áp dụng cho đúng build/SHA đã thử.

| Chủ | Hạn mục tiêu | Branch | Ưu tiên |
|---|---|---|---|
| Worker | 11/10/2026; không cắt gate để kịp demo | `feat/deploy-reachability` | P0 |

## Ranh giới

- Dùng profile Electron biệt lập và VPS phát triển đã xác minh ở G2; giữ app Git G2 còn chạy để có bằng chứng demo. Kiểm tra disk/RAM trước mỗi build. Chỉ tạo app/port/thư mục mang tên G2b; không reset hoặc prune toàn VPS, không xóa dữ liệu hay app khác. Nếu tài nguyên không đủ cho Next, ghi `NOT_RUN` cùng số đo và dừng thay vì làm VPS bất ổn.
- Không dùng Git wizard, remote clone hoặc CLI deploy thay cho nút **Thư mục trên máy**. Không chạy pilot ML, migrate hoặc thao tác firewall thủ công để làm đẹp kết quả. Không đưa credential/env secret vào log, ảnh hoặc commit; không push/PR/merge.

## Definition of Done

- [x] Từ Electron thật, chọn `demo-apps/vite-spa` qua folder picker, detector nhận Vite SPA và plan/nginx phù hợp; precheck/start/health hoàn tất. Trang chính trả HTTP 200 từ máy điều khiển. App DB là `source_type=local`, `source_path` đúng thư mục máy, mọi trường Git của app/deployment là NULL.
- [x] Từ Electron thật, chọn `demo-apps/next-blog` qua folder picker, detector nhận Next.js và plan/start/port phù hợp; build/runtime/health đạt, URL trang chính trả HTTP 200 từ máy điều khiển. Route `/bai-viet/ops-pilot-la-gi` cũng trả HTTP 200.
- [x] Đã ghi app/deployment ID, source folder, detector, image/container ID đầy đủ, host/container port, loopback và external HTTP, exposure, timestamps và resource. App Git G2 vẫn reachable. Có ảnh Electron thật cho runtime/kết quả và lịch sử của hai app, không dùng fixture.
- [x] Kết quả và bằng chứng `PASS` cho cả Vite/Next được ghi trong `docs/demo-14-10/evidence.md`; không phát hiện blocker template cần sửa.
- [x] Node 22.23.3: lint, Node/Web/Scripts typecheck, full Vitest 71 files / 666 tests, build và `git diff --check` pass trên HEAD đã thử. Task/board cập nhật và commit cục bộ; không push/PR/merge.

## Nhật ký

- START 09/10/2026 — Worker bắt đầu trên `feat/deploy-reachability`, HEAD `47327f2a8b96f46759c7fa73a458d95fa51f6b01`; sẽ dùng Electron/userData G2 cô lập và VPS phát triển đã pin host key.
- PLAN 09/10 — Leader duyệt local G2 Git deploy/redeploy và external HTTP thật; G2b kiểm chứng lựa chọn source còn lại cùng Vite SPA/Next.js trên VPS trước rehearsal và phiếu in.
- LIVE-SMOKE 09/10 — Electron thật/profile biệt lập deploy local folder Vite SPA và Next.js; cả hai runtime healthy, loopback/external HTTP 200, Next route HTTP 200, SQLite xác nhận folder local chính xác và Git fields NULL. G2 Express vẫn healthy/reachable. Chi tiết image/container IDs, resources, timestamps và ảnh: [evidence](../demo-14-10/evidence.md#G2b--live-smoke-nguồn-folder-local-và-template).
- GATES 09/10 — Node 22.23.3: lint PASS; app Node/Web typecheck PASS; scripts typecheck PASS (`pnpm --dir app exec tsc --noEmit -p tsconfig.scripts.json --composite false`); full Vitest 71/71 files, 666/666 tests PASS; build PASS; `git diff --check` PASS.
- HANDOFF-LOCAL 09/10 — Bằng chứng/task/board được commit cục bộ trên `feat/deploy-reachability`; không push/PR/merge. Không có thay đổi runtime code, nên live smoke và gates cùng source HEAD.
- REVIEW 09/10 — Leader xem ảnh Electron, đọc bằng chứng và kiểm tra lại từ máy điều khiển: Vite `/`, Next `/` và `/bai-viet/ops-pilot-la-gi`, Git Express `/health` đều HTTP 200. SQLite profile biệt lập đọc read-only cho thấy Vite app/deploy 2/3, Next 3/4 là `source_type=local`, đúng đường dẫn folder, `running/reachable`, mọi trường Git đều NULL. Duyệt local G2b; chưa push/merge nên task vẫn `CHỜ REVIEW`.

## PR

Chưa được phép push, mở PR hoặc merge.
