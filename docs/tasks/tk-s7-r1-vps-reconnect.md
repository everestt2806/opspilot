# TK-S7 R1 — Giữ app khi gỡ và kết nối lại VPS

## Vấn đề

Trước 11/10/2026, `vps:delete` xóa bản ghi `vps` khỏi SQLite. Khóa ngoại `app.vps_id ON DELETE CASCADE` kéo theo xóa app, deployment, metric, score, alert và cấu hình giám sát. Container trên VPS vẫn chạy, nhưng OpsPilot mất toàn bộ liên kết cục bộ.

## Mục tiêu và phạm vi

- Gỡ VPS khỏi danh sách quản lý, giữ nguyên dữ liệu cục bộ của app và dữ liệu vận hành; không gửi lệnh xóa container hoặc file tới VPS.
- Thêm lại đúng host, cổng SSH và fingerprint SHA256 thì khôi phục VPS ID cũ, app và lịch sử. Credential mới thay credential cũ; credential của hồ sơ đã gỡ được xóa khỏi DB.
- Khác host, cổng hoặc fingerprint thì tạo hồ sơ mới, không nhận nhầm app. Nhiều hồ sơ cũ cùng identity phải dừng để xử lý thủ công.
- Poller và danh sách app không truy cập VPS đã gỡ. Chặn gỡ khi deploy, migrate hoặc thí nghiệm còn hoạt động.
- Không đổi payload của các kênh IPC hiện có; cập nhật ý nghĩa `vps:delete` trong contract và UI bốn ngôn ngữ.

## Giới hạn cần phát triển tiếp

Migration 008 chỉ bảo vệ dữ liệu từ thời điểm cài bản mới. Bản ghi đã bị phiên bản cũ xóa cứng, hoặc nằm trong SQLite trên máy tính khác, không thể dựng lại lịch sử từ database hiện tại. Muốn nhận diện app đang chạy trong trường hợp đó cần checkpoint riêng: quét read-only Docker/Compose trên VPS, xác minh app thuộc OpsPilot rồi cho người dùng đối chiếu và import; không được tự bịa nguồn Git, phiên bản hay dữ liệu ML đã mất.

## Nhật ký

- START 11/10/2026: tái hiện đường xóa cứng và `ON DELETE CASCADE`; chọn soft archive trong SQLite migration 008 để giữ nguyên FK và ID của app/deployment.
- UPDATE 11/10/2026: hoàn tất repository, migration, IPC disconnect, monitor filter, UI copy và test tái kết nối.
- HANDOFF-LOCAL 11/10/2026: 72/72 Vitest files, 719/719 tests PASS; typecheck Node/Web PASS; production build PASS; ESLint toàn app 0 error, 15 warning định dạng đã có sẵn trong các file deploy không sửa; ESLint các file thay đổi 0 error/0 warning; `git diff --check` sạch. Chưa chạy luồng gỡ/thêm lại trên VPS thật; giữ trạng thái CHỜ REVIEW và không push/PR/merge.
