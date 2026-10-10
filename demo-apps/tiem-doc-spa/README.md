# Tiệm Đọc — React + Vite

Kệ sách minh họa có tìm kiếm tiếng Việt, lọc thể loại, xem chi tiết và lưu sách quan tâm vào trình duyệt. Không gọi API ngoài, không cần database hoặc env.

## Chạy trên máy

```bash
npm ci
npm run dev
```

Để kiểm tra bản build: `npm run build` rồi `npm start`; mở `http://localhost:3000/`.

## Deploy bằng OpsPilot

Chọn thư mục `demo-apps/tiem-doc-spa` hoặc root directory đó khi dùng Git. Detector phải báo **Vite SPA**, build output `dist`, container port **80**, healthcheck `/`. OpsPilot sẽ phục vụ bản build bằng nginx; không cần điền env. Sau deploy, mở URL và thử tìm “màu”, chọn bộ lọc **Thiết kế**, lưu một cuốn rồi bấm **Sách đã lưu**.

Toàn bộ sách và tác giả trên trang là dữ liệu minh họa, không phải danh mục bán hàng thật.
