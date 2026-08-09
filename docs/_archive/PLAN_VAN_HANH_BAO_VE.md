# PLAN VẬN HÀNH DỰ ÁN — BÁO CÁO, BẢO VỆ & QUY TRÌNH TEAM
> File thứ 3, đi kèm KE_HOACH_DO_AN.md và UI_UX_SPEC.md. Phủ mọi thứ KHÔNG phải code:
> quy trình 2 người, bảo vệ dữ liệu thí nghiệm, báo cáo, slide, Q&A phản biện, rủi ro.

---

## 0. TUẦN 0 — LÀM TRƯỚC KHI CODE (nhiều nhóm bỏ qua rồi hối hận)

- [ ] **Gặp giảng viên chốt 3 điều bằng văn bản (email):** (1) safeStorage của Electron có được chấp nhận thay cho tự viết AES-256-GCM không; (2) phạm vi Tier 2 là stretch goal đúng như đề xuất; (3) định dạng báo cáo + số trang yêu cầu của khoa. Có email làm bằng chứng nếu sau này bị hỏi "sao không làm X".
- [ ] Hỏi luôn: **lịch bảo vệ dự kiến, phòng bảo vệ có internet/cho dùng 4G không** — quyết định phương án demo (mục 5).
- [ ] Lập nhóm Zalo/Discord riêng cho đồ án + Google Drive chung (chứa báo cáo, biên bản họp giảng viên, video demo).
- [ ] Tạo repo GitHub private, add cả 2 người + mời giảng viên nếu thầy/cô muốn xem tiến độ.

---

## 1. QUY TRÌNH TEAM 2 NGƯỜI (đủ dùng, không "scrum kiểng")

**Git:** trunk-based đơn giản — nhánh `main` luôn chạy được; mỗi việc 1 nhánh ngắn `feat/ten-viec`, tồn tại tối đa 3 ngày, merge bằng PR. Người kia đọc lướt PR trong 24h (đọc để *nắm code của nhau*, không phải soi lỗi — mục tiêu: ai cũng trả lời được về toàn hệ thống lúc bảo vệ, vì hội đồng hay cố tình hỏi người không viết phần đó).
- Commit message tiếng Việt/Anh tuỳ, nhưng prefix module: `[ssh]`, `[deploy]`, `[ml]`, `[ui]`...
- Tag mốc: `v-week4-deploy-ok`, `v-week9-freeze`... — quay lại được trạng thái từng milestone.

**Nhịp làm việc:**
- Họp 15 phút đầu tuần: đối chiếu bảng timeline, cập nhật cột "thực tế" cạnh cột "kế hoạch" (bảng này đưa vào phụ lục báo cáo — bằng chứng quản lý dự án).
- `DECISIONS.md` (đã nêu ở plan chính): mọi thay đổi so với plan ghi 1 dòng + lý do.
- Thứ 6 hằng tuần: 1 người chạy lại **smoke test 10 phút** (mục 2) trên `main`. Fail → tuần sau ưu tiên sửa trước khi làm mới.

**Quy tắc dùng AI (để giải trình "AI hỗ trợ" một cách tự tin):**
- AI viết code theo spec — nhưng người merge phải giải thích được từng hàm public làm gì. Không hiểu → không merge.
- Mỗi tuần mỗi người tự chọn 1 đoạn code AI viết và giải thích lại cho người kia trong họp đầu tuần (5 phút). Đây chính là luyện tập trả lời hội đồng.

---

## 2. TESTING — MỨC ĐỦ CHO ĐỒ ÁN, KHÔNG HƠN

**Unit test (chỉ 3 chỗ đáng viết, dùng vitest + pytest):**
1. Detectors — mỗi detector ≥4 case: nhận đúng, từ chối đúng, thư mục rác, case nhập nhằng (có cả next lẫn express trong dependencies → priority quyết định). Đây là phần dễ sai ngầm nhất.
2. `features.py` — sliding window, slope: cho chuỗi tăng tuyến tính biết trước → slope phải đúng giá trị.
3. Crypto/credentials — mã hoá rồi giải mã ra đúng bản gốc; sửa 1 byte ciphertext → phải throw.
**Không viết unit test cho UI, SSH, pipeline** — test bằng smoke test thật.

**Smoke test thủ công 10 phút (checklist chạy mỗi thứ 6 + trước mọi buổi demo):**
- [ ] Thêm VPS mới → online. [ ] Deploy express-api → chạy, mở được URL. [ ] Dashboard có số liệu sau ≤60s. [ ] Bật script cpu_spike 2 phút → có ≥1 alert. [ ] Gắn nhãn 1 alert. [ ] Rollback thủ công → app về version cũ. [ ] Tắt app → mở lại → dữ liệu còn nguyên.

**Test độ bền trước tuần thí nghiệm (tuần 9):** để app + poller chạy liên tục 24h với 1 deployment — kiểm tra: SSH tự reconnect sau khi VPS reboot, RAM của Electron/ML service không phình (chính tool của mình cũng phải không memory leak — hội đồng mà phát hiện tool phát-hiện-memory-leak bị memory leak thì rất khó đỡ).

---

## 3. BẢO VỆ DỮ LIỆU THÍ NGHIỆM (37 giờ chạy — mất là thảm hoạ)

- SQLite của app bật WAL mode. Sau MỖI run thí nghiệm, `run_experiment.py` tự copy file `.db` + export CSV (metric_sample, alert, experiment_run) vào `experiments/results/run_<scenario>_<n>/` và **push lên GitHub ngay** (CSV nhỏ, không cần LFS).
- Nguyên tắc: phân tích (`analyze.py`) chỉ đọc từ bản export, không đọc DB sống → chạy lại phân tích bất kỳ lúc nào, trên máy nào.
- Snapshot 2 VPS sau khi setup sạch (đã ghi ở plan chính) + ghi chú lại từng bước setup vào `docs/vps-setup.md` để dựng lại VPS mới trong 30 phút nếu provider có sự cố.

---

## 4. BÁO CÁO — OUTLINE + PHÂN CÔNG + LỊCH VIẾT

**Viết rải, không dồn:** chương 1–2 viết được từ tuần 5 (không phụ thuộc kết quả). Tuần 12 chỉ để ráp + sửa, không phải để viết từ đầu.

| Chương | Nội dung chính | Ai | Viết ở tuần |
|---|---|---|---|
| 1. Giới thiệu | Bài toán, mục tiêu, phạm vi, đóng góp (nêu rõ 4 điểm: vòng lặp phát hiện→rollback, so sánh 4 phương pháp có CI, slope feature + ablation, kiến trúc agentless) | A | 5–6 |
| 2. Cơ sở lý thuyết & khảo sát | Anomaly detection (3 thuật toán — tự viết lại bằng hiểu biết, có công thức), khảo sát tool liên quan (Coolify, CapRover, Dokploy: bảng so sánh tính năng + chỉ ra khoảng trống là phần ML) | B | 5–7 |
| 3. Phân tích & thiết kế | Kiến trúc, use case, schema, trade-off (SSH-only vs agent, Electron vs web, build trên VPS vs local) — tái dùng sơ đồ trong plan | A | 7–8 |
| 4. Hiện thực | Detector engine, deploy pipeline, collector, ML service — mỗi phần 1 đoạn + 1 hình/đoạn code tiêu biểu, KHÔNG dán code tràn lan | A+B | 9–10 |
| 5. Thí nghiệm & đánh giá | Phương pháp fault-injection, định nghĩa ground truth, bảng P/R/F1±CI, PR curve, detection delay, ablation slope, bảng đo công sức thêm framework | B | 10–11 |
| 6. Kết luận, hạn chế & hướng phát triển | Hạn chế: 2 VPS, 1 loại app chịu tải nhân tạo, chưa test traffic thật, ngưỡng tinh chỉnh trên cùng phân phối lỗi... (thành thật = điểm cộng theo đúng tiêu chí chấm) | A+B | 11–12 |

- Mọi biểu đồ sinh từ `analyze.py` với đúng bộ màu trong UI_UX_SPEC → báo cáo, app, slide đồng bộ.
- Trích dẫn: chuẩn IEEE, quản lý bằng Zotero từ tuần 5 (đừng gõ tay tài liệu tham khảo ở tuần 12).

---

## 5. SLIDE + PHƯƠNG ÁN DEMO DỰ PHÒNG

**Slide ~15 trang cho 15 phút:** 1 vấn đề → 2 khoảng trống của tool hiện có → 3 kiến trúc (1 hình) → 4 demo (chuyển sang app) → 5 phương pháp thí nghiệm → 6 bảng kết quả chính → 7 PR curve + ablation → 8 hạn chế → 9 kết luận. Quy tắc: mỗi slide 1 ý, số liệu to, không đọc slide.

**Demo 3 lớp dự phòng (quyết định theo câu trả lời ở Tuần 0):**
1. **Lớp 1 — live VPS thật** qua 4G hotspot riêng (không tin wifi hội trường). Trước buổi bảo vệ 1 tiếng: chạy smoke test + reset VPS về snapshot sạch.
2. **Lớp 2 — live local:** VPS "giả" bằng máy ảo/multipass ngay trên laptop (tool SSH vào localhost) — mất điểm "VPS thật" nhưng mọi tính năng vẫn demo sống được. Chuẩn bị sẵn từ tuần 12, test 1 lần.
3. **Lớp 3 — video 3 màn đã quay** (mỗi màn 1 file riêng để tua nhanh khi hội đồng yêu cầu).
- In sẵn 3 bản: bảng kết quả P/R/F1 + PR curve + timeline chart — nếu máy chiếu hỏng vẫn có cái đưa hội đồng xem.

---

## 6. CHUẨN BỊ Q&A PHẢN BIỆN (soạn câu trả lời từ tuần 11, mỗi người thuộc cả 12)

Câu hỏi dự kiến — gạch đầu dòng hướng trả lời:
1. *"Sao không dùng Prometheus/Grafana?"* → Mục tiêu là nghiên cứu pipeline phát hiện, tự chủ collector giữ VPS nhẹ (NFR-1), tránh chi phí tích hợp không phục vụ câu hỏi nghiên cứu; Prometheus là hướng phát triển khi cần scale nhiều VPS.
2. *"Sao không dùng LSTM/deep learning?"* → Mẫu 15–30s/lần, vài nghìn điểm/run — quá ít cho DL; 3 phương pháp chọn có thể huấn luyện nhanh trên máy user, giải thích được (slope), và trọng tâm là so sánh có kiểm soát chứ không phải đuổi theo model phức tạp.
3. *"Ground truth xác định thế nào, có công bằng không?"* → Định nghĩa cửa sổ [fault_start+trễ, fault_end], áp dụng đồng nhất cho cả 4 phương pháp; nêu rõ hạn chế của định nghĩa này trong chương 6.
4. *"Ngưỡng 0.7 lấy đâu ra?"* → Tinh chỉnh trên pilot run (tuần 9) tách biệt với 50 run chính thức; và PR curve cho thấy kết quả trên MỌI ngưỡng, không phụ thuộc 1 điểm.
5. *"Isolation Forest/OCSVM hoạt động thế nào?"* → mỗi người thuộc giải thích 2 phút/thuật toán, có ví dụ trực giác (iForest: điểm bất thường bị cô lập sau ít nhát cắt hơn).
6. *"Nếu app có traffic thật, nhiễu cao thì sao?"* → hạn chế đã nêu; cơ chế 2 mẫu liên tiếp + ensemble giảm false positive; hướng phát triển: retrain định kỳ, concept drift.
7. *"Auto-rollback nhầm (false positive) thì hậu quả?"* → rollback về version từng chạy ổn nên chi phí thấp; có cooldown; mặc định để chế độ cảnh báo, auto chỉ bật khi user tin tưởng method.
8. *"Sao build image trên VPS mà không build local rồi push?"* → tránh phụ thuộc registry + khác kiến trúc CPU (Apple Silicon vs x86); trade-off: tốn tài nguyên VPS lúc build — đã precheck RAM/disk trước.
9. *"Bảo mật credential?"* → safeStorage/keychain OS, không rời máy; SSH key khuyến nghị thay password; đã xác nhận phạm vi với giảng viên (email tuần 0).
10. *"Migrate app đang có người dùng thì downtime bao nhiêu?"* → đo thật trong thí nghiệm, báo con số; nêu hạn chế: chưa làm zero-downtime (blue-green là hướng phát triển).
11. *"AI hỗ trợ những gì, em nắm được không?"* → đưa DECISIONS.md + quy trình review chéo; sẵn sàng giải thích bất kỳ module nào hội đồng chỉ định.
12. *"Thêm 1 framework mới mất bao lâu?"* → trả lời bằng số đo thật ở tuần 11 (file, số dòng, số giờ).

---

## 7. SỔ RỦI RO (risk register) — xem lại mỗi 2 tuần

| Rủi ro | Khả năng | Ứng phó đã cài sẵn |
|---|---|---|
| Thành viên bận/ốm 1–2 tuần | Trung bình | Review chéo hằng tuần → người còn lại nắm đủ để gánh; buffer tuần 11 |
| SSH chập chờn làm thí nghiệm hỏng giữa run | Cao | run_experiment.py đánh dấu run lỗi và tự chạy bù; kết quả mỗi run độc lập |
| ML service khó đóng gói trên máy lạ | Trung bình | Chấp nhận yêu cầu Python 3.10+ trong README (chốt với giảng viên tuần 0); PyInstaller chỉ thử ở buffer |
| VPS provider khoá/sự cố | Thấp | Snapshot + docs/vps-setup.md dựng lại 30 phút; 2 provider khác nhau cho 2 VPS nếu muốn chắc |
| Kết quả ML "xấu" (F1 thấp, ML không hơn rule ở kịch bản nào đó) | Trung bình | **Không phải thảm hoạ:** đồ án chấm phương pháp so sánh, không chấm model thắng. Báo cáo trung thực kết quả + phân tích vì sao (vd error_burst đột ngột thì rule bắt tốt, ML thắng ở suy giảm dần) — đây chính là insight hay nhất của chương 5 |
| Demo live hỏng | Trung bình | 3 lớp dự phòng (mục 5) |
| Trễ tiến độ | Trung bình | Quy tắc cắt đã chốt ở plan chính (thứ tự: Tier 2 → 2 kịch bản fault → migrate có DB) |
