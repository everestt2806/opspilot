# TK-S7 G5-live — kiểm tra vận hành và rehearsal trên build hiện tại

**Trạng thái:** `BLOCKED / NOT_RUN` (2026-10-09 UTC). G5c đã giải thích sai lệch RAM UI: ảnh G4b 91% đến từ Electron cũ và không chứng minh VPS dưới ngưỡng; ba cặp refresh trên build mới khớp collector khoảng 20–21%. Không dùng lại con số 91% làm gate RAM. Đợt kiểm tra vận hành này xác minh được RAM, disk, trạng thái container qua collector và HTTP ngoài; chưa xác minh được process RSS hoặc memory pressure/OOM, vì app hiện tại không cung cấp các số liệu đó qua đường SSH đã pin. Wizard Git dừng trước precheck do thiếu `PORT` và `ENABLE_FAULT_ENDPOINTS`; không bấm Start.

## Điều kiện còn thiếu

- Trước khi thử lại, bổ sung một đường chẩn đoán chỉ đọc qua SSH đã pin hoặc provider console đã xác minh để thu process RSS và memory pressure/OOM; giữ các kết quả này cùng mẫu RAM/disk/container. Không dùng SSH không pin hoặc thay đổi dịch vụ VPS.
- Chuẩn bị wizard app Git hiện tại với các biến bắt buộc `PORT` và `ENABLE_FAULT_ENDPOINTS` hợp lệ từ cấu hình nguồn đã kiểm tra; chạy precheck trong Electron và lưu kết quả. Precheck ở lượt này là `NOT_RUN` vì wizard chặn tại bước cấu hình với thông báo thiếu hai biến trên.
- Chỉ khi mọi kiểm tra vận hành và precheck đạt mới thực hiện một deploy/redeploy theo UI trên đúng build hiện tại.
- Quay liên tục từ trước Start qua pipeline, result, history và HTTP ngoài trên cùng build. Không ghép các lượt; kiểm tra MP4 không có audio track và review nội dung.
- Nếu điều kiện không đạt, dừng trước Start, ghi chính xác điểm chặn và giữ `DEMO_READY_RECORDED` với video G3 được gắn nhãn build cũ/deployment v3.

## Kết quả đợt kiểm tra 2026-10-09 UTC

- Build Electron: `app/out`, nhánh `feat/deploy-reachability`, HEAD lúc bắt đầu `b3b784e`; dùng profile G2 hiện có. Refresh `vps:get-resources` qua SSH host key đã pin thành công; RAM UI và disk giữ ổn định ở khoảng 20–21% và 7/25 GB.

| Mẫu UTC | RAM UI | Disk UI | Collector deployment 6 cùng phút | Container | Kết quả |
|---|---:|---:|---:|---|---|
| 2026-10-09 20:38 | 807 MB / 3.8 GB (~21%) | 7 / 25 GB | host_mem_pct 20.50–20.85% | `container_up=1` | `PASS` cho chỉ số quan sát được |
| 2026-10-09 20:39 | 816 MB / 3.8 GB (~21%) | 7 / 25 GB | host_mem_pct 20.43–20.85% | `container_up=1` | `PASS` cho chỉ số quan sát được |
| 2026-10-09 20:41 | 796 MB / 3.8 GB (~20%) | 7 / 25 GB | 20:41:01Z 20.72%, 20:41:11Z 20.71% | `container_up=1` | `PASS` cho chỉ số quan sát được |

- Docker version trên VPS: 29.8.2. `vps:get-resources` trả dữ liệu trên build hiện tại. Không có trường process RSS, pressure stall information hoặc OOM counter trong màn hình/chẩn đoán Electron đã dùng; các gate đó là `NOT_VERIFIED`, không được suy diễn là sạch.
- Wizard tại App detail → **Triển khai phiên bản mới** đã ghim nguồn Git public (ref `main`, root `demo-apps/express-api`) và nhận diện Express. Sang cấu hình, wizard dừng với lỗi thiếu biến bắt buộc `PORT` và `ENABLE_FAULT_ENDPOINTS`; do đó **precheck `NOT_RUN`**. Rời wizard trước Start; không có job hoặc deployment mới và không có thay đổi VPS từ lượt này.
- HTTP từ máy điều khiển lúc `2026-10-09T20:41:53Z`: `http://160.191.243.89:30000/health` 200; `http://160.191.243.89:30001/` 200; `http://160.191.243.89:30002/` 200.
- Deploy, quay video liên tục và kiểm tra silent MP4: `NOT_RUN` vì các gate bắt buộc chưa xác minh/đạt. Giữ `DEMO_READY_RECORDED`, dùng video G3 build cũ/deployment v3 theo phiếu; không đổi kết luận hay PDF A4.

## Giới hạn

Không đổi credential/fingerprint, không chạy pilot ML, không thực hiện deploy hay thay đổi dịch vụ VPS khi các gate chưa đạt. Deployment hiện tại Git v4 cùng các app folder giữ nguyên bằng chứng đã ghi ở evidence G5.
