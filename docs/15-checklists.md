# CHECKLIST

In ra hoặc copy vào issue GitHub. Tick thật, đừng tick cho có.

---

## Checklist trước khi code — phần còn thiếu hấp thụ vào W1 (10/08–16/08)

### Chốt với giảng viên (BLOCKING — làm ngày đầu tiên)

> **Ghi chú cập nhật 28/07/2026 — giữ nguyên checklist gốc:** các mục trao đổi với GVHD bên
> dưới được xem là bằng chứng nhóm làm việc nghiêm túc và là kênh báo cáo tiến độ, **không còn
> là cổng phê duyệt kỹ thuật**. Nhóm tự chốt phương án, ghi rõ lý do và chịu trách nhiệm giải
> trình; không dừng triển khai để chờ GVHD quyết định thay. Chữ “BLOCKING” ở tiêu đề được giữ
> lại để phản ánh kế hoạch ban đầu.

- [ ] Gửi email chốt **bằng văn bản** 3 điều:
  1. `safeStorage` của Electron có được chấp nhận thay cho tự cài đặt AES-256-GCM không (ADR-002)?
  2. Yêu cầu **Python 3.12 trên máy chạy app** có chấp nhận được không (ADR-010)?
  3. Tier 2 (Flask) là stretch goal — có đúng như đề xuất không?
- [ ] Hỏi thêm: **định dạng + số trang báo cáo theo quy định khoa**; mẫu bìa; hạn nộp bản nháp
- [ ] Hỏi: **lịch bảo vệ dự kiến**; phòng bảo vệ có internet không, có được dùng 4G không
      (quyết định phương án demo ở [`16`](16-bao-ve-va-qa.md))
- [ ] Lưu email trả lời vào Drive chung → cập nhật kết quả vào ADR-002 và ADR-010

### Hạ tầng
- [ ] `git init`, commit đầu tiên với toàn bộ `docs/`
- [ ] Tạo repo GitHub **private**, add cả 2 thành viên (+ GVHD nếu thầy/cô muốn)
- [ ] Kiểm tra `.gitignore` chặn đúng: thử `git add -n` một file `.db` giả → phải bị bỏ qua
- [ ] `git config --global core.autocrlf input` trên **cả hai máy**
- [ ] Tạo nhóm chat riêng + thư mục Google Drive chung
- [ ] Cả hai đọc xong [`CLAUDE.md`](../CLAUDE.md) và [`01-ke-hoach.md`](01-ke-hoach.md)

### Máy dev (cả 2 người)
- [ ] Node 22 · pnpm · Python 3.12 · Docker Desktop · VS Code — theo [`09`](09-moi-truong-dev.md) mục 1
- [ ] Tạo SSH key riêng cho đồ án: `~/.ssh/deploytool_ed25519`
- [ ] Thêm ngoại lệ Windows Defender cho thư mục repo

### VPS
- [ ] Mua **2 VPS cùng provider / cùng gói / cùng region**, Ubuntu 24.04
- [ ] Chạy hết [`08-vps-setup.md`](08-vps-setup.md) mục 1–5 trên **cả hai máy**
- [ ] 6 lệnh nghiệm thu đều xanh, **đặc biệt lệnh 4 (đồng hồ) và 6 (lệch < 2000ms)**
- [ ] Chụp **snapshot** cả 2 máy, ghi ID vào bảng ở [`08`](08-vps-setup.md) mục 0
- [ ] Điền bảng thông tin VPS (IP, provider, ngày hết hạn thanh toán)

### Kế hoạch
- [ ] Cả hai xem [`04-timeline.md`](04-timeline.md), đồng ý phân công A/B
- [ ] Đặt lịch định kỳ: họp thứ Hai 15', smoke test thứ Sáu 10'
- [ ] Cài Zotero, tạo thư mục tài liệu tham khảo chung

---

## Smoke test 10 phút

Chạy **mỗi thứ Sáu** trên `main` và **trước mọi buổi demo**.
Ghi kết quả 1 dòng vào `docs/smoke-log.md`: ngày · ai chạy · pass/fail · ghi chú.

- [ ] 1. Mở app → không lỗi console, dot ML service **xanh**, dot SSH **xanh**
- [ ] 2. Thêm VPS mới (hoặc kiểm tra lại VPS cũ) → trạng thái **Online**, hiện RAM/disk thật
- [ ] 3. Deploy `demo-apps/express-api` → thành công, **mở được URL trên trình duyệt**
- [ ] 4. Thời gian deploy hiển thị **< 3 phút** (NFR-4)
- [ ] 5. Dashboard có số liệu sau **≤ 60 giây**, cả 6 ô Statistic đều có giá trị
- [ ] 6. Chạy `cpu_spike` 2 phút → **≥1 phương pháp** báo alert, vạch sự kiện hiện trên chart
- [ ] 7. Gắn nhãn 1 alert → đổi màu ngay, mở lại app vẫn còn nhãn
- [ ] 8. Rollback thủ công → app về version cũ, vẫn mở được URL
- [ ] 9. Màn Lịch sử có đủ bản ghi của các việc vừa làm
- [ ] 10. Tắt app → mở lại → dữ liệu còn nguyên, poller chạy tiếp, `seq` không thủng

**Fail bất kỳ mục nào → tuần sau ưu tiên sửa trước khi làm việc mới.**

---

## Trước tuần thí nghiệm chính thức (cuối W8, hạn 04/10)

- [ ] **Soak test 24 giờ đã chạy và đạt** ([`11`](11-chien-luoc-test.md#3-test-độ-bền-soak-test--tuần-9-bắt-buộc))
- [ ] Pilot 10 run (5 kịch bản × 2) đã chạy xong
- [ ] **Ngưỡng ML và feature config đã chốt, ghi vào `DECISIONS.md`** — sau mốc này không đổi nữa
- [ ] `run_experiment.py` chạy trọn 1 run **không cần can thiệp tay**
- [ ] Kiểm tra toàn vẹn sau run chạy tự động và báo đúng khi cố tình làm hỏng
- [ ] `export_results.py` xuất CSV + `meta.json` (có `git_commit`) và push GitHub được
- [ ] `analyze.py` chạy được trên dữ liệu pilot, ra bảng và 3 hình
- [ ] Kiểm chứng R14: `memory_leak` làm rule chạm ngưỡng ở khoảng phút 10–13, container
      **không** bị OOM-kill trước phút 15
- [ ] Lệch đồng hồ 2 VPS đều < 2000ms
- [ ] Cả 2 VPS trống, không chạy gì khác
- [ ] Đã tính lịch: 25 run/VPS × 83' ≈ 35 giờ — đặt lịch chạy cụ thể

---

## Trước khi nộp (W15)

- [ ] Bản đóng gói cài được trên **máy sạch**, smoke test trên bản đóng gói
- [ ] `analyze.py` chạy lại từ CSV trên máy khác → **đúng** số liệu trong báo cáo
- [ ] Mọi hình trong báo cáo sinh lại được bằng một lệnh
- [ ] Báo cáo: mọi hình/bảng có số, có chú thích, được nhắc trong thân bài
- [ ] Tài liệu tham khảo IEEE từ Zotero, ≥15 nguồn
- [ ] Phụ lục có: timeline kế hoạch vs thực tế · ma trận truy vết · `DECISIONS.md` · smoke log
- [ ] `README.md` ghi đúng yêu cầu môi trường và cách chạy
- [ ] Repo không còn secret, không còn file `.db`
- [ ] Video demo 3 màn đã quay, mỗi màn một file riêng

---

## Ngày bảo vệ

**Trước 1 ngày**
- [ ] Khôi phục 2 VPS về snapshot sạch
- [ ] Deploy sẵn app demo cho Màn 2, để chạy **≥40 phút** cho model train xong
      (⚠ **không thể train ML tại chỗ trong lúc bảo vệ**)
- [ ] Tập demo lần cuối, bấm giờ — mục tiêu ≤8 phút
- [ ] Sạc đầy laptop + mang sạc + mang cục phát 4G riêng
- [ ] Copy video dự phòng vào **USB** (đừng phụ thuộc mạng)
- [ ] In 3 bản: bảng P/R/F1 · PR curve · hình timeline

**Trước 1 tiếng**
- [ ] Smoke test 10 phút trên chính máy sẽ dùng để demo
- [ ] Kiểm tra 4G hotspot hoạt động, **không dùng wifi hội trường**
- [ ] Mở sẵn: app · slide · thư mục video · `DECISIONS.md` · `docs/contracts/`
- [ ] Tắt thông báo, đặt máy ở chế độ trình chiếu, tắt sleep
- [ ] Kiểm tra độ tương phản màu trên máy chiếu thật (dot trạng thái có nhìn rõ không)

**Ngay trước khi vào**
- [ ] App đang chạy, dashboard đã có dữ liệu, model đã train xong
- [ ] Script memory leak đã sẵn sàng trong terminal, chỉ cần Enter
- [ ] Hít thở. Nhóm đã có 50 run dữ liệu thật — không ai trong phòng biết hệ thống này rõ hơn.
