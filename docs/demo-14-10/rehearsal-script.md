# Kịch bản rehearsal 14/10 — G3 và G4b

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

“Gate live hiện không đạt nên tôi dừng trước Start. Tôi chuyển sang bản ghi toàn bộ thao tác thật đã diễn tập ngày 09/10/2026 trên build OpsPilot HEAD `d4506554fcb4d8b6a89fe34cdac4ac7c81cd0955`. Bản ghi dài 7:37 và không có audio track. Đây là `RECORDED_FALLBACK`, không phải phiên live; source SHA trong bản ghi được hiển thị riêng trong lịch sử deployment.”

Video dự phòng chỉ được gọi là sẵn sàng sau khi rehearsal hoàn tất, file mở lại được và thời lượng/âm thanh được kiểm tra. Nếu buổi quay không ghi đủ toàn bộ luồng, bỏ video và đánh dấu `NOT_RUN` trong evidence.


## G4 — lời dẫn khi preflight buộc dùng RECORDED_FALLBACK

Bản build hiện tại: UI source HEAD `4addec37b66a4d5145bb55fec21012fdc3acfb0c`, tree `4fa92683f89b77255ea3417131bb12e8914779e1`. Trước khi trình bày, mở Apps local Vite/Next và Deploy trên build này; ảnh tương ứng ở evidence G4. Full video fallback có thời lượng 7:37 và được phát nguyên vẹn làm phần demo đã ghi.

| Mốc trong bản ghi | Thao tác / loại bằng chứng | Lời dẫn |
|---|---|---|
| 0:00–0:35 | **RECORDED_FALLBACK** — mở trang Apps, tổng quan dịch vụ. | “Tôi sẽ trình bày bản ghi một lần deploy Git thật. Phiên này là fallback; cửa sổ ứng dụng hiện tại dùng build UI mới và cho phép chọn Git hoặc thư mục local.” |
| 0:35–1:10 | **RECORDED_FALLBACK** — mở Vite local, framework/port/exposure. | “Đây là ứng dụng từ folder trên máy, đã chạy trên VPS và được kiểm tra HTTP từ máy điều khiển.” |
| 1:10–1:45 | **RECORDED_FALLBACK** — mở Next local. | “Nguồn folder cũng hỗ trợ Next.js; route bài viết và trang chính đều đã trả HTTP 200.” |
| 1:45–2:20 | **RECORDED_FALLBACK** — mở Git Express và history. | “Ứng dụng Git dùng repo công khai, ref main và thư mục Express. Lịch sử hiện SHA đầy đủ.” |
| 2:20–3:05 | **RECORDED_FALLBACK** — Prepare snapshot và detector. | “Remote main và bản v2 đang chạy dùng cùng full SHA; lượt sau là redeploy cùng mã nguồn, không phải commit mới.” |
| 3:05–3:40 | **RECORDED_FALLBACK** — VPS precheck, source summary, Start. | “Preflight đạt ở lần ghi hình này; snapshot đã pin được dùng cho deployment.” |
| 3:40–5:35 | **RECORDED_FALLBACK** — theo dõi pipeline và health/exposure. | “Pipeline ghi nhận build, container, health và exposure. Đây là thao tác của bản ghi G3.” |
| 5:35–6:20 | **RECORDED_FALLBACK** — history v3, SHA và status. | “v3 là bản hiện hành. `running` ở v1/v2 là trạng thái lịch sử được lưu; tôi không khẳng định ba container cùng chạy.” |
| 6:20–7:00 | **RECORDED_FALLBACK** — URL ngoài cho ba app. | “Các URL Git, Vite và Next trả HTTP 200 từ máy điều khiển.” |
| 7:00–7:37 | **RECORDED_FALLBACK** — kết luận và giới hạn. | “Video này dùng build cũ và chạy lại cùng SHA. Đo G4a cho thấy MemAvailable khoảng 3,061 MiB; số 94% ở UI G4 trước đây chỉ phản ánh MemFree. Phiên mới không chạy deploy vì chưa xác nhận được precheck trong wizard Electron, nên giữ video G3 làm fallback. Push-to-deploy, HTTPS ingress, migrate sau rollback và pilot ML chưa được chứng minh.” |

G4a đo read-only lúc `2026-10-09T15:36:45.322Z`: MemFree `321,872 kB` (~314 MiB), MemAvailable `3,134,372 kB` (~3,061 MiB), disk trống `17,926 MB`. Bảy container ở trạng thái healthy/Up và OOM matches từ 01/10 là 0. Resource UI của build source commit `b69d19e34541f9c04e89875f8620044fad29c453` (app tree `d2aa94a8c56dc6cdebf8d2def7740ea45dcfc810`) hiển thị khoảng `817 MB / 3.8 GB` dùng. Dù resource gate đạt, wizard native dropdown ngăn xác minh app đích và precheck trong Electron; vì vậy live G4a là `NOT_RUN`. Không gắn video G3 với build UI mới và không nói VPS thiếu RAM.

## G4b — kết quả live trước freeze

Ngày 09/10, đường điều hướng app detail, preselect, precheck và redeploy v4 đã chạy trong Electron production build source `b69d19e34541f9c04e89875f8620044fad29c453`, tree `d2aa94a8c56dc6cdebf8d2def7740ea45dcfc810`. Tuy nhiên clip `g4b-live-rehearsal-20261009.mp4` bắt đầu sau khi v4 hoàn tất, có audio handler `soun`; clip này không phải bản ghi liên tục của lượt deploy và không được phát làm fallback.

## G4b correction 10/10 — dừng theo resource gate

Electron production build/profile G2 sau refresh hiển thị RAM dùng `3.5/3.8 GB` (91%, khoảng `0.3 GB` khả dụng theo MemAvailable), disk dùng `7/25 GB` và Docker `29.8.2`. RAM dưới ngưỡng rehearsal `1 GiB`; dừng trước Prepare, precheck và Start. Precheck/redeploy correction `NOT_RUN`, không tạo v5. Ảnh: [resource gate không đạt](evidence/g4b-correction-resource-gate-failed.png). Container ID vẫn chưa xác minh; không suy đoán.

## RECORDED_FALLBACK — video deploy G3 (7:37)

Dùng nguyên video [G3 rehearsal](evidence/g3-rehearsal-20261009.mp4), MP4 457.4 giây, source build UI cũ `d4506554fcb4d8b6a89fe34cdac4ac7c81cd0955`. Đây là bản ghi full deploy G3/v3, không phải build hiện tại hoặc deploy v4. MP4 có video handler, metadata handler `mdir`, không có audio handler; không gắn ảnh hay thông tin G4b vào video này. Các HTTP 200 trong bản ghi là kết quả ở thời điểm G3, không được mô tả như probe hiện tại.

Lời dẫn kết: “Đây là bản ghi toàn bộ một lượt deploy Git trên build OpsPilot cũ ngày 09/10; nó dài 7 phút 37 giây và không có track âm thanh. Phiên live G4b hôm nay dừng trước precheck/Start vì MemAvailable thấp hơn ngưỡng 1 GiB; app đang giữ deployment v4 đã có. Bản ghi chỉ chứng minh luồng ở build cũ. Container ID chưa xác minh; webhook, HTTPS ingress, migrate sau rollback và ML pilot chưa được chứng minh.”

## G5 — lời dẫn khi không thể xác minh tài nguyên

“Ở G5 tôi không thu được mẫu VPS mới: profile biệt lập không giải mã được khóa safeStorage, nên không tạo SSH connection đã pin. Tôi không thể kết luận nguyên nhân MemAvailable giảm hay trạng thái RAM hiện tại. Vì không chứng minh được RAM ổn định từ 1 GiB và precheck không chạy, tôi dừng trước Prepare/Start; không có redeploy mới. Clip đang phát là full deploy G3 trên build UI cũ, ghi deployment v3; app Git hiện ở v4. Ba app được giữ nguyên.”
