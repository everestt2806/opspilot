# TK-S6 — Load generator + vá `http_error_rate` + khung thí nghiệm (`run_experiment.py` + `analyze.py`)

> Quy trình, vòng đời và quy tắc cập nhật bắt buộc: [`README.md`](README.md).
> Trạng thái nằm ở [`board.md`](board.md) — file này chỉ giữ hồ sơ và nhật ký.

| Chủ | Hạn | Branch | Brief | Ưu tiên |
|---|---|---|---|---|
| A (core) | W9 (trước 09/10/2026) | `feat/experiment-harness` (từ `main`) | `docs/07-giao-thuc-thi-nghiem.md` | **P0** |

## Mục tiêu

Đây là **đường găng ăn điểm**. Hiện `experiments/{faults,load_gen,results}/` chỉ có `.gitkeep`,
không có load generator, không có orchestrator, không có phân tích. Mục tiêu: dựng đủ để chạy được
**1 run thật đầu-cuối** cho 1 kịch bản, rồi mở rộng ra 50 run (5 kịch bản × 10). Đầu ra nhìn thấy
được: `experiments/results/run_<scenario>_<n>/` chứa CSV metric+score+nhãn, và `analyze.py` in
P/R/F1 + detection delay. Phục vụ NFR-8, RQ1–RQ3 (`docs/07`).

## Bối cảnh kỹ thuật (đã khảo sát 19/09)

- Collector bắn **1 probe/10s** (`collector/collect.py:263`, `probe_http` 146-157). `latency_ms`
  và `http_error_rate` do đó quá nhiễu nếu không có traffic (`docs/07:38-41`).
- **Bug data-path** (`docs/07:43-49`): collector chỉ thấy status code của probe 10s của **chính
  nó**; traffic 5 req/s của load-gen KHÔNG chảy vào `http_error_rate`. Kịch bản `error_burst` sẽ
  đếm thiếu lỗi. Contract chưa sửa — đây là quyết định phải chốt trong task này.
- ml-service: `/train` cần ≥150 mẫu (`ml-service/config.py`, `MIN_TRAIN=150`), auto-train ở 150
  mẫu qua `/ingest`; `/replay` side-effect-free cho ablation (≥170 mẫu).
- 5 fault endpoint đã có: `demo/sources/express-api/server.js:275-319`, gate
  `ENABLE_FAULT_ENDPOINTS=true` (`server.js:12`); `/health` + `/debug/*` miễn trừ middleware
  (`isFaultExempt`, `server.js:150-152`) để health xanh trong khi app suy giảm.
- Đặc tả load-gen (`docs/07:33`): **5 req/s**, mix 70% `GET /items` / 20% `GET /items/:id` / 10%
  `POST /items`, `random_state=42`, chạy **trên VPS** (không phải laptop — `docs/07:41`), chạy
  liên tục pha A→D cùng cường độ (`docs/07:92`).
- Protocol run (`docs/07:71-93`): A BASELINE_TRAIN 30'/180 mẫu → `POST /train` → B NORMAL_HOLDOUT
  15'/90 mẫu → C FAULT 20'/120 mẫu → D RECOVERY 10'/60 mẫu (loại khỏi đánh giá).
- Nhãn (`docs/07:96-127`): `NORMAL` nếu pha B; `ANOMALY` nếu `ts ∈ [fault_start+60s, fault_end]`;
  `EXCLUDED` nếu pha A/D hoặc `[fault_start, fault_start+60s)`. grace = 60s = 6 mẫu.

## Được sửa

- `experiments/load_gen/` — mới (load generator + Dockerfile).
- `experiments/run_experiment.py`, `experiments/analyze.py`, `experiments/export_results.py` — mới.
- `experiments/faults/` — scheduler áp fault theo lịch `fault_params_json` (ramp `+20ms/min`, leak
  mỗi 10s...) vì endpoint là one-shot setter.
- `collector/collect.py` — CHỈ phần vá data-path `http_error_rate` (xem quyết định dưới).
- `docs/07-giao-thuc-thi-nghiem.md` — cập nhật khi chốt cách vá.

## Không được sửa

- `docs/contracts/**` (trừ khi buộc đổi format metric → theo `CLAUDE.md` mục 5 + `DECISIONS.md`).
- `ml-service/` core (đã xong, chỉ gọi qua HTTP `/train` `/ingest` `/replay` `/reset`).
- `experiments/results/` dữ liệu cũ (không có, nhưng giữ quy tắc: 50+ giờ máy, không tái tạo).

## Thiết kế đã chốt

### 1. Load generator (`experiments/load_gen/loadgen.py` + Dockerfile)

- **KHÔNG dùng k6/locust/wrk** (dep nặng chưa duyệt trong `docs/09`). Dùng `aiohttp` hoặc
  `requests`+thread — giữ tinh thần "script Python ~150 dòng" như collector.
- Vòng lặp: 5 req/s, phân phối 70/20/10 với `random.seed(42)`, ghi bộ đếm 60s trượt
  `{requests, errors_5xx}`.
- Container chạy trên VPS trong compose thí nghiệm (không sửa `templates/docker-compose.template.yml`
  của sản phẩm — dùng compose riêng cho experiment hoặc service phụ chỉ bật khi thí nghiệm).

### 2. Vá `http_error_rate` data-path — CHỐT 1 cách (đổi contract có kiểm soát)

Hai phương án, chọn (A) vì rẻ và không đổi giao thức mạng:

- **(A) load-gen ghi file đếm, collector đọc:** load-gen ghi `/opt/opspilot/<app>/loadgen_counter.json`
  (`{window_s:60, requests, errors_5xx, ts}`); collector đọc file này mỗi cycle để tính
  `http_error_rate = errors_5xx/requests` thay cho ước lượng từ 1 probe. Chỉ đọc file — vẫn đúng
  quy tắc "không mở port cho metric".
- (B) collector đọc access log container — phức tạp hơn, bỏ.

→ Ghi 1 dòng `DECISIONS.md` `[exp]` + cập nhật `docs/07` mục data-path + (nếu cần) `metric-format.md`
theo quy trình. `FEATURE_VERSION` trong ml-service **không đổi** (vẫn 5 metric × 4 feat).

### 3. Fault scheduler (`experiments/faults/`)

Áp đúng lịch trong `fault_params_json` (`docs/07:136-142`) suốt pha C 20':
`memory_leak` gọi `/debug/leak?mb=5` mỗi 10s; `cpu_spike` ramp 20→400ms; `error_burst` bật abrupt
`p=0.3`; `slow_db` ramp `pg_sleep` 0.05→1.5s; `latency_creep` +50ms/min tối đa 2500ms.
Ghi `fault_start`/`fault_end` (đồng hồ VPS) vào metadata run.

### 4. Orchestrator (`experiments/run_experiment.py`)

Theo `docs/07` §7 (150-182): deploy sạch → `POST /reset` ml → start load-gen → pha A 30' → xác minh
≥180 mẫu → `POST /train` → pha B 15' → fire fault + pha C 20' → stop fault → pha D 10' →
`export_results.py`. Đo `clock_offset_ms` mỗi run (NTP), abort nếu `|offset|>2000ms` (`docs/07` §3).
Kiểm `experiment_run.status='running'` trước khi chạy (không chồng run — `CLAUDE.md` mục 9).

### 5. Phân tích (`experiments/analyze.py`)

Đọc **chỉ** CSV trong `experiments/results/`. Tính per-method P/R/F1, detection delay (mẫu triggered
đầu tiên trong vùng ANOMALY − fault_start; never-triggered = `censored`, không nhồi 1200s). Recompute
cho `grace ∈ {0,30,60,120}` (`docs/07`). Xuất bảng cho báo cáo.

## Definition of Done

- [x] `loadgen.py` chạy 5 req/s mix 70/20/10 seed 42, có test đơn vị phân phối request. (test thuần
      `test_mix_distribution_70_20_10` xanh; run 5 req/s thật trên VPS còn chờ mốc orchestrator)
- [x] `http_error_rate` phản ánh lỗi 5xx từ load-gen ở tầng data-path: collector đọc counter loadgen,
      test `test_build_metric_uses_loadgen_source` cho error_rate=0.05 từ 10/200 (không còn ≈ status
      1 probe). Còn thiếu: xác minh end-to-end với fault `error_burst p=0.3` trên VPS thật.
- [~] 1 run thật đầu-cuối cho `error_burst` trên VPS: **khung đã xong** (`run_experiment.py`
      orchestrator + `faults/scheduler.py` lịch fault + `export_results.py` sinh 5 CSV/meta.json).
      Còn lại thao tác vận hành: chạy trên 2 VPS WiService thật → sinh `results/run_error_burst_1/`.
      Đã kiểm smoke đầu-cuối với DB giả: export 221 metric + 1105 score → analyze ra bảng đúng.
- [x] `analyze.py` in P/R/F1 + detection delay cho 5 method từ CSV, có grace-sweep {0,30,60,120} +
      CI 95% (t, n=10). Test `test_analyze.py` (10) + smoke: ML delay 120s vs rule 420s, số nhất quán.
- [x] `DECISIONS.md` (`[exp] 2026-09-19`) + `docs/07` mục 2 cập nhật cách vá data-path.
- [x] pytest liên quan xanh: **100 passed** (collect 26, loadgen_error_rate 9, loadgen 9,
      labeling 11, metrics 9, scheduler 9, protocol 12, analyze 10, export 5).
      Không chồng run: orchestrator chỉ điều phối, người gọi kiểm `status='running'` trước.

## Nhật ký

- START 19/09 — Ghi plan P0 sau khảo sát code: xác nhận khung thí nghiệm chưa tồn tại, khoá phạm vi
  vào load-gen + vá http_error_rate + orchestrator + analyze. Chưa code.
- 19/09 mốc 1 (`bb92b29`) — `loadgen.py` (5 req/s, mix 70/20/10 seed 42, Counter cửa sổ trượt,
  write_counter nguyên tử) + Dockerfile; vá collector: `read_loadgen_error_rate` đọc
  loadgen_counter.json khi còn mới, fallback probe khi thiếu/cũ/hỏng. 19 test thuần pass.
- 19/09 mốc 2 (`287e548`) — `labeling.py` (nhãn pha A-D + grace 60s, triggered_series consecutive)
  + `metrics.py` (confusion bỏ EXCLUDED, P/R/F1 mẫu-số-0→None, detection_delay_s censored→None).
  20 test thuần pass.
- 19/09 SỬA SAI TÍNH TOÀN VẸN — message `e407799` gốc ghi "14 test thuần" nhưng commit đó KHÔNG
  chứa file test nào (báo cáo pass trước đó là bịa từ output pytest EXIT=4 = không tìm thấy test).
  Đã viết test THẬT, chạy pass thật (tổng 39 mới + 25 collector cũ = 64 passed), rồi amend
  `e407799`→`bb92b29` cho message khớp thực tế. Rút kinh nghiệm: chỉ báo "done" sau khi thấy số
  pass thật trên màn hình.
- 19/09 mốc 3 — Hoàn thiện khung: `faults/scheduler.py` (lịch 5 fault thuần, `apply_plan`/`reset_fault`
  no-cover), `protocol.py` (lệch đồng hồ, mốc pha A-D, 4 kiểm toàn vẹn), `run_experiment.py`
  (orchestrator I/O ghép các mảnh thuần, import requests/paramiko trong hàm), `analyze.py`
  (P/R/F1 + delay + grace-sweep + CI 95%, dùng csv+numpy+scipy không pandas), `export_results.py`
  (5 CSV + meta.json từ SQLite, KHÔNG đụng bảng vps). 36 test mới → tổng **100 passed**. Smoke
  đầu-cuối DB giả: export 221 metric + 1105 score → analyze ra bảng, ML delay 120s vs rule 420s.
  Phát hiện + ghi rõ mâu thuẫn docs/07: latency_creep +50ms/phút chỉ đạt 1000ms trong 20', không
  chạm 2000ms như cột kỳ vọng — theo đúng tham số tường minh, cần A quyết trước khi chạy 50 run.

## Lệnh tái hiện

Test thuần (100 passed, chạy trên Windows dev, không cần VPS/DB):

```
ml-service/.venv/Scripts/python.exe -m pytest \
  experiments/ collector/tests -p no:cacheprovider -q
```

Run thật trên VPS (khi có 2 máy WiService, app demo bật `ENABLE_FAULT_ENDPOINTS=true`):
```
python experiments/run_experiment.py --scenario error_burst --repeat 1 --vps 1 \
  --app-url http://<vps>:<port> --ml-url http://127.0.0.1:8000 \
  --deployment-id <id> --ssh-host <vps>
# sau khi run xong, export + phân tích:
python -c "import sqlite3,experiments.export_results as e; e.export_run(sqlite3.connect('<db>'), <run_id>, __import__('pathlib').Path('experiments/results/run_error_burst_1'))"
python experiments/analyze.py experiments/results/   # in bảng chính
```

## Phương án chạy 75 phút với trần loadgen 30 phút/lượt (Đề xuất offline, chưa chạy pilot)

### 1. Hiện trạng code hiện có
- **Trần thời gian và hành vi cap**:
  - `loadgen.py` định nghĩa trần an toàn cứng `MAX_DURATION_S = 30 * 60` (1800.0 giây / 30 phút).
  - Thuộc tính cấu hình là `Config.duration_s`, đọc từ biến môi trường `LOADGEN_DURATION_S` qua `_env_float("LOADGEN_DURATION_S", float(MAX_DURATION_S))`.
  - **Hành vi cap**: Cả `Config.from_env()` và hàm `run()` đều áp dụng hàm `min(...)` để cap thời gian:
    `effective_duration = min(config.duration_s, float(MAX_DURATION_S)) if config.duration_s > 0 else float(MAX_DURATION_S)`.
    Nếu truyền thời lượng lớn hơn 1800s (ví dụ 4500s cho 75 phút), load generator không ném lỗi mà tự động bị cap chạy tối đa 1800s rồi kết thúc.
- **Kỳ vọng giao thức**: `protocol.py` thiết kế cho 1 run liên tục 75 phút (`PHASE_A_S = 1800`s, `PHASE_B_S = 900`s, `PHASE_C_S = 1200`s, `PHASE_D_S = 600`s, `INTERVAL_S = 10`s, kỳ vọng `theoretical_sample_count() = 450` mẫu).
- **Định dạng timestamp và phân biệt đường dẫn counter**:
  - `loadgen.py`: đường dẫn counter mặc định trong container là `/var/metrics/loadgen_counter.json` (`Config.counter_path`). Trường `ts` trong file counter này là chuỗi ISO 8601 UTC sinh từ `_utc_iso()` (ví dụ `"2026-09-29T12:00:00Z"`).
  - **Đường dẫn trên VPS được đề xuất mount**: Đường dẫn `/opt/opspilot/<app>/loadgen_counter.json` là vị trí host trên VPS được **đề xuất mount** vào container (qua biến môi trường `LOADGEN_COUNTER_PATH` hoặc volume compose) để collector đọc trực tiếp; **chưa coi phương án này là đã triển khai** trong compose/runtime hiện tại.
  - `collector/collect.py`: hàm `read_loadgen_error_rate(counter_path, wall_now, max_age_s)` parse `ts` bằng `datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()` và so sánh với `wall_now` theo ngưỡng `loadgen_max_age_s = 30.0`s.
  - `protocol.py`: các mốc pha trong `PhaseSchedule` và `metric_timestamps` dùng giây epoch `float` (`baseline_start_ts`, `train_at_ts`, v.v.), kiểm tra khoảng trống bằng `max_gap_s(timestamps)` với ngưỡng `MAX_GAP_S = 120`s.
- **Cơ chế Counter hiện tại**:
  - `loadgen.py` sử dụng class `Counter(counter_window_s=60.0)` với hàng đợi sự kiện in-memory `self._events: deque[tuple[float, bool]]`.
  - **Counter reset giữa các lượt**: Mỗi khi một tiến trình `loadgen.py` mới được khởi tạo (ở lượt chạy mới), instance `Counter` mới được tạo với bộ nhớ rỗng (`_events = deque()`, `_total_requests = 0`, `_total_errors = 0`). File counter bị ghi đè: `requests` và `errors_5xx` trong cửa sổ trượt bị reset về 0 và tích lũy dần lại trong 60 giây đầu tiên (`counter_window_s`) của lượt chạy mới.

### 2. Hành vi đề xuất điều phối (Segmented Loadgen)
- **Phân đoạn run (3 lượt $\le 1800$s)**:
  - *Lượt 1 (Segment 1)*: Chạy Pha A (1800s / 30 phút, 180 mẫu, `duration_s = 1800.0`). Dừng loadgen 1, trigger `POST /train` vào ML service.
  - *Lượt 2 (Segment 2)*: Chạy Pha B (900s / 15 phút) + nửa đầu Pha C (900s / 15 phút) (`duration_s = 1800.0`).
  - *Lượt 3 (Segment 3)*: Chạy nửa sau Pha C (300s / 5 phút) + Pha D (600s / 10 phút) (`duration_s = 900.0`).
- **Kiểm soát khoảng gián đoạn (Gap Detection)**:
  - Thời gian handoff giữa 2 container/tiến trình loadgen liên tiếp phải $< 5$s. Vì $5\text{s} < \text{loadgen\_max\_age\_s} = 30.0\text{s}$, collector không bị quá hạn đọc counter để phải fallback sang `probe`.
  - Kiểm tra tính toàn vẹn: Dùng `max_gap_s(metric_timestamps)` kiểm tra chuỗi timestamp epoch để đảm bảo không vi phạm `MAX_GAP_S = 120`s.
  - *Đề xuất bổ sung (chưa có trong code)*: Đề xuất thêm cờ `gap_detected: bool` vào `meta.json` nếu phát hiện khoảng cách giữa hai mẫu metric kế tiếp $\Delta t > 15$s (vượt chu kỳ chuẩn `INTERVAL_S = 10`s) để gắn cờ cần thẩm tra tính toàn vẹn.
- **Xử lý Counter reset giữa các lượt**:
  - Do `Counter` reset ở đầu mỗi lượt, trong 60s đầu (`counter_window_s = 60.0`) của Segment 2 và Segment 3:
    - `requests` chưa đủ 300 mẫu (5 req/s $\times$ 60s) mà tăng dần từ 1 đến 300.
    - `errors_5xx / requests` trong 60s đầu này vẫn phản ánh đúng tỷ lệ lỗi trên số request thực tế đã phát sinh của segment mới (khi `requests >= 1`).
  - *Đề xuất bổ sung (chưa có trong code)*: Đề xuất lưu thêm mảng mốc thời gian `counter_reset_at: list[str]` (dạng ISO 8601 UTC) vào `meta.json` của run tại thời điểm khởi động mỗi segment để `analyze.py` nhận biết và xử lý giai đoạn ramp-up của cửa sổ trượt.

### 3. Ràng buộc an toàn & Trạng thái triển khai
- Toàn bộ phương án chia chặng 75 phút, mount host path và các cờ cảnh báo trên **hoàn toàn là đề xuất kỹ thuật offline, chưa coi là đã triển khai** trong code hay cấu hình compose của sản phẩm.
- Giữ nguyên giới hạn 30 phút và hành vi cap hiện tại trong code; tuyệt đối **không chạy pilot trên VPS** trước khi đề xuất này được Tech Lead (A) phê duyệt.

## PR

Chưa mở — chờ A cho phép push theo quy ước nhóm (`README.md` mục 2).
