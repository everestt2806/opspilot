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

- [ ] 9/9 unit test trong brief m07 xanh (`pytest`)
- [ ] `curl` đủ 6 endpoint khớp từng tên trường OpenAPI
- [ ] Chuỗi giả memory leak → iforest/ocsvm báo trước khi mem chạm 90%
- [ ] Restart service → `/status` vẫn `trained:true`
- [ ] Chạy 2 lần cùng dữ liệu → score giống hệt (kiểm chứng random_state)
- [ ] `README` của ml-service ghi lệnh tái hiện từng bước

## Nhật ký

- START 19/08 — venv Python 3.12.10 sẵn sàng, deps khớp danh sách duyệt; scaffold chỉ mới có
  `/health` + config rỗng. Kế hoạch: features.py → models → store → endpoint → test → fake series.
- UPDATE 19/08 — chưa bắt đầu code (ưu tiên trong ngày: TK-S2 VPS nghiệm thu trước; B chưa giao
  fixture TK-B3 → sẽ tự viết `gen_fake_series.py` trong scope ml-service nếu B chưa kịp).
- UPDATE 19/08 — **Lùi W2 cùng TK-B3**: quyết định dồn lực demo 24/08 (chẩn đoán lỗi kết nối +
  deploy Express thật + ops dashboard); ML không nằm trong demo. Nội dung task giữ nguyên,
  hạn dời 28/08. Các mục phụ thuộc TK-S2/B3 giải quyết khi quay lại.

## Lệnh tái hiện

```bash
cd ml-service
.venv/Scripts/python.exe -m pytest tests/ -v
.venv/Scripts/python.exe scripts/gen_fake_series.py --scenario memory_leak --out state/fake/metrics.jsonl
.venv/Scripts/python.exe -m uvicorn main:app --port 8765   # rồi curl 6 endpoint theo OpenAPI
```

## PR

— (chưa có)