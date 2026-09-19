# KẾ HOẠCH CHỐNG LỖI CHO DEMO OPSPILOT

## Việc phải hoàn tất trước demo

1. **Mở port `30001/TCP` inbound cho VM02 (221.121.1.80) trong trang quản lý firewall của nhà cung cấp WiService.** Đây là port Next.js sẽ nhận sau Express. Đã xác minh trong rehearsal 15-16/09: app trên VPS healthy (loopback 200) nhưng bên ngoài vào port 30001 bị timeout, trong khi 30000/30002 mở bình thường — firewall nhà cung cấp đang chặn đúng port này. Nên mở luôn cả dải `30000-30040/TCP` trên cả VM02 và VM01 để khỏi vướng lại khi số app tăng.
2. Mở OpsPilot và thêm lại cả hai VPS (DB local đã reset về trống): VM01 và VM02.
3. Chạy `02-KIEM-TRA-TRUOC-DEMO.cmd`.
4. Chỉ bắt đầu demo khi SSH của cả VM01 và VM02 đều PASS.
5. Deploy lần lượt Express, Next.js, Vite. Không bấm chạy đồng thời.
6. Sau khi cả ba app chạy, chạy lại preflight và chụp kết quả PASS.

Lưu ý cấp port: với hai VPS vừa dọn sạch, OpsPilot cấp port tuần tự từ 30000 — Express `30000`, Next.js `30001`, Vite `30002`. Nếu port cấp thực tế khác (xem màn Review), đối chiếu lại URL trước khi trình bày.

## Đường chính: public port

Nếu preflight báo public endpoint là `HTTP 200`, dùng URL OpsPilot cấp. Với hai VPS vừa dọn sạch, thứ tự port sẽ là:

```text
Express: http://221.121.1.80:30000
Next.js: http://221.121.1.80:30001
Vite:    http://221.121.1.80:30002
VITE_API_URL=http://221.121.1.80:30000
```

Đây là đường nên dùng khi trình bày chính thức.

Nếu đúng port `30001` timeout từ ngoài (mở bằng trình duyệt không được) nhưng 30000/30002 vẫn vào bình thường: đó là port WiService chưa mở — app vẫn healthy trên VPS. Chưa mở được port thì chuyển sang đường tunnel dưới đây cho riêng Next.js, các app khác vẫn dùng public URL.

## Đường dự phòng: SSH tunnel

Nếu container healthy nhưng public endpoint timeout:

1. Chạy `03-MO-DUONG-DU-PHONG.cmd`.
2. Giữ cửa sổ đó mở suốt buổi demo.
3. Dùng URL tunnel được in ra màn hình.

Quy tắc ánh xạ hiện tại (VM02 vừa dọn sạch, cấp port tuần tự từ 30000):

```text
VM02 port 30000 (Express) -> http://127.0.0.1:33000
VM02 port 30001 (Next.js) -> http://127.0.0.1:33001
VM02 port 30002 (Vite)    -> http://127.0.0.1:33002
VM01 port 30000           -> http://127.0.0.1:34000
VM01 port 30001           -> http://127.0.0.1:34001
```

Sau khi deploy hoặc migrate thêm app, đóng cửa sổ tunnel và chạy lại file để nó đọc danh sách app mới.

Nếu phải deploy Vite bằng đường dự phòng, nhập URL tunnel Express đang chạy, ví dụ:

```text
VITE_API_URL=http://127.0.0.1:33000
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
