# TK-B2 — M12: 3 demo app Tier 1 + fault endpoint

| Chủ | Hạn | Branch | Brief | Ưu tiên |
|---|---|---|---|---|
| B | 11/08/2026 | feat/m12-demo-apps | `docs/prompts/m12-demo-apps.md` | P0 |

## Mục tiêu

3 app demo đúng 3 stack Tier 1 (Next.js blog, Express API, Vite SPA) kèm các endpoint/script
sinh fault (memory leak, cpu spike, error burst…) để deploy, chạy thí nghiệm và demo. Đây là
điều kiện để có lát cắt Express W2 và gate smoke W1.

## Được sửa

- `demo-apps/**` (thư mục của B).

## Không được sửa

- `templates/**` (Dockerfile template là của A — nếu thiếu field thì báo).

## Definition of Done

- [ ] 3 app chạy được local (README từng app: lệnh chạy, port)
- [ ] Mỗi app có Dockerfile dùng đúng template của A
- [ ] `next-blog` có endpoint fault: leak/CPU/error (cho 5 kịch bản `docs/07`)
- [ ] Express có DB để phát sinh `db_response_ms` (nếu nằm trong scope m12)
- [ ] PR kèm lệnh tái hiện cho cả 3 app

## Nhật ký

- START 11/08 — dự kiến xong trong ngày.
- UPDATE 19/08 — **TRỄ**: `demo-apps/` còn rỗng, chưa có PR. Đang chặn TK-B4 (probe cần đích)
  và gate G0 (TK-S3). B cần ưu tiên số 1: làm tối thiểu `express-api` trước, 2 app còn lại theo sau.

## Lệnh tái hiện

```bash
cd demo-apps/express-api && pnpm dev   # (điền lệnh thật khi B cập nhật)
```

## PR

— (chưa có)