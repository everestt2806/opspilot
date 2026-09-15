# vite-spa — demo app (M12)

SPA React + Vite: **1 trang** gọi `/health` và `/items` của `express-api` — dùng để demo
OpsPilot deploy một app frontend tĩnh (build ra `dist/`) và nghiệm thu frontend nối đúng API.

## Cấu hình

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `VITE_API_URL` | _(trống)_ | Địa chỉ gốc của express-api (SPA gọi trực tiếp từ browser) |

Sao chép `.env.example` thành `.env` rồi sửa `VITE_API_URL` trước khi build.

## Chạy local

```bash
npm ci
npm run build     # build tĩnh ra dist/
npm start         # vite preview tại http://localhost:3000
```

Yêu cầu `express-api` đang chạy (mặc định `http://localhost:3000`); nếu chạy port khác
thì sửa `VITE_API_URL` rồi build lại.

## Docker

```bash
docker build -t opspilot-demo-vite-spa . && docker run --rm -p 3020:80 opspilot-demo-vite-spa
```

(Khi deploy bằng OpsPilot, tool tự render Dockerfile từ `templates/` — file Dockerfile
này chỉ để chạy tay độc lập.)
