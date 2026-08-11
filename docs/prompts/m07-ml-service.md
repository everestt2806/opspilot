# M07 — ML service · Người A · Tuần 1–3

`ml-service/` — FR-D4. **Đây là phần ăn điểm nhất của đồ án.**

## Mục tiêu
FastAPI localhost:8765 chạy song song 3 mô hình phát hiện bất thường + 1 ensemble trên cùng
một dòng dữ liệu, trả score chuẩn hoá 0..1 cho từng phương pháp.

## Đọc trước
- **`docs/contracts/ml-api.openapi.yaml`** — 6 endpoint, không thêm không bớt, không đổi tên trường
- `docs/07-giao-thuc-thi-nghiem.md` — hiểu dữ liệu này sẽ được dùng để làm gì
- `docs/14-quyet-dinh-kien-truc.md` ADR-008, ADR-010

## Cấu trúc

```
ml-service/
├─ main.py                 FastAPI, 6 endpoint
├─ config.py               hằng số: WINDOW=20, METRICS=[...], MIN_TRAIN=150, RANDOM_STATE=42
├─ features.py             sliding window -> vector 20 chiều
├─ models/
│  ├─ base.py              interface chung: fit(X), score(x)->float 0..1
│  ├─ zscore_ewma.py  iforest.py  ocsvm.py  ensemble.py
├─ store.py                lưu/nạp state theo deployment_id
├─ state/<deployment_id>/  model.pkl, scaler.pkl, meta.json   (gitignore)
├─ scripts/gen_fake_series.py
└─ requirements.txt
```

## `features.py` — trái tim của phần nghiên cứu

- Cửa sổ trượt **20 mẫu**.
- **5 metric**: `cpu_pct`, `mem_mb`, `latency_ms`, `http_error_rate`, `db_response_ms`.
- Mỗi metric **4 đặc trưng**: `[giá trị hiện tại, mean cửa sổ, std cửa sổ, slope]`
  → **vector 20 chiều**, **thứ tự chiều cố định** (thứ tự đổi giữa train và inference là bug
  cực khó phát hiện — viết test cho việc này).
- `slope` = hệ số góc hồi quy tuyến tính trên cửa sổ, đơn vị **đơn vị metric / phút**
  (chuẩn hoá theo thời gian để không phụ thuộc chu kỳ lấy mẫu).
  **Đây là đặc trưng bắt suy giảm tăng dần — có ablation study chứng minh ở chương 5.**
- Giá trị `null`: điền bằng giá trị hợp lệ gần nhất (forward fill); chưa có giá trị nào →
  dùng 0 và ghi cảnh báo. Metric `null` **toàn bộ** tập train (vd app không có DB) → **loại
  metric đó khỏi vector**, ghi vào `meta.json` và trả trong `warnings` của `/train`.
- Chưa đủ 20 mẫu → trả `None`, **không** trả vector 0.

Hàm chính:
```python
def build_vector(window: list[dict], config: FeatureConfig) -> np.ndarray | None
def build_matrix(samples: list[dict], config: FeatureConfig) -> np.ndarray   # (n-window+1, dim)
```
`FeatureConfig` có `use_slope`, `use_mean`, `use_std`, `window`, `metrics` — chính là thứ cho
phép `/replay` chạy ablation mà không phải viết code riêng.

## Ba mô hình + ensemble

| Method | Cài đặt | Chuẩn hoá score về 0..1 |
|---|---|---|
| `zscore_ewma` | EWMA `α=0.3` cho mean và var từng **chiều**; z = \|x−μ\|/σ | `sigmoid(max_z/3 − 1)`, kẹp [0,1] |
| `iforest` | `IsolationForest(n_estimators=100, contamination='auto', random_state=42)` | min-max của `−decision_function` **theo phân vị của tập train** (dùng p1 và p99 để không bị outlier kéo) |
| `ocsvm` | `StandardScaler` **bắt buộc** → `OneClassSVM(kernel='rbf', nu=0.05, gamma='scale')` | như trên, trên `−decision_function` |
| `ensemble` | không train gì thêm | `score` = **trung vị** 3 score; `above_threshold` = **≥2/3** method con vượt ngưỡng (ADR-008) |

⚠ `ensemble.above_threshold` tính từ **cờ của 3 model con**, KHÔNG phải từ `score` ensemble.

Hằng số chuẩn hoá (min/max/percentile của tập train) **lưu vào state** — inference phải dùng
đúng hằng số của lúc train, nếu không score sẽ trôi.

## Endpoint

Theo đúng `ml-api.openapi.yaml`. Điểm cần chú ý:

- `POST /ingest` — nhận **một** mẫu, cập nhật cửa sổ, trả score 4 method.
  Chưa train → `ready:false`, mọi score `null` (**không phải 0**).
  Mẫu phải đến theo thứ tự `seq` tăng dần; phát hiện lùi thứ tự → log cảnh báo.
- `POST /train` — cần ≥150 mẫu. Fit scaler → fit 3 model → tính hằng số chuẩn hoá → lưu state.
  Trả `warnings` cho các metric bị loại.
- `POST /replay` — **không side-effect, không đọc/ghi đĩa, không đụng model đang chạy.**
  Train trên `train_count` mẫu đầu, chấm điểm toàn bộ mảng, trả score từng mẫu.
  Đây là công cụ cho ablation study và threshold sweep chạy **offline hoàn toàn** (~40 dòng
  code, giá trị rất cao cho chương 5).
- Chỉ bind `127.0.0.1`. Không CORS. Không auth (localhost).

## Bắt buộc
- **`random_state=42` ở mọi nơi.** Kết quả thí nghiệm phải tái lập được.
- `logging`, không `print`.
- Pydantic v2 cho mọi request/response.
- State pickle vào `state/<deployment_id>/` kèm `meta.json`
  (`train_sample_count`, `trained_at`, `feature_version`, `dropped_metrics`, ngưỡng chuẩn hoá).
  Restart service **không mất** model.
- `feature_version = "v1-5metrics-4feats-w20"` — đổi công thức feature thì **phải** đổi chuỗi
  này, `analyze.py` kiểm tra để không trộn nhầm dữ liệu của hai phiên bản.

## `scripts/gen_fake_series.py`
Sinh chuỗi metric giả (numpy): pha bình thường + inject anomaly theo kiểu (tăng dần / đột ngột /
nhiễu), xuất ra `metrics.jsonl` đúng format. Fixture do B bàn giao cho phép A test toàn bộ
pipeline ML **không cần VPS, không cần collector thật**, từ tuần 1.

## Unit test (`pytest`)
- [ ] Chuỗi tăng tuyến tính đã biết → `slope` đúng giá trị lý thuyết (sai số 1e-6)
- [ ] Chuỗi hằng → `slope == 0`, `std == 0`
- [ ] Cửa sổ chưa đủ 20 mẫu → `None`
- [ ] Có `null` giữa chuỗi → không sinh `NaN`
- [ ] Vector đúng **20 chiều**, thứ tự chiều ổn định qua nhiều lần gọi
- [ ] Train rồi score lại chính dữ liệu train → phần lớn score thấp (< 0.5)
- [ ] Inject anomaly rõ rệt → score > 0.7
- [ ] `/replay` với `use_slope=false` → `feature_dim == 15`

## Định nghĩa xong
- [ ] `curl` được cả 6 endpoint, khớp từng tên trường với file OpenAPI
- [ ] Chuỗi giả có memory leak → `iforest`/`ocsvm` báo trước khi `mem_pct` chạm 90%
- [ ] Restart service → `/status` vẫn báo `trained: true`
- [ ] Cùng dữ liệu, chạy 2 lần → **score giống hệt nhau** (kiểm chứng `random_state`)
- [ ] Toàn bộ unit test xanh
