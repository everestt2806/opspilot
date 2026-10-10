# TK-S7 D11-sources — ba ứng dụng độc lập để thử deploy

**Trạng thái:** HOÀN THÀNH LOCAL, CHỜ USER DEPLOY. Người dùng sẽ tự deploy một ứng dụng tối nay, hai ứng dụng còn lại để dành cho buổi demo 11/10. Phạm vi là source demo và hướng dẫn; không thay đổi OpsPilot, VPS, schema hay contract.

## Requirement ledger

| Yêu cầu | Cách làm | Kiểm chứng phiên hiện tại | Trạng thái |
|---|---|---|---|
| Một source thử ngay | Express có trang đặt lịch, API và `/health`, không cần DB/env | `npm ci`, `node --check`, HTTP 200, GET lịch 7 ngày/8 slot và POST đặt lịch thành công | PASS |
| Hai source để dành | Vite SPA lọc sách và Next.js có trang chủ + bài viết | Vite và Next build pass; Vite trang chủ 200, Next trang chủ/bài viết/health 200 và route sai 404 | PASS |
| Trang nhìn chỉnh chu, có tương tác thật | Nội dung tiếng Việt, bố cục riêng cho từng app, responsive, không gọi dịch vụ ngoài | Mở Edge thực và xem ảnh tại 1366×900 và 504×844; React render và ba layout không bị cắt ở viewport 504 | PASS |
| Deploy được bằng OpsPilot | Mỗi thư mục có package/lockfile độc lập; detector đúng stack; build/start và HTTP smoke đạt | `try:detect` trả `express`, `static-spa`, `nextjs` đúng; build Vite/Next sạch. Chưa deploy VPS thật | PASS LOCAL |
| Bàn giao rõ cho người dùng | README từng app và thứ tự deploy, không có credential/secret | `docs/demo-11-10/ba-web-demo.md` ghi đường dẫn, thứ tự, lưu ý `NODE_ENV=production` cho Next | PASS |

## Nhật ký

- START 2026-10-10 UTC+07 — Đọc detector Express/Vite/Next và ba source demo hiện có. Chọn ba app mới độc lập, không sửa source demo cũ hoặc pipeline. Tối nay ưu tiên Express nhẹ để người dùng thử một lượt; hai app còn lại là static SPA và Next.js.
- COMPLETE LOCAL 2026-10-10 UTC+07 — Tạo ba source độc lập; lockfile tái lập; build và smoke HTTP; kiểm tra detector OpsPilot, ảnh desktop và viewport 504. Docker daemon trên máy phát triển không chạy nên không chạy local `docker build`; chưa khẳng định kết quả deploy VPS thật. Bước tiếp theo là người dùng deploy theo `docs/demo-11-10/ba-web-demo.md`.
