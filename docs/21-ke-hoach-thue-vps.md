# KẾ HOẠCH THUÊ VPS — RẺ NHẤT & TỐI ƯU

> Nguồn sự thật cho việc thuê/dùng VPS của toàn bộ đồ án. Bổ sung cho
> [`08-vps-setup.md`](08-vps-setup.md) (RUNBOOK dựng máy từ đầu). `08` nói **cấu hình
> nào**, file này nói **thuê thế nào để tốn ít nhất**.
>
> Chốt ngày 18/08/2026; **cập nhật 19/08/2026: chuyển provider sang WiService (VN)** theo
> DECISIONS.md. Cập nhật tiếp khi có giá thật của snapshot/region.

---

## 1. Vấn đề cần giải

Timeline `04` kéo dài 14+ tuần, và `08` yêu cầu **2 VPS cùng provider/gói/region**, mỗi máy
**2 vCPU · 4GB RAM · 40GB SSD**. Nếu trả tiền trọn 4 tháng cho cả 2 máy ở provider giá thị
trường (Vultr/DO ~$24/tháng/máy) thì tốn hàng trăm USD — trong khi thực tế nhóm **không dùng
VPS liên tục**: chỉ bật khi dev, thí nghiệm và demo.

Mấu chốt tiết kiệm không nằm ở việc hạ cấu hình (xem mục 2), mà ở việc **chọn provider tính
theo giờ + dùng snapshot để tắt máy khi không cần**.

---

## 2. Vì sao KHÔNG xuống gói 1 vCPU · 2GB

| Hạng mục | Tải thật trên VPS lúc thí nghiệm | 1 vCPU · 2GB |
|---|---|---|
| App thí nghiệm `express-api` (`mem_limit: 512m`) | ~512MB | ✅ vừa |
| PostgreSQL (nếu `needsDb`) | ~200–400MB | cộng dồn |
| Collector (`mem_limit: 128m`) | ~50MB | cộng dồn |
| OS + Docker daemon + containerd | ~700–900MB | cộng dồn |
| **Tổng steady-state** | **~1.7–1.9GB** | ⚠️ cận trần |
| **Build Next.js** | cần ≥2GB một mình | ❌ OOM |

- Một core: `cpus: 1.0` của app phải chia sẻ core duy nhất với collector/daemon → `cpu_pct` và
  `latency_ms` nhiễu, làm bẩn 2/5 feature, phá hỏng con số detection delay (headline của chương 5).
- Tiết kiệm chỉ ~€1–2/tháng so với 2 vCPU·4GB → không bù nổi rủi ro phải chạy lại 50 run.

**Kết luận: giữ 2 vCPU · 4GB.** Tiết kiệm bằng cách khác, không hạ cấu hình.

---

## 3. Provider chốt: WiService (Việt Nam)

| Hạng mục | Giá trị |
|---|---|
| Gói | Preset **Cheap 2** — 2 vCPU · 4GB RAM · 40GB SSD · 1 IPv4 · 0 backup · 0 snapshot mặc định |
| Giá | CPU 2 core **30.000₫** + RAM 4GB **20.000₫** + SSD 40GB **28.000₫** + IPv4 **3.000₫** → **81.000₫/tháng/máy** chưa VAT 10% (≈ $3.2) |
| Hình thức | **Tính theo giờ** (~111₫/h) — dùng theo đợt; xoá máy là ngừng tốn tiền |
| Snapshot | 0–7 cái/máy, ~**4.000₫/cái/tháng** — mở đúng 1 cái/máy sau nghiệm thu, giá không đáng tiết kiệm |

Lý do chọn (quyết định 2026-08-19, xem `DECISIONS.md`): (1) DC trong nước → ping thấp từ máy
dev, upload build nhanh và `clock_offset_ms` nhỏ hơn hẳn so với DC châu Âu; (2) rẻ hơn phương án
Hetzner một chút và không phải verify danh tính; (3) tính theo giờ khớp đúng nhịp "dùng theo đợt".

### Các phương án thay thế

| Provider | Gói | Cấu hình | Giá | Nhận xét |
|---|---|---|---|---|
| Hetzner CX22 | CX22 | 2 vCPU · 4GB · 40GB · 20TB | ~€4.4/th | **Plan B chính** — cùng cấu hình, có snapshot giá rõ ràng; đổi nếu WiService thiếu snapshot hoặc không ổn định |
| Hetzner CAX11 (ARM) | CAX11 | 2 vCPU ARM · 4GB | ~€3.3/th | **ARM**: Docker image phải build `arm64`, dễ vướng build Next.js/pg. Chỉ dùng nếu xác nhận được mọi image build arm OK |
| RackNerd | 4GB | 3 vCPU · 4GB · 60GB · 7TB | $59.99/năm ≈ $5/th | Trả trọn năm + DC chủ yếu Mỹ (ping cao từ VN). Không hợp dùng theo đợt |
| Contabo VPS | 2 vCPU · 4GB | 2 vCPU · 4GB | ~€4–5/th | Hay bị oversold (CPU yếu hơn chỉ số), có phí setup. Dự phòng xa |

---

## 4. Lịch dùng máy theo timeline (ước lượng)

Giá 89.100₫/máy/tháng đã gồm VAT 10%; 2 máy = **178.200₫/tháng**, cộng ~8.000₫/tháng cho
1 snapshot/máy.

| Giai đoạn | Tuần | Nhu cầu | 2 máy × thời gian bật | ~Chi phí |
|---|---|---:|---:|
| Dev + deploy + soak | W2–W5 | Deploy 3 framework, fault, soak 24h | ~3 tuần | ~125.000₫ |
| Migrate + thí nghiệm | W6–W9 | Migrate 2 VPS, 50 run (~35h/VPS) | ~5 tuần | ~205.000₫ |
| Demo + bảo vệ | W10–W15 | Bật từng buổi, khôi phục snapshot | lẻ tẻ | ~45.000₫ |
| **Tổng cả đồ án** | | | | **~375.000₫ ≈ $15** |

> Con số là ước tính để lên ngân sách. Chi phí thực theo dõi qua bảng ở mục 0 của
> `08-vps-setup.md` (cột "hết hạn thanh toán").

---

## 5. Trình tự hành động

1. **W2 (tuần này):** tạo **cả 2 máy Cheap 2** cùng datacenter (`08` mục 0 chốt 2 VPS, gate G0
   cần snapshot sạch cả 2). Chọn Ubuntu 24.04, ghi IP/provider/DC vào bảng mục 0 của `08` ngay.
   Cài theo `08-vps-setup.md`, chạy đủ 6 lệnh nghiệm thu trên mỗi máy.
2. **Snapshot ngay khi cấu hình xong** cả 2 máy (tên `opspilot-clean`); ghi giá snapshot thật
   vào bảng mục 0 — từ lần sau tạo lại chỉ mất vài phút.
3. **Cuối W2 về sau:** bật khi cần, **xoá máy khi nghỉ dài ngày** (tính theo giờ, xoá là ngừng
   tốn tiền; snapshot vẫn còn để tạo lại).
4. **W6:** mọi máy tạo lại từ snapshot phải cùng gói + cùng DC với máy còn lại (điều kiện so
   sánh 2 VPS hợp lệ trong `analyze.py`, xem `07-giao-thuc-thi-nghiem.md` mục 9.3).
5. **W14 (bảo vệ):** khôi phục snapshot, deploy trước app memory-leak ≥40 phút để model train
   xong trước giờ demo.

---

## 6. Ràng buộc không được quên

- 2 máy phải **cùng provider, cùng gói, cùng region** — bắt buộc cho thí nghiệm.
- Không để máy chạy lãng phí khi không có việc: đây chính là nguồn tốn kém lớn nhất.
- Ghi IP/provider/region/ngày tạo/snapshot vào bảng ở mục 0 của `08-vps-setup.md` ngay sau mua.
- Không commit private key/credentials lên repo (đã chặn trong `.gitignore`).
