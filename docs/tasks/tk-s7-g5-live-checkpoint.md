# TK-S7 G5-live — kiểm tra vận hành và rehearsal trên build hiện tại

**Trạng thái:** `NOT_RUN`. G5c đã giải thích sai lệch RAM UI: ảnh G4b 91% đến từ Electron cũ và không chứng minh VPS dưới ngưỡng; ba cặp refresh trên build mới khớp collector khoảng 20–21%. Không dùng lại con số 91% làm gate RAM.

## Điều kiện còn thiếu

- Hoàn tất kiểm tra vận hành chỉ đọc trên VPS: nhiều mẫu tài nguyên, process/container, pressure/OOM, disk và health của ba ứng dụng; đối chiếu kết quả `vps:get-resources`/precheck. Không tác động VPS nếu chưa qua gate.
- Chỉ khi kiểm tra vận hành đạt và precheck trong Electron đạt mới thực hiện một deploy/redeploy theo UI trên đúng build hiện tại.
- Quay liên tục từ trước Start qua pipeline, result, history và HTTP ngoài trên cùng build. Không ghép các lượt; kiểm tra MP4 không có audio track và review nội dung.
- Nếu điều kiện không đạt, dừng trước Start, ghi chính xác điểm chặn và giữ `DEMO_READY_RECORDED` với video G3 được gắn nhãn build cũ/deployment v3.

## Giới hạn

Không đổi credential/fingerprint, không chạy pilot ML, không dùng VPS thật trước khi checkpoint này được giao và gate vận hành được kiểm tra. Deployment hiện tại Git v4 cùng các app folder giữ nguyên bằng chứng đã ghi ở evidence G5.
