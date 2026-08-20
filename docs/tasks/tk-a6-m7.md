# TK-A6 — M7: ML skeleton — features + 6 endpoint + unit test

| Chủ | Hạn | Branch | Brief | Ưu tiên |
|---|---|---|---|---|
| A | 28/08/2026 | feat/m07-ml-skeleton-tests | `docs/prompts/m07-ml-service.md` | P0 |

## Mục tiêu (FR-D4 — phần ăn điểm nhất)

Xây lõi `ml-service/` theo đúng `docs/contracts/ml-api.openapi.yaml`: `features.py` (cửa sổ 20
mẫu × 5 metric × 4 đặc trưng = vector 20 chiều), 6 endpoint, 3 model + ensemble, `store.py`
persist state, `gen_fake_series.py`, 9 unit test trong brief. Mọi ngẫu nhiên `random_state=42`;
`feature_version="v1-5metrics-4feats-w20"`.

## Được sửa

- `ml-service/**` (main.py, config.py, features.py, models/, store.py, scripts/, tests/).

## Không được sửa

- `docs/contracts/ml-api.openapi.yaml` — nếu thiếu thông tin thì hỏi, không tự thêm endpoint.
- `app/**` (module khác của A cũng không đụng trong nhánh này).

## Definition of Done

- [x] 9/9 unit test trong brief m07 xanh (`pytest`) — 19/19 test, phủ mọi mục brief
- [x] `curl` đủ 6 endpoint khớp từng tên trường OpenAPI
- [x] Chuỗi giả memory leak → iforest/ocsvm báo trước khi mem chạm 90%
- [x] Restart service → `/status` vẫn `trained:true`
- [x] Chạy 2 lần cùng dữ liệu → score giống hệt (kiểm chứng random_state)
- [x] `README` của ml-service ghi lệnh tái hiện từng bước

## Nhật ký

- START 19/08 — venv Python 3.12.10 sẵn sàng, deps khớp danh sách duyệt; scaffold chỉ mới có
  `/health` + config rỗng. Kế hoạch: features.py → models → store → endpoint → test → fake series.
- UPDATE 19/08 — chưa bắt đầu code (ưu tiên trong ngày: TK-S2 VPS nghiệm thu trước; B chưa giao
  fixture TK-B3 → sẽ tự viết `gen_fake_series.py` trong scope ml-service nếu B chưa kịp).
- UPDATE 19/08 — **Lùi W2 cùng TK-B3**: quyết định dồn lực demo 24/08 (chẩn đoán lỗi kết nối +
  deploy Express thật + ops dashboard); ML không nằm trong demo. Nội dung task giữ nguyên,
  hạn dời 28/08. Các mục phụ thuộc TK-S2/B3 giải quyết khi quay lại.
- START 20/08 — Kéo sớm 2 ngày: TK-A14 (PR #18) xong sớm, W2 của A dày (A6→A7→A9), task này
  không phụ thuộc B hay port. TK-B3 chưa giao fixture → tự viết `gen_fake_series.py` trong
  scope. Đã đọc `prompts/m07`, `ml-api.openapi.yaml` (6 endpoint, snake_case),
  `metric-format.md` (định dạng jsonl cho gen_fake_series), ADR-008/010, docs/07 (đồng hồ,
  grace 60s), docs/10 (logging, Python). Scaffold hiện tại chỉ có `/health`. Kế hoạch theo
  brief: features → models → store → endpoints → fake series → test.
- UPDATE 20/08 — Hoàn tất toàn bộ: config (WINDOW=20, 5 metric, MIN_TRAIN=150, probe +1 cổng
  khi bận), features (slope theo phút, forward fill, drop metric all-null), 3 model +
  ensemble (EWMA update online: chấm điểm TRƯỚC rồi update để anomaly không bị nuốt vào mean),
  store (pickle nguyên tử + meta.json), 6 endpoint đúng OpenAPI, gen_fake_series 5 kịch bản,
  README, 19 test. `ruff check` + `ruff format` sạch. Curl 6 endpoint OK, replay lặp 2 lần
  giống hệt, restart giữ trained, memory_leak báo trước mem 90%.
- UPDATE 20/08 — **Phát hiện quan trọng cho B (đọc kỹ trước W9)**: chuẩn hoá min-max p1/p99
  tập train theo chữ M7 làm iforest/ocsvm chấm mẫu unseen bình thường quá cao. Đo trên dữ
  liệu giả (80-200 seeds): iforest FP ~41% (median ~0.65, depth bias — đã thử n_estimators
  100→1000, max_samples, contamination: không đổi), ocsvm với 'scale' FP ~71% chạm trần 1.0
  (curse of dimensionality: mọi điểm unseen cách train ~4-6σ trong 20D). Đã thử thêm
  OOF-calibration (41→33%, 71→54%) và rolling-percentile (24-36%): không đủ tốt, thêm trạng
  thái mới nên KHÔNG làm. Chỉ đổi `gamma` ocsvm 'scale'→0.001 (FP về ~40%, anomaly vẫn 1.0) —
  đã ghi 2 dòng DECISIONS.md 20/08 + cập nhật chữ m07. zscore_ewma chạy đúng (FP 0/40, median
  0.44). Test khoá theo ngưỡng hiện tại (chỉ chặn "không tệ hơn baseline"); **đánh giá FP
  trên dữ liệu collector thật là việc W9 của B** — nếu cần đổi cách chuẩn hoá thì mở ADR.
- DONE 20/08 — PR [#19](https://github.com/everestt2806/opspilot/pull/19) merged vào `main` ·
  19/19 pytest, ruff, curl đủ 6 endpoint và các smoke replay/restart/determinism đều xanh ·
  việc tiếp theo của A: TK-A7 Detector engine Tier 1.

## Lệnh tái hiện

```bash
cd ml-service
.venv/Scripts/python.exe -m pytest tests/ -v
.venv/Scripts/python.exe scripts/gen_fake_series.py --scenario memory_leak --out state/fake/metrics.jsonl
.venv/Scripts/python.exe -m uvicorn main:app --port 8765   # rồi curl 6 endpoint theo OpenAPI
```

## PR

- [#19](https://github.com/everestt2806/opspilot/pull/19) — merged 20/08/2026.
