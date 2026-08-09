# M12 — Ba app demo + fault endpoint · Người B · Tuần 1 và Tuần 6

`demo-apps/` — phục vụ test detector, test deploy, và làm đối tượng thí nghiệm

## Mục tiêu
Ba ứng dụng nhỏ, mỗi cái đại diện một stack Tier 1, đủ thật để detector nhận diện đúng và
deploy chạy được — **không đầu tư quá mức**, đây chỉ là công cụ.

## Ba app (tuần 1)

| Thư mục | Stack | Yêu cầu tối thiểu |
|---|---|---|
| `next-blog/` | Next.js 14 (App Router) | 2 trang, đọc dữ liệu tĩnh, `next` trong `dependencies`, `.env.example` có `NEXT_PUBLIC_SITE_NAME` |
| `express-api/` | Express + PostgreSQL (`pg`) | CRUD `/items`, `GET /health`, migration tạo bảng lúc khởi động, `.env.example` có `DATABASE_URL`, `PORT` |
| `vite-spa/` | React + Vite (build tĩnh) | 1 trang gọi API, `vite` trong `devDependencies`, `.env.example` có `VITE_API_URL` |

Ràng buộc chung: chạy được bằng `npm ci && npm run build && npm start` · không phụ thuộc dịch
vụ ngoài · khởi động < 10 giây · `express-api` tự tạo bảng và seed ~1000 bản ghi khi khởi động
(cần cho việc kiểm chứng `count(*)` khi migrate).

Được phép dùng AI sinh nhanh 3 app này — chúng không phải phần đóng góp của đồ án.

## `express-api` — fault endpoint (tuần 6)

**Đây là đối tượng của toàn bộ 50 run thí nghiệm.** Các endpoint chỉ bật khi
`ENABLE_FAULT_ENDPOINTS=true`; mặc định **tắt**. Nói rõ trong báo cáo rằng đây là công cụ thí
nghiệm, không phải lỗ hổng của tool.

| Endpoint | Hành vi | Tham số |
|---|---|---|
| `GET /debug/leak?mb=5` | Cấp phát `mb` MB và **giữ trong mảng toàn cục** (không cho GC thu) | mặc định 5 |
| `GET /debug/cpu?ms=200` | Busy-loop chặn `ms` mili giây | 20–400 |
| `GET /debug/error-rate?p=0.3` | Đặt xác suất mọi request tiếp theo trả HTTP 500 | 0–1 |
| `GET /debug/slow-db?sec=0.5` | Chèn `SELECT pg_sleep(sec)` trước mỗi query | 0–1.5 |
| `GET /debug/latency?ms=500` | Middleware delay `ms` cho mọi request | 0–2500 |
| `POST /debug/reset` | Xoá mọi hiệu ứng, giải phóng mảng leak | |

Ràng buộc:
- Mỗi hiệu ứng độc lập, bật/tắt riêng, `POST /debug/reset` xoá sạch tất cả.
- **`/health` không bị ảnh hưởng bởi `/debug/latency` và `/debug/error-rate`** — đây chính là
  điểm mấu chốt của đồ án: health check nhị phân vẫn xanh trong khi ứng dụng đang suy giảm.
- `/debug/leak` phải làm `mem_mb` tăng **tuyến tính và tái lập được** giữa 10 lần lặp.

## Cấu hình container (quan trọng cho thí nghiệm)

Trong compose sinh ra cho `express-api`: `mem_limit: 512m`, `cpus: 1.0`.
Trần bộ nhớ cố định là điều kiện để đường cong memory leak tái lập được giữa các run
(xem `docs/07` mục 2). Không giới hạn thì kết quả phụ thuộc RAM còn trống của VPS lúc đó.

## Kiểm chứng tham số fault (bắt buộc làm ở pilot tuần 8 — rủi ro R14)

Với `mb=5` mỗi 10 giây (30 MB/phút), nền ~120MB, trần 512MB:
- ngưỡng rule 90% (≈460MB) bị chạm ở khoảng **phút 11**
- container **không** bị OOM-kill trước **phút 15**

Nếu pilot cho kết quả lệch nhiều → chỉnh `mb` và **ghi `DECISIONS.md`**, rồi chạy lại pilot.
**Chỉnh trước khi chạy 50 run chính thức**, không chỉnh giữa chừng.

## Định nghĩa xong
- [ ] Cả 3 app chạy local bằng `docker run` (tuần 1)
- [ ] Detector nhận đúng cả 3 (tuần 2)
- [ ] Cả 3 deploy được lên VPS qua tool, mỗi app < 3 phút (tuần 3)
- [ ] 5 fault endpoint hoạt động, `POST /debug/reset` xoá sạch (tuần 6)
- [ ] `/health` **vẫn trả 200** khi đang bật `/debug/latency=2000` và `/debug/error-rate=0.5`
- [ ] `express-api` có sẵn ~1000 bản ghi để kiểm chứng migrate
- [ ] Kiểm chứng R14 đạt (tuần 8)
