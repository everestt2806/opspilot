# TIMELINE REBASELINE — 10/08/2026 → 20/11/2026

**Bắt đầu: Thứ Hai 10/08/2026. Hạn nộp: Thứ Sáu 20/11/2026.** Tổng thời gian còn lại:
**14 tuần 5 ngày**. Kế hoạch này thay lịch khởi động cũ và là nguồn sự thật cho mọi nhãn W1–W15.

Phân công cố định: **Người A = App/Infra** (Electron, SSH, deploy, migrate, UI).
**Người B = ML/Monitoring** (collector, ML service, poller, thí nghiệm).

## Mục tiêu 4 tuần đầu: 66,7% chức năng

Không đo tiến độ bằng số file, số màn hình hoặc số dòng code. Dự án có **24 yêu cầu chức
năng FR-A1…FR-E3** trong [`05-truy-vet-yeu-cau.md`](05-truy-vet-yeu-cau.md). Cuối W4 phải
có **16/24 yêu cầu đã kiểm chứng trên luồng thật = 66,7%**:

- FR-A1–A3: quản lý VPS, credential, SSH/Docker/tài nguyên — 3 yêu cầu.
- FR-B1–B7: detector, deploy 3 Tier 1, env/precheck/log/lịch sử deploy — 7 yêu cầu.
- FR-D1–D5: collector, poller/dashboard, rule, 3 model + ensemble, gắn nhãn — 5 yêu cầu.
- FR-E1: rollback thủ công — 1 yêu cầu.

**Chưa tính vào 66,7%:** migrate FR-C1–C5, auto-rollback FR-E2, action log đủ mọi loại FR-E3,
Tier 2 FR-B8, đóng gói, dữ liệu thí nghiệm và báo cáo. Vì vậy đây là **MVP lõi chạy được**, không
phải 66,7% tổng giờ công của cả đồ án.

Giả định năng lực để giữ mốc này: mỗi người có **28–32 giờ tập trung/tuần**, làm 6 ngày và
review PR của nhau trong 24 giờ. Nếu một người chỉ còn dưới 20 giờ/tuần, phải báo ngay trong
cột “Thực tế”; mục tiêu hợp lý khi đó là 50–55%, không ép bằng cách bỏ test.

## Bốn tuần tăng tốc

| Tuần | Người A — App/Infra | Người B — ML/Monitoring | Tích hợp và DoD cuối tuần | FR luỹ kế | Thực tế |
|---|---|---|---|---:|---|
| **W1 · 10/08–16/08** | Scaffold Electron/React/TS; SQLite migration 001; M1 SSH manager; M2 credential; VPS List tối thiểu gồm CRUD, test SSH, Docker và resource | Venv + FastAPI `/health`; collector v0; script metric giả; tạo 3 demo app chạy local | Ngày 10/08 chốt 7 điểm kiến trúc còn mở trong `docs/17`; app khởi động được; `pnpm try:ssh` chạy `docker --version` trên VPS; thêm VPS qua UI thấy online/RAM/disk; 3 demo app chạy Docker local | **3/24 · 12,5%** | |
| **W2 · 17/08–23/08** | M3 detector đủ 3 Tier 1 + test; M4 `PRECHECK→UPLOAD→RENDER→BUILD`; deploy Express end-to-end bằng CLI trước; khung Deploy Log | M5 collector hoàn chỉnh trên VPS; M7 feature + train/ingest/replay; zscore/EWMA, Isolation Forest, OCSVM, ensemble chạy trên dữ liệu giả | **Cổng lát cắt dọc:** chọn Express → detect → build trên VPS → app chạy → `metrics.jsonl` đúng contract; cả 3 detector qua ≥4 case; ML API test độc lập pass | **6/24 · 25,0%** | |
| **W3 · 24/08–30/08** | Hoàn tất M4 `DEPLOY→HEALTHCHECK→RECORD`; Deploy Wizard tối thiểu (env + precheck); stream log xterm; deploy đủ Next/Express/Vite | M6 poller + rule engine; nạp metric vào SQLite; nối `/ingest` thật; dashboard v1 có metric và score 5 phương pháp | **Cổng deploy + dữ liệu:** 3 app Tier 1 deploy từ UI; metric thật hiện trên chart; mỗi mẫu có 5 dòng `score_sample`; đổi rule threshold làm alert thay đổi | **13/24 · 54,2%** | |
| **W4 · 31/08–06/09** | Redeploy; lưu release artifact; rollback tay; màn Phiên bản/lịch sử deploy; xử lý nhánh lỗi và retry; hỗ trợ B tích hợp | Vòng đời alert; gắn nhãn đúng/sai; dashboard panel 5 phương pháp; load generator + 1 fault smoke; xử lý reconnect/offset/trùng mẫu | **CỔNG MVP 66,7%:** smoke UC-01/02/03/04/06/08 trên `main`; rollback đúng v(N-1); stress/fault tạo alert và gắn nhãn được; test ngắt SSH rồi nạp bù không trùng mẫu | **16/24 · 66,7%** | |

### Việc cụ thể ngay W1

| Ngày | Người A | Người B | Điểm nối cuối ngày |
|---|---|---|---|
| **10/08** | Scaffold Electron + React; copy shared contract; khởi tạo DB/migration | Tạo venv; FastAPI `/health`; khung collector và test Python | Hai app chạy bằng một lệnh; tạo initial commit duy nhất trên `main`, sau đó mọi việc qua PR |
| **11/08** | Repository CRUD VPS + IPC; khung VPS List | Tạo 3 demo app; Dockerfile local; generator metric giả đúng contract | A import type IPC không lỗi; B sinh được JSONL hợp lệ |
| **12/08** | M2 `encrypt/decrypt` + unit test tamper | Collector lấy docker stats + HTTP probe local | 2 VPS phải SSH được chậm nhất cuối ngày |
| **13/08** | M1 `connect/exec`, phân loại lỗi, timeout/reconnect | Collector ghi `metrics.jsonl`/`latest.json`; FastAPI nhận sample giả | `try:ssh` và test collector chạy độc lập |
| **14/08** | M1 `uploadDir/readFileTail`; resource/Docker check | Đưa collector lên VPS bằng Docker; kiểm tra metric thật | A đọc được file JSONL của B qua SSH |
| **15/08** | Nối VPS List với DB/SSH, xử lý loading/error | Hoàn thiện demo apps + test ML skeleton; viết lệnh tái hiện | Merge, review chéo và smoke FR-A1–A3 |
| **16/08** | Buffer, không kéo feature mới | Buffer, không kéo feature mới | Chỉ sửa gate W1, cập nhật `05-truy-vet-yeu-cau.md` và cột “Thực tế” |

**02/09 rơi vào W4.** Không đặt một đầu việc chỉ có thể hoàn tất trong ngày này; coi đó là
ngày nghỉ hoặc buffer. Gate W4 vẫn chốt ngày 06/09.

### Nhịp làm việc trong W1–W4

| Khi nào | Việc bắt buộc |
|---|---|
| Đầu ngày | Mỗi người chốt tối đa 2 đầu việc có DoD; việc mới chỉ được kéo vào khi việc cũ đã test |
| Cuối ngày | Push nhánh đang làm; ghi blocker và lệnh tái hiện lỗi, không chỉ nhắn “đang lỗi” |
| Thứ Tư | Test contract chéo: A gọi API/đọc file của B, B dùng SSH/DB path của A |
| Thứ Bảy | Merge về `main`, chạy smoke test; cập nhật FR và cột “Thực tế” |
| Mọi PR | Nhánh sống tối đa 2 ngày; người còn lại review trong 24 giờ và giải thích được public API |

Quy tắc tăng tốc: làm **một lát cắt Express chạy end-to-end trước**, sau đó mới nhân sang
Next/Vite; CLI phải chạy trước UI; UI chỉ dùng AntD mặc định; không làm migrate, auto-rollback,
Flask hoặc polish trước khi Cổng MVP xanh.

## Lịch W5–W15

| Tuần | Ngày | Người A | Người B | DoD cuối tuần | Thực tế |
|---|---|---|---|---|---|
| **W5** | 07/09–13/09 | M8 auto-rollback + cooldown; dọn bug MVP; soak test 24h | Hoàn thiện load generator, 5 fault endpoint/script; theo dõi soak và tỷ lệ thiếu mẫu | Memory leak → trusted method báo động → auto-rollback; app chạy 24h ổn định | |
| **W6** | 14/09–20/09 | M9 migrate app không DB: PREPARE→BACKUP→TRANSFER→RESTORE | Đo lệch đồng hồ; scaffold `run_experiment.py`; chuẩn hoá metadata/export | Migrate app không DB giữa 2 VPS; chạy tay 1 fault thấy metric biến dạng đúng | |
| **W7** | 21/09–27/09 | M9 PostgreSQL + VERIFY + nhánh rollback khi ngắt SSH | Tự động hoá trọn 1 run; chạy thử 2 run và kiểm tra ground truth | Migrate có DB thành công; 1 run tự động xuất đủ metric/score/alert/meta | |
| **W8** | 28/09–04/10 | Sửa bug chặn; hỗ trợ pilot; đóng băng schema metric/score | Pilot 5 kịch bản × 2 lần; chốt threshold và feature config | **Cổng freeze:** 10 run pilot hoàn tất; cấu hình ML đã ghi `DECISIONS.md`; không đổi sau mốc này | |
| **W9** | 05/10–11/10 | Trực thí nghiệm; đóng gói Electron bản đầu | Chạy 50 run chính thức trên 2 VPS; `analyze.py` bảng chính | 50 run completed; CSV có backup; bảng P/R/F1 ± CI của 5 phương pháp | |
| **W10** | 12/10–18/10 | Cài bản build trên máy sạch; bug/polish; Flask chỉ khi mọi gate đều xanh | PR curve, AUC-PR, ablation slope, timeline chart; viết chương 5 | Bản build chạy trên máy sạch; đủ 4 hình chính và bảng số liệu cuối | |
| **W11** | 19/10–25/10 | Viết chương 1, 3, 4 phần app | Viết chương 2, 4 phần ML, hoàn thiện chương 5 | Bản thảo chương 1–5 đầy đủ, dù còn thô | |
| **W12** | 26/10–01/11 | Đệm kỹ thuật: chạy bù, sửa bug chặn, hoàn thiện đóng gói | Đệm dữ liệu: chạy bù và kiểm tra tái lập | Không còn kỹ thuật dang dở; số liệu và bản build được khoá | |
| **W13** | 02/11–08/11 | Chương 6 + slide + phụ lục timeline/truy vết | Rà soát số liệu, hình vẽ, tài liệu tham khảo | Báo cáo đủ 6 chương; slide khoảng 15 trang; trích dẫn thống nhất | |
| **W14** | 09/11–15/11 | Demo VPS thật + fallback local; tập lần 1–2 | Quay video dự phòng; chuẩn bị bảng kết quả và Q&A ML | Gửi bản nháp GVHD; smoke test pass; 2 lần diễn tập có bấm giờ | |
| **W15** | 16/11–20/11 | Sửa góp ý, tập lần 3, chuẩn bị bản nộp | Sửa số liệu/phụ lục, kiểm tra video và backup | **Nộp 20/11.** Bản in/file số/video/demo dự phòng đều sẵn sàng | |

## Cổng kiểm soát và hành động khi trễ

| Cổng | Hạn | Điều kiện đạt | Nếu không đạt |
|---|---|---|---|
| **G0 — Nền chạy được** | 16/08 | App + DB + SSH + ML skeleton chạy trên máy của cả hai; 2 VPS dùng được | Hai người dừng tính năng mới, xử lý môi trường trong tối đa 2 ngày |
| **G1 — Lát cắt Express** | 23/08 | Express deploy bằng tool và collector ghi metric trên VPS | B dừng UI/dashboard để hỗ trợ pipeline; chưa nhân sang Next/Vite |
| **G2 — MVP 66,7%** | 06/09 | 16 FR nêu trên đều có bằng chứng smoke test | Hoãn M8/M9; W5 chỉ tích hợp. Nếu 13/24 trở xuống, cắt migrate có DB trước |
| **G3 — Freeze thí nghiệm** | 04/10 | Pilot 10 run, runner chạy tự động, threshold/feature đã chốt | Cắt `slow_db` + `latency_creep`; vẫn giữ 10 lần lặp/kịch bản còn lại |
| **G4 — Dữ liệu chính thức** | 11/10 | 50 run completed hoặc toàn bộ run của phạm vi đã cắt có lý do | Dùng W12 chạy bù; không làm Flask và không polish UI |

Nếu cuối W3 chưa đạt **13/24 FR**, W4 không nhận thêm tính năng: cả hai chỉ nối luồng, sửa lỗi,
test và hoàn tất 16 FR đã cam kết. Không “bù phần trăm” bằng History/Settings hoặc màn hình giả.

## Ngân sách thời gian máy cho W9

- 1 run ≈ 83 phút gồm deploy sạch, baseline 30 phút, holdout 15 phút, fault 20 phút, hồi phục
  10 phút và teardown.
- 50 run ÷ 2 VPS = 25 run/VPS × 83 phút ≈ **35 giờ liên tục mỗi VPS**.
- W9 có đủ buffer retry nếu runner đã chạy trọn 1 run ở W7 và pilot 10 run hoàn tất ở W8.

## Thứ tự cắt phạm vi

1. Tier 2 Flask.
2. Hai scenario `slow_db` và `latency_creep`.
3. Migrate PostgreSQL; vẫn giữ migrate app không DB.
4. Đóng gói Python hoàn toàn; cho phép yêu cầu Python 3.12.
5. UI History/Settings nâng cao.

Không cắt: deploy end-to-end, đường ống metric đúng, 3 phương pháp ML + rule + ensemble,
10 lần lặp trên mỗi kịch bản được giữ lại, auto-rollback mức demo an toàn, PR curve và ablation slope.
