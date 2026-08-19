# TK-B3 — Fixture metric giả đúng contract

| Chủ | Hạn | Branch | Brief | Ưu tiên |
|---|---|---|---|---|
| B | 28/08/2026 | feat/m07-fake-metrics | `docs/contracts/metric-format.md`, `prompts/m07` (mục gen_fake_series) | P1 |

## Mục tiêu

Sinh chuỗi metric giả đúng format `metric-format.md` để A test toàn bộ pipeline ML (features →
train → score) **không cần VPS, không cần collector thật**, từ tuần 1. Kịch bản: pha bình
thường + inject anomaly (tăng dần / đột ngột / nhiễu).

## Được sửa

- `experiments/fixtures/**` (thư mục của B).

## Không được sửa

- `ml-service/**` (của A) — trừ khi A đồng ý cho B viết vào `ml-service/scripts/`.
  Phương án dự phòng đã thống nhất: nếu B chưa kịp, **A tự viết** `gen_fake_series.py` trong
  `ml-service/scripts/` (nằm trong scope m07) — báo nhau trước khi làm để không trùng.

## Definition of Done

- [ ] Đầu ra `metrics.jsonl` khớp từng tên trường contract (kể cả `null` hợp lệ)
- [ ] `seq` tăng dần liên tục, chu kỳ 10s (timestamp phù hợp)
- [ ] Ít nhất 2 kịch bản anomaly: tăng dần (memory leak) + đột ngột (cpu spike)
- [ ] Kèm lệnh tái hiện; A chạy lại được và trỏ đúng file trong try-ML

## Nhật ký

- START 17/08 — dự kiến giao fixture cho A.
- UPDATE 19/08 — chưa thấy PR; A sẽ tự viết `gen_fake_series.py` nếu đến 20/08 vẫn trống
  (đã ghi ở TK-A6). Nếu B làm, báo A để A không viết trùng.
- UPDATE 19/08 — **Lùi W2 cùng TK-A6** (quyết định dồn lực demo 24/08; ML ngoài demo). Hạn
  dời 28/08; phương án dự phòng "A tự viết gen_fake_series" vẫn giữ nguyên.

## Lệnh tái hiện

```bash
# (điền khi có code) — ví dụ:
python experiments/fixtures/gen_metrics.py --scenario memory_leak --minutes 40 --out metrics.jsonl
```

## PR

— (chưa có)