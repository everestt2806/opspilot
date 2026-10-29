# Nhật Ký Phố — Next.js

Tạp chí mini có trang chủ, ba bài viết riêng, điều hướng bài tiếp theo, metadata và `/health`. Nội dung/hình minh họa đều nằm trong source; không cần database, tài khoản hay API ngoài.

## Chạy trên máy

```bash
npm ci
npm run build
npm start
```

Mở `http://localhost:3000/` rồi đọc một bài. Health trả JSON ở `http://localhost:3000/health`.

## Deploy bằng OpsPilot

Chọn thư mục `demo-apps/nhat-ky-pho-next` hoặc root directory tương ứng khi dùng Git. Detector phải báo **Next.js**, container port **3000**, healthcheck `/`, không yêu cầu DB. Màn hình deploy hiện yêu cầu `NODE_ENV`; nhập `production`. Sau deploy, mở trang chủ rồi bấm **Đọc bài mở đầu** để xem route bài viết hoạt động.

Đây là một tạp chí minh họa; các bài viết không đại diện cho một ấn phẩm ngoài đời.
