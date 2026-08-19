# TK-S3 — Gate G0: review chéo + smoke tuần 1

| Chủ | Hạn | Branch | Brief | Ưu tiên |
|---|---|---|---|---|
| Both | 22/08/2026 | — | `docs/19` mục 10 (bảng cổng) | P0 |

## Mục tiêu

Chốt cổng **G0 — Nền chạy được**: "App, DB, SSH, ML skeleton trên hai máy; hai VPS dùng được".
Đây là lá chắn trước khi sang W2.

## Được sửa

- Cột trạng thái FR/NFR trong `docs/05-truy-vet-yeu-cau.md`.
- Cột "Thực tế" `docs/04-timeline.md` (nhịp cuối tuần).

## Không được sửa

- Code — review/smoke chỉ đọc, phát hiện lỗi thì mở task mới.

## Definition of Done

- [ ] A review PR của B (collector, demo apps); B review PR của A (PR #9) theo `prompts/99-review`
- [ ] `pnpm test` + `pnpm lint` + `pnpm typecheck` xanh trên `main` sau khi merge hết PR W1
- [ ] Smoke: SSH + collector trên VPS thật chạy được (`docs/15` mục smoke test 10 phút)
- [ ] ML skeleton train được từ dữ liệu giả (TK-A6 + TK-B3)
- [ ] FR-A1/A2/A3 tick đủ bằng chứng trong `docs/05`
- [ ] Ghi kết quả gate vào `docs/smoke-log.md`

## Nhật ký

- START 15/08 — dự kiến cuối W1 chốt gate.
- UPDATE 19/08 — phụ thuộc còn treo: TK-S2 (VPS), TK-B2 (demo apps, TRỄ), TK-A6 (ML skeleton),
  TK-B3 (fixture). Dự kiến chạy review chéo 20/08, smoke + chốt gate 21/08; nếu trượt thì lùi
  sang 22/08 và W2 ưu tiên gỡ trước việc mới (quy tắc trong `docs/03`).
- UPDATE 19/08 — B bận, A làm hết tuần (demo 24/08): **chạy gate chiều 22/08**. Review chéo:
  B nếu rảnh, không thì **A tự review theo `prompts/99` và ghi rõ trong hồ sơ này**. Hai item
  thay đổi phạm vi theo quyết định dồn demo: item ML (TK-A6/B3) **hoãn W2** — ghi rõ lý do
  trong kết quả gate; item demo-apps chỉ tính lát cắt `express-api`. Smoke W1 vẫn: VPS thật +
  try-ssh + lint/typecheck trên main + express chạy local.

## Lệnh tái hiện

```bash
pnpm test && pnpm lint && pnpm typecheck
# smoke theo docs/15-checklists.md#smoke-test-10-phút
```

## PR

— (gate, không có PR riêng)