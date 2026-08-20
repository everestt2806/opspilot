# OpsPilot ML Service (M7)

Service phát hiện bất thường chạy **cục bộ** (FastAPI, 127.0.0.1:8765), do Electron spawn.
3 model + 1 ensemble chạy song song trên cùng dòng metric; score chuẩn hoá 0..1.

- Contract API: `docs/contracts/ml-api.openapi.yaml` — đúng 6 endpoint, không thêm không bớt.
- Thông số chốt: `config.py` (cửa sổ 20 mẫu, 5 metric, 4 đặc trưng, MIN_TRAIN 150,
  `random_state=42`, `feature_version="v1-5metrics-4feats-w20"`).

## Cấu trúc

```
main.py            FastAPI, 6 endpoint (health/status/ingest/train/reset/replay)
config.py          hằng số đã chốt
features.py        sliding window -> vector 20 chiều (value/mean/std/slope mỗi metric)
models/            base + zscore_ewma + iforest + ocsvm + ensemble
store.py           state/<deployment_id>/ (state.pkl + meta.json) — restart không mất model
scripts/gen_fake_series.py   sinh metrics.jsonl giả theo metric-format.md
tests/             pytest, gọi trực tiếp hàm endpoint (không cần HTTP)
```

## Cài đặt & chạy

```bash
cd ml-service
py -3.12 -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt

.venv/Scripts/python.exe -m uvicorn main:app --port 8765
```

## Test

```bash
.venv/Scripts/python.exe -m pytest tests/ -v
.venv/Scripts/python.exe -m ruff check .
```

## Lệnh tái hiện từng bước

1. **Sinh dữ liệu giả** (không cần VPS/collector):

   ```bash
   .venv/Scripts/python.exe scripts/gen_fake_series.py --scenario memory_leak --out state/fake/metrics.jsonl
   ```

2. **Kiểm tra 6 endpoint bằng curl** (service đang chạy ở 8765):

   ```bash
   curl http://127.0.0.1:8765/health
   curl "http://127.0.0.1:8765/status?deployment_id=42"
   curl -X POST http://127.0.0.1:8765/reset -H "Content-Type: application/json" -d '{"deployment_id":42}'
   ```

   Payload `/ingest` (một mẫu) và `/train` (mảng ≥150 mẫu) lấy từ
   `state/fake/metrics.jsonl` — đọc 180 dòng đầu thành mảng `samples` rồi:

   ```bash
   curl -X POST http://127.0.0.1:8765/train \
     -H "Content-Type: application/json" \
     -d "{\"deployment_id\":42,\"samples\":[...180 mẫu...]}"
   ```

   Sau đó `/ingest` từng dòng tiếp theo → `ready:true`, `scores` đủ 4 method.

3. **Kiểm chứng tính tái lập** — chạy `/replay` hai lần cùng payload, so sánh `results`
   giống hệt nhau (đã có pytest `test_replay_lap_lai_ket_qua_giong_het`).

## Ghi chú thiết kế

- `null` ≠ `0`: null điền bằng giá trị hợp lệ gần nhất (forward fill); metric null toàn bộ
  tập train thì bị loại khỏi vector và báo trong `warnings` của `/train`.
- `slope` tính trên trục thời gian thật (đơn vị metric/phút) — đặc trưng bắt suy giảm
  tăng dần, có ablation study ở chương 5.
- `/replay` hoàn toàn offline: không đọc ghi đĩa, không đụng model đang chạy.