# TIMELINE REBASELINE — 10/08/2026 → 20/11/2026

**Bắt đầu: Thứ Hai 10/08/2026. Hạn nộp: Thứ Sáu 20/11/2026.** Tổng thời gian còn lại:
**14 tuần 5 ngày**. Kế hoạch này thay lịch khởi động cũ và là nguồn sự thật cho mọi nhãn W1–W15.

Phân công từ 15/08/2026: **Người A = Core/Algorithms** (Electron main, DB, SSH, pipeline,
monitoring, ML). **Người B = UI/Delivery** (renderer, collector, demo app, thực thi thí nghiệm
và bằng chứng). Chi tiết ranh giới và cơ chế mock typed:
[`20-phan-cong-a-core-b-ui.md`](20-phan-cong-a-core-b-ui.md).

Sau các kết quả đã merge ngày 11/08, cả hai **tạm dừng đến hết 14/08** vì bận. Không giao
deadline và không tính trễ trong khoảng này; toàn bộ task chưa hoàn thành bắt đầu lại từ 15/08.

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

Giả định năng lực để giữ mốc này sau khi đổi vai: A có **34–38 giờ tập trung/tuần**, B có
**24–30 giờ/tuần**, làm 6 ngày và review PR trong 24 giờ. Nếu A có dưới 28 giờ hoặc B dưới
20 giờ/tuần, phải báo ngay trong cột “Thực tế”; mục tiêu hợp lý khi đó là 50–55%, không ép
bằng cách bỏ test.

## Bốn tuần tăng tốc

| Tuần | Người A — Core/Algorithms | Người B — UI/Delivery | Tích hợp và DoD cuối tuần | FR luỹ kế | Thực tế |
|---|---|---|---|---:|---|
| **W1 · 10/08–21/08** | Scaffold/DB đã merge; từ 15/08: credential, M1 SSH manager, ML skeleton | Từ 15/08: collector v0, metric giả, 3 demo app, UI kết nối/tài nguyên bằng typed mock | App khởi động; `pnpm try:ssh` chạy `docker --version`; VPS List thấy online/RAM/disk; A đọc `metrics.jsonl` của B; 3 demo app chạy Docker local | **3/24 · 12,5%** | |
| **W2 · 22/08–28/08** | M3 detector 3 Tier 1; M4 `PRECHECK→BUILD`; M7 feature + train/ingest/replay và 4 method | Hoàn tất collector trên VPS; Deploy Wizard + Deploy Log/xterm bằng mock typed | **Cổng lát cắt dọc:** Express detect/build trên VPS; `metrics.jsonl` đúng contract; UI render đúng deploy event; ML API test độc lập pass | **6/24 · 25,0%** | |
| **W3 · 29/08–04/09** | M4 `DEPLOY→RECORD`; M6 poller/rule; nạp metric/score/alert vào SQLite và IPC | Nối Deploy Wizard vào IPC thật; Dashboard chart + panel 5 phương pháp | **Cổng deploy + dữ liệu:** 3 app Tier 1 deploy từ UI; metric thật hiện trên chart; mỗi mẫu có 5 `score_sample`; đổi rule làm alert thay đổi | **13/24 · 54,2%** | |
| **W4 · 05/09–11/09** | Redeploy/release/rollback/retry; alert lifecycle; reconnect/offset/dedupe | Versions/History; alert feedback UI; fault script và smoke evidence | **CỔNG MVP 66,7%:** smoke UC-01/02/03/04/06/08 trên `main`; rollback đúng v(N-1); fault tạo alert/gắn nhãn; nạp bù không trùng | **16/24 · 66,7%** | |

### Việc cụ thể ngay W1

| Ngày | Người A | Người B | Điểm nối cuối ngày |
|---|---|---|---|
| **10/08** | Scaffold Electron + React; copy shared contract; khởi tạo DB/migration | Tạo venv; FastAPI `/health`; khung collector và test Python | Hai app chạy bằng một lệnh; tạo initial commit duy nhất trên `main`, sau đó mọi việc qua PR |
| **11/08** | Repository CRUD VPS + IPC + khung VPS List đã merge | Không nhận task mới vì bận | PR #4 merge; sau kết quả này cả hai bắt đầu khoảng nghỉ |
| **11/08 sau phần đã merge → 14/08** | **Tạm dừng — không nhận task mới** | **Tạm dừng — không nhận task mới** | Không tính trễ; task mở giữ ở `TUẦN NÀY`, không để giả ở `ĐANG LÀM` |
| **15/08** | Nghiệm thu M2 + dựng/kiểm tra 2 VPS | Collector scaffold + contract test | Cả hai máy dev/VPS sẵn sàng; test module độc lập pass |
| **16/08** | Chuẩn bị fixture/CLI cho SSH | Ba demo app chạy Docker local | 3 health endpoint trả 200; A có target để smoke SSH |
| **17/08** | M1 `connect/exec`, timeout/reconnect | Generator metric giả đúng contract | `try:ssh` chạy lệnh đơn; JSONL giả hợp lệ |
| **18/08** | Hoàn thiện phân loại lỗi/reconnect | Docker stats + HTTP probe local | AUTH/TIMEOUT/HOST rõ; collector probe demo Express |
| **19/08** | M1 `uploadDir/readFileTail` | Ghi `metrics.jsonl`/`latest.json` | Tail theo byte và output atomic cùng pass test |
| **20/08** | Resource/Docker handler + smoke VPS | Chạy collector Docker trên VPS | A đọc được JSONL thật của B qua SSH |
| **21/08** | ML skeleton + hỗ trợ tích hợp | UI connection/resource states, nối IPC thật | Review chéo; smoke FR-A1–A3; chỉ sửa gate W1 |

**02/09 rơi vào W3.** Không đặt một đầu việc chỉ có thể hoàn tất trong ngày này; coi đó là
ngày nghỉ hoặc buffer. Gate W3 vẫn chốt ngày 04/09.

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
| **W5** | 12/09–18/09 | M8 auto-rollback + cooldown; dọn bug core; soak 24h | Hoàn thiện 5 fault endpoint/script; UI trạng thái rollback; ghi log soak | Memory leak → trusted method báo động → auto-rollback; app chạy 24h ổn định | |
| **W6** | 19/09–25/09 | M9 migrate app không DB: PREPARE→BACKUP→TRANSFER→RESTORE | Migrate Wizard; đo lệch đồng hồ; scaffold `run_experiment.py` và metadata | Migrate app không DB giữa 2 VPS; chạy tay 1 fault thấy metric biến dạng đúng | |
| **W7** | 26/09–02/10 | M9 PostgreSQL + VERIFY + nhánh rollback khi ngắt SSH | Nối Migrate Wizard; tự động hoá 1 run; chạy thử 2 run và kiểm tra ground truth | Migrate có DB thành công; 1 run xuất đủ metric/score/alert/meta | |
| **W8** | 03/10–09/10 | Sửa bug core; hỗ trợ pilot; chốt threshold/feature và đóng băng schema | Pilot 5 kịch bản × 2 lần; UI bug; chuẩn hoá export/bằng chứng | **Cổng freeze:** 10 run pilot; cấu hình ML ghi `DECISIONS.md`; không đổi sau mốc này | |
| **W9** | 10/10–16/10 | Trực lỗi core/ML; đóng gói Electron bản đầu | Chạy 50 run trên 2 VPS; `analyze.py`; backup CSV | 50 run completed; CSV có backup; bảng P/R/F1 ± CI của 5 phương pháp | |
| **W10** | 17/10–23/10 | Cài bản build máy sạch; bug core; rà giải thích thuật toán | PR curve, AUC-PR, ablation/timeline chart; UI polish; viết kết quả | Bản build chạy máy sạch; đủ 4 hình chính và bảng số liệu cuối | |
| **W11** | 24/10–30/10 | Viết kiến trúc, core app/infra và thuật toán ML | Viết UI/UX, collector, thực nghiệm và hoàn thiện chương kết quả | Bản thảo chương 1–5 đầy đủ, dù còn thô | |
| **W12** | 31/10–06/11 | Đệm kỹ thuật: chạy bù, sửa bug chặn, hoàn thiện đóng gói | Đệm dữ liệu: chạy bù và kiểm tra tái lập | Không còn kỹ thuật dang dở; số liệu và bản build được khoá | |
| **W13** | 07/11–11/11 | Chương 6 + slide + phụ lục timeline/truy vết | Rà soát số liệu, hình vẽ, tài liệu tham khảo | Báo cáo đủ 6 chương; slide khoảng 15 trang; trích dẫn thống nhất | |
| **W14** | 12/11–16/11 | Demo VPS thật + fallback local; tập lần 1–2 | Quay video dự phòng; chuẩn bị bảng kết quả và Q&A ML | Gửi bản nháp GVHD; smoke test pass; 2 lần diễn tập có bấm giờ | |
| **W15** | 17/11–20/11 | Sửa góp ý, tập lần 3, chuẩn bị bản nộp | Sửa số liệu/phụ lục, kiểm tra video và backup | **Nộp 20/11.** Bản in/file số/video/demo dự phòng đều sẵn sàng | |

## Cổng kiểm soát và hành động khi trễ

| Cổng | Hạn | Điều kiện đạt | Nếu không đạt |
|---|---|---|---|
| **G0 — Nền chạy được** | 21/08 | App + DB + SSH + ML skeleton chạy trên máy của cả hai; 2 VPS dùng được | Hai người dừng tính năng mới, xử lý môi trường trong tối đa 2 ngày |
| **G1 — Lát cắt Express** | 28/08 | Express deploy bằng tool và collector ghi metric trên VPS | B dừng UI mới, tập trung fixture/smoke/tái hiện lỗi cho A; chưa nhân sang Next/Vite |
| **G2 — MVP 66,7%** | 11/09 | 16 FR nêu trên đều có bằng chứng smoke test | Hoãn M8/M9; W5 chỉ tích hợp. Nếu 13/24 trở xuống, cắt migrate có DB trước |
| **G3 — Freeze thí nghiệm** | 09/10 | Pilot 10 run, runner chạy tự động, threshold/feature đã chốt | Cắt `slow_db` + `latency_creep`; vẫn giữ 10 lần lặp/kịch bản còn lại |
| **G4 — Dữ liệu chính thức** | 16/10 | 50 run completed hoặc toàn bộ run của phạm vi đã cắt có lý do | Dùng W12 chạy bù; không làm Flask và không polish UI |

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
