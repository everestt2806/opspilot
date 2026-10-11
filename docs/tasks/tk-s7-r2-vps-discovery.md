# TK-S7 R2 — Nhận diện app còn chạy trên VPS

## Mục tiêu

Khi SQLite cục bộ không còn hồ sơ app, người dùng vẫn phải thấy các container do OpsPilot triển khai trên VPS đã xác minh SSH. Kết quả là danh sách **phát hiện từ VPS**, tách khỏi app đã được quản lý trong SQLite.

## Tiêu chí nghiệm thu

- Quét read-only qua SSH với host key đã pin; không đọc `.env`, log, credential hoặc sửa trạng thái VPS.
- Chỉ nhận container có bằng chứng OpsPilot đủ chặt; giới hạn số lượng và kích thước kết quả. Container lạ không được nhận nhầm.
- UI hiển thị app phát hiện, cổng, image và trạng thái cùng nhãn rõ ràng; lỗi quét có thể thử lại. Không giả tạo lịch sử deploy, nguồn Git hay metric đã mất.
- Contract IPC, kiểm thử scanner và UI, typecheck, lint, build phải đồng bộ.
- Không push, mở PR hoặc merge. VPS thật chưa được dùng để xác nhận checkpoint này.

## Nhật ký

- START 11/10/2026: sau R1, cần đường quét từ VPS cho máy tính mới và dữ liệu đã bị xóa cứng bởi phiên bản cũ. Chọn danh sách chỉ đọc vì Docker hiện tại không mang đủ metadata để import app vào schema quản lý một cách trung thực.
- UPDATE 11/10/2026: thêm `vps:discover-apps`, scanner Docker chỉ chọn các trường/nhãn cần thiết, kiểm tra tên/image/Compose path và giới hạn đầu ra; tab VPS hiển thị ứng viên chưa có trong SQLite theo bốn ngôn ngữ, không cấp hành động quản lý. Docker thực tế chưa được quét trong checkpoint này.
- ORCHESTRATION 11/10/2026: đã thử giao scanner cho Orca Worker trên cùng worktree ba lần; cả ba lần thất bại trước khi prompt đến Worker (`agent_prompt_blocked`, rồi hai lần `agent_readiness timeout`). Các terminal tạo ra đã được release; Leader triển khai trực tiếp, không ghi nhận công lao Worker vào mã nguồn.
- HANDOFF-LOCAL 11/10/2026: Node 22.23.3, Vitest 73/73 files và 727/727 tests PASS (gồm scanner/UI); Node/Web typecheck và production build PASS; ESLint 0 error, 15 warning định dạng ở các file deploy khác đã tồn tại từ R1; `git diff --check` sạch. Docker CLI có trên máy phát triển nhưng daemon không chạy, nên lệnh format Docker thực và VPS live giữ `NOT_RUN`. Trạng thái checkpoint `CHỜ REVIEW`, không push/PR/merge.

## Bước tiếp theo

Để import thành app có thể deploy lại/rollback, pipeline cần ghi manifest **không chứa secret** trên VPS cho các lần deploy mới (định danh ổn định, framework, nguồn, cổng, phiên bản image). UI phải cho người dùng xem và xác nhận trước khi tạo hồ sơ SQLite. App cũ không có manifest chỉ được phát hiện ở chế độ đọc; không dựng lại lịch sử Git, deployment hoặc ML bằng suy đoán. Việc xác minh lệnh Docker trên VPS thật và luồng import được tách thành checkpoint R3.
