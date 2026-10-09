# Kịch bản demo 14/10 — `DEMO_READY_RECORDED`

**Trạng thái:** Leader đã chấp nhận phương án recorded làm dự phòng. G5c giải thích số 91% là UI từ Electron cũ; ba lần refresh trên build hiện tại khớp collector khoảng 20–21%, và `vps:get-resources` hoạt động. Live rehearsal vẫn `NOT_RUN` vì chưa hoàn tất các kiểm tra vận hành và chưa có video deploy liên tục trên build mới. Dùng nội dung dưới đây để trình bày video G3 đúng phạm vi và phân biệt với trạng thái G4b.

## Bằng chứng video

- Video đầy đủ: [G3 rehearsal](evidence/g3-rehearsal-20261009.mp4), dài `7:37` (`457.4s`), không có audio track.
- Video ghi một lần deploy Git trên build UI cũ `d4506554fcb4d8b6a89fe34cdac4ac7c81cd0955`, deployment `v3`. Đây không phải build hiện tại hoặc deployment hiện hành.
- App Git hiện được xác nhận gần nhất ở deployment `6/v4`; bằng chứng HTTP ngoài từ G4b ngày 09/10 được lưu riêng trong [evidence](evidence.md). Không ghép các kết quả đó với video G3 thành một lượt rehearsal.
- Giữ nguyên file video đầy đủ làm bản đối chứng. Khi chọn lịch 6–8 phút, tua đến các đoạn ghi rõ bên dưới; gọi rõ là **trích đoạn G3 không liên tục**.

## Phương án A — chiếu toàn bộ video (khoảng 10–12 phút)

| Thời gian | Nội dung và lời dẫn |
|---|---|
| 0:00–1:30 | Giới thiệu hai nguồn: Git và thư mục local qua Vite/Next. Nói rõ đây là bản ghi G3 trên build cũ. |
| 1:30–9:07 | Phát nguyên video G3 `7:37`. Bản ghi cho thấy Git deploy, history v3 và các màn hình hai loại nguồn. |
| 9:07–10:45 | Phân biệt build cũ/v3 trong video với app Git v4 đã được xác nhận riêng ở G4b. HTTP 200 là bằng chứng ngày 09/10, không phải probe trong buổi demo. |
| 10:45–11:30 | Kết luận: G5c đã xác minh refresh RAM UI/collector khoảng 20–21%; ảnh 91% là từ Electron cũ, không chứng minh VPS dưới ngưỡng. Live chưa chạy vì còn thiếu kiểm tra vận hành và video liên tục trên build mới; giữ nguyên app. Nêu các giới hạn push-to-deploy, HTTPS ingress, migrate sau rollback và ML pilot chưa được chứng minh. |

## Phương án B — trình bày 6–8 phút bằng trích đoạn có nhãn

Giữ tổng thời lượng khoảng `7:30`; không phát video đầy đủ trong phương án này.

| Thời gian | Nội dung |
|---|---|
| 0:00–1:00 | Nêu hai kiểu nguồn và cảnh báo: video sau đây là trích đoạn G3 trên build cũ, deployment v3. |
| 1:00–1:35 | Phát đoạn `0:00–0:35` của G3: danh sách ứng dụng. Nhãn trên màn hình: **TRÍCH ĐOẠN G3 · BUILD CŨ · KHÔNG LIÊN TỤC**. |
| 1:35–2:10 | Phát đoạn `1:45–2:20`: app Git và source. Không gọi trạng thái trong video là trạng thái hiện tại. |
| 2:10–4:05 | Phát đoạn `3:40–5:35`: pipeline deploy đã ghi trong G3. Nhắc đây là deployment v3 trên build cũ. |
| 4:05–4:50 | Phát đoạn `5:35–6:20`: history v3. |
| 4:50–6:10 | Đối chiếu bằng chứng G4b ngày 09/10: app Git v4 và HTTP ngoài 200; Git Express, Vite, Next. Không trình bày đó là một phần của video G3. |
| 6:10–7:30 | Kết luận: ba mẫu G5c trên build mới khớp collector khoảng 20–21%; ảnh 91% là UI Electron cũ. Live vẫn `NOT_RUN` vì chưa hoàn tất kiểm tra vận hành và chưa có video deploy liên tục trên build mới; giữ `DEMO_READY_RECORDED`. Video đầy đủ 7:37 vẫn có sẵn để đối chứng. |

Các đoạn video cộng lại khoảng `3:50`; tổng lịch trình gồm lời dẫn khoảng `7:30`. Nếu không thể phát các đoạn với nhãn rõ, chọn Phương án A và dành đủ 10–12 phút.

## Lời dẫn giới hạn G5

“Video vừa xem ghi một lượt deploy Git thật trên build UI cũ và kết thúc ở deployment v3. App Git hiện tại là deployment v4, có bằng chứng HTTP riêng từ ngày 09/10. Ảnh 91% trước đây đến từ tiến trình Electron cũ; trên build mới, ba mẫu UI khớp collector khoảng 20–21%. Hôm nay không diễn tập live vì các kiểm tra vận hành chưa hoàn tất và chưa có video liên tục trên build mới. Tôi giữ phương án recorded đã được chấp nhận và không gộp hai bộ bằng chứng.”
