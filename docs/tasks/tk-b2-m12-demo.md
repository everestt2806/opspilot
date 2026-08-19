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
- [ ] `next-blog` + `vite-spa` chạy local + Dockerfile — **lùi W2**
- [ ] `next-blog` có endpoint fault: leak/CPU/error (cho 5 kịch bản `docs/07`) — **lùi W2**
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

## Lệnh tái hiện

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