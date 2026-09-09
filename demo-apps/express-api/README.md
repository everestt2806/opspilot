# express-api — demo app (M12)

Mini full-stack Express + PostgreSQL dùng để demo OpsPilot:

- `/` là landing page trực quan xác minh deploy, runtime, storage và uptime.
- Có thể tạo bản ghi ngay trên giao diện để chứng minh luồng browser → Express → PostgreSQL.
- CRUD `/items`, `GET /meta`, `GET /health`; tự seed 1000 bản ghi khi khởi động.

Đây vẫn là đối tượng deploy và thí nghiệm của OpsPilot (M12).

## Cấu hình

| Biến | Mặc định  | Ý nghĩa                                                                      |
| -------------- | --------- | ---------------------------------------------------------------------------- |
| `PORT`         | `3000`    | Cổng nghe của app                                                            |
| `DATABASE_URL` | _(trống)_ | Có → dùng PostgreSQL (tự migration + seed 1000 dòng); không có → dùng bộ nhớ |
| `ENABLE_FAULT_ENDPOINTS` | `false` | `true` → bật các endpoint `/debug/*` dùng gây suy giảm khi thí nghiệm |

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

## Endpoint fault (`/debug/*`) — công cụ thí nghiệm, không phải lỗ hổng

Chỉ hoạt động khi `ENABLE_FAULT_ENDPOINTS=true` (mặc định tắt — endpoint trả 404).
Đây là đối tượng của 50 run thí nghiệm (`docs/07`); nói rõ trong báo cáo rằng đây là
công cụ thí nghiệm.

| Endpoint | Hành vi | Tham số (giới hạn) |
|---|---|---|
| `GET /debug/leak?mb=5` | Cấp phát `mb` MB giữ trong mảng toàn cục (GC không thu) | 1–512, mặc định 5 |
| `GET /debug/cpu?ms=200` | Busy-loop chặn `ms` ms mỗi request | 20–400 |
| `GET /debug/error-rate?p=0.3` | Xác suất mọi request tiếp theo trả 500 | 0–1 |
| `GET /debug/slow-db?sec=0.5` | `SELECT pg_sleep(sec)` trước mỗi query (chỉ chế độ DB) | 0–1.5 |
| `GET /debug/latency?ms=500` | Middleware delay `ms` ms mọi request | 0–2500 |
| `POST /debug/reset` | Xoá mọi hiệu ứng, giải phóng mảng leak | |
| `GET /debug/status` | Xem trạng thái fault hiện tại (đọc) | |

**Quan trọng:** `/health` không bị ảnh hưởng bởi `/debug/latency` và `/debug/error-rate`
— health check nhị phân vẫn 200 khi app đang suy giảm; đây là kịch bản OpsPilot cần
phát hiện bằng ML.

```bash
ENABLE_FAULT_ENDPOINTS=true npm start
curl "http://localhost:3000/debug/latency?ms=2000"
curl "http://localhost:3000/debug/error-rate?p=0.5"
curl -o /dev/null -w "%{http_code}\n" http://localhost:3000/health   # vẫn 200
curl -X POST http://localhost:3000/debug/reset
```

## Ghi chú

- App JS thuần — không cần bước build (`npm run build` in ra thông báo skip để khớp chuỗi lệnh chuẩn của M12).
- Kiểm chứng migrate (W9): nạp `DATABASE_URL` rồi `SELECT count(*) FROM items` phải ra 1000.
