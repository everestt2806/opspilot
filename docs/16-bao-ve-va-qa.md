# BẢO VỆ: SLIDE, DEMO & CHUẨN BỊ PHẢN BIỆN

---

## 1. Slide — 15 trang cho 15 phút

| # | Nội dung | Ghi chú |
|---|---|---|
| 1 | Tên đề tài, nhóm, GVHD | |
| 2 | **Vấn đề:** health check nhị phân chỉ biết "sống/chết", không biết "đang xấu dần" | 1 hình minh hoạ đường mem tăng dần trong khi health check vẫn xanh |
| 3 | **Khoảng trống của tool hiện có** | Bảng so sánh Coolify/CapRover/Dokploy — cột "phát hiện suy giảm" đều trống |
| 4 | Mục tiêu & 4 đóng góp | 4 gạch đầu dòng, không hơn |
| 5 | Kiến trúc | **1 hình duy nhất**, chính là hình ở `01-ke-hoach.md` |
| 6 | → **DEMO** (chuyển sang app) | ~8 phút, xem mục 2 |
| 7 | Phương pháp thí nghiệm | 4 pha của một run + định nghĩa ground truth |
| 8 | 5 kịch bản fault | Bảng ngắn |
| 9 | **Bảng kết quả chính** P/R/F1 ± CI | Số to, tô đậm ô đáng chú ý |
| 10 | **Detection delay** — ML sớm hơn rule bao nhiêu | Con số quan trọng nhất của cả buổi |
| 11 | PR curve + AUC-PR | Trả lời trước câu hỏi "sao chọn ngưỡng 0.7" |
| 12 | Ablation slope | Chứng minh thiết kế feature có chủ đích |
| 13 | Phân tích theo kiểu suy giảm (RQ3) | Nêu cả chỗ ML **không** thắng — tăng độ tin cậy |
| 14 | Hạn chế | Thành thật, cụ thể |
| 15 | Kết luận & hướng phát triển | |

**Quy tắc:** mỗi slide một ý · số liệu to · **không đọc slide** · không animation.

---

## 2. Ba lớp demo dự phòng

Chọn lớp 1 hay 2 dựa trên câu trả lời của GVHD ở tuần 0 (phòng bảo vệ có internet không).

| Lớp | Phương án | Chuẩn bị |
|---|---|---|
| **1** | **VPS thật** qua **4G hotspot riêng** — không tin wifi hội trường | Snapshot sạch + deploy sẵn + smoke test trước 1 tiếng |
| **2** | **Local:** VPS "giả" bằng máy ảo/Multipass ngay trên laptop, tool SSH vào `127.0.0.1` | Dựng và **test thật 1 lần ở tuần 14**. Mất điểm "VPS thật" nhưng mọi tính năng vẫn sống |
| **3** | **Video đã quay**, mỗi màn một file riêng để tua nhanh | Quay ở tuần 14, để trong **USB** |

Ngoài ra: **in sẵn 3 bản** bảng kết quả + PR curve + hình timeline — máy chiếu hỏng vẫn có
cái đưa hội đồng xem.

---

## 3. Kịch bản demo 3 màn (~8 phút)

### Màn 1 — Deploy (2 phút)
Kéo thư mục app demo vào tool → detector nhận diện framework tự động → precheck → deploy lên
VPS thật, log build chạy real-time trên màn hình → banner **"Deploy thành công sau 2m41s"**.
Mở app bằng điện thoại của giảng viên nếu được (URL thật, VPS thật — không phải localhost).

> Câu dẫn: *"Con số 2 phút 41 giây này chính là NFR-4 mà nhóm em cam kết, và nó được ghi vào
> cơ sở dữ liệu ở mọi lần deploy — thầy/cô xem bảng lịch sử sẽ thấy trung bình của cả kỳ."*

### Màn 2 — Hệ thống tự cứu chính nó (4 phút) — **đinh của buổi bảo vệ**
Chạy script memory leak → dashboard cho thấy `mem_mb` tăng dần → **chỉ vào thanh score của
từng phương pháp tăng dần**, vạch màu lần lượt xuất hiện trên chart (tím → hồng → xanh dương),
**trong khi vạch ngưỡng rule 90% vẫn chưa chạm** → auto-rollback kích hoạt → app hồi phục,
`mem_mb` về bình thường.

> Câu chốt: *"Hệ thống phát hiện và tự khắc phục **trước khi** ngưỡng truyền thống kịp phản
> ứng khoảng X giây — đúng bằng con số trung bình trong bảng thí nghiệm 10 lần lặp."*

⚠ **Bắt buộc chuẩn bị trước:** model phải được train xong (≥40 phút chạy) **trước** buổi bảo
vệ. Không thể train tại chỗ.

### Màn 3 — Tính mở rộng bằng con số (2 phút)
Mở file `flask.ts` (nếu làm Tier 2): *"Thêm một framework mới = 1 file N dòng, không sửa một
dòng nào ở lõi, mất Y giờ"* — con số Y **đo thật** khi làm ở tuần 10, có trong báo cáo làm
bằng chứng cho tiêu chí "tính mở rộng của kiến trúc detector".

Nếu **không** làm Tier 2: thay bằng mở `detector-contract.ts` và giải thích interface, nói rõ
Tier 2 là stretch goal đã thống nhất với GVHD từ đầu và nhóm chọn ưu tiên phần nghiên cứu.

**Tập ≥3 lần ở tuần 14–15, bấm giờ, quay video dự phòng từng màn.**

---

## 4. Mười lăm câu hỏi phản biện & hướng trả lời

Soạn từ tuần 13. **Cả hai người phải thuộc cả 15** — hội đồng hay hỏi người không viết phần đó.

1. **"Sao không dùng Prometheus/Grafana?"**
   → Mục tiêu là nghiên cứu pipeline phát hiện, không phải xây hệ giám sát. Tự chủ collector
   giữ VPS nhẹ (NFR-1) và kiểm soát hoàn toàn định dạng/chu kỳ dữ liệu. Prometheus hợp lý khi
   scale nhiều VPS — đã ghi vào hướng phát triển. (ADR-003)

2. **"Sao không dùng LSTM/deep learning?"**
   → Mẫu 10 giây/lần, ~460 mẫu mỗi run, tổng vài chục nghìn điểm — quá ít cho DL. Ba phương
   pháp đã chọn train được trong vài giây trên máy người dùng, **giải thích được** (chỉ ra
   metric nào bất thường), và trọng tâm là **so sánh có kiểm soát**, không phải đuổi theo mô
   hình phức tạp. Đã ghi vào hướng phát triển kèm lý do.

3. **"Ground truth xác định thế nào, có công bằng không?"**
   → Nhãn theo cửa sổ: ANOMALY = `[fault_start + 60s, fault_end]`; NORMAL = pha holdout 15
   phút mà model **chưa từng thấy**; pha hồi phục bị loại vì không thể gán nhãn trung thực.
   **Cùng một quy tắc áp cho cả 5 phương pháp.** Có phân tích độ nhạy với `grace ∈ {0,30,60,120}`.

4. **"Ngưỡng 0.7 lấy đâu ra?"**
   → Tinh chỉnh trên 10 run pilot ở tuần 8, **tách biệt** với 50 run chính thức. Và PR curve
   trình bày kết quả trên **mọi** ngưỡng nên kết luận không phụ thuộc một điểm.

5. **"Isolation Forest / One-Class SVM hoạt động thế nào?"**
   → Mỗi người thuộc phần giải thích 2 phút/thuật toán, có ví dụ trực giác (iForest: điểm bất
   thường bị cô lập sau ít nhát cắt ngẫu nhiên hơn; OCSVM: học một biên bao quanh vùng dữ
   liệu bình thường trong không gian đặc trưng).

6. **"Vì sao chọn 4 đặc trưng đó? Slope để làm gì?"**
   → Giá trị hiện tại bắt bất thường tức thời; mean/std bắt lệch mức và độ biến động; **slope
   bắt xu hướng** — đúng thứ cần cho suy giảm tăng dần. Có **ablation study** chứng minh bằng
   số: bỏ slope thì detection delay tăng bao nhiêu giây.

7. **"Nếu app có traffic thật, nhiễu cao thì sao?"**
   → Đã nêu trong hạn chế. Cơ chế 2 mẫu liên tiếp + ensemble giảm false positive. Hướng phát
   triển: train lại định kỳ và phát hiện concept drift.

8. **"Auto-rollback nhầm thì hậu quả gì?"**
   → Rollback về version **đã từng chạy ổn định** nên chi phí thấp; có cooldown 10 phút chống
   lặp; mặc định **tắt**, người dùng chủ động bật và chọn phương pháp tin cậy.

9. **"Sao build image trên VPS mà không build local rồi push?"**
   → Tránh phụ thuộc registry và tránh lệch kiến trúc CPU. Đánh đổi là tốn tài nguyên VPS lúc
   build — đã xử lý bằng bước PRECHECK kiểm tra RAM/disk trước. (ADR-004)

10. **"Bảo mật credential thế nào?"**
    → `safeStorage` uỷ quyền cho keychain/DPAPI của hệ điều hành, không rời máy; khuyến nghị
    SSH key thay password; đã xác nhận phạm vi với thầy/cô bằng email ở tuần 0. (ADR-002)

11. **"Migrate lúc app đang có người dùng thì downtime bao nhiêu?"**
    → Đo thật, có số trong báo cáo (`migration_job.downtime_ms`). Hạn chế: chưa zero-downtime;
    blue-green là hướng phát triển.

12. **"AI hỗ trợ những gì, em có nắm được không?"**
    → AI viết phần lớn code **theo spec do nhóm thiết kế**. Kiến trúc, contract giữa các
    module, giao thức thí nghiệm và cách xử lý kết quả là do nhóm quyết định — mở
    `docs/contracts/` và `DECISIONS.md` cho hội đồng xem. Mời thầy/cô chỉ định bất kỳ module
    nào để giải thích.

13. **"Thêm một framework mới mất bao lâu?"**
    → Trả lời bằng **số đo thật** ở tuần 10: bao nhiêu file, bao nhiêu dòng, bao nhiêu giờ,
    và không sửa dòng nào ở lõi.

14. **"Kết quả này có tái lập được không?"**
    → `random_state=42` ở mọi nơi; toàn bộ CSV + `meta.json` (kèm git commit) đã lưu trong
    repo; `analyze.py` chỉ đọc CSV nên chạy lại trên máy bất kỳ ra đúng số.

15. **"Chỉ 2 VPS và một loại app, kết luận có tổng quát không?"**
    → **Không, và nhóm nói rõ điều đó trong chương 6.** Kết luận giới hạn trong phạm vi đã thí
    nghiệm. Nhóm đã kiểm tra chênh lệch giữa 2 VPS và báo cáo; mở rộng sang nhiều loại ứng
    dụng và traffic thật là hướng phát triển tiếp theo.

---

## 5. Nguyên tắc trả lời

- **Không biết thì nói không biết**, rồi nói mình sẽ tìm hiểu theo hướng nào. Bịa là mất điểm
  nặng nhất.
- Trả lời **bằng số liệu của mình** bất cứ khi nào có thể — nhóm có 50 run, hãy dùng chúng.
- Câu hỏi chỉ ra một hạn chế → **thừa nhận thẳng**, rồi chỉ vào chương 6 nơi đã ghi hạn chế đó.
  Đã lường trước là điểm cộng, không phải điểm trừ.
- Người không phụ trách phần bị hỏi vẫn trả lời được ở mức tổng quan, rồi mời người kia bổ
  sung chi tiết. Đừng im lặng nhìn nhau.
