# Preflight VPS phát triển — 08/10/2026

VPS này dùng để phát triển và kiểm chứng. Người dùng dự kiến chuẩn bị VPS khác cho buổi demo 14/10. Không dùng kết quả dưới đây để đánh dấu pilot TK-S6 hoặc demo là đã chạy.

| Hạng mục | Kết quả đã kiểm chứng |
|---|---|
| Host | `160.191.243.89`, SSH user `root`, TCP 22 truy cập được |
| Xác thực host | Fingerprint RSA SHA256 đối chiếu khớp giữa console nhà cung cấp và SSH client trước đăng nhập; lưu riêng trong `opspilot_dev_known_hosts` trên máy điều khiển |
| SSH key phát triển | Tạo khóa Ed25519 riêng ngoài repo trong thư mục `.ssh` của người dùng; cài public key cho `root`, xác minh đăng nhập `BatchMode=yes`, `StrictHostKeyChecking=yes` thành công. Mật khẩu SSH hiện vẫn được bật. |
| Hệ điều hành | Ubuntu 24.04 LTS, x86_64 |
| CPU / RAM | 2 vCPU, 3916 MiB RAM; khoảng 3505 MiB available lúc kiểm tra |
| Ổ hệ thống | 25 GB, còn khoảng 21 GB sau cài Docker; **thấp hơn mốc 40 GB của pilot** |
| Đồng hồ | `System clock synchronized: yes`, NTP active, timezone UTC; chưa đo offset hai chiều |
| Docker | Docker Engine 29.8.2, Compose 5.6.0; daemon active; `hello-world` chạy thành công |
| Truy cập app ngoài | Container `nginx:alpine` tạm trên TCP 30000 trả HTTP 200 từ máy điều khiển; đã dừng và xoá container, không còn container đang chạy; cổng 30000 đóng lại sau thử nghiệm |
| UFW | Chưa cài; app hiện phân loại trạng thái này là `unknown` và bỏ qua rule UFW; external probe vẫn cần kiểm chứng trên từng app |
| Bản cập nhật OS | Sau `apt-get update`, apt báo 373 gói chưa nâng cấp. Chưa chạy nâng cấp toàn hệ thống hoặc reboot. |

## Kết luận và giới hạn

- **DEV_READY_INFRA** cho một deploy thử nhỏ; Docker, SSH và cổng 30000 đã có bằng chứng thực tế.
- **NOT_PILOT_READY**: ổ 25 GB thấp hơn yêu cầu 40 GB/VPS; mới có một VPS, chưa chạy thử tải/ML 75 phút, chưa đo độ lệch giờ theo giao thức.
- **NOT_APP_E2E_VERIFIED**: chưa tạo bản ghi VPS trong OpsPilot và chưa deploy `express-api` qua app. `SshManager.openClient()` hiện gọi `ssh2.connect()` mà không có `hostVerifier`, tức app tự chấp nhận host key theo mặc định của thư viện. Cần pin host key và test trước khi dùng app để ghi lên VPS.
- Đã thử đăng nhập root bằng khóa riêng từ máy điều khiển; mật khẩu SSH vẫn bật. Không đưa mật khẩu hoặc private key vào repo, log, tài liệu hoặc prompt Worker. Nên đổi mật khẩu đã chia sẻ trong console nhà cung cấp.

Docker được cài từ apt repository chính thức cho Ubuntu 24.04; không cài `ufw`, không sửa cloud firewall, không deploy app thật và không chạy pilot.
