# C04 — Website demo để thầy tự thấy nhanh, chậm và dữ liệu được giữ

## Đầu vào

C03 APPROVED. Đọc `demo-apps/express-api/README.md`, server/public hiện có, M12 và API thực
tế `/items`, `/meta`, `/health`. Xác minh shape dữ liệu trước làm UI; không invent field API.
Chặng chỉ làm trải nghiệm website demo, chưa làm Monitor hoặc fault helper.

## Các bước Worker làm

1. Dùng source Express hiện có làm “Sổ ghi chú nhóm”: danh sách rõ ràng, input thêm ghi chú,
   nút tải lại, trạng thái lưu và số bản ghi thật. Map vào fields `/items` đang hỗ trợ.
2. Giảng viên nhập ghi chú riêng, thấy xuất hiện sau save/refetch và reload. Khi DB unavailable
   hiển thị lỗi thật, không chuyển sang dữ liệu in-memory rồi bảo đã lưu PostgreSQL.
3. Đo thời gian request nghiệp vụ thật bằng clock monotonic trình duyệt; nhãn “Lần tải từ
   trình duyệt”. Loading tồn tại đúng lúc pending, lỗi HTTP/network có retry và text dễ hiểu.
4. Giảm metadata kỹ thuật ở trang chính; runtime/storage/version cho vào chi tiết. Không tạo
   checkout/payment giả, không thêm database model hoặc framework mới để trông nhiều tính năng.
5. Ghi nhận thao tác/ảnh nhanh ở baseline. Dùng fault endpoint opt-in sẵn có qua SSH thử chậm
   có giới hạn và reset sau test; không setTimeout ở frontend hoặc hardcode số ms.
6. Deploy source đã cập nhật qua pipeline C01, giữ marker/data; deployment mới phải dùng
   boundary C02 và baseline/train theo C03 trước bước fault demo tiếp theo.

## File được sửa

`demo-apps/express-api/public/**`, README, server chỉ sửa lỗi tối thiểu nếu API hiện hữu
không xử lý đúng hành vi đang dùng. Không thêm schema/dependency hoặc chỉnh ML/collector.

## Case và DoD

- [ ] C04-T1: tạo/đọc ghi chú thật từ PostgreSQL, reload vẫn còn; validation không làm mất input.
- [ ] C04-T2: request chậm thật có loading + latency đo thực, không fake timing.
- [ ] C04-T3: 5xx/network/save failure không báo thành công; có retry dễ hiểu.
- [ ] C04-T4: ảnh cùng thao tác bình thường/chậm; UI 1366×768 và 1024×768 đọc được.
- [ ] C04-T5: fault reset, redeploy không mất marker, deployment/model cần train lại được ghi rõ.
- [ ] C04-T6: API/fault smoke liên quan và test logic request/error nếu thêm logic mới; không
      viết test chỉ để khẳng định text/CSS tồn tại.

## Evidence và review

`c04/experience.md`, ảnh website bình thường/pending/lỗi, source path, marker identifier và
request timing method; handoff-c04.md. Leader kiểm tra đây là business API/DB thật, không mẫu giả,
và thầy có thể hiểu thao tác không cần giải thích Docker. C04 APPROVED mới mở C05.
