# C05 — Màn tình trạng đọc là hiểu, số liệu lấy từ hệ thống thật

## Đầu vào

C04 APPROVED, app demo hiện tại có dữ liệu C02/C03. Đọc docs/02 mục Dashboard + UI token,
M10, IPC/shared types, renderer store/entry và monitor service. Chỉ làm màn đọc; thao tác alert/
setting/recovery thuộc chặng sau. Giữ dashboard quản lý fleet đang có nếu vẫn dùng.

## Các bước Worker làm

1. Tạo entry Monitor từ app/VPS/Deploy, chọn app và deployment thật; header tên dễ hiểu,
   URL, version và timestamp mẫu cuối. Version/target chưa có dữ liệu thì empty state rõ.
2. Initial load `monitor:samples/scores/alerts/get-setting`; subscribe tick, unsubscribe,
   hủy/ignore response cũ khi đổi app; dedupe, giới hạn cửa sổ hiển thị.
3. Hero tình trạng bằng text/icon/color: bình thường/chậm/có cảnh báo/chưa đủ dữ liệu/mất
   cập nhật. Định nghĩa bảng ưu tiên states dựa vào sample hiện tại/setting/alert, viết test.
   Null/stale có ưu tiên hơn suy diễn “healthy”; alert ML không có nguyên nhân thì text trung tính.
4. Hiển thị latency (ms), lỗi kiểm tra HTTP (%/60s), phiên bản; chart latency/threshold và
   timestamp. Không suy số khách hàng/đơn hàng/lỗi toàn hệ thống từ probe error-rate.
5. Chi tiết mở rộng: CPU/RAM/DB/container, 3 ML + ensemble và rule, model readiness,
   anomaly score không gọi độ chính xác. Không làm 5 chart lớn cạnh tranh với thông điệp chính.
6. Null là gap/“Chưa có số đo”, stale ghi lần cập nhật cuối. Ghi threshold/stale policy trong
   handoff; ngưỡng stale là presentation policy có lý do, không sửa contract silent.
7. Thêm projection mode bằng renderer state: text lớn, ẩn kỹ thuật, chart/timeline chính rõ;
   chưa tạo phase automatic giả. Không nhúng browser HTTP bằng webview đặc quyền.
8. Bảng alert ban đầu read-only, refresh để thấy resolved/peak (tick chỉ có new_alerts).
   Không hiển thị nút thao tác giả; chưa có recovery thì entry đó để chặng C07.

## File được sửa

Renderer page/component/hook/store/strings/styles scoped và tests, wiring navigation/preload
nếu contract hiện có chưa exposed. Tái dùng AntD/Recharts; không đổi schema/model/app shell.

## Case và DoD

- [ ] C05-T1: real IPC initial load + live tick thay số và chart đúng app/deployment.
- [ ] C05-T2: out-of-order response/switch app/remount không trộn data hoặc leak listener.
- [ ] C05-T3: table state precedence null/stale/offline/not-trained/healthy/degraded có test.
- [ ] C05-T4: đơn vị/range/date đúng, memory series giới hạn, timestamp UTC chỉ format ở UI.
- [ ] C05-T5: ảnh 1366×768/1024×768; không horizontal overflow toàn app; detail mở/đóng hợp lý.
- [ ] C05-T6: renderer tests liên quan + typecheck/lint/format/build và Electron click-through.

## Evidence và review

`c05/state-mapping.md` ghi UI message → nguồn metric/alert/setting → điều kiện, ảnh normal/
no-data/stale, live screenshot/video tick; handoff-c05.md. Leader review cả phép suy state,
request lifecycle và khả năng đọc nhanh: nhìn màn chính phải biết website có vấn đề gì.
C05 APPROVED mới mở C06.
