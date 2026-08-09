# CHIẾN LƯỢC TEST — mức đủ cho đồ án, không hơn

Nguyên tắc: **test những chỗ sai ngầm mà không ai phát hiện được bằng mắt.** Chỗ nào chạy thử
là biết ngay (UI, SSH, deploy) thì dùng smoke test thủ công — viết unit test cho chúng tốn
thời gian mà không đổi được điểm nào.

---

## 1. Unit test — đúng 4 chỗ

### 1.1 Detectors (`vitest`) — dễ sai ngầm nhất
Mỗi detector ≥4 case:

| Case | Ví dụ với `nextjs` |
|---|---|
| Nhận đúng | `package.json` có `next` trong dependencies → `true` |
| Từ chối đúng | dự án Express thuần → `false` |
| Thư mục rác | thư mục rỗng / chỉ có `README.md` → `false`, không throw |
| Nhập nhằng | có **cả** `next` lẫn `express` → `nextjs` thắng nhờ `priority` |

Cộng thêm: `.env.example` có 3 biến → `requiredEnv` chứa đủ 3; có `prisma` →
`needsDb === true`. Fixture để trong `app/src/main/detectors/__fixtures__/`.

`SourceTree` là object thuần → dựng fixture bằng tay, **không đụng vào file system**.

### 1.2 `features.py` (`pytest`) — sai là hỏng toàn bộ thí nghiệm
- Chuỗi tăng tuyến tính đã biết trước → `slope` phải bằng đúng giá trị lý thuyết (sai số 1e-6).
- Chuỗi hằng → `slope == 0`, `std == 0`.
- Cửa sổ chưa đủ 20 mẫu → trả `None`, **không** trả vector 0.
- Có `null` giữa chuỗi → điền bằng giá trị hợp lệ gần nhất, không sinh `NaN`.
- Vector đầu ra có **đúng 20 chiều**, thứ tự chiều ổn định qua nhiều lần gọi
  (thứ tự đổi = model train và inference lệch nhau, bug rất khó thấy).

### 1.3 Crypto (`vitest`)
- Mã hoá rồi giải mã ra đúng bản gốc, kể cả chuỗi có Unicode và private key nhiều dòng.
- Sửa **1 byte** ciphertext → `decrypt` **phải throw**.
- Hàm che secret trong log: đầu vào chứa password → đầu ra không còn chuỗi đó.

### 1.4 Ground truth & metric của `analyze.py` (`pytest`)
Đây là code quyết định con số trong báo cáo — sai là bảo vệ sai.
- Dựng chuỗi nhãn giả đã biết trước TP/FP/FN → `precision/recall/f1` khớp giá trị tính tay.
- `grace` khác nhau → số mẫu ANOMALY thay đổi đúng như kỳ vọng.
- Run không có alert nào → detection delay là `censored`, **không phải 0, không phải 1200**.

**Không viết unit test cho:** UI, SSH manager, deploy/migrate pipeline, poller.
Chúng phụ thuộc môi trường thật; mock hết thì test chỉ kiểm tra chính cái mock.

---

## 2. Smoke test 10 phút

Chạy **mỗi thứ Sáu** trên `main` và **trước mọi buổi demo**.
Checklist đầy đủ: [`15-checklists.md`](15-checklists.md#smoke-test-10-phút).

Fail → tuần sau ưu tiên sửa **trước** khi làm việc mới. Ghi kết quả (ngày, ai chạy, pass/fail)
vào một dòng trong `docs/smoke-log.md` — bảng này cũng vào phụ lục báo cáo.

---

## 3. Test độ bền (soak test) — tuần 5, bắt buộc

Để app + poller chạy **liên tục 24 giờ** với ít nhất 1 deployment đang giám sát, rồi kiểm tra:

| Kiểm tra | Đạt khi |
|---|---|
| RAM của Electron | Không tăng quá 20% so với sau 1 giờ đầu |
| RAM của ml-service | Tương tự |
| SSH tự reconnect | Reboot VPS giữa chừng → poller nối lại, **không thủng dữ liệu** (kiểm tra `seq` liên tục) |
| Số mẫu | ≈ 24×60×6 = 8640 mẫu, thiếu <2% |
| Kích thước DB | Tăng tuyến tính, không phình bất thường |
| Không có exception chưa bắt | Log không có `unhandledRejection` |

> Hội đồng mà phát hiện *tool phát hiện memory leak* bị memory leak thì rất khó đỡ.
> Đây là lý do soak test nằm trong danh sách không được cắt.

---

## 4. Test nhánh lỗi — chủ động phá, đừng chỉ test đường hạnh phúc

Làm rải ở tuần 5–7, ghi kết quả vào báo cáo chương 4 (thể hiện đã nghĩ tới lỗi):

| Kịch bản phá | Kỳ vọng |
|---|---|
| Ngắt mạng giữa bước `UPLOAD` | `step-failed` với `SSH_TIMEOUT`, VPS không còn rác |
| `docker build` fail (Dockerfile sai) | Log lỗi hiện đủ, không tạo container, image dở bị xoá |
| App deploy xong nhưng healthcheck fail | Tự rollback về v(N-1), app cũ chạy lại |
| Ngắt SSH giữa `TRANSFER` khi migrate | Đích dọn sạch, **nguồn tự khởi động lại**, status `rolled_back` |
| Kill ml-service khi đang chạy | Dot ở topbar đỏ, poller vẫn ghi `metric_sample` và `rule`, ML score `null` |
| VPS hết disk | `PRECHECK` chặn trước, thông báo rõ số liệu thực tế |
| Xoá `metrics.jsonl` khi đang chạy | Poller phát hiện offset > kích thước file, reset về 1, ghi `action_log` |

---

## 5. Kiểm tra chất lượng dữ liệu thí nghiệm (tuần 8–9)

Chạy tự động sau **mỗi** run — chi tiết ở [`07`](07-giao-thuc-thi-nghiem.md#7-quy-trình-tự-động--run_experimentpy) mục 7:
số mẫu ≥90% lý thuyết · không có khoảng trống >2 phút · mỗi `metric_sample` có đúng 5 dòng
`score_sample` · không còn `score = null` sau khi train.

Run nào fail kiểm tra → đánh dấu `aborted` và tự chạy lại. **Không bao giờ đưa run lỗi vào
bảng kết quả rồi giải thích sau.**

---

## 6. Trước khi nộp (tuần 15)

- [ ] Cài bản đóng gói lên **máy sạch** (không có Node/Python cài sẵn) → chạy được đến đâu,
      ghi rõ yêu cầu môi trường vào README (Python 3.12 là yêu cầu đã chấp nhận, xem ADR-010)
- [ ] Smoke test trên bản đóng gói, không phải bản dev
- [ ] `analyze.py` chạy lại từ CSV trên máy khác → ra **đúng** con số trong báo cáo
- [ ] Mọi hình trong báo cáo sinh lại được bằng một lệnh
