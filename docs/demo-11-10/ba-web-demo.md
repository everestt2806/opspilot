# Ba website để thử deploy bằng OpsPilot

Mỗi thư mục là một ứng dụng độc lập. Chọn **thư mục ứng dụng** khi deploy trực tiếp; nếu deploy từ Git, chọn root directory ghi trong bảng. Không cần mua tên miền hoặc cấu hình database cho ba lượt này.

| Thứ tự | Website | Root directory trong Git | Detector mong đợi | Sau khi deploy |
|---|---|---|---|---|
| Tối nay | Sân Nhà — đặt lịch sân | `demo-apps/san-nha-booking` | Express, cổng 3000, health `/health` | Mở URL ứng dụng, xem lịch sân |
| Ngày mai, lượt 1 | Tiệm Đọc — kệ sách | `demo-apps/tiem-doc-spa` | Vite SPA, cổng 80, health `/` | Mở URL ứng dụng, lọc sách hoặc xem chi tiết |
| Ngày mai, lượt 2 | Nhật Ký Phố — tạp chí | `demo-apps/nhat-ky-pho-next` | Next.js, cổng 3000, health `/` | Mở URL ứng dụng, vào một bài viết |

1. Tạo app mới trong OpsPilot, chọn VPS và nguồn **thư mục máy** hoặc **Git**.
2. Nếu dùng Git, điền đúng root directory ở bảng. Với Nhật Ký Phố, nhập `NODE_ENV=production` khi màn hình yêu cầu biến môi trường.
3. Giữ cấu hình detector đề xuất, chạy deploy một lượt, đợi trạng thái hoàn tất rồi bấm mở URL. Đó là đủ cho kịch bản demo cơ bản.

Ba site không dùng dịch vụ ngoài hoặc thông tin đăng nhập. Dữ liệu đặt sân của Sân Nhà chỉ nằm trong bộ nhớ tiến trình và sẽ mất khi container khởi động lại. Danh sách sách Tiệm Đọc là dữ liệu minh họa; mục đã lưu nằm trong trình duyệt đang mở. Bài viết Nhật Ký Phố là nội dung mẫu viết sẵn.

Đã kiểm tra trên máy phát triển: `npm ci`, build cho Vite/Next, start và HTTP; OpsPilot nhận đúng detector cho cả ba. Việc deploy VPS thật là bước do người dùng thực hiện sau khi nhận source.
