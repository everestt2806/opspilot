# TK-S7 G4 — Sửa copy nguồn, diễn tập cuối và freeze gói demo

> Phụ thuộc: [G3 rehearsal](tk-s7-g3-demo-rehearsal.md) qua review local. G4 chốt đúng một bản trình bày cho 14/10; không dùng trạng thái `HOÀN THÀNH` trước khi merge.

| Chủ | Hạn mục tiêu | Branch | Ưu tiên |
|---|---|---|---|
| Worker | 13/10/2026; không cắt gate để kịp demo | `feat/deploy-reachability` | P0 |

## Ranh giới

- Sửa nhỏ UI: mô tả đầu trang Deploy hiện ghi “Chọn thư mục mã nguồn” kể cả khi chọn **Kho Git**. Đổi thành câu trung tính, chính xác cho hai lựa chọn nguồn ở cả 4 locale; thêm/cập nhật test liên quan. Không thay IPC, schema hoặc pipeline trong task này.
- Dùng profile Electron G2 biệt lập và VPS phát triển đã pin host key. Kiểm tra RAM/disk/port, remote SHA và ba URL trước khi redeploy. Không reset/prune VPS, không chỉnh firewall thủ công, không ghi credential vào ảnh/video/PDF. Nếu VPS không đạt preflight, không ép live; dùng fallback đã kiểm chứng và ghi lý do.
- Video G3 gắn với build cũ; sau sửa UI, phải quay video dự phòng mới trên đúng build cuối. Không gắn video G3 với build cuối nếu UI đã đổi. Nếu chỉ có thể dùng video G3, ghi rõ SHA cũ và chọn `RECORDED_FALLBACK` có giới hạn tương ứng.

## Definition of Done

- [x] Copy Deploy trung tính cho folder/Git ở vi/en/zh/ja; test xác nhận header đúng khi chọn từng nguồn. Kiểm tra bằng ảnh Electron thật. Trong lịch sử, giải thích v1/v2 `running` là kết quả **đã ghi nhận**; chỉ v hiện tại có nhãn “Đang kích hoạt”, không nói ba container cùng chạy.
- [x] Preflight G4 ngày 09/10: build mới xác nhận UI/apps; external Git/Vite/Next HTTP 200; remote SHA khớp. VPS có 94% RAM đã dùng (<512 MB khả dụng), nên live redeploy G4 `NOT_RUN` để giữ ba app; chuyển sang fallback G3 dài 7:37 theo ngoại lệ của task. Không gán deployment ID mới hoặc gọi video G3 là build mới.
- [x] Dùng video dự phòng G3 đã được Leader review: 457.4 giây, H.264, im lặng, không audio stream; nguồn video build HEAD `d4506554fcb4d8b6a89fe34cdac4ac7c81cd0955` và Git SHA `8af16e1f9165a31557288adbc23acc420244938f` được nêu riêng. Ảnh build UI G4 lưu riêng; không ghép SHA/build để ngụ ý video trên source mới.
- [x] Cập nhật [kịch bản](../demo-14-10/rehearsal-script.md), [bằng chứng](../demo-14-10/evidence.md) và [phiếu HTML](../demo-14-10/phieu-demo.html) theo **rehearsal cuối**. Sửa chỗ phiếu nói “Nhập repo” nếu thực tế dùng app Git đã liên kết; sửa timeline 7:30 nếu thời lượng thật khác. Tạo PDF A4 **một trang** từ HTML mới, mở xem trực quan không cắt chữ, xác nhận ngày/SHA/chế độ/URL và giới hạn đúng; loại PDF draft ngày 08/10 khỏi gói demo cuối.
- [x] Node 22.23.3: lint, Node/Web/Scripts typecheck, 71/670 full Vitest, build và `git diff --check` PASS. UI build/source `4addec37b66a4d5145bb55fec21012fdc3acfb0c`, tree `4fa92683f89b77255ea3417131bb12e8914779e1`; không sửa code sau build. ESLint có cảnh báo CRLF nhưng 0 errors.
- [x] Đề xuất `DEMO_READY_RECORDED` có điều kiện để Leader review: fallback G3 đã review, nhưng video dùng build cũ; nếu không chấp nhận thì `NOT_READY` cho đến khi đạt preflight và quay video trên build mới. Board/task/evidence/PDF đã cập nhật. Commit cục bộ; không push/PR/merge.

## Nhật ký

- START 09/10/2026 — Bắt đầu G4 trên `feat/deploy-reachability`, HEAD `a71aec2`; G3 đã qua review local. Giữ profile/app/VPS hiện hành.
- PLAN 09/10 — G3 đạt local gate 7:38; Leader kiểm tra độc lập remote SHA, SQLite v3, ba HTTP 200 và MP4 457.4 giây video-only. G4 sửa copy Git, tạo PDF A4 và nếu preflight đạt thì rehearsal live trên build cuối.
- UI 09/10/2026 — Commit source `4addec37b66a4d5145bb55fec21012fdc3acfb0c`, app tree `4fa92683f89b77255ea3417131bb12e8914779e1`; mô tả Deploy cập nhật bốn locale, focused test 48/48. Electron build mới mở đúng profile.
- PREFLIGHT 09/10/2026 — Remote main SHA khớp; ba URL external HTTP 200. VPS RAM 3.6/3.8 GB (94%, dưới 512 MB khả dụng), disk free 18 GB. Live redeploy G4 `NOT_RUN` để giữ ba app; dùng G3 fallback 7:37 trên build HEAD `d4506554fcb4d8b6a89fe34cdac4ac7c81cd0955`, source SHA `8af16e1f9165a31557288adbc23acc420244938f`. Chỉ đề xuất `DEMO_READY_RECORDED`, chờ Leader review.
- PDF 09/10/2026 — HTML/PDF một trang A4 đã render và xem trực quan; PDF nháp ngày 08/10 được bỏ khỏi gói demo.
- GATES 09/10/2026 — Node 22.23.3 lint, Node/Web/Scripts typecheck, full Vitest 71/670, production build và diff check PASS; focused DeployPage 48/48. Lint báo CRLF warnings (0 lỗi), Vitest báo jsdom warnings nhưng exit 0.

## PR

Chưa được phép push, mở PR hoặc merge.
