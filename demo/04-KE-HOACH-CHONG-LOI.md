# KẾ HOẠCH CHỐNG LỖI CHO DEMO OPSPILOT

## Việc phải hoàn tất tối nay

1. Trong trang quản lý VPS, cho phép inbound TCP `30024-30040` trên cả VM02 và VM01.
2. Mở OpsPilot và thêm lại VM01. Profile hiện tại mới có VM02 nên chưa thể migrate.
3. Chạy `02-KIEM-TRA-TRUOC-DEMO.cmd`.
4. Chỉ bắt đầu rehearsal khi SSH của cả VM01 và VM02 đều PASS.
5. Deploy lần lượt Express, Next.js, Vite. Không bấm chạy đồng thời.
6. Sau khi cả ba app chạy, chạy lại preflight và chụp kết quả PASS.

## Đường chính: public port

Nếu preflight báo public endpoint là `HTTP 200`, dùng URL OpsPilot cấp:

```text
Express: http://221.121.1.80:<port-express>
VITE_API_URL=http://221.121.1.80:<port-express>
```

Đây là đường nên dùng khi trình bày chính thức.

## Đường dự phòng: SSH tunnel

Nếu container healthy nhưng public endpoint timeout:

1. Chạy `03-MO-DUONG-DU-PHONG.cmd`.
2. Giữ cửa sổ đó mở suốt buổi demo.
3. Dùng URL tunnel được in ra màn hình.

Quy tắc ánh xạ hiện tại:

```text
VM02 port 30024 -> http://127.0.0.1:33024
VM02 port 30025 -> http://127.0.0.1:33025
VM02 port 30026 -> http://127.0.0.1:33026
VM01 port 30000 -> http://127.0.0.1:34000
```

Sau khi deploy hoặc migrate thêm app, đóng cửa sổ tunnel và chạy lại file để nó đọc danh sách app mới.

Nếu phải deploy Vite bằng đường dự phòng, nhập URL tunnel Express đang chạy, ví dụ:

```text
VITE_API_URL=http://127.0.0.1:33024
```

Không nói public access đã PASS khi đang dùng tunnel. Có thể trình bày: “Ứng dụng đã healthy trên VPS; mạng nhà cung cấp đang giới hạn public port nên tôi dùng SSH local forwarding đã mã hóa để mở giao diện.”

## Trình tự kiểm tra Express

1. Mở trang chính.
2. Xác nhận `PostgreSQL` và `1000` records.
3. Tạo `MARKER-DEMO-1409`.
4. Reload và xác nhận marker còn tồn tại.
5. Mở `/health`: HTTP 200, `ok=true`.
6. Mở `/meta`: runtime Node, storage PostgreSQL.
7. Ghi lại URL Express trước khi sang bước Vite.

## Sáng mai, trước khi thầy đến

1. Bật cả hai VPS và đợi SSH hoạt động.
2. Chạy `02-KIEM-TRA-TRUOC-DEMO.cmd`.
3. Nếu public port FAIL, mở ngay `03-MO-DUONG-DU-PHONG.cmd`.
4. Mở sẵn OpsPilot, tài liệu `00-BAT-DAU-DEMO.md` và ba thư mục source.
5. Không update dependency, pull code hoặc reset VPS sát giờ demo.

## Tiêu chí GO/NO-GO

Chỉ bắt đầu demo live khi:

- VM01 SSH PASS.
- VM02 SSH PASS.
- Docker trên hai VPS PASS.
- Express health PASS bằng public URL hoặc tunnel dự phòng.
- PostgreSQL trả đúng marker.
- Ba thư mục source trong `demo\sources` còn đủ.

Nếu một mục chưa PASS, dùng rehearsal đã chuẩn bị để sửa trước khi bắt đầu, không vừa trình bày vừa dò lỗi.
