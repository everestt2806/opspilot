# TK-S7 G4b — Diễn tập live qua đường điều hướng app đã liên kết

> G4a xác nhận `MemAvailable` khoảng 3 GiB, disk còn khoảng 18 GB và ba app đang HTTP 200. Live G4a dừng do công cụ GUI không chọn được `<select>` native. Đường sản phẩm đã có: từ chi tiết Git app bấm **Triển khai phiên bản mới**; `AppsPage.tsx` set `deployPreselect({ vpsId, appId })`, rồi `DeployPage.tsx` tự chọn app/VPS/nguồn Git sau `app:list`. Không sửa React state, SQLite hoặc IPC bằng tay để tạo bằng chứng live.

| Chủ | Hạn mục tiêu | Branch | Ưu tiên |
|---|---|---|---|
| Worker | Trước freeze 13/10/2026; không cắt gate | `feat/deploy-reachability` | P0 |

## Definition of Done

- [ ] Trên Electron production build hiện tại và profile G2 biệt lập, mở chi tiết `g2-express-20261009` → bấm **Triển khai phiên bản mới**. Xác nhận wizard đã tự chọn đúng VPS, app ID 1, nguồn Git, repo/ref/root và full SHA. Chụp ảnh trạng thái này; nếu preselect hỏng thật, ghi lỗi và sửa bug nhỏ bằng commit/test riêng rồi build lại. Chỉ dùng thao tác UI người dùng có thể làm; không set DOM/store hay DB thủ công.
- [ ] Kiểm tra read-only `MemAvailable` vẫn ≥1 GiB, disk đủ, ba URL và container healthy. Trong wizard bấm **Kiểm tra trước** và lưu bằng chứng precheck pass trên đúng app/port; không suy luận từ panel VPS. Nếu không đạt hoặc app đích không xác minh được, dừng trước Start và ghi `NOT_RUN` với lý do thực.
- [ ] Khi precheck pass, redeploy Git từ app đã liên kết trên VPS phát triển. Ghi build source commit/tree, repo/ref/full SHA, app/deployment/version, timestamps, image/container IDs, exposure, loopback/external HTTP; kiểm tra Vite/Next vẫn reachable. Nếu remote SHA không đổi, gọi đây là redeploy cùng SHA, không phải tự động deploy hay commit mới.
- [ ] Diễn tập bài 6–8 phút và quay MP4 dự phòng trên **chính build vừa chạy**. Kiểm tra video mở được, thời lượng và hình ở đầu/giữa/cuối, âm thanh có/không, không lộ secret. Cập nhật `evidence.md`, script, phiếu HTML/PDF A4 một trang theo kết quả thật; không dùng video G3 để đại diện build mới.
- [ ] Node 22 lint, Node/Web/Scripts typecheck, full Vitest, build và `git diff --check` trên source cuối; ghi warnings thật. Đề xuất `DEMO_READY_LIVE`, `DEMO_READY_RECORDED` hoặc `NOT_READY` theo bằng chứng để Leader review. Cập nhật board/task trạng thái hợp lệ, commit cục bộ; không push/PR/merge. Khi xong chỉ báo “Worker đã xong”.

## Nhật ký

- PLAN 09/10 — Leader review G4a resource fix và thấy đường preselect app từ nút **Triển khai phiên bản mới** đã có sẵn. G4b kiểm chứng live gate trên đúng UX đó trước khi freeze.

## PR

Chưa được phép push, mở PR hoặc merge.
