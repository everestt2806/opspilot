# M11 — Thí nghiệm & phân tích · Người B · Tuần 6–10

`experiments/` — NFR-8, toàn bộ chương 5 của báo cáo

## Mục tiêu
Tự động hoá 50 run thí nghiệm, bảo vệ dữ liệu tuyệt đối, và biến dữ liệu đó thành bảng + hình
cho báo cáo. **Đây là phần quyết định điểm số.**

## Đọc trước — bắt buộc đọc hết
- **`docs/07-giao-thuc-thi-nghiem.md`** — toàn bộ file. Mọi định nghĩa nằm ở đó
- `docs/contracts/schema.sql` — `experiment_run`, `score_sample`, `alert`
- `docs/contracts/ml-api.openapi.yaml` — `POST /train`, `/reset`, `/replay`
- `docs/02-ui-ux-spec.md` mục 1 — bộ màu 5 phương pháp (hình vẽ phải dùng đúng)

## Cần viết

```
experiments/
├─ faults/{memory_leak,cpu_spike,error_burst,slow_db,latency_creep}.py
├─ load_gen/{loadgen.py,Dockerfile}
├─ palette.py            bộ màu 5 phương pháp cho matplotlib (đúng hex của UI)
├─ run_experiment.py     chạy 1..N run tự động
├─ export_results.py     xuất CSV + meta.json sau mỗi run
└─ analyze.py            P/R/F1 + CI + PR curve + ablation + timeline chart
```

### `load_gen/` — container chạy **trên VPS**
5 request/giây, mix 70% `GET /items` · 20% `GET /items/:id` · 10% `POST /items`.
Chạy suốt từ đầu pha A đến hết pha D, cường độ **không đổi**. `random_state=42`.
Chạy trên VPS chứ không từ laptop để jitter internet không lẫn vào `latency_ms`.

### `faults/*.py`
Mỗi script: `start(params)` / `stop()`, gọi các endpoint `/debug/*` của `express-api`
(xem `m12-demo-apps.md`). Tham số đúng bảng ở `docs/07` mục 6, ghi vào
`experiment_run.fault_params_json` để tái lập được.

### `run_experiment.py`
```
python experiments/run_experiment.py --scenario memory_leak --repeat 1-10 --vps 1
```
10 bước theo `docs/07` mục 7. Bốn điểm dễ làm sai:

1. **Đo lệch đồng hồ đầu mỗi run** (`ssh vps 'date +%s%3N'` so với `time.time()*1000`).
   `|offset| > 2000ms` → **huỷ run**, `abort_reason='clock_skew'`.
2. **Mọi mốc thời gian ghi theo đồng hồ VPS**, quy đổi bằng offset vừa đo.
3. **Gọi `/train` đúng thời điểm** (cuối pha A), sau khi xác nhận đã có ≥180 `metric_sample`.
   Thiếu >10% → huỷ run.
4. **Kiểm tra toàn vẹn ngay sau run**; fail → `status='aborted'`, đưa vào hàng đợi chạy lại
   (tối đa 2 lần):
   - số mẫu ≥90% lý thuyết (≈462 mẫu cho 77 phút)
   - không có khoảng trống >2 phút giữa 2 mẫu liên tiếp
   - mỗi `metric_sample` có **đúng 5** dòng `score_sample`
   - không còn `score = null` trong pha B, C, D

### `export_results.py`
Sau **mỗi** run, xuất vào `experiments/results/run_<scenario>_<n>/`:
`metric_sample.csv` · `score_sample.csv` · `alert.csv` · `experiment_run.csv` ·
`meta.json` (`git_commit`, `collector_version`, `feature_version`, ngưỡng đang dùng, `vps_id`).
**Commit + push ngay.** **Không bao giờ commit file `.db`** (chứa credential SSH đã mã hoá).

### `analyze.py`
Chỉ đọc **CSV đã export**, không đọc DB sống → chạy lại được trên máy bất kỳ, kể cả sau khi
đã trả VPS.

Đầu ra:
1. **Bảng chính** P/R/F1 `mean ± std` + **CI 95%** (phân phối t, n=10), theo method × scenario.
2. **Detection delay** — trung bình trên các run phát hiện được + **số run censored** (không
   phát hiện). Tuyệt đối **không** điền 1200s cho run censored.
3. **PR curve + AUC-PR** — quét ngưỡng 0.05→0.95 bước 0.05 trên `score_sample`.
   `rule` chỉ có **một điểm** (score nhị phân) — vẽ dạng điểm đánh dấu, ghi chú rõ.
4. **Ablation slope** — gửi lại mẫu qua `POST /replay` với `use_slope=false`, so bảng
   "có slope vs không slope" trên `memory_leak` và `latency_creep`.
5. **Hình timeline một run tiêu biểu** — `mem_mb` theo thời gian + vạch `fault_start` + điểm
   alert đầu tiên của từng method (đúng màu) + đường ngang ngưỡng rule 90%.
6. **Kiểm chứng bổ trợ:** độ nhạy với `grace ∈ {0,30,60,120}` · so sánh 2 VPS · số run bị huỷ.

Xuất Markdown (dán vào báo cáo) + PNG 300 DPI. **Dùng `palette.py`** để màu khớp app và slide.

## Bất biến

1. **Ground truth, ngưỡng và định nghĩa metric chốt TRƯỚC khi chạy 50 run chính thức** (pilot tuần 8).
   Đổi sau khi đã nhìn kết quả là p-hacking.
2. Run bị huỷ **không bao giờ** được đưa vào bảng kết quả. Báo cáo số run huỷ và lý do.
3. `random_state=42` ở mọi nơi.
4. Mọi con số trong báo cáo truy được về một file CSV trong `results/`.

## Unit test (`pytest`) cho `analyze.py` — sai ở đây là bảo vệ sai
- [ ] Chuỗi nhãn giả biết trước TP/FP/FN → P/R/F1 khớp giá trị tính tay
- [ ] `grace` khác nhau → số mẫu ANOMALY đổi đúng kỳ vọng
- [ ] Run không có alert → detection delay là **censored**, không phải 0
- [ ] CI 95% với n=10 khớp `scipy.stats.t.interval`

## Định nghĩa xong
- [ ] Một run chạy trọn vẹn **không cần can thiệp tay** (mốc tuần 7)
- [ ] Pilot 10 run xong, ngưỡng đã chốt và ghi `DECISIONS.md` (mốc tuần 8)
- [ ] 50 run chính thức xong, CSV đã push GitHub (mốc tuần 9)
- [ ] `analyze.py` chạy trên máy khác từ CSV → ra **đúng** số liệu trong báo cáo
- [ ] Đủ 4 hình chính cho chương 5, đúng bộ màu
