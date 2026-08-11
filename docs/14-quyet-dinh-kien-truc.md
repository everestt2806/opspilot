# QUYẾT ĐỊNH KIẾN TRÚC (ADR)

Mỗi mục: **bối cảnh → phương án đã cân nhắc → quyết định → đánh đổi chấp nhận**.
Đây là nguyên liệu trực tiếp cho **chương 3 mục trade-off** và cho phần trả lời phản biện.
Học thuộc phần "Đánh đổi" — hội đồng hỏi đúng chỗ đó.

Thay đổi nhỏ hằng ngày ghi ở [`../DECISIONS.md`](../DECISIONS.md); chỉ quyết định **kiến trúc**
mới lên đây.

---

## ADR-001 — SSH-only, không agent trên VPS

**Bối cảnh.** Cần thu thập metric và điều khiển Docker trên VPS từ xa.

**Phương án.** (a) Cài agent thường trú trên VPS, đẩy metric về. (b) Mở port cho Prometheus
scrape. (c) **SSH exec + đọc file.**

**Quyết định: (c).** Mọi lệnh qua `ssh exec`; metric đọc bằng `tail -c +N` trên file trong
volume của container.

**Vì sao.** NFR-1 yêu cầu không có tiến trình thường trú ngoài container ứng dụng. SSH-only
còn nghĩa là: không cần mở thêm port (bề mặt tấn công không tăng), không cần cài gì lên host,
gỡ tool đi là VPS sạch. Với 1–2 VPS thì chi phí SSH hoàn toàn chấp nhận được.

**Đánh đổi.** Không mở rộng tốt cho hàng chục VPS (mỗi VPS một connection, poll tuần tự);
độ trễ metric cao hơn push-based. Chấp nhận vì phạm vi đồ án là 2 VPS. Ghi vào hướng phát triển.

---

## ADR-002 — `safeStorage` thay cho tự cài đặt AES-256-GCM

**Bối cảnh.** NFR-2 nói "mã hoá AES-256-GCM, lưu cục bộ".

**Phương án.** (a) Tự cài đặt AES-256-GCM + `scrypt` từ passphrase người dùng.
(b) **`safeStorage` của Electron** (uỷ quyền cho keychain/DPAPI của hệ điều hành).

**Quyết định: (b), có sẵn đường lùi sang (a).** Cột `crypto_scheme` trong `vps` đã cho phép
tồn tại song song hai scheme; đổi chỉ tốn ~1 ngày và không lan sang module khác.

**Vì sao.** Ít code hơn, ít khả năng tự tay tạo lỗ hổng hơn (tự cài đặt crypto là chỗ dễ sai
nhất), khoá được bảo vệ bởi cơ chế của hệ điều hành thay vì passphrase người dùng đặt yếu.

**Đánh đổi.** (1) Không di chuyển được credential sang máy khác — nhưng đúng ra là ưu điểm về
bảo mật. (2) Về hình thức chưa khớp nguyên văn "AES-256-GCM" trong đề tài → **đã hỏi và được
GVHD xác nhận bằng email ở tuần 0** *(cập nhật kết quả vào đây khi có)*.

---

## ADR-003 — Collector tự viết, không Prometheus/cAdvisor

**Bối cảnh.** Cần CPU, RAM, latency, error rate, DB response time của container.

**Phương án.** (a) cAdvisor + Prometheus + Grafana. (b) node-exporter + Prometheus.
(c) **Script Python ~150 dòng trong container Alpine.**

**Quyết định: (c).**

**Vì sao.** Câu hỏi nghiên cứu là *so sánh các phương pháp phát hiện*, không phải *xây dựng
hệ thống giám sát*. cAdvisor kéo theo cả hệ sinh thái Prometheus (thêm 2–3 container, thêm
port, thêm PromQL, thêm 1–2 tuần tích hợp) mà không cộng điểm nào. Collector tự viết cho
đúng 8 chỉ số cần, ghi ra một file, kiểm soát hoàn toàn định dạng và chu kỳ.

**Đánh đổi.** Mất các tính năng sẵn có (service discovery, alerting, dashboard). Nhóm phải tự
lo độ tin cậy của collector (đã xử lý: `restart unless-stopped`, mọi lỗi → ghi `null`,
`mem_limit 128m`). Với >10 VPS thì Prometheus mới hợp lý — ghi vào hướng phát triển.

---

## ADR-004 — Build image trên VPS, rollback bằng tag image

**Bối cảnh.** Cần đưa ứng dụng lên VPS và quay lại phiên bản cũ nhanh.

**Phương án.** (a) Build local → push registry → pull trên VPS. (b) **Upload source → build
trên VPS.**

**Quyết định: (b).** Rollback = `docker compose up` với tag `v(N-1)` đã có sẵn; giữ 3 image cũ.

**Vì sao.** (a) cần một registry (thêm tài khoản, thêm secret, thêm điểm hỏng) và gặp vấn đề
kiến trúc CPU nếu máy dev là Apple Silicon còn VPS là x86. (b) đảm bảo image được build đúng
môi trường sẽ chạy. Rollback bằng tag mất ~10 giây, không phải build lại.

**Đánh đổi.** Build tiêu tốn RAM/CPU của chính VPS đang chạy production (đã giảm thiểu bằng
bước `PRECHECK` yêu cầu RAM trống >512MB, disk >2GB) và tốn băng thông upload source mỗi lần
deploy (đã giảm bằng tar + loại trừ `node_modules`).

---

## ADR-005 — SQLite cho toàn bộ dữ liệu của tool

**Bối cảnh.** Cần lưu cấu hình, lịch sử, metric, score, nhãn.

**Phương án.** (a) PostgreSQL cục bộ. (b) File JSON/CSV. (c) **SQLite (`better-sqlite3`).**

**Quyết định: (c)**, bật WAL.

**Vì sao.** App desktop một người dùng, không đồng thời cao. SQLite không cần cài đặt gì
thêm, đi kèm ứng dụng, truy vấn SQL đầy đủ (cần cho `analyze.py` và dashboard), một file duy
nhất — dễ sao lưu. Khối lượng lớn nhất là `score_sample`: 50 run × ~460 mẫu × 5 phương pháp
≈ 115.000 dòng, hoàn toàn trong tầm SQLite.

**Đánh đổi.** Không truy cập đồng thời từ nhiều máy (không cần). WAL + index bắt buộc, nếu
không dashboard sẽ giật khi poller đang ghi.

---

## ADR-006 — Bỏ nginx ở phiên bản 1

**Bối cảnh.** Đề tài gốc nêu nginx trong danh sách container.

**Phương án.** (a) nginx reverse proxy + routing theo domain/subpath. (b) **App expose trực
tiếp một port trên host.**

**Quyết định: (b).** Cấp port tự động trong dải **30000–30999**, lưu ở `app.host_port`,
URL là `http://<vps-ip>:<host_port>`.

**Vì sao.** Nginx chỉ có ý nghĩa khi cần domain, HTTPS, hoặc nhiều app trên cùng port 80 —
cả ba đều nằm ngoài phạm vi. Collector probe qua docker network nên không cần access log của
nginx. Bỏ nginx tiết kiệm ~3 ngày (template config, routing, debug) và bớt một container
phải giám sát.

**Đánh đổi.** URL có số port, không đẹp; không có HTTPS; không host nhiều app trên một domain.
Ghi vào hướng phát triển: "reverse proxy + Let's Encrypt".

---

## ADR-007 — Metric append-only (`metrics.jsonl`), poll theo offset

**Bối cảnh.** Kế hoạch ban đầu: collector ghi đè `latest.json` mỗi 5s, poller đọc mỗi 15s.

**Vấn đề phát hiện trước khi code.** Ghi đè + poll thưa hơn chu kỳ ghi ⇒ **mất 2/3 số mẫu**,
đúng loại dữ liệu đắt nhất của đồ án (35+ giờ máy mỗi VPS). Mất kết nối SSH 5 phút là mất
trắng 5 phút dữ liệu, không cách nào lấy lại.

**Quyết định.** Collector **append** một dòng JSON vào `metrics.jsonl` mỗi **10 giây** (vẫn
giữ `latest.json` để debug tay). Poller kéo mỗi **30 giây** bằng `tail -c +<offset>`, nạp
**mọi dòng mới** và lưu offset vào `app.metrics_offset`.

**Vì sao.** (1) Không mất mẫu nào. (2) Mất kết nối rồi nối lại thì `tail` tự nạp bù toàn bộ
khoảng thiếu. (3) Số lời gọi SSH **giảm một nửa** so với poll 15s. (4) File JSONL là định
dạng lưu trữ luôn, dễ kiểm tra bằng mắt.

**Đánh đổi.** Dữ liệu hiển thị trên dashboard trễ tối đa 30 giây (chấp nhận được, và vẫn nằm
trong NFR-5 "15–30 giây"). Phải xử lý xoay vòng file và trường hợp dòng cuối viết dở — đã
đặc tả trong [`contracts/metric-format.md`](contracts/metric-format.md).

> **Ghi chú rà soát 28/07/2026 — làm rõ sai khác với đề tài gốc:** NFR-5 dùng cụm
> “tần suất thu thập metric 15–30 giây”, trong khi collector hiện lấy mẫu mỗi 10 giây.
> Đề xuất giữ 10 giây vì 30 phút baseline cần 180 mẫu, đồng thời phân biệt rõ hai nhịp:
> **lấy mẫu 10 giây** và **đồng bộ/hiển thị 30 giây**. Đây là sai khác có chủ đích phục vụ
> thí nghiệm, cần giải trình trong báo cáo/DECISIONS thay vì ngầm coi 10 giây thuộc khoảng
> 15–30 giây.

---

## ADR-008 — Thêm phương pháp thứ tư: Ensemble voting

**Bối cảnh.** Đề tài yêu cầu 3 phương pháp ML.

**Quyết định.** Thêm `ensemble`: `above_threshold` khi **≥2/3** trong (zscore_ewma, iforest,
ocsvm) vượt ngưỡng; `score` = trung vị 3 score.

**Vì sao.** Chi phí gần như bằng 0 (không train thêm gì, chỉ là phép bỏ phiếu trên kết quả đã
có) nhưng thêm một dòng vào bảng so sánh — và thường là dòng **có false positive thấp nhất**,
rất đáng bàn luận ở chương 5. Cũng là lựa chọn mặc định hợp lý cho `trusted_method` của
auto-rollback: an toàn hơn tin vào một model đơn lẻ.

**Đánh đổi.** Recall thường thấp hơn model đơn tốt nhất (cần 2/3 đồng ý nên phản ứng chậm
hơn). Chính sự đánh đổi precision–recall này là nội dung phân tích, không phải nhược điểm.

---

## ADR-009 — Ant Design + Recharts + xterm.js

**Bối cảnh.** Team 2 người, NFR-6 nói UI tối giản, nhưng 2 màn hình sẽ xuất hiện lúc bảo vệ.

**Phương án.** (a) Tailwind + shadcn/ui tự ráp. (b) **Ant Design v5.** (c) MUI.

**Quyết định: (b)** + Recharts cho chart + `@xterm/xterm` cho log viewer.

**Vì sao.** AntD có sẵn Steps (wizard 4 bước và 5 bước), Table có filter, Form có validation,
Modal confirm, Notification, Drawer, Statistic — đúng những thứ dự án cần, tiết kiệm khoảng
một tuần so với tự ráp. `xterm.js` render ANSI color của `docker build` mà không phải viết
parser màu — log trông "thật" mà tốn 20 dòng code.

**Đánh đổi.** Giao diện mang dấu ấn AntD, ít cá tính. Chấp nhận: NFR-6 ưu tiên chức năng, và
thời gian tiết kiệm được dồn cho phần ML.

---

## ADR-010 — ML service là tiến trình Python riêng, yêu cầu Python 3.12 trên máy người dùng

**Bối cảnh.** scikit-learn không có bản JavaScript tương đương đủ tin cậy.

**Phương án.** (a) Cài đặt lại 3 thuật toán bằng TypeScript. (b) **Tiến trình Python riêng,
REST localhost.** (c) Python nhúng qua PyInstaller/`pythonia`.

**Quyết định: (b).** Electron `spawn` service lúc khởi động, giao tiếp
`http://127.0.0.1:8765`. README ghi rõ yêu cầu Python 3.12.

**Vì sao.** (a) tự cài đặt Isolation Forest và OCSVM là rủi ro lớn về tính đúng đắn — và hội
đồng sẽ hỏi "sao không dùng thư viện chuẩn". (b) dùng đúng scikit-learn (dễ giải trình, kết
quả so sánh được với tài liệu), lại **test được bằng `curl` mà không cần Electron**, cho phép
A kiểm thử ML độc lập với UI/collector bằng dữ liệu giả do B bàn giao.

**Đánh đổi.** Máy chạy app phải có Python 3.12 → giảm tính "cài là chạy" của NFR-3.
Đã chốt với GVHD ở tuần 0; PyInstaller chỉ thử ở tuần 12 nếu dư thời gian. Cũng phải xử lý
vòng đời tiến trình con (mồ côi, tranh port) — đã ghi trong
[`09-moi-truong-dev.md`](09-moi-truong-dev.md) mục 4.4.
