# Sân Nhà — Express

Trang đặt lịch sân nhỏ để thử vòng deploy ngắn: mở web, đổi ngày, chọn giờ và giữ một lượt. Lịch giữ trong bộ nhớ của tiến trình; khởi động lại app sẽ trả lịch về trạng thái ban đầu. Không cần database, tài khoản hay biến môi trường.

## Chạy trên máy

```bash
npm ci
npm start
```

Mở `http://localhost:3000/`; kiểm tra health ở `http://localhost:3000/health`. Có thể đổi cổng bằng `PORT=3001` trên Linux hoặc `$env:PORT=3001` trên PowerShell.

## Deploy bằng OpsPilot

Chọn **thư mục local** `demo-apps/san-nha-booking` hoặc **Git** với root directory cùng đường dẫn. Detector phải báo **Express**, container port **3000**, healthcheck `/health`, không yêu cầu DB. Giữ giá trị cổng public do OpsPilot cấp; sau khi hoàn tất, mở URL app rồi chọn một khung giờ để thử. Không cần cấu hình env.

Trang này là dữ liệu demo, không nhận thanh toán hoặc lưu lịch lâu dài.
