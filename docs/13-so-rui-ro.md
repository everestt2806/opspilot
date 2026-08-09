# SỔ RỦI RO

Review **mỗi 2 tuần** (cuối tuần chẵn), cập nhật cột "Tình trạng". Rủi ro mới phát sinh thì
thêm dòng, đừng để trong đầu.

Mức: 🔴 cao · 🟡 trung bình · 🟢 thấp

---

| # | Rủi ro | Khả năng | Tác động | Ứng phó đã cài sẵn | Dấu hiệu sớm | Tình trạng |
|---|---|---|---|---|---|---|
| R1 | **Đường ống metric không xong trước tuần 4** → phần ML không có dữ liệu thật, cả đồ án đổ | 🟡 | 🔴 | Cổng G2 ở W4 buộc Người A dừng UI/migrate dồn vào pipeline; Người B có dữ liệu giả từ W1 để làm việc độc lập | Hết W3 mà `metric_sample` vẫn rỗng | Mở |
| R2 | Một thành viên bận/ốm 1–2 tuần | 🟡 | 🟡 | Review chéo hằng tuần → người kia gánh được; W12 là đệm; thứ tự ưu tiên khi 1 người đã chốt ở [`03`](03-quy-trinh-team.md#6-khi-một-người-bậnốm) | | Mở |
| R3 | SSH chập chờn làm hỏng run thí nghiệm giữa chừng | 🔴 | 🟡 | `run_experiment.py` đánh dấu `aborted` + tự chạy lại (tối đa 2 lần); mỗi run độc lập; ngân sách W9 có buffer retry | Nhiều `abort_reason='ssh'` trong pilot W8 | Mở |
| R4 | **Lệch đồng hồ VPS làm sai detection delay** — hỏng con số headline | 🟡 | 🔴 | Bật `systemd-timesyncd`; đo `clock_offset_ms` mỗi run; huỷ run khi lệch >2s | Offset đo được tăng dần giữa các run | Mở |
| R5 | ML service khó đóng gói trên máy lạ | 🟡 | 🟡 | Chấp nhận yêu cầu Python 3.12 trong README (ADR-010); PyInstaller chỉ thử ở W12 nếu dư | Cài thử trên máy sạch ở W10 thất bại | Mở |
| R6 | VPS provider khoá tài khoản / sự cố | 🟢 | 🔴 | Snapshot + [`08-vps-setup.md`](08-vps-setup.md) dựng lại trong 30'; CSV kết quả đã push GitHub sau mỗi run nên **mất VPS không mất dữ liệu** | Email cảnh báo từ provider, thanh toán lỗi | Mở |
| R7 | **Kết quả ML "xấu"** (F1 thấp, không hơn rule ở kịch bản nào đó) | 🟡 | 🟢 | **Không phải thảm hoạ.** Đồ án chấm phương pháp so sánh, không chấm model thắng. Báo cáo trung thực + phân tích nguyên nhân chính là insight của chương 5 ([`07`](07-giao-thuc-thi-nghiem.md#10-nếu-kết-quả-xấu)) | Pilot W8 cho F1 < 0.5 ở mọi kịch bản | Mở |
| R8 | Demo live hỏng lúc bảo vệ | 🟡 | 🔴 | 3 lớp dự phòng ([`16`](16-bao-ve-va-qa.md#2-ba-lớp-demo-dự-phòng)): VPS thật qua 4G riêng → máy ảo local → video đã quay | Wifi hội trường chập chờn lúc tập demo | Mở |
| R9 | Trễ tiến độ tổng thể | 🟡 | 🟡 | Các cổng kiểm soát + thứ tự cắt phạm vi đã chốt ([`04`](04-timeline.md)); W12 đệm | Cột "Thực tế" lệch kế hoạch >1 tuần | Mở |
| R10 | GVHD **không chấp nhận `safeStorage`**, bắt tự cài đặt AES-256-GCM đúng nguyên văn NFR-2 | 🟡 | 🟡 | M2 thiết kế 2 scheme cùng interface, `crypto_scheme` đã có sẵn trong schema → đổi tốn ~1 ngày, không lan ra module khác. **Hỏi ngay tuần 0** | Email tuần 0 chưa được trả lời | Mở |
| R11 | Mất dữ liệu thí nghiệm (35+ giờ máy mỗi VPS) | 🟢 | 🔴 | WAL + export CSV + push GitHub sau **mỗi** run; `analyze.py` chỉ đọc CSV, không đọc DB sống | Một run xong mà thư mục `results/` không có CSV mới | Mở |
| R12 | Sa đà làm đẹp UI / thêm tính năng ngoài phạm vi | 🟡 | 🟡 | Danh sách "KHÔNG LÀM" ([`01`](01-ke-hoach.md) PHẦN 8) + mức đầu tư UI đã chốt ([`02`](02-ui-ux-spec.md) mục 5); review chéo nhắc nhau | PR có tính năng không nằm trong `05-truy-vet-yeu-cau.md` | Mở |
| R13 | Không giải thích được code AI viết khi bị hỏi | 🟡 | 🔴 | Luật "không hiểu → không merge"; mỗi tuần giải thích 1 đoạn cho nhau (12 lần trước khi bảo vệ); `DECISIONS.md` làm bằng chứng | Buổi họp đầu tuần bị bỏ 2 lần liên tiếp | Mở |
| R14 | Container app bị OOM-kill lúc chạy `memory_leak` sớm hơn dự kiến → không quan sát được đoạn suy giảm dần | 🟡 | 🟡 | `mem_limit: 512m` cố định + tốc độ leak 30MB/phút đã tính để rule chạm ngưỡng ở ~11'; kiểm chứng lại trong pilot W8 và chỉnh tham số **trước** khi chạy chính thức | Pilot cho thấy container chết trước phút 15 | Mở |

---

## Rủi ro đã đóng

| # | Rủi ro | Đóng khi nào | Vì sao đóng |
|---|---|---|---|
| — | | | |

---

## Cách dùng bảng này lúc bảo vệ

Hội đồng hỏi *"nhóm em có lường trước rủi ro gì không?"* → mở đúng bảng này. Trả lời bằng một
rủi ro **đã thực sự xảy ra** và cách nhóm xử lý, tốt hơn nhiều so với liệt kê lý thuyết.
Vì vậy: cột "Tình trạng" phải được cập nhật thật trong suốt kỳ, đừng để nguyên "Mở" cả 16 tuần.
