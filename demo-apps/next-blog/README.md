# next-blog — demo app (M12)

Blog Next.js 14 (App Router): **2 trang** đọc dữ liệu tĩnh (trang chủ + chi tiết bài viết) —
dùng để demo OpsPilot deploy app Node SSR lên VPS. Không có database, không dịch vụ ngoài.

## Cấu hình

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `NEXT_PUBLIC_SITE_NAME` | `OpsPilot Demo Blog` | Tên hiển thị ở header |

Sao chép `.env.example` thành `.env` trước khi chạy local; khi build Docker thì truyền
`--build-arg NEXT_PUBLIC_SITE_NAME=...`.

## Chạy local

```bash
npm ci
npm run build     # pre-render 2 trang + 4 bài viết tĩnh
npm start         # http://localhost:3000
```

## Docker

```bash
docker build -t opspilot-demo-next-blog . && docker run --rm -p 3030:3000 opspilot-demo-next-blog
```

(Khi deploy bằng OpsPilot, tool tự render Dockerfile từ `templates/` — file Dockerfile
này chỉ để chạy tay độc lập.)
