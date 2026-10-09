# TK-S7 G2b — Live smoke nguồn thư mục và template trên VPS

> Phụ thuộc: [G2 Git live smoke](tk-s7-g2-live-git-vps-smoke.md) qua review local. Mục tiêu sản phẩm là hai nguồn ngang hàng; G2b kiểm chứng đường **thư mục trên máy** và hai detector/template còn lại. Theo [kế hoạch demo](../29-ke-hoach-demo-14-10.md); kết quả chỉ áp dụng cho đúng build/SHA đã thử.

| Chủ | Hạn mục tiêu | Branch | Ưu tiên |
|---|---|---|---|
| Worker | 11/10/2026; không cắt gate để kịp demo | `feat/deploy-reachability` | P0 |

## Ranh giới

- Dùng profile Electron biệt lập và VPS phát triển đã xác minh ở G2; giữ app Git G2 còn chạy để có bằng chứng demo. Kiểm tra disk/RAM trước mỗi build. Chỉ tạo app/port/thư mục mang tên G2b; không reset hoặc prune toàn VPS, không xóa dữ liệu hay app khác. Nếu tài nguyên không đủ cho Next, ghi `NOT_RUN` cùng số đo và dừng thay vì làm VPS bất ổn.
- Không dùng Git wizard, remote clone hoặc CLI deploy thay cho nút **Thư mục trên máy**. Không chạy pilot ML, migrate hoặc thao tác firewall thủ công để làm đẹp kết quả. Không đưa credential/env secret vào log, ảnh hoặc commit; không push/PR/merge.

## Definition of Done

- [ ] Từ Electron thật, chọn `demo-apps/vite-spa` qua folder picker, detector nhận Vite SPA và plan/nginx phù hợp; precheck/start/health hoàn tất. Kiểm tra URL từ máy điều khiển, gồm trang chính và một đường dẫn SPA nếu app có router. App DB là `source_type=local`, `source_path` đúng thư mục máy, mọi trường Git của app/deployment là NULL.
- [ ] Từ Electron thật, chọn `demo-apps/next-blog` qua folder picker, detector nhận Next.js và plan/start/port phù hợp; build/runtime/health đạt, URL trang chính trả HTTP 200 từ máy điều khiển. Không ghi `PASS` nếu chỉ detector hoặc build đạt mà runtime chưa healthy. Nếu thiếu tài nguyên, ghi trạng thái `NOT_RUN` có bằng chứng trước khi tạo app.
- [ ] Mỗi lượt ghi app/deployment ID, source folder (không có secret), detector, image/container ID, host/container port, loopback và external HTTP, exposure, thời gian và resource sau build. Kiểm tra app Git G2 vẫn reachable sau các lượt thử. Ảnh Electron thật cho hai màn kết quả/lịch sử, không dùng fixture.
- [ ] Ghi kết quả vào `docs/demo-14-10/evidence.md` với bảng riêng Vite/Next, `LIVE_VPS`, `FAILED` hoặc `NOT_RUN` chính xác. Nếu phát hiện blocker trong template, sửa nhỏ bằng commit code/test riêng rồi chạy lại live smoke trên build mới; không dùng evidence cũ cho code mới.
- [ ] Node 22: lint, Node/Web/Scripts typecheck, full Vitest, build, `git diff --check` pass trên đúng HEAD đã thử. Cập nhật task/board và commit cục bộ; không push/PR/merge. Khi xong chỉ báo “Worker đã xong”.

## Nhật ký

- PLAN 09/10 — Leader duyệt local G2 Git deploy/redeploy và external HTTP thật; G2b kiểm chứng lựa chọn source còn lại cùng Vite SPA/Next.js trên VPS trước rehearsal và phiếu in.

## PR

Chưa được phép push, mở PR hoặc merge.
