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

- [ ] Copy Deploy trung tính cho folder/Git ở vi/en/zh/ja; test xác nhận header đúng khi chọn từng nguồn. Kiểm tra bằng ảnh Electron thật. Trong lịch sử, giải thích v1/v2 `running` là kết quả **đã ghi nhận**; chỉ v hiện tại có nhãn “Đang kích hoạt”, không nói ba container cùng chạy.
- [ ] Diễn tập lần hai đủ 6–8 phút bằng build sau sửa copy: mở hai app local, thực hiện một redeploy Git thủ công, xem SHA/lịch sử, kiểm tra HTTP ngoài cho Git/Vite/Next, kết luận với giới hạn. Ghi thời điểm, duration, app/deployment ID, full Git SHA, build source commit và tree `app` (`git rev-parse <commit>:app`), lỗi/khắc phục; không gọi redeploy cùng SHA là cập nhật commit mới.
- [ ] Quay MP4 dự phòng của lần cuối; xác minh mở/phát được, duration, hình ảnh các mốc đầu/giữa/cuối, audio có/không và không có secret. Lưu ảnh chính, video và bảng bằng chứng dưới `docs/demo-14-10/`; nếu video thiếu thì ghi `NOT_RUN`, không gọi gói dự phòng sẵn sàng.
- [ ] Cập nhật [kịch bản](../demo-14-10/rehearsal-script.md), [bằng chứng](../demo-14-10/evidence.md) và [phiếu HTML](../demo-14-10/phieu-demo.html) theo **rehearsal cuối**. Sửa chỗ phiếu nói “Nhập repo” nếu thực tế dùng app Git đã liên kết; sửa timeline 7:30 nếu thời lượng thật khác. Tạo PDF A4 **một trang** từ HTML mới, mở xem trực quan không cắt chữ, xác nhận ngày/SHA/chế độ/URL và giới hạn đúng; loại PDF draft ngày 08/10 khỏi gói demo cuối.
- [ ] Chạy Node 22 lint, Node/Web/Scripts typecheck, full Vitest, build và `git diff --check` trên source cuối. Ghi rõ build source SHA và tree `app`; commit tài liệu sau đó không được ngụ ý làm thay đổi runtime đã diễn tập. Không sửa code sau khi chốt build mà không chạy lại gate/rehearsal.
- [ ] Ghi đề xuất verdict `DEMO_READY_LIVE`, `DEMO_READY_RECORDED` hoặc `NOT_READY` kèm điều kiện và giới hạn để Leader review. Cập nhật board bằng trạng thái hợp lệ, commit cục bộ; không push/PR/merge. Khi xong chỉ báo “Worker đã xong”.

## Nhật ký

- PLAN 09/10 — G3 đạt local gate 7:38; Leader kiểm tra độc lập remote SHA, SQLite v3, ba HTTP 200 và MP4 457.4 giây video-only. G4 sửa copy Git, tạo lại bản in A4 và diễn tập trên build cuối.

## PR

Chưa được phép push, mở PR hoặc merge.
