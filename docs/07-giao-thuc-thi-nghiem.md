# GIAO THỨC THÍ NGHIỆM & ĐÁNH GIÁ

> **Đây là phần ăn điểm nhất của đồ án.** App chỉ là công cụ để sinh ra dữ liệu cho tài liệu
> này. Đọc kỹ trước khi viết `run_experiment.py` và `analyze.py`.
>
> Nguyên tắc xuyên suốt: **mọi định nghĩa phải được chốt TRƯỚC khi chạy 50 run chính thức.**
> Đổi định nghĩa sau khi thấy kết quả là p-hacking, và hội đồng có thể hỏi đúng chỗ đó.

---

## 1. Câu hỏi nghiên cứu

**RQ1.** Các phương pháp phát hiện bất thường không giám sát (Z-score/EWMA, Isolation Forest,
One-Class SVM, Ensemble) có phát hiện suy giảm vận hành **sớm hơn và chính xác hơn** ngưỡng
cố định (rule-based) không, và sớm hơn bao nhiêu?

**RQ2.** Đặc trưng **slope** (xu hướng trên cửa sổ trượt) đóng góp bao nhiêu vào khả năng
phát hiện suy giảm *tăng dần*?

**RQ3.** Phương pháp nào phù hợp với kiểu suy giảm nào (đột ngột vs tăng dần)?

Cả 3 câu đều trả lời được bằng dữ liệu của cùng 50 run — không cần thí nghiệm bổ sung.

---

## 2. Thiết lập chung

| Thành phần | Cấu hình cố định |
|---|---|
| App chịu tải | `demo-apps/express-api` + PostgreSQL, container `mem_limit: 512m`, `cpus: 1.0` |
| VPS | 2 VPS **cùng provider, cùng gói, cùng region**, không chạy gì khác trong lúc thí nghiệm |
| Chu kỳ metric | 10 giây/mẫu |
| Load generator | container trên VPS, **5 request/giây**, mix: 70% `GET /items`, 20% `GET /items/:id`, 10% `POST /items` |
| Ngưỡng ML | `score > 0.7`, 2 mẫu liên tiếp — **chốt sau pilot tuần 8, không đổi nữa** |
| Ngưỡng rule | cpu>90%, mem>90%, latency>2000ms, error_rate>0.5, 3 mẫu liên tiếp |
| `random_state` | 42 ở mọi nơi (sklearn, numpy, load generator) |

**Vì sao phải có load generator:** không có traffic thì `latency_ms` và `http_error_rate` chỉ
đo được từ 1 probe/10s — ước lượng error rate từ 6 mẫu/phút quá nhiễu, và 3/5 kịch bản mất ý
nghĩa. Load generator chạy **trên chính VPS** (không phải từ laptop) để jitter internet không
lẫn vào số đo.

> **Ghi chú rà soát 28/07/2026 — đề xuất, chưa đổi contract:** collector hiện chỉ nhìn thấy
> status code của health probe 10 giây/lần; status code của 5 request/giây do load generator
> tạo ra chưa đi vào `http_error_rate`. Vì vậy lập luận “có load generator thì error rate bớt
> nhiễu” chưa đúng với đường dữ liệu hiện tại. Đề xuất ưu tiên: load generator công bố bộ đếm
> request/5xx theo cửa sổ 60 giây (file JSON ghi nguyên tử hoặc endpoint nội bộ), collector đọc
> bộ đếm đó khi chạy thí nghiệm; khi không có load generator mới fallback về health probe.
> Cần ghi nguồn của error rate vào `raw_json`/`meta.json` để không trộn hai cách đo mà không biết.

**Vì sao `mem_limit: 512m`:** memory leak cần một trần xác định thì đường cong mới tái lập
được giữa 10 lần lặp; không giới hạn thì kết quả phụ thuộc RAM còn trống của VPS lúc đó.

---

## 3. Đồng hồ — đọc kỹ, đây là chỗ dễ hỏng số liệu nhất

`detection delay` là con số headline của đồ án. Nếu trừ hai đồng hồ khác nhau thì con số đó vô nghĩa.

1. VPS bật `systemd-timesyncd` (làm ở [`08-vps-setup.md`](08-vps-setup.md)).
2. Đầu **mỗi** run, `run_experiment.py` đo lệch đồng hồ:
   `ssh vps 'date +%s%3N'` so với `time.time()*1000` trên máy user → lưu
   `experiment_run.clock_offset_ms` và `vps.clock_offset_ms`.
3. **Mọi mốc thời gian của run (`fault_start_ts`, `fault_end_ts`…) ghi theo đồng hồ VPS**
   (quy đổi bằng offset vừa đo). Mọi phép so sánh dùng `metric_sample.ts_vps`.
4. `|clock_offset_ms| > 2000` → **huỷ run**, ghi `abort_reason='clock_skew'`, sửa NTP rồi chạy lại.
   2 giây = 1/5 chu kỳ mẫu, quá lớn để bỏ qua.

---

## 4. Cấu trúc một run (78–83 phút)

```
   0'  ┌─ DEPLOY SẠCH ────────── docker compose down -v, deploy lại từ đầu, POST /reset
   5'  ├─ A. BASELINE_TRAIN ──── 30 phút = 180 mẫu  ──▶ POST /train
  35'  ├─ B. NORMAL_HOLDOUT ──── 15 phút = 90 mẫu   ──▶ vùng đo FALSE POSITIVE
  50'  ├─ C. FAULT ───────────── 20 phút = 120 mẫu  ──▶ vùng đo TRUE POSITIVE
  70'  ├─ D. RECOVERY ────────── 10 phút = 60 mẫu   ──▶ LOẠI khỏi đánh giá
  80'  └─ TEARDOWN ──────────── export CSV, đóng run
```

**Vì sao có pha B (holdout):** mẫu dùng để train thì model đã "nhìn thấy", chấm điểm trên đó
là gian lận. Pha B là 90 mẫu **bình thường mà model chưa từng thấy** — không có nó thì không
tính được False Positive một cách trung thực. Đây là điểm hội đồng có thể vặn, và nhóm có
câu trả lời sẵn.

**Vì sao pha D bị loại:** sau khi tắt fault, hệ thống vẫn còn suy giảm (bộ nhớ chưa được giải
phóng, hàng đợi chưa rút). Nhãn "bình thường" cho pha này là sai; nhãn "bất thường" cũng sai
vì fault đã ngừng. Cách trung thực là **loại khỏi tính toán và nói rõ trong báo cáo**.
Pha D vẫn được ghi dữ liệu đầy đủ (dùng cho hình timeline và để chứng minh hệ thống hồi phục).

Load generator chạy **suốt từ đầu pha A đến hết pha D**, cường độ không đổi.

---

## 5. Ground truth — định nghĩa chốt

Đơn vị đánh giá là **mẫu** (`metric_sample`).

```
nhãn(mẫu i) =
    NORMAL     nếu ts_i ∈ pha B                            (holdout)
    ANOMALY    nếu ts_i ∈ [fault_start + grace, fault_end]
    EXCLUDED   nếu ts_i ∈ pha A, pha D, hoặc [fault_start, fault_start + grace)
```

- `grace = detection_grace_s = **60 giây**` (6 mẫu). Lý do: fault cần thời gian để biểu hiện
  ra metric; không phương pháp nào bị coi là sai khi chưa có tín hiệu để nhìn.
- **Phân tích độ nhạy bắt buộc:** `analyze.py` tính lại toàn bộ bảng với
  `grace ∈ {0, 30, 60, 120}` giây và báo cáo rằng kết luận không đổi (hoặc đổi thế nào).
  Một dòng trong báo cáo, gần như miễn phí, chặn đứng câu hỏi "sao lại chọn 60?".

**Dự đoán của một phương pháp tại mẫu i** = phương pháp đó **đang ở trạng thái triggered** tại
mẫu i, tức đã có đủ `ml_consecutive`/`rule_consecutive` mẫu liên tiếp vượt ngưỡng.
Áp dụng **cùng một quy tắc cho cả 5 phương pháp** — đây là điều kiện để so sánh công bằng.

| | Thực tế ANOMALY | Thực tế NORMAL |
|---|---|---|
| **Dự đoán triggered** | TP | FP |
| **Dự đoán yên tĩnh** | FN | TN |

- `Precision = TP/(TP+FP)` · `Recall = TP/(TP+FN)` · `F1 = 2PR/(P+R)`
- **Detection delay** = `ts` của mẫu triggered đầu tiên trong vùng ANOMALY − `fault_start_ts`
  (giây). Không triggered lần nào trong cả pha C → delay = **censored**, ghi riêng, **không**
  điền bằng 1200s (điền số sẽ bóp méo trung bình). Báo cáo dạng
  "trung bình trên các run phát hiện được, kèm số run không phát hiện".

---

## 6. Năm kịch bản fault

Tất cả cài vào `demo-apps/express-api` dưới prefix `/debug/*`. Các endpoint này **chỉ bật khi
`ENABLE_FAULT_ENDPOINTS=true`** — nói rõ trong báo cáo rằng đây là công cụ thí nghiệm, không
phải lỗ hổng của tool.

| # | `scenario` | Cách gây | Tham số (ghi vào `fault_params_json`) | Kiểu suy giảm | Kỳ vọng |
|---|---|---|---|---|---|
| 1 | `memory_leak` | `GET /debug/leak?mb=5` mỗi 10s, giữ buffer vào mảng toàn cục | 5 MB/10s = 30 MB/phút, trần 512MB | **tăng dần** | ML bắt ở ~2–4', rule chạm 90% (≈460MB) ở ~11' → **khoảng cách ~7 phút, đây là con số bán cả buổi bảo vệ** |
| 2 | `cpu_spike` | `GET /debug/cpu?ms=x` busy-loop, x tăng bậc thang | x: 20→400ms, +20ms mỗi phút | tăng dần | ML bắt sớm nhờ slope của cpu + latency |
| 3 | `error_burst` | `GET /debug/error-rate?p=x` trả 500 với xác suất p | p = 0.3 **đột ngột**, bật ở phút 0 của pha C | **đột ngột** | rule bắt nhanh ngang ML — kỳ vọng ML **không** thắng ở đây, và đó là kết quả trung thực đáng báo cáo |
| 4 | `slow_db` | `SELECT pg_sleep(x)` chèn trước mỗi query | x: 0.05→1.5s, tăng mỗi phút | tăng dần | `db_response_ms` + `latency_ms` cùng trôi |
| 5 | `latency_creep` | Middleware delay tăng dần | +50ms mỗi phút, tối đa 2500ms | tăng dần | kịch bản khó nhất cho rule (chỉ vượt 2000ms ở cuối) |

**Kịch bản 3 tồn tại có chủ đích:** một đồ án nói "ML thắng ở mọi kịch bản" là đáng ngờ.
Có một kịch bản mà rule ngang hoặc thắng làm cho toàn bộ kết quả đáng tin hơn, và cho phép
viết một đoạn phân tích sắc sảo ở chương 5 (RQ3).

---

## 7. Quy trình tự động — `run_experiment.py`

```
python experiments/run_experiment.py --scenario memory_leak --repeat 1..10 --vps 1
```

Các bước (mỗi bước ghi `action_log`; lỗi ở bất kỳ đâu → `status='aborted'` + lý do, và
**tự động chạy lại run đó ở cuối hàng đợi**, tối đa 2 lần):

> **Ghi chú rà soát 28/07/2026 — đề xuất, chưa đổi schema:** contract hiện có
> `UNIQUE(scenario, repeat_index)`, nên không thể lưu riêng run bị huỷ và lần retry cùng chỉ số.
> Đề xuất thêm `attempt_index` (1..3), đổi unique thành
> `(scenario, repeat_index, attempt_index)`, và export theo thư mục có attempt. `analyze.py`
> chỉ lấy attempt `completed` vào bảng chính nhưng vẫn báo cáo đầy đủ số attempt bị huỷ và lý do.

1. Đo lệch đồng hồ → huỷ nếu `|offset| > 2000ms`.
2. `docker compose down -v` trên VPS, deploy lại app demo từ đầu → `deployment_id` mới.
3. `POST /reset` cho ML service.
4. Khởi động load generator container.
5. Tạo `experiment_run` (`status='running'`, ghi `baseline_start_ts`).
6. Chờ pha A (30'), kiểm tra đã có ≥180 `metric_sample` → `POST /train`, ghi `train_at_ts`.
   Số mẫu thiếu >10% → huỷ run (`abort_reason='insufficient_samples'`).
7. Chờ pha B (15').
8. Ghi `fault_start_ts` → **kích hoạt fault** → chờ 20'.
9. Tắt fault, ghi `fault_end_ts` → chờ pha D (10') → ghi `run_end_ts`, `status='completed'`.
10. Dừng load generator, export CSV, push GitHub.

**Kiểm tra tính toàn vẹn ngay sau mỗi run** (fail → đánh dấu run cần chạy lại):
- Số mẫu thực tế ≥ 90% số mẫu lý thuyết (462 mẫu cho 77 phút).
- Không có khoảng trống >2 phút giữa 2 mẫu liên tiếp.
- Mỗi `metric_sample` có đúng **5** dòng `score_sample`.
- `score` khác `null` cho toàn bộ pha B, C, D (nếu còn `null` nghĩa là train thất bại).

---

## 8. Bảo vệ dữ liệu — 50+ giờ máy, mất là thảm hoạ

1. SQLite bật **WAL**.
2. Sau **mỗi** run, `export_results.py` xuất CSV vào
   `experiments/results/run_<scenario>_<n>/`:
   `metric_sample.csv` · `score_sample.csv` · `alert.csv` · `experiment_run.csv` ·
   `meta.json` (git commit hash, collector_version, feature_version, ngưỡng đang dùng).
3. **Commit + push ngay** (CSV nhỏ, không cần LFS). **Không commit file `.db`** — nó chứa
   bảng `vps` với credential SSH đã mã hoá.
4. `analyze.py` **chỉ đọc từ CSV đã export**, không đọc DB sống → phân tích chạy lại được bất
   cứ lúc nào, trên máy nào, kể cả sau khi VPS đã trả.
5. `meta.json` có `git_commit` để biết chính xác dữ liệu này sinh ra bởi phiên bản code nào.
   Đổi code giữa chừng mà quên ghi là mất khả năng giải thích outlier.

---

## 9. Phân tích — `analyze.py`

Đầu vào: toàn bộ `experiments/results/**/*.csv`. Đầu ra: bảng Markdown + hình PNG (dùng đúng
bộ màu ở [`02-ui-ux-spec.md`](02-ui-ux-spec.md), export sẵn trong `experiments/palette.py`).

### 9.1 Bảng chính (chương 5)

Mỗi ô: `mean ± std`, kèm **khoảng tin cậy 95%** (phân phối t, n=10).

| Method | Scenario | Precision | Recall | F1 | Detection delay (s) | #run không phát hiện |
|---|---|---|---|---|---|---|

Cộng thêm dòng "Trung bình toàn bộ kịch bản" và một bảng gộp theo kiểu suy giảm
(tăng dần vs đột ngột) để trả lời RQ3.

### 9.2 Ba phân tích offline — chạy trên dữ liệu đã có, **không tốn thêm giờ máy nào**

Điều kiện: `score_sample` đã lưu score thô của **mọi** phương pháp ở **mọi** mẫu.

1. **Threshold sweep → đường Precision–Recall.** Quét ngưỡng 0.05 → 0.95 bước 0.05, vẽ PR
   curve cho từng phương pháp, báo cáo thêm **AUC-PR**. Đây là cách trình bày của paper thật;
   nó cũng vô hiệu hoá câu hỏi "sao lại chọn ngưỡng 0.7" vì kết quả được trình bày trên
   *mọi* ngưỡng.
2. **Ablation study — chứng minh slope là chìa khoá.** Gửi lại toàn bộ mẫu đã lưu qua
   `POST /replay` với `feature_config.use_slope = false`, so bảng "có slope vs không slope"
   trên `memory_leak` và `latency_creep`. Kỳ vọng: detection delay tăng vọt khi bỏ slope →
   chứng minh **bằng số liệu** rằng thiết kế feature là có chủ đích, không phải may mắn.
   Làm thêm biến thể `use_mean=false`, `use_std=false` nếu còn thời gian.
3. **Hình timeline một run tiêu biểu.** Trục x thời gian; vẽ `mem_mb`; vạch dọc
   `fault_start`; điểm alert đầu tiên của từng phương pháp đúng màu; đường ngang ngưỡng rule
   90%. **Một hình nói hết câu chuyện "ML bắt sớm hơn rule bao nhiêu"** — đặt ngay đầu chương 5
   và làm slide chính lúc bảo vệ.

### 9.3 Kiểm tra bắt buộc trước khi tin kết quả

- **So sánh 2 VPS:** tính lại bảng chính tách theo `vps_id`. Chênh lệch F1 giữa 2 VPS
  > 0.05 → điều tra trước khi gộp; dù không chênh cũng phải báo cáo là đã kiểm tra.
- **Độ nhạy với `grace`** (mục 5).
- **Số run bị huỷ và lý do** — báo cáo trung thực, đừng giấu.

---

## 10. Nếu kết quả "xấu"

Nếu F1 của ML không cao hơn rule ở một hoặc vài kịch bản: **đây không phải thảm hoạ.**
Đồ án chấm *phương pháp so sánh có kiểm soát*, không chấm *model thắng*. Kết quả trung thực
kèm phân tích nguyên nhân (vd: `error_burst` đột ngột thì rule bắt tốt; ML thắng ở suy giảm
tăng dần) chính là insight giá trị nhất của chương 5.

**Điều duy nhất không được làm:** đổi định nghĩa ground truth, đổi ngưỡng, hay loại bỏ run
"xấu" **sau khi** đã nhìn kết quả. Nếu buộc phải đổi, phải nói rõ trong báo cáo là đã đổi,
đổi gì và vì sao.
