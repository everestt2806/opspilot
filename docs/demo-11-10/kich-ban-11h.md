# Kịch bản OpsPilot — 11:00 ngày 11/10/2026

**Mục tiêu:** trình bày trong 7 phút một sản phẩm đang chạy thật trên VPS; giữ bản ghi deploy Git làm phương án dự phòng. Mở [phiếu in A4](phieu-demo.html) cạnh máy trình chiếu. Chỉ gọi một thao tác là *live* nếu chính buổi demo vừa thực hiện và thấy kết quả.

## Chuẩn bị lúc 10:30–10:50

1. Mở OpsPilot bản production trên profile G2 và kiểm tra thấy ba app `g2-express-20261009`, `g2b-vite-20261009`, `g2b-next-20261009`. Nếu dùng profile khác, **dừng ở phần URL/video**, không thêm VPS hay nhập credential trước lớp.
2. Mở trước ba URL trong trình duyệt, giữ các tab sẵn: [Express /health](http://160.191.243.89:30000/health), [Vite SPA](http://160.191.243.89:30001/), [Next.js](http://160.191.243.89:30002/). Bấm tải lại và ghi giờ kiểm tra. Chỉ tuyên bố chúng đang chạy nếu lúc đó trả HTTP 200.
3. Mở sẵn [video G3](../demo-14-10/evidence/g3-rehearsal-20261009.mp4), kiểm tra phát được. Video dài 7:37, không có tiếng, ghi deploy Git thật trên **build cũ**, kết thúc ở **v3**. App Git trong hồ sơ hiện là **v5** sau lượt redeploy ngày 10/10 trên build hiện tại; video G3 không ghi lượt v5.
4. Nếu định bấm **Bắt đầu triển khai** trực tiếp: chỉ thực hiện sau khi chuẩn bị nguồn Git, xác minh SHA, cấu hình môi trường đã rà soát, precheck trên chính app **PASS**, và có đủ thời gian để chờ kết quả. Nếu một bước chưa đạt, dừng trước Start và dùng lịch sử + URL + video. Không nhập hoặc trình chiếu mật khẩu, private key, token, `DATABASE_URL`.
5. Không chạy migrate/rollback hoặc tiêm lỗi ML để “cho đẹp” khi chưa có lần rehearsal được xác minh trên đúng build/profile. Không thay đổi firewall/port thủ công trong buổi demo.

## Kịch bản chính — 7 phút, không phụ thuộc deploy mới

| Mốc | Thao tác trên màn hình | Lời nói ngắn |
|---|---|---|
| 0:00–0:40 | Mở OpsPilot, vào **Tổng quan**. | “OpsPilot giúp đưa ứng dụng từ máy tính hoặc kho Git lên VPS riêng, rồi theo dõi phiên bản, trạng thái và khả năng truy cập.” |
| 0:40–1:30 | Vào **Máy chủ → G2 Development VPS → Tổng quan**. Bấm làm mới tài nguyên/diagnostics nếu kết nối ổn. | “Ứng dụng kết nối VPS qua SSH với host key đã pin. Đây là số đo có thời điểm kiểm tra; nếu phần chẩn đoán chưa tải thì tôi không coi nó là số đo hiện tại.” |
| 1:30–2:35 | Vào **Ứng dụng**, mở `g2-express-20261009`, xem thông tin nguồn và tab lịch sử. Chỉ vào repo `everestt2806/opspilot`, ref `main`, root `demo-apps/express-api`, SHA và v5. | “Đây là deploy từ Git công khai. OpsPilot ghim commit SHA để biết chính xác source của phiên bản. v3, v4 và v5 dùng cùng SHA: đây là các lần redeploy, không phải commit mới hay tự động deploy khi push.” |
| 2:35–3:25 | Quay lại danh sách; mở nhanh Vite và Next, chỉ vào nguồn **thư mục máy tính** và runtime. | “Người dùng chọn được hai cách đưa source vào: Git và thư mục local. Ba template đã chạy trên VPS này là Express, Vite SPA và Next.js.” |
| 3:25–4:35 | Vào **Triển khai**; chỉ hai lựa chọn nguồn. Nếu Git Prepare hoàn tất, chỉ repo/ref/root, SHA, detector/plan; có thể đi đến precheck nếu đạt. **Không bấm Start theo mặc định.** | “Wizard nhận diện framework, tạo kế hoạch build, kiểm tra VPS và môi trường trước khi chạy pipeline. Tôi chỉ chạy deploy mới nếu các gate trên màn hình đều đạt.” |
| 4:35–5:35 | Chuyển sang ba tab trình duyệt đã mở; reload từng URL. | “Đây là kết quả bên ngoài VPS: Express health, Vite và Next. HTTP 200 tại thời điểm kiểm tra chứng minh dịch vụ truy cập được qua IP:port; đây chưa phải HTTPS hay domain tự động.” |
| 5:35–6:20 | Trở lại app, mở lịch sử/Exposure hoặc Doctor nếu có bằng chứng tương ứng; nếu không, giữ trang ứng dụng. | “Ứng dụng lưu lịch sử deployment và phân biệt trạng thái runtime với khả năng truy cập ngoài. Doctor chỉ đưa chẩn đoán/fix có điều kiện; hôm nay tôi không giả lập một sự cố chưa kiểm chứng.” |
| 6:20–7:00 | Mở phiếu A4/slide kết luận. | “Phần đã xác minh là Git manual deploy/redeploy, deploy thư mục local cho ba stack và URL truy cập ngoài. Push-to-deploy khi desktop tắt, HTTPS/domain, migrate sau rollback và pilot ML trên VPS còn cần gate thực tế; đó là các mốc tiếp theo.” |

**Nếu giảng viên yêu cầu xem thao tác deploy:** chuyển sang nhánh live chỉ khi checklist chuẩn bị đạt. Nói rõ “Tôi sẽ redeploy cùng SHA để chứng minh pipeline; không có source commit mới.” Đợi `finished`, mở history và reload `/health`. Nếu lỗi, trình bày lỗi thật, không chạy lại liên tiếp để che lỗi; chuyển video G3 với nhãn build cũ/v3.

## Trả lời nhanh khi được hỏi

- **“Giống Vercel đến đâu?”** Hai nguồn deploy và theo dõi phiên bản đã chạy trên VPS riêng; Git push tự kích hoạt khi desktop tắt, preview environment và HTTPS tự động còn trong lộ trình, chưa gọi là hoàn thành.
- **“Có phải mở port/firewall bằng tay?”** Pipeline có bước kiểm tra reachability và reconcile `ufw` có điều kiện; firewall phía nhà cung cấp và DNS có thể vẫn cần cấu hình riêng. Ba app demo hiện truy cập qua HTTP IP:port.
- **“Có tự deploy khi push Git?”** Chưa. Git hiện là manual deploy từ repository với commit SHA ghim; không đánh đồng redeploy cùng SHA với build từ commit mới.
- **“Migrate và rollback đã hoàn thiện?”** Có mô đun và luồng từng được kiểm thử, nhưng migrate sau rollback chưa qua gate cần thiết cho buổi demo này; không trình diễn hoặc tuyên bố đạt production.
- **“Có dữ liệu để phát triển ML chưa?”** Có [CSV 180 mẫu đo thực từ Express v5](ml-samples-v5-180.csv), cách nhau 10 giây, gồm năm metric đầu vào `cpu_pct`, `mem_mb`, `latency_ms`, `http_error_rate`, `db_response_ms`. Mã ở `ml-service/features.py` biến cửa sổ 20 mẫu thành vector 20 chiều; `ml-service/main.py` yêu cầu tối thiểu 150 mẫu để train. CSV này chỉ minh họa dữ liệu đầu vào, không phải run thí nghiệm chính thức hay bằng chứng mô hình đã train/đạt accuracy. Pilot ML trên VPS và đánh giá thống kê vẫn chưa được xác nhận.

## Khi mạng hoặc app không dùng được

- **VPS còn truy cập nhưng wizard không qua precheck:** trình bày kịch bản chính bằng lịch sử và ba URL; nói “precheck chưa đạt, tôi dừng trước Start”.
- **VPS hoặc OpsPilot không truy cập được:** nói “Đây là bản ghi ngày 09/10, build cũ, deployment v3; tôi không gọi nó là thao tác live hôm nay”, rồi phát [video G3 7:37](../demo-14-10/evidence/g3-rehearsal-20261009.mp4). Nếu chỉ có 7 phút, chiếu các đoạn đã gắn nhãn trong [kịch bản G3](../demo-14-10/rehearsal-script.md), và giữ video đầy đủ để đối chứng.
- **Không có quyền chiếu IP công khai:** dùng ảnh kết quả và lịch sử trong [hồ sơ bằng chứng](../demo-14-10/evidence.md); không biến ảnh thành dữ liệu live.

## Bằng chứng và giới hạn tại thời điểm soạn

- 10/10/2026 khoảng 15:09 UTC+07: ba URL Express/Vite/Next đều trả HTTP 200 từ máy điều khiển; cần kiểm tra lại trước 11:00 ngày 11/10.
- G2/G2b, G4b và G5-live C3d chứng minh deploy Git manual, redeploy cùng SHA, local Vite/Next và Git Express v5 `running/reachable`; chi tiết ở [evidence](../demo-14-10/evidence.md). C3d có precheck PASS, deploy v5 hoàn tất và ba URL HTTP 200 sau deploy, nhưng video mới dừng trước Start nên **không có bản quay liên tục cho v5**. G5 C2d chứng minh RAM, PSI, OOM và collector ổn tại thời điểm đã ghi; lượt C3d chỉ có một mẫu chẩn đoán, chưa xác minh xu hướng OOM/collector cùng phút. Những lần đo này không bảo đảm tình trạng ngày mai.
- [ml-samples-v5-180.csv](ml-samples-v5-180.csv) là 180 dòng đo thực được SELECT chỉ đọc từ bảng `metric_sample` của SQLite profile G2, deployment 7 (Express v5), `seq` 9118–9297, 07:42:34–08:12:24 UTC ngày 10/10/2026. CSV chỉ chứa timestamp và metric, không chứa bảng `vps`, credential hoặc raw JSON. Mọi dòng có `container_up=1`, năm metric không NULL, `http_error_rate=0`, khoảng cách đúng 10 giây. Đây là đoạn mẫu để giải thích pipeline feature/train; bảng `experiment_run` của profile này chưa có run chính thức và `experiments/results/` chưa có CSV xuất từ một pilot hoàn chỉnh.
- Build hiện tại sau C3a (`b035bae`, hồ sơ `f68018c`) có 72 file/712 Vitest tests PASS, typecheck Node/Web/Scripts và build PASS. Gate này chứng minh kiểm thử local, không thay thế precheck hoặc redeploy trên VPS.
- Mốc demo 11/10 thay thế mọi mốc “14/10” trong tài liệu demo cũ. Không dùng phiếu A4 cũ đề ngày 14/10 khi trình bày.
