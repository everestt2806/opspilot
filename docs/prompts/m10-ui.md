# M10 — Giao diện · Người A · rải Tuần 1–10

`app/src/renderer/` — UC-01..UC-09

## Mục tiêu
7 màn hình đi hết 9 use case mà không cần đọc tài liệu. **90% công sức UI dồn vào Dashboard và
Deploy Log** — hai màn xuất hiện lúc bảo vệ. Phần còn lại dùng component AntD mặc định.

## Đọc trước
- **`docs/02-ui-ux-spec.md`** — toàn bộ file: design token, layout, spec từng màn, quy tắc UX
- **`docs/contracts/ipc-contract.ts`** — mọi lời gọi và event
- `docs/10-quy-uoc-code.md` mục 8

## Thứ tự làm

| Ưu tiên | Màn | Tuần | Mức đầu tư |
|---|---|---|---|
| 1 | Deploy Log (3.3) | W3 | **Cao** — stepper + xterm |
| 1 | Dashboard (3.4) | W3–W4 | **Cao nhất** — chart + vạch sự kiện + panel 5 method + gắn nhãn |
| 2 | Deploy Wizard (3.2) | W3 | Chuẩn AntD Steps |
| 3 | VPS List (3.1) | W1 | Chuẩn AntD Table |
| 3 | Phiên bản (3.5) | W4 | Chuẩn AntD Timeline |
| 3 | Migrate Wizard (3.6) | W7 | Chuẩn AntD Steps |
| 4 | Lịch sử (3.7) + Cài đặt | W10 | Tối thiểu |

## Hai màn cần làm kỹ

### Deploy Log
- Stepper ngang 7 bước, mỗi bước: ✓ xanh + thời gian ("12s") / spinner / ✗ đỏ.
- `@xterm/xterm` + `FitAddon` + `SearchAddon`. Ghi thẳng `chunk` từ event `deploy:event`
  type `log` vào terminal — **giữ nguyên ANSI, không xử lý gì thêm**.
- Auto-scroll, tự tắt khi người dùng cuộn lên, hiện nút "↓ Xuống cuối".
- Thành công → banner xanh **"Deploy thành công sau 2m41s"** + nút "Mở app ↗" + "Xem dashboard".
- Thất bại → banner đỏ ghi rõ **bước nào** + 30 dòng log cuối của bước đó + nút rollback.

### Dashboard — ★ signature của đồ án
- **Tầng 1:** 6 ô `Statistic`, số to JetBrains Mono, nhấp nháy nhẹ khi có mẫu mới, mũi tên ↑↓
  so mẫu trước.
- **Tầng 2 trái (70%):** 2 chart Recharts xếp dọc, trục thời gian **đồng bộ**, chọn cửa sổ
  15ph/1h/6h.
  **★ Vạch dọc đánh dấu sự kiện ngay trên chart** — alert của method nào thì vạch **đúng màu
  method đó** (`ReferenceLine`), rollback = vạch đỏ đậm có nhãn. Đây chính là "timeline chart"
  của báo cáo nhưng hiện **live** trong app: lúc demo memory leak, hội đồng **nhìn thấy** đường
  mem đi lên chạm lần lượt vạch tím/hồng/xanh dương trước khi chạm ngưỡng rule.
- **Tầng 2 phải (30%):** 5 hàng method, mỗi hàng: chấm màu cố định + tên + thanh score 0..1
  realtime + trạng thái (Yên tĩnh / ⚠ CẢNH BÁO). Method trusted có tag "tự rollback".
  Model chưa train đủ → hiện **"Đang thu thập 132/150 mẫu"**, không hiện score 0.
- **Tầng 3:** bảng alert gần đây, 2 nút `[✓ Đúng] [✗ Sai]` gắn nhãn — **bấm một phát, đổi màu
  ngay, sửa lại được, không modal, không form**. Gắn nhãn phải "rẻ" thì mới đủ nhãn.
  ⚠ **Chỉ hiện bản ghi bảng `alert`** (đã triggered), **không** hiện `score_sample`.

## Ràng buộc

1. Renderer **không** gọi ssh2/sqlite trực tiếp — mọi thứ qua `window.api` typed.
2. Không gọi IPC trong lúc render; chỉ trong `useEffect` hoặc event handler.
3. **Mọi chuỗi hiển thị nằm trong `strings.ts`.** Không hardcode tiếng Việt trong component.
4. Màu 5 phương pháp lấy từ **một** file token, dùng chung cho chart/tag/bảng. Không copy mã
   hex rải rác.
5. Hành động phá huỷ (xoá VPS · rollback khi app đang chạy tốt · dọn VPS nguồn · bật
   auto-rollback) → confirm 2 lớp; rollback khi đang chạy tốt bắt **gõ đúng tên app**.
6. Lỗi hiển thị phải nói đủ 3 điều: chuyện gì · ở bước nào · làm gì tiếp. Message thô để trong
   mục "Chi tiết kỹ thuật" thu gọn được.
7. Empty state cho VPS/Apps/Dashboard đều hướng dẫn hành động kế tiếp.
8. Timestamp: tương đối ("2 phút trước") + tooltip tuyệt đối. Host/port/path/command dùng mono.
9. Component >200 dòng → tách. Trang chỉ ghép component + gọi store.

## Không làm
Theme sáng · i18n runtime · kéo-thả sắp xếp dashboard · tuỳ biến chart · animation chuyển
trang · onboarding tour · responsive mobile.

## Định nghĩa xong
- [ ] 9 use case đi hết luồng **không cần đọc tài liệu**
- [ ] Không màn nào để lộ JSON thô hoặc message lỗi thô
- [ ] Dashboard cập nhật mượt khi có `monitor:tick` mỗi 30 giây, không nháy cả trang
- [ ] Vạch sự kiện trên chart hiện **đúng màu** từng method
- [ ] Gắn nhãn alert phản hồi tức thì (<100ms cảm nhận)
- [ ] Test trên **máy chiếu** ở tuần 15: dot trạng thái ≥10px **và kèm chữ**, không dựa vào
      màu đơn thuần (máy chiếu rửa màu rất mạnh)
