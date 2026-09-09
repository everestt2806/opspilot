# TK-B2 — M12: 3 demo app Tier 1 + fault endpoint

| Chủ | Hạn | Branch | Brief | Ưu tiên |
|---|---|---|---|---|
| A (nhận 19/08, trước là B) | 20/08/2026 | feat/m12-express-demo-app | `docs/prompts/m12-demo-apps.md` | P0 |

## Mục tiêu

3 app demo đúng 3 stack Tier 1 (Next.js blog, Express API, Vite SPA) kèm các endpoint/script
sinh fault (memory leak, cpu spike, error burst…) để deploy, chạy thí nghiệm và demo. Đây là
điều kiện để có lát cắt Express W2 và gate smoke W1.

**Lát cắt demo 24/08 (chỉ tiêu của A tuần này):** làm tối thiểu `express-api` — chạy local,
endpoint fault, Dockerfile — làm đích deploy cho TK-A13. `next-blog` + `vite-spa` lùi W2,
không chặn demo.

## Được sửa

- `demo-apps/**` (thư mục của B; A làm trong tuần demo — docs/20 cập nhật 19/08).

## Không được sửa

- `templates/**` (Dockerfile template là của A — nếu thiếu field thì báo).

## Definition of Done

Lát cắt demo (hạn 20/08, đã xong — PR #15):

- [x] `express-api` chạy local (README có lệnh chạy, port)
- [x] `express-api` có Dockerfile (node:22-alpine, build/run chuẩn M12)
- [x] `next-blog` + `vite-spa` chạy local + Dockerfile (B, 08/09)
- [x] fault endpoint leak/CPU/error-rate/slow-db/latency trên `express-api` (B, 08/09 — spec M12 ghi fault endpoint ở express-api, dòng "next-blog có endpoint fault" trong DoD cũ là nhầm; 5 kịch bản `docs/07` vẫn đủ)
- [ ] Kiểm chứng `DATABASE_URL` → PostgreSQL seed 1000 (chờ W9 khi có DB trên VPS)
- [x] PR kèm lệnh tái hiện cho express-api (PR #15)

## Nhật ký

- START 11/08 — dự kiến xong trong ngày.
- UPDATE 19/08 — **TRỄ**: `demo-apps/` còn rỗng, chưa có PR. Đang chặn TK-B4 (probe cần đích)
  và gate G0 (TK-S3). B cần ưu tiên số 1: làm tối thiểu `express-api` trước, 2 app còn lại theo sau.
- UPDATE 19/08 — B bận → **A nhận từ 19/08** (quyết định: A làm hết tuần này). Ưu tiên làm lát
  cắt demo: `express-api` + fault endpoint + Dockerfile để TK-A13 có đích deploy 24/08;
  2 app còn lại vẫn thuộc task này, làm nốt W2.
- UPDATE 19/08 — **A làm xong lát cắt express-api** (commit `064a89e`, PR #15): app JS thuần
  dual-path storage (có `DATABASE_URL` → PostgreSQL + migrate + seed 1000 `khoan-thu-N`; không
  có → bộ nhớ để chạy độc lập), CRUD `/items` + `X-Total-Count`, `/health`. Kiểm chứng local
  (port 3200, bản chạy sạch mới): `/health` `{"ok":true,"uptime_s":3}`; `X-Total-Count: 1000`;
  `GET /items/999999` → 404. **Kiểm chứng Docker local (Docker 29.4.3):** build image OK, container
  chạy port 3010 → `/health` ok, `X-Total-Count: 1000`, POST tạo id 1001, 404 đúng, stop sạch.
  Phần còn lại của task (**next-blog, vite-spa, fault endpoint**) lùi **W2** — không chặn demo
  24/08 (fault endpoint chỉ cần từ tuần 6, kịp thí nghiệm W7); A chuyển sang TK-B7. Build/run
  trên VM01 sẽ được kiểm chứng lại ở TK-A13 (đích deploy demo).
- START 08/09 — B nhận lại phần còn lại, branch `feat/m12-demo-apps-rest` (đứng từ `main`;
  board ghi "sau B8" nhưng B8 đang chờ TK-S4 nên B xin kéo trước — code local thuần, không đụng
  vùng của A).
- UPDATE 08/09 — **Xong phần code của task**:
  - **express-api fault endpoint**: 5 endpoint `/debug/*` đúng bảng M12 (`leak` 1–512MB giữ
    buffer toàn cục, `cpu` busy-loop 20–400ms, `error-rate` p 0–1 trả 500, `slow-db`
    pg_sleep 0–1.5s trước mỗi query — chỉ tác dụng khi có DB, `latency` delay 0–2500ms) +
    `POST /debug/reset` + `GET /debug/status` (đọc). Gate `ENABLE_FAULT_ENDPOINTS=true`
    (mặc định 404). `/health`, `/favicon.ico` và toàn bộ `/debug/*` miễn nhiễm middleware
    fault. Smoke node + Docker (port 3011, fault max: latency=500, error-rate=1, cpu=300,
    leak=10MB): `/health` 200 nhanh (~70ms), `/items` 500, **reset vẫn dùng được dưới
    error-rate=1.0** (sau khi phát hiện và sửa bug reset bị error-rate nuốt), sau reset
    `/items` về ~58ms. Không bật env → `/debug/*` 404 đúng.
  - **vite-spa**: React 18 + Vite 5, 1 trang gọi `/health` + `/items` của `VITE_API_URL`,
    `.env.example`, Dockerfile 2 stage (build Node → nginx alpine). Build local OK
    (143.5KB JS); chạy thật với express-api: trang hiển thị health OK + 5/1000 items.
    Docker: image 73.8MB, `docker run` → HTTP 200.
  - **next-blog**: Next.js 14 App Router, 2 trang (trang chủ + `/bai-viet/[slug]` 4 bài
    tĩnh, generateStaticParams), `NEXT_PUBLIC_SITE_NAME` qua `.env.example`, Dockerfile
    node:22-alpine build-arg. `npm run build` pre-render đủ; local `next start`: trang chủ
    200, bài viết 200, slug sai 404. Docker: image 1.05GB (không có giới hạn size cho app
    demo trong M12 — chỉ collector bị giới hạn 80MB), `docker run` → 200 cả 2 trang.
  - `.gitignore` thêm `.next/`.
  - Còn hở: `slow-db` chưa kiểm chứng với PostgreSQL thật (cần DATABASE_URL — sẽ nạp ở
    TK-S4/W8 pilot trên VPS); DoD PostgreSQL seed 1000 chờ W9.

## Lệnh tái hiện

```bash
cd demo-apps/express-api
# fault endpoint (bat qua env, mac dinh tat):
ENABLE_FAULT_ENDPOINTS=true npm start
curl "http://localhost:3000/debug/latency?ms=2000"   # bat delay 2s
curl "http://localhost:3000/debug/error-rate?p=0.5"  # 50% request tra 500
curl -o /dev/null -w "%{http_code}\n" http://localhost:3000/health   # van 200 + nhanh
curl -X POST http://localhost:3000/debug/reset        # xoa sach fault
# Docker:
docker build -t opspilot-demo-express . && docker run --rm -e ENABLE_FAULT_ENDPOINTS=true -p 3010:3000 opspilot-demo-express

cd ../vite-spa
npm ci && npm run build && npm start   # preview http://localhost:3000, can express-api
docker build -t opspilot-demo-vite-spa . && docker run --rm -p 3020:80 opspilot-demo-vite-spa

cd ../next-blog
npm ci && npm run build && npm start   # http://localhost:3000
curl -o /dev/null -w "%{http_code}\n" http://localhost:3000/bai-viet/ops-pilot-la-gi   # 200
docker build -t opspilot-demo-next-blog . && docker run --rm -p 3030:3000 opspilot-demo-next-blog
```

Bản gốc (lát cắt express-api #15):

```bash
cd demo-apps/express-api
npm ci && npm start &                 # hoặc: PORT=3200 npm start
curl http://localhost:3000/health     # {"ok":true,"uptime_s":N}
curl -i "http://localhost:3000/items?limit=5"   # 5 ban ghi, X-Total-Count: 1000
curl -i -X POST http://localhost:3000/items -H "Content-Type: application/json" -d '{"name":"demo"}'
curl -i http://localhost:3000/items/999999      # 404

# Chay bang Docker (docker daemon dang chay):
docker build -t opspilot-demo-express . && docker run --rm -p 3010:3000 opspilot-demo-express
curl http://localhost:3010/health
```

## PR

- #15 — lát cắt express-api (merge 19/08). next-blog + vite-spa + fault endpoint → W2.