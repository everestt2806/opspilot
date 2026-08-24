# express-api — demo app (M12)

Mini full-stack Express + PostgreSQL dùng để demo OpsPilot:

- `/` là landing page trực quan xác minh deploy, runtime, storage và uptime.
- Có thể tạo bản ghi ngay trên giao diện để chứng minh luồng browser → Express → PostgreSQL.
- CRUD `/items`, `GET /meta`, `GET /health`; tự seed 1000 bản ghi khi khởi động.

Đây vẫn là đối tượng deploy và thí nghiệm của OpsPilot; endpoint fault sẽ thêm ở tuần 6
(xem `docs/prompts/m12`).

## Cấu hình

| Biến           | Mặc định  | Ý nghĩa                                                                      |
| -------------- | --------- | ---------------------------------------------------------------------------- |
| `PORT`         | `3000`    | Cổng nghe của app                                                            |
| `DATABASE_URL` | _(trống)_ | Có → dùng PostgreSQL (tự migration + seed 1000 dòng); không có → dùng bộ nhớ |

## Chạy local

```bash
npm ci
npm start          # hoặc: PORT=3100 npm start
curl http://localhost:3000/health        # {"ok":true,...}
curl http://localhost:3000/meta          # runtime, storage, số bản ghi
curl http://localhost:3000/items?limit=5 # 5/1000 bản ghi, đọc X-Total-Count
```

Mở `http://localhost:3000/` để xem landing page và tạo một bản ghi demo.

## Chạy bằng Docker

```bash
docker build -t opspilot-demo-express .
docker run --rm -p 3010:3000 opspilot-demo-express
curl http://localhost:3010/health
```

## Ghi chú

- App JS thuần — không cần bước build (`npm run build` in ra thông báo skip để khớp chuỗi lệnh chuẩn của M12).
- Kiểm chứng migrate (W9): nạp `DATABASE_URL` rồi `SELECT count(*) FROM items` phải ra 1000.
