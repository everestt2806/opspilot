# Đánh giá mốc 25/11 — cập nhật 18/11/2026

UPDATE18/11 UX2a — Runtime1+2 ready thật; controller mới đã cài trên1 (systemd/API
ready),2 làm đích. App có1nút chuẩn bị và controller wizard tự gọi trước install.
Full2779+2existingLinuxSKIP/build/native PASS; chưa app deployment trên máy mới.
Tiếp guided folder/Git→website/E4b, giữ các công việc còn mở theo lịch dưới đây.

Đây là dự báo công việc, không phải chứng nhận hoàn thành. Deadline toàn dự án
hiện hành vẫn 04/12; user hỏi khả năng xong toàn bộ trước25/11. Với các khoảng trống
đã ghi ở release master/board, chưa đủ cơ sở cam kết xong toàn bộ vào25/11.
Mục tiêu khả thi hơn là bản ứng viên demo trọn các luồng chính, sau đó tiếp tục
hoàn thiện những phần chưa đạt thay vì mô tả chúng là đã hoàn tất.

## Trạng thái có bằng chứng

- Git deploy Express/SPA/Next, tự cập nhật khi desktop ngắt, rollback, ENV và
  PostgreSQL đã có kiểm chứng lab/VPS cũ. Máy cũ hết hạn; không suy máy mới đã chạy.
- Nhận lại dự án/đọc bảng PostgreSQL có Main/IPC/UI và candidate đã push e353c1f;
  chưa nghiệm thu đủ actual GUI với controller mới trên VPS mới.
- Windows installer/ML runtime đã có kiểm chứng trên máy phát triển; lane Kim
  K1/K2/K3 cần bằng chứng cập nhật từ máy của Kim. Không tự coi là clean-machine PASS.
- Formal ML pilot/batch/thống kê, Product backup/restore/migrate, đủ direct/Git
  parity, HTTPS vận hành/renewal, soak và tổng duyệt release còn mở theo master.
- Hai máy1+2 hiện khả dụng: Ubuntu24.04/x64/glibc2.39,2CPU/~4GBRAM/~80GBdisk;
  chưa Docker/controller. Máy3+4 thuộc Kim, không tự dùng làm hạ tầng ML.

## Thứ tự triển khai hướng đến trải nghiệm người dùng

| Thời gian dự kiến | Công việc / đầu ra kiểm chứng | Owner |
|---|---|---|
| 18–19/11 | UX1 thêm VPS bằng IP/password, tự pin; cài Docker/controller qua luồng có sẵn, deploy trên máy mới; gỡ/thêm lại nhận đúng app và database | Sơn |
| 20–21/11 | Chạy hết hành trình trực tiếp và Git cho template đã hỗ trợ; ENV/DB chỉ hỏi dữ liệu thật sự cần, auto deploy/rollback có kết quả rõ ràng; sửa lỗi gây mất luồng demo | Sơn |
| 22–23/11 | Ưu tiên backup/restore và migrate2máy, kiểm bảo toàn dữ liệu và đường lỗi; HTTPS khi đủ domain/quyềnDNS. Tính năng chưa đạt không được trình bày như đã hỗ trợ | Sơn |
| Song song | K1 package/K2 Windows riêng/K3 CI-hướng dẫn theo nhánh và phạm vi đã giao; bàn giao SHA/evidence để tích hợp cuối | Kim |
| 24/11 | Ghép bản đã review, full regression/build/installer và kiểm thử tự động qua đêm; ngừng thêm tính năng để sửa lỗi phát hành | Sơn + Kim |
| 25/11 | Chạy3lần demo8–10phút có đo giờ; chốt candidate, dữ liệu mẫu, hướng dẫn và danh sách giới hạn thực tế | Sơn + Kim |

Lịch trên là mục tiêu cần cập nhật theo kết quả từng ngày. Backup/migrate/HTTPS và
formalML có thể vượt mốc25; không giảm gate hoặc đổi tên một phần backend thành
feature hoàn chỉnh để giữ lịch. Sau25 vẫn tiếp tục đến04/12 theo backlog đã chốt.

Luồng khóa SSH đổi sau khi cài lại VPS cũng cần một hành động xác nhận rõ trong
app. UX1 hiện dừng an toàn khi khóa đã biết không khớp; chưa cung cấp key-rotation
wizard. Không hướng dẫn người dùng sửa SQLite hoặc tắt kiểm tra khóa để vượt lỗi.

## Tiêu chí “demo trọn luồng”

1. Thêm VPS bằng IP/password, app tự xử lý bước kỹ thuật thông thường. Không yêu cầu
   console/SHA256 ở đường mặc định. Fingerprint thủ công nằm trong nâng cao.
2. Chọn thư mục hoặc repo/branch, app tự nhận framework/build/start/port. Chỉ hỏi
   ENV/domain nếu ứng dụng cần. Quyền/cài đặt có tác động phải giải thích bằng tác dụng.
3. Deploy xong mở đúng web; trạng thái phân biệt app healthy với public URL bị chặn.
4. Git update tự deploy khi desktop đóng; bản lỗi giữ/khôi phục bản khỏe, UI giải thích.
5. Database có dữ liệu thật; bỏ/thêm lại VPS nhận lại đúng app/DB, không bắt tạo lại.
6. Chỉ demo backup/migrate/HTTPS/ML bằng luồng đã được nghiệm thu. Có phương án dự
   phòng mạng nhưng phân biệt rõ video với chạy trực tiếp.

## Các việc app phải tự gánh

Tự lấy/ghim host key, phát hiện prerequisite, nhận framework, cấp port, reconcile
firewallOS trong quyền đã cấp, healthcheck/probe, theo dõi progress và đề xuất xử lý.
Nếu firewall nhà cung cấp không có API/quyền, SSH bị chặn ngay từ ngoài hoặc cần
quyền sở hữu domain thì báo đúng một bước người dùng cần làm; không yêu cầu thao tác
thủ công giả định trước khi xác định blocker. Không hứa mở được cloud firewall
không có quyền. Không hiện hash/requestUUID hoặc thuật ngữ nội bộ trong luồng chính.

## Checkpoint kế tiếp: UX2 — một hành trình triển khai

Đầu ra cần là tính năng người dùng dùng được. Không thêm một trang hướng dẫn buộc
người dùng tự chạy từng CLI thay cho tích hợp. UX1 chỉ giải quyết phần thêm VPS,
chưa chứng minh toàn hành trình tự động bên dưới đã có trên UI.

| Người dùng làm | App tự xử lý / điều kiện nghiệm thu |
|---|---|
| Chọn VPS hoặc nhập IP/password | Kiểm kết nối, ghi nhớ server, xác định prerequisite; không hỏi SHA256 ở luồng chính |
| Cho phép chuẩn bị máy một lần | Cài Docker/Compose hoặc controller khi cần qua services/journals đã có; không cài lại thành phần đang tốt; progress và retry/resume cùng intent |
| Chọn thư mục hoặc repo/branch | Giữ đủ hai nguồn, auto detect/build/start/port/health; cấu hình thủ công nằm nâng cao |
| Nhập ENV cần thiết, chọn DB nếu app cần | Mô tả theo công dụng; chuẩn bị/chọn đúng instance, không yêu cầu người dùng nhớ DB UUID/receipt/generation |
| Bấm triển khai | Chạy source→build→activate→health→publish; tự reconcile firewall trong quyền được cấp; mất phản hồi hiển thị đang đối soát, không gửi lại job tùy ý |
| Mở website | Nút mở URL thật, trạng thái rõ app đang chạy/chưa truy cập ngoài; log kỹ thuật có thể mở khi cần |
| Push Git ở lần sau | Tự deploy trên VPS khi desktop đóng, UI nhận lại kết quả sau reconnect; rollback giữ DB và có thông báo dễ hiểu |

Giữ mọi kiểm tra ownership/lease/authority ở Main/controller; đơn giản hóa phần
người dùng phải thao tác, không xóa guard để rút bước. Trước khi viết UX2 cần map
đúng services/contracts đang có và chọn một orchestration path, tránh tạo pipeline
song song không có recovery. Native/Electron acceptance phải đi đúng luồng mặc
định như người mới; advanced/CLI chỉ là đường điều tra lỗi.

FormalML: hai máy1+2 đã có, nhưng vẫn phải đối chiếu provider/cấu hình/clock và
đặt riêng khoảng thời gian không có workload app khi đo. Không lấy việc đã SSH
được làm bằng chứng pilot/batch đã đạt; không dùng máy3+4 của Kim nếu chưa được giao.

## Điểm cần khóa mỗi ngày

- SHA đã push và luồng nào đã chạy thật; không chỉ báo số unit test.
- Lỗi nào đang chặn hành trình người dùng, ai xử lý, cách tái hiện.
- Phần chưa đủ bằng chứng chuyển sang danh sách phát triển tiếp; không gọi toàn bộ
  sản phẩm production-complete khi còn thiếu dữ liệu ML/soak/delivery.
