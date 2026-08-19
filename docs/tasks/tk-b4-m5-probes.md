# TK-B4 — M5: docker stats + HTTP probe (chạy local)

| Chủ | Hạn | Branch | Brief | Ưu tiên |
|---|---|---|---|---|
| B | 18/08/2026 | feat/m05-collector-probes | `docs/prompts/m05-collector.md` | P1 |

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

## Lệnh tái hiện

```bash
# (điền khi có code)
```

## PR

— (chưa có)