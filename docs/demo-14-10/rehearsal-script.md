# Kịch bản rehearsal 14/10 — G3

**Bản nháp:** 09/10/2026. Rehearsal thật dùng Electron, profile G2 biệt lập và VPS phát triển, kéo dài 7:38 (14:52:05–14:59:43 UTC+07). Build OpsPilot tại source HEAD `d4506554fcb4d8b6a89fe34cdac4ac7c81cd0955`; không có thay đổi runtime source trong buổi diễn tập. Video dự phòng dài 7:37, không có audio stream.

## Timeline 7:30

| Mốc | Thao tác / loại bằng chứng | Lời dẫn |
|---|---|---|
| 0:00–0:35 | **LIVE_VPS** — mở trang Ứng dụng trong Electron; chỉ trạng thái tổng quan. | “OpsPilot là ứng dụng desktop nhận mã nguồn, xác định cách build, triển khai qua SSH và lưu lịch sử phiên bản. Hôm nay tôi sẽ cho thấy cả hai lựa chọn nguồn: Git và thư mục trên máy.” |
| 0:35–1:10 | **LIVE_VPS** — mở app `g2b-vite-20261009`, chỉ framework `static-spa`, port và Exposure Reachable. | “Với nguồn thư mục, Vite được nhận diện và chạy trên VPS. Đây là nguồn local đã chọn qua folder picker; máy đích chỉ nhận snapshot để build.” |
| 1:10–1:45 | **LIVE_VPS** — quay lại danh sách, mở `g2b-next-20261009`, chỉ Next.js, host/container port và Exposure. | “Cùng một luồng folder hỗ trợ Next.js. Trang và route bài viết đã được kiểm tra bằng HTTP từ máy điều khiển.” |
| 1:45–2:20 | **LIVE_VPS** — mở `g2-express-20261009`, history v2 và source Git. | “Với Git, wizard pin một snapshot theo full commit SHA; app này đang chạy từ repo công khai, nhánh main, thư mục Express. Redeploy lần này sẽ xác minh lại snapshot và ghi version mới.” |
| 2:20–3:05 | **LIVE_VPS** — bắt đầu deploy phiên bản mới từ app Git; xem URL/ref/root, Prepare và detector/plan. | “Remote main hiện vẫn ở SHA `8af16e1f9165a31557288adbc23acc420244938f`. Bản ghi đang chạy cũng dùng SHA này. Tôi không tạo commit giả; nếu remote không đổi thì đây là redeploy cùng mã nguồn.” |
| 3:05–3:40 | **LIVE_VPS** — kiểm tra VPS/precheck, xác nhận source summary rồi Start. | “Preflight còn đủ RAM và disk; cổng của app hiện tại được quản lý bởi OpsPilot. Tôi bắt đầu deploy từ snapshot vừa pin.” |
| 3:40–5:35 | **LIVE_VPS** — theo dõi các bước tải nguồn, cấu hình, build image, chạy container, health và publish. | “Pipeline đang đi qua các bước build và kiểm tra health/exposure. Mốc hoàn tất sẽ được lưu trong deployment history cùng SHA nguồn.” |
| 5:35–6:20 | **LIVE_VPS** — xem kết quả, mở history v3, đối chiếu tag/SHA/status/exposure. | “Deployment mới đã ghi nhận. Nếu SHA bằng bản trước, tôi gọi rõ là cùng SHA; version tăng không có nghĩa repo đã có commit mới.” |
| 6:20–7:00 | **LIVE_VPS** — kiểm tra ba app trong danh sách và thử HTTP từ máy điều khiển sau buổi quay. | “Git Express, Vite và Next vẫn reachable sau rehearsal. Mỗi lần chỉ đổi deployment của app Git này.” |
| 7:00–7:30 | **LIVE_VPS** — giữ màn app/history, kết luận. | “Đã chứng minh hai nguồn local folder và Git deploy thủ công. Push-to-deploy, HTTPS ingress, migrate sau rollback và pilot ML chưa được xác nhận ở checkpoint này.” |

## Chuyển sang video dự phòng khi mạng lỗi

“Kết nối VPS đang gián đoạn, vì vậy tôi dừng thao tác live tại đây. Tôi chuyển sang bản ghi toàn bộ thao tác thật đã diễn tập ngày 09/10/2026 trên build OpsPilot HEAD `d4506554fcb4d8b6a89fe34cdac4ac7c81cd0955`. Bản ghi dài 7:37 và im lặng. Đây là `RECORDED_FALLBACK`, không phải phiên live; source SHA trong bản ghi được hiển thị riêng trong lịch sử deployment.”

Video dự phòng chỉ được gọi là sẵn sàng sau khi rehearsal hoàn tất, file mở lại được và thời lượng/âm thanh được kiểm tra. Nếu buổi quay không ghi đủ toàn bộ luồng, bỏ video và đánh dấu `NOT_RUN` trong evidence.
