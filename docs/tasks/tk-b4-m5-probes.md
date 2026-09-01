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

- [x] Parse `docker stats` đúng: `cpu_pct`, `mem_mb` (đơn vị theo contract)
- [x] Probe HTTP: `latency_ms` ms, `http_error_rate` 0–1 (cửa sổ 60s theo D3 khi vào thí nghiệm)
- [x] Thiếu metric → ghi `null`, không ghi `0`
- [x] pytest có test cho parser + probe (mock stats output)

## Nhật ký

- START 18/08 — dự kiến làm sau khi có scaffold (TK-B1 merged).
- BLOCKED 19/08 — cần app demo (TK-B2) làm đích probe; tạm bỏ qua bằng cách probe localhost
  port tĩnh nếu muốn xả blocker — chọn cách nào thì ghi UPDATE vào đây.
- UPDATE 19/08 — **Lùi W2** (quyết định dồn lực demo 24/08; collector ngoài demo). Hạn dời
  26/08. Đích probe sẽ là `express-api` (TK-B2 đã có lát cắt của A) — hết blocker khi quay lại.
- ASSIGNED 30/08 — Sau demo, B4 là task duy nhất B cần kéo. Đích `express-api` và Docker đã có;
  hạn rebaseline 01/09. Bàn giao bằng PR, pytest và output mẫu đã che thông tin VPS.
- START 01/09 — tạo nhánh `feat/m05-collector-probes` từ main `46e47b0`; audit parser đơn vị/null
  so với `metric-format.md`; bổ sung pytest cho parser + probe HTTP (mock stats output).
- UPDATE 01/09 — pytest 21/21 xanh. Thêm 18 test: đơn vị bộ nhớ (MiB/GiB/KiB/MB), docker stats
  (mock subprocess: thành công/exit khác 0/không có docker), probe HTTP (mock requests: 200/5xx/
  timeout/connection error, url rỗng), cửa sổ error rate 60s (probe fail và 5xx đều tính lỗi theo
  chốt của B, mẫu hết hạn rớt khỏi cửa sổ, không có `APP_URL` thì rate null), null semantics và
  `container_up = 0` khi probe fail/container chết. Tách helper `update_error_window` khỏi
  `build_metric` để test cửa sổ. Chưa commit — chờ B tự chạy/check rồi commit cục bộ, không push
  khi A chưa cho phép.
- SMOKE 01/09 — PASS (Docker Desktop 29.0.1, app giả nginx `testapp`): 10 dòng/100s, `ts` cách đúng
  10s, `seq` 1→10 liên tục, `cpu_pct`/`mem_mb`/`latency_ms` số thật (latency 3–26ms),
  `http_error_rate` 0, `container_up` 1, `db_response_ms` null (không `DB_DSN`), `host_*` null
  (Windows không có `/proc` — đúng dự kiến, lên VPS Linux mới có). Dòng mẫu (đã gọn):
  `{"seq":1,"ts":"2026-09-01T13:48:41Z","cpu_pct":0.0,"mem_mb":16.2,"mem_pct":0.1,"mem_limit_mb":15851.52,"latency_ms":9.66,"http_error_rate":0.0,"db_response_ms":null,"host_cpu_pct":null,"host_mem_pct":null,"container_up":1,"collector_version":"1.0.0"}`.
  Case app chết (stop container → `container_up:0`) sẽ kiểm chứng kỹ ở B6 trên VM01.

## Lệnh tái hiện

```bash
cd collector
python -m pytest tests -q
```

## PR

— (chưa có)
