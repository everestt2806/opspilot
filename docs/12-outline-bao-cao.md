# OUTLINE BÁO CÁO & LỊCH VIẾT

**Nguyên tắc: viết rải, không dồn.** Chương 1–2 viết được từ tuần 11 mà không cần kết quả.
Tuần 13–15 chỉ để ráp và sửa, **không phải để viết từ đầu**.

⚠ Số trang, định dạng, mẫu bìa theo quy định của khoa — **hỏi GVHD ở tuần 0**, đừng đoán.

---

## Phân công & lịch

| Chương | Nội dung chính | Ai | Tuần viết |
|---|---|---|---|
| 1. Giới thiệu | Bài toán, mục tiêu, phạm vi, **4 đóng góp** | A | W11 |
| 2. Cơ sở lý thuyết & khảo sát | 3 thuật toán + khảo sát tool liên quan | B | W11 |
| 3. Phân tích & thiết kế | Kiến trúc, use case, schema, trade-off | A | W11 |
| 4. Hiện thực | Detector, deploy pipeline, collector, ML service | A+B | W11–W12 |
| 5. Thí nghiệm & đánh giá | **Chương quan trọng nhất** | B | W10–W12 |
| 6. Kết luận, hạn chế & hướng phát triển | | A+B | W13 |
| Phụ lục | Timeline thực tế, ma trận truy vết, DECISIONS.md, smoke log | A | W13 |

---

## Chương 1 — Giới thiệu

Bài toán · mục tiêu · phạm vi (nói rõ **không** làm gì) · cấu trúc báo cáo.

**Nêu thẳng 4 đóng góp** (đây là thứ hội đồng tìm):
1. Vòng lặp khép kín **phát hiện → tự rollback** trên hạ tầng thật, kiến trúc agentless.
2. **So sánh có kiểm soát 5 phương pháp** (rule + 3 ML + ensemble) trên cùng tập dữ liệu
   fault-injection, có khoảng tin cậy.
3. **Đặc trưng slope** cho phát hiện suy giảm tăng dần, kèm **ablation study** chứng minh
   đóng góp của nó bằng số liệu.
4. Kiến trúc **detector mở rộng được**, đo bằng công sức thực tế khi thêm một framework mới.

## Chương 2 — Cơ sở lý thuyết & khảo sát

- **Anomaly detection không giám sát:** Z-score/EWMA, Isolation Forest, One-Class SVM —
  **tự viết lại bằng hiểu biết của mình**, có công thức, có trực giác. Không copy Wikipedia:
  hội đồng sẽ hỏi lại đúng đoạn này.
- Ensemble voting và lý do dùng.
- **Khảo sát tool liên quan** — bảng so sánh tính năng: Coolify · CapRover · Dokploy ·
  Portainer · (Prometheus + Grafana làm đối chứng phía giám sát).
  Kết luận của bảng: các tool này mạnh về deploy nhưng **giám sát chỉ dừng ở ngưỡng cố định** →
  đó chính là khoảng trống mà đồ án lấp.
- Khái niệm degraded state và vì sao health check nhị phân không đủ.

## Chương 3 — Phân tích & thiết kế

Use case (9 UC) · kiến trúc 3 lớp (tái dùng sơ đồ [`01-ke-hoach.md`](01-ke-hoach.md)) ·
schema (tái dùng [`contracts/schema.sql`](contracts/schema.sql)) · thiết kế feature vector.

**Mục trade-off — viết kỹ, đây là nơi ăn điểm giải trình.** Mỗi mục 1 đoạn, lấy nội dung từ
[`14-quyet-dinh-kien-truc.md`](14-quyet-dinh-kien-truc.md):
SSH-only vs agent · Electron vs web app · build trên VPS vs build local · collector tự viết vs
Prometheus · SQLite vs PostgreSQL · safeStorage vs AES tự cài đặt · append-only JSONL vs ghi đè.

## Chương 4 — Hiện thực

Mỗi module một đoạn + **một hình hoặc một đoạn code tiêu biểu** (≤20 dòng).
**Không dán code tràn lan** — dán 5 trang code là dấu hiệu không có gì để nói.

Nên có: sơ đồ state machine deploy · một detector đầy đủ (làm ví dụ cho tính mở rộng) ·
hàm tính slope · luồng poller → ML → alert → rollback.
Thêm một mục ngắn "xử lý lỗi và các nhánh hỏng" — dẫn kết quả test nhánh lỗi ở
[`11-chien-luoc-test.md`](11-chien-luoc-test.md) mục 4.

## Chương 5 — Thí nghiệm & đánh giá ★

Bám sát [`07-giao-thuc-thi-nghiem.md`](07-giao-thuc-thi-nghiem.md). Thứ tự đề xuất:

1. **Hình timeline một run tiêu biểu** ngay đầu chương — một hình kể hết câu chuyện.
2. Thiết lập thí nghiệm (cấu hình VPS, load generator, tại sao `mem_limit`, tại sao probe
   từ trong VPS).
3. **Định nghĩa ground truth** + 4 pha của một run + vì sao có pha holdout, vì sao loại pha
   recovery. Viết rõ ràng — đây là chỗ chứng minh nhóm hiểu mình đang đo cái gì.
4. Bảng chính P/R/F1 ± CI 95% theo phương pháp × kịch bản.
5. **Detection delay** — bảng + biểu đồ, so ML với rule, kèm số run không phát hiện được.
6. **PR curve + AUC-PR** cho từng phương pháp.
7. **Ablation study slope.**
8. Phân tích theo kiểu suy giảm (RQ3): vì sao rule tốt ở `error_burst`, vì sao ML thắng ở
   suy giảm tăng dần.
9. Kiểm chứng bổ trợ: độ nhạy với `grace`, so sánh giữa 2 VPS, số run bị huỷ và lý do.
10. Kết quả về app: tỷ lệ deploy/migrate/rollback thành công, thời gian deploy trung bình
    (NFR-4), downtime migrate, công sức thêm framework mới (FR-B8).

## Chương 6 — Kết luận, hạn chế & hướng phát triển

**Hạn chế phải thành thật và cụ thể** (theo đúng tiêu chí chấm, thành thật = điểm cộng):
- Chỉ 2 VPS, một provider, một region.
- Một loại ứng dụng (`express-api`) chịu tải **nhân tạo**, chưa test traffic người dùng thật.
- Ngưỡng tinh chỉnh trên pilot có cùng phân phối lỗi với tập chính thức.
- Fault injection là lỗi **được lập trình sẵn**, không phải lỗi tự nhiên trong vận hành.
- Định nghĩa ground truth theo cửa sổ thời gian là một lựa chọn, có thể tranh luận
  (đã có phân tích độ nhạy).
- Chưa xử lý concept drift; model không tự train lại.
- Chưa có zero-downtime migrate; chưa có HTTPS/domain tự động.

**Hướng phát triển:** retrain định kỳ + phát hiện concept drift · nhiều VPS (khi đó
Prometheus hợp lý hơn) · deep learning khi có đủ dữ liệu · blue-green deployment ·
reverse proxy + Let's Encrypt · mở rộng detector sang Go/Rust/Django.

## Phụ lục

Bảng timeline **kế hoạch vs thực tế** ([`04`](04-timeline.md)) · ma trận truy vết yêu cầu
([`05`](05-truy-vet-yeu-cau.md)) · `DECISIONS.md` · nhật ký smoke test · hướng dẫn dựng lại
môi trường ([`08`](08-vps-setup.md), [`09`](09-moi-truong-dev.md)).

---

## Quy tắc trình bày

- **Trích dẫn chuẩn IEEE, quản lý bằng Zotero từ tuần 11.** Đừng gõ tay tài liệu tham khảo ở
  tuần cuối. Tối thiểu ~15 nguồn: paper gốc của Isolation Forest (Liu 2008), One-Class SVM
  (Schölkopf 2001), khảo sát anomaly detection, tài liệu Docker/SSH, tool liên quan.
- **Mọi hình sinh từ `analyze.py`**, dùng đúng bộ màu 5 phương pháp ở
  [`02-ui-ux-spec.md`](02-ui-ux-spec.md) → báo cáo, app và slide đồng bộ màu.
- Mọi hình/bảng có số thứ tự, có chú thích, **được nhắc đến trong thân bài**. Hình không được
  nhắc tới thì bỏ.
- Mọi con số trong báo cáo phải truy được về một file CSV trong `experiments/results/`.
  Không có con số nào "nhớ áng chừng".
- Ảnh chụp màn hình app: đúng theme tối, phóng to phần cần nhìn, không chụp cả màn hình.
