# TK-B4 — M5: docker stats + HTTP probe (chạy local)

| Chủ | Hạn | Branch | Brief | Ưu tiên |
|---|---|---|---|---|
| B | 01/09/2026 | feat/m05-collector-probes | `docs/prompts/m05-collector.md` | P0 |

## Cách B và AI bắt đầu

1. Đồng bộ `main` tại hoặc sau `2addfb8`; branch VPS Control Panel đã merge, không làm tiếp ở đó.
2. Đọc `CLAUDE.md`, `docs/23-ke-hoach-sau-demo-30-08.md`, `docs/tasks/README.md`, file này,
   `docs/prompts/m05-collector.md` và `docs/contracts/metric-format.md`.
3. Tạo/switch branch `feat/m05-collector-probes`; chuyển đúng TK-B4 trên board sang
   `ĐANG LÀM`, ghi `START <dd/mm>` trước khi code.
4. Chỉ sửa `collector/**`, test và hai file task/board. Không sửa Electron, renderer hay contract.

Prompt giao AI nằm ở `docs/23-ke-hoach-sau-demo-30-08.md` mục 4. B4 xong mới kéo B5.

## Mục tiêu

Phần thu thập của collector: đọc `docker stats --format JSON` → 5 metric đúng tên/đơn vị, và
HTTP probe đo `latency_ms` + `http_error_rate` vào đích app demo. Chạy local trước khi lên VPS
(TK-B6).

## Được sửa

- `collector/**` (của B).

## Không được sửa

- `docs/contracts/metric-format.md` — sai thiếu thì báo, không tự sửa.

## Definition of Done

- [ ] Parse `docker stats` đúng: `cpu_pct`, `mem_mb` (đơn vị theo contract)
- [ ] Probe HTTP: `latency_ms` ms, `http_error_rate` 0–1 (cửa sổ 60s theo D3 khi vào thí nghiệm)
- [ ] Thiếu metric → ghi `null`, không ghi `0`
- [ ] pytest có test cho parser + probe (mock stats output)

## Nhật ký

- START 18/08 — dự kiến làm sau khi có scaffold (TK-B1 merged).
- BLOCKED 19/08 — cần app demo (TK-B2) làm đích probe; tạm bỏ qua bằng cách probe localhost
  port tĩnh nếu muốn xả blocker — chọn cách nào thì ghi UPDATE vào đây.
- UPDATE 19/08 — **Lùi W2** (quyết định dồn lực demo 24/08; collector ngoài demo). Hạn dời
  26/08. Đích probe sẽ là `express-api` (TK-B2 đã có lát cắt của A) — hết blocker khi quay lại.
- ASSIGNED 30/08 — Sau demo, B4 là task duy nhất B cần kéo. Đích `express-api` và Docker đã có;
  hạn rebaseline 01/09. Bàn giao bằng PR, pytest và output mẫu đã che thông tin VPS.

## Lệnh tái hiện

```bash
# (điền khi có code)
```

## PR

— (chưa có)
