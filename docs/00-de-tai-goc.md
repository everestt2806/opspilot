# ĐỀ TÀI GỐC (bản nộp giảng viên) — TÀI LIỆU BẤT BIẾN

> **Không sửa file này.** Đây là bản mô tả đề tài đã/đang trình giảng viên, dùng để đối
> chiếu "đã cam kết những gì". Mọi thay đổi so với nội dung dưới đây phải xuất hiện trong
> [`../DECISIONS.md`](../DECISIONS.md) và được nêu ở chương 6 của báo cáo.
> Bản kế hoạch thi hành (đã đơn giản hoá và sửa lỗi) là [`01-ke-hoach.md`](01-ke-hoach.md).

---

## TÊN ĐỀ TÀI

Ứng dụng desktop hỗ trợ deploy và migrate ứng dụng Web đa nền tảng trên VPS, tích hợp
module phát hiện suy giảm vận hành (degraded state) bằng Machine Learning

## 1. KIẾN TRÚC TỔNG QUAN

Ứng dụng desktop chạy trên máy người dùng, kết nối tới VPS qua SSH — không cài đặt tiến
trình thường trực trên VPS ngoài Docker và các container của ứng dụng (bao gồm 1 container
thu thập metric nhỏ gọn, triển khai kèm mỗi lần deploy).

Ứng dụng gồm 3 lớp:

- **Giao diện:** Electron + React + TypeScript — màn hình quản lý VPS, deploy wizard, dashboard giám sát, migrate wizard, lịch sử.
- **Lớp xử lý cục bộ:** Node.js (main process của Electron) — quản lý kết nối SSH, thực thi lệnh Docker từ xa, mã hoá lưu trữ credential, và engine phát hiện framework dạng plugin (mỗi framework một detector độc lập, dễ mở rộng sau này).
- **Lớp ML:** Python microservice chạy cục bộ trên máy người dùng, nhận metric qua SSH polling định kỳ, chạy inference với nhiều phương pháp phát hiện bất thường song song, trả kết quả cho giao diện qua REST nội bộ (localhost).

Toàn bộ huấn luyện và suy luận ML chạy trên máy chạy ứng dụng desktop, không chạy trên VPS, giữ VPS nhẹ.

## 2. YÊU CẦU CHỨC NĂNG

### Nhóm A — Quản lý kết nối VPS
- **FR-A1:** Thêm/sửa/xoá thông tin kết nối VPS (host, port, SSH key hoặc user/pass); lưu cục bộ có mã hoá AES-256-GCM.
- **FR-A2:** Kiểm tra kết nối SSH; kiểm tra Docker đã cài trên VPS, tự cài nếu chưa có (có xác nhận người dùng).
- **FR-A3:** Hiển thị danh sách VPS kèm trạng thái (online/offline, tài nguyên khả dụng).

### Nhóm B — Phân tích & Deploy (đa framework)
- **FR-B1:** Phân tích source code qua kiến trúc detector dạng plugin — mỗi detector kiểm tra file đặc trưng của stack (package.json + next.config.js, package.json kiểu Express, package.json + vite.config.js, requirements.txt/Pipfile...) để xác định framework, build command, biến môi trường cần thiết.
- **FR-B2:** Danh sách framework hỗ trợ: Tier 1 (bắt buộc): Next.js, Node/Express (API backend thuần), Static SPA (React/Vue qua Vite build). Tier 2 (mở rộng, chỉ làm nếu còn thời gian): Python Flask/Django.
- **FR-B3:** Wizard yêu cầu bổ sung config/secret còn thiếu; cảnh báo thao tác thủ công cần làm (OAuth callback URL...).
- **FR-B4:** Kiểm tra tài nguyên VPS đích (RAM, disk, port trống) trước khi deploy.
- **FR-B5:** Build Docker image theo detector đã xác định, chạy test (nếu có), deploy qua SSH.
- **FR-B6:** Hiển thị log build/deploy theo thời gian thực.
- **FR-B7:** Lưu lịch sử các lần deploy (version, framework, thời gian, trạng thái).
- **FR-B8:** Kiến trúc detector cho phép bổ sung framework mới sau này mà không cần sửa lõi hệ thống (mỗi detector là 1 module độc lập: điều kiện nhận diện + build command + Dockerfile template).

### Nhóm C — Migrate
- **FR-C1:** Chọn VPS nguồn và đích, khởi tạo quy trình migrate.
- **FR-C2:** Backup application, database, file cấu hình, persistent volume trên VPS nguồn.
- **FR-C3:** Truyền dữ liệu sang VPS đích, restore và khởi động lại ứng dụng.
- **FR-C4:** Health check và kiểm tra toàn vẹn dữ liệu (checksum, đếm bản ghi database) trước khi xác nhận hoàn tất.
- **FR-C5:** Hỗ trợ huỷ/rollback nếu migrate thất bại giữa chừng; giữ nguyên VPS nguồn cho đến khi xác nhận thành công.

### Nhóm D — Giám sát & Phát hiện bất thường
- **FR-D1:** Triển khai container thu thập metric (CPU, RAM, latency, HTTP error rate, database response time, trạng thái container) cùng lúc deploy, không phụ thuộc framework.
- **FR-D2:** Lấy metric định kỳ qua SSH, hiển thị dashboard thời gian thực.
- **FR-D3:** Baseline rule-based: cảnh báo khi metric vượt ngưỡng cố định (cấu hình được).
- **FR-D4:** Chạy song song 3 phương pháp phát hiện bất thường trên cùng dữ liệu: (a) Z-score/EWMA đa biến (baseline thống kê đơn giản), (b) Isolation Forest, (c) One-Class SVM — hiển thị độ tin cậy của từng phương pháp.
- **FR-D5:** Cho phép gắn nhãn đúng/sai cho từng cảnh báo (theo từng phương pháp) để phục vụ đánh giá so sánh.

### Nhóm E — Rollback & Lịch sử
- **FR-E1:** Rollback thủ công về version/VPS trước đó theo yêu cầu người dùng.
- **FR-E2:** Tự động rollback khi rule-based hoặc phương pháp ML được chọn làm mặc định xác nhận lỗi/suy giảm vượt ngưỡng cấu hình.
- **FR-E3:** Ghi log toàn bộ hành động (deploy, migrate, rollback, cảnh báo) phục vụ tra cứu và đánh giá.

## 3. YÊU CẦU PHI CHỨC NĂNG

- **NFR-1:** Không cài tiến trình thường trực trên host VPS ngoài container ứng dụng và container thu thập metric.
- **NFR-2:** Credential SSH mã hoá AES-256-GCM, lưu cục bộ, không gửi ra ngoài.
- **NFR-3:** Ứng dụng chạy tối thiểu trên 1 hệ điều hành desktop (theo máy nhóm sử dụng), đóng gói bằng electron-builder; đa nền tảng hệ điều hành là hướng mở rộng, không bắt buộc trong phạm vi đồ án.
- **NFR-4:** Thời gian deploy trung bình cho ứng dụng đơn giản (Tier 1) dưới 3 phút.
- **NFR-5:** Tần suất thu thập metric mặc định 15–30 giây/lần, có thể cấu hình.
- **NFR-6:** Giao diện tối giản, ưu tiên đúng chức năng hơn thẩm mỹ — thời gian tập trung chủ yếu cho phần nghiên cứu ML.
- **NFR-7:** Bắt buộc hỗ trợ ổn định 3 stack Tier 1; Tier 2 là stretch goal, không đánh đổi thời gian của phần ML nếu bị chậm tiến độ.
- **NFR-8:** Mỗi kịch bản fault-injection phải chạy lặp lại đủ số lần để tính được độ lệch chuẩn/khoảng tin cậy cho Precision, Recall, F1 — không báo cáo bằng 1 lần chạy duy nhất.

## 4. USE CASE

- **UC-01 – Kết nối VPS mới.** Nhập host, SSH key/user-pass → hệ thống kiểm tra kết nối, kiểm tra/tự cài Docker (có xác nhận) → lưu profile mã hoá cục bộ. *Kết quả:* VPS xuất hiện trong danh sách, trạng thái online.
- **UC-02 – Deploy ứng dụng lần đầu.** Chọn thư mục source/Git URL → hệ thống chạy qua các detector để xác định framework, build command, env, dependency → wizard yêu cầu bổ sung config thiếu → kiểm tra tài nguyên VPS đích → build & deploy → xem log real-time. *Kết quả:* Ứng dụng chạy trên VPS, có bản ghi trong lịch sử deploy kèm framework đã nhận diện.
- **UC-03 – Redeploy phiên bản mới.** Chọn VPS đã deploy → build phiên bản mới → deploy → health check tự động; nếu lỗi rõ ràng, tự rollback rule-based về version cũ.
- **UC-04 – Rollback thủ công.** Chọn version/VPS trong lịch sử → xác nhận → hệ thống khôi phục.
- **UC-05 – Migrate sang VPS khác.** Chọn VPS nguồn/đích → backup app + database + persistent data → truyền dữ liệu → restore → kiểm tra toàn vẹn (checksum, đếm bản ghi) → xác nhận hoặc rollback nếu lỗi giữa chừng.
- **UC-06 – Theo dõi dashboard vận hành.** Mở dashboard → xem CPU/RAM/latency/error rate/trạng thái container theo thời gian thực; xem cảnh báo rule-based và của từng phương pháp ML.
- **UC-07 – Cảnh báo suy giảm & tự rollback (tự động).** Phương pháp ML mặc định phát hiện suy giảm đa chỉ số vượt ngưỡng tin cậy → gửi cảnh báo → nếu chế độ tự động bật, thực hiện rollback → ghi log.
- **UC-08 – Gắn nhãn phản hồi cảnh báo.** Xem cảnh báo trong lịch sử (theo từng phương pháp) → đánh dấu đúng/sai (true/false positive).
- **UC-09 – Xem lịch sử hoạt động.** Mở màn hình lịch sử → lọc theo loại hành động (deploy/migrate/rollback/cảnh báo) → xem chi tiết.

## 5. CÔNG NGHỆ ĐỀ XUẤT

- **Desktop UI:** Electron + React + TypeScript, đóng gói bằng electron-builder.
- **Kết nối VPS:** thư viện ssh2 (Node.js) — không cần agent cài trên VPS.
- **Kiến trúc phát hiện framework:** dạng plugin/detector (mỗi detector kiểm tra file đặc trưng của stack để xác định build command tương ứng), giúp dễ bổ sung framework mới sau này.
- **Container hoá:** Docker + Docker Compose trên VPS (ứng dụng theo Tier 1/Tier 2, PostgreSQL, Nginx, container thu thập metric).
- **Thu thập metric:** cAdvisor/node-exporter hoặc script nhỏ gọn tự viết, lấy dữ liệu qua SSH — không phụ thuộc framework của ứng dụng.
- **ML:** Python + scikit-learn — 3 phương pháp: Z-score/EWMA đa biến, Isolation Forest, One-Class SVM; chạy cục bộ trên máy chạy app, giao tiếp với Electron qua REST nội bộ (localhost).
- **Lưu trữ cấu hình/lịch sử của chính ứng dụng:** SQLite cục bộ.

## 6. PHƯƠNG PHÁP ĐÁNH GIÁ NÂNG CAO

- So sánh nhiều phương pháp thay vì 1 mô hình duy nhất: đối chiếu Precision/Recall/F1/tỷ lệ cảnh báo sai giữa rule-based (threshold cố định), Z-score/EWMA, Isolation Forest, One-Class SVM trên cùng tập dữ liệu fault-injection.
- Rigor thống kê: mỗi kịch bản lỗi chạy lặp lại nhiều lần (đủ để tính độ lệch chuẩn/khoảng tin cậy), không kết luận từ 1 lần chạy.
- Mục "Hạn chế và hướng phát triển" trong báo cáo cuối: nêu rõ giới hạn về số lượng VPS thử nghiệm, kích thước dữ liệu, độ phức tạp mô hình đã chọn và lý do.
- Kịch bản demo trực tiếp lúc bảo vệ: giả lập 1 lỗi suy giảm dần (ví dụ memory leak) ngay tại chỗ, cho thấy hệ thống phát hiện và rollback trước khi health-check nhị phân kịp phản ứng.
- Chuẩn bị giải trình phần AI hỗ trợ: nắm rõ kiến trúc, trade-off thiết kế (tại sao SSH-only, tại sao Electron, tại sao kết hợp rule-based + nhiều phương pháp ML) để trả lời được không cần xem tài liệu.

## 7. TIÊU CHÍ ĐÁNH GIÁ

- Tỷ lệ deploy / migrate / rollback thành công trên môi trường thử nghiệm, tính riêng theo từng framework Tier 1.
- Thời gian downtime khi migrate; mức độ toàn vẹn dữ liệu sau migrate.
- Precision, Recall, F1-score (kèm khoảng tin cậy) của 3 phương pháp phát hiện bất thường trên tập dữ liệu fault-injection, có bảng so sánh.
- Thời gian phát hiện sớm hơn so với rule-based thuần.
- Tính mở rộng của kiến trúc detector (đo bằng công sức thêm 1 framework mới, ví dụ Tier 2).
- Chất lượng phần "Hạn chế và hướng phát triển" và độ trôi chảy khi giải trình kiến trúc/trade-off lúc bảo vệ.
- Tính ổn định và mức độ hoàn thiện của ứng dụng desktop (đóng gói chạy được, không cần agent trên VPS).
