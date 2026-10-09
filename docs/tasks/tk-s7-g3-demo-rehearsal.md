# TK-S7 G3 — Diễn tập demo 14/10 trên VPS thật

> Phụ thuộc: [G2 Git](tk-s7-g2-live-git-vps-smoke.md) và [G2b nguồn local](tk-s7-g2b-local-template-vps-smoke.md) đã qua review local. Mục tiêu là một buổi trình bày 6–8 phút có bằng chứng, không mở rộng chức năng trong lúc diễn tập.

| Chủ | Hạn mục tiêu | Branch | Ưu tiên |
|---|---|---|---|
| Worker | 12/10/2026; không cắt gate để kịp demo | `feat/deploy-reachability` | P0 |

## Ranh giới

- Dùng Electron thật, profile biệt lập G2 và VPS phát triển đã pin host key. Giữ ba app G2/G2b hoạt động; kiểm tra RAM/disk và các URL trước diễn tập. Chỉ dùng app/port thuộc buổi diễn tập, không reset/prune VPS hay thao tác firewall thủ công. Không đưa credential, khóa, biến môi trường bí mật vào ảnh/video/tài liệu.
- Demo nêu rõ hai lựa chọn deploy: **Git repository** và **thư mục trên máy**. Cảnh live ưu tiên Git Express; Vite SPA và Next.js đã chạy thật có thể trình bày qua app detail/URL. Redeploy cùng SHA phải gọi đúng là redeploy cùng mã nguồn, không nói là push-to-deploy.
- Không trình bày rollback, migrate sau rollback, HTTPS, webhook hoặc ML pilot là đã hoàn thiện nếu chưa có live gate riêng. Có thể trình bày Doctor/Monitor theo dữ liệu thật đang hiển thị; mọi dữ liệu synthetic phải được gọi rõ tên.

## Definition of Done

- [x] Viết kịch bản thao tác và lời nói theo từng mốc 0:00–8:00; chỉ rõ phần nào live, phần nào là bằng chứng đã ghi, câu chuyển sang video khi mạng lỗi. Chọn chính xác một luồng Git deploy/redeploy để thực hiện trong rehearsal; trước khi chạy xác nhận port/tài nguyên và full SHA từ remote. Không tạo commit giả để có SHA mới.
- [x] Chạy trọn một lần rehearsal bằng Electron thật, bấm giờ từ mở app đến câu kết. Ghi build/HEAD, app/deployment ID, repo/ref/full SHA, thời gian từng cảnh, URL/status từ máy điều khiển, các lỗi và thời gian khắc phục. Xác nhận Git, Vite, Next vẫn truy cập được sau rehearsal.
- [x] Chụp các màn chính ở đúng build; tạo **một video dự phòng** của thao tác thật dài phù hợp bài trình bày, có ngày/SHA. Kiểm tra mở lại được ảnh/video, âm thanh nếu có và không lộ credential. Nếu công cụ ghi hình lỗi, ghi `NOT_RUN` cùng lý do và không gọi là đã có fallback.
- [x] Cập nhật [evidence](../demo-14-10/evidence.md) và [phiếu A4](../demo-14-10/phieu-demo.html) bằng kết quả thật; bỏ số gate cũ 08/10 và chỗ trống không còn đúng. Phiếu vẫn ghi **BẢN NHÁP** đến G4 freeze, phân biệt `LIVE_VPS` với `RECORDED_FALLBACK`, và nêu giới hạn Git tự động/HTTPS/migrate/ML.
- [x] Không cần sửa runtime vì blocker. Đã chạy Node 22.23.3 lint, Node/Web/Scripts typecheck, full Vitest (71 file / 666 test), build và `git diff --check` trên source cuối; tất cả PASS, không mượn gate G2b. Board/task cập nhật; commit cục bộ, không push/PR/merge.

## Nhật ký

- START 09/10/2026 — Bắt đầu G3 trên `feat/deploy-reachability`, HEAD `d4506554fcb4d8b6a89fe34cdac4ac7c81cd0955`; dùng Electron/profile G2 biệt lập và giữ Git/Vite/Next hiện có.
- PLAN 09/10 — Leader kiểm tra độc lập G2b: Vite, Next và Git external HTTP 200; SQLite local source đúng và Git fields NULL. Chuyển sang rehearsal và gói trình bày 14/10.

## PR

Chưa được phép push, mở PR hoặc merge.

- RESULT 09/10/2026 — Rehearsal Electron thật hoàn tất 14:52:05–14:59:43 UTC+07 (7:38), Git app 1 deployment 5/v3, redeploy cùng full SHA `8af16e1f9165a31557288adbc23acc420244938f`; ba app qua HTTP 200 external. Video dự phòng 7:37, H.264, im lặng; ảnh/video kiểm tra được, không có credential.
- GATES 09/10/2026 — Node 22.23.3: lint, Node/Web/Scripts typecheck, 71/666 Vitest, build và diff check đều PASS trên source HEAD đã diễn tập. Không thay runtime.
