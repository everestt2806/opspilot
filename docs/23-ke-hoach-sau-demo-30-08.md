# Kế hoạch sau demo cơ bản — chốt ngày 30/08/2026

> **Điểm vào hiện tại cho A, B và mọi AI mới.** Đọc file này sau `CLAUDE.md`, rồi chỉ đọc
> tk-file của task mình đang nhận. Trạng thái chi tiết luôn lấy từ [`tasks/board.md`](tasks/board.md).

## 1. Baseline đã có

`origin/main` tại commit `2addfb8` đã gồm:

- PR #21: VPS Control Panel v1 của B.
- PR #22: quét môi trường VPS qua SSH.
- PR #23: giữ credential PostgreSQL khi redeploy, title bar/log/UI demo và reset demo an toàn.
- Lát cắt đã demo với giảng viên: thêm/kết nối VPS, xem trạng thái, quét môi trường, deploy
  `express-api` + PostgreSQL và mở app qua port công khai.
- ML service độc lập đã có feature 20 chiều, 3 model + ensemble và 6 endpoint (PR #19).

Không tiếp tục polish VPS/Deploy nếu không phải bug chặn. Khoảng trống P0 hiện tại là đường dữ liệu:

```text
app trên VPS → collector → metrics.jsonl → poller → SQLite/ML → Dashboard
```

## 2. Hai luồng làm độc lập

| | A — Core/Algorithms | B — UI/Delivery |
|---|---|---|
| Task kéo ngay | [`TK-A16`](tasks/tk-a16-m6-poller-rule.md) | [`TK-B4`](tasks/tk-b4-m5-probes.md) |
| Sau đó | TK-A15 hardening deploy/rollback | TK-B5 → TK-B6 → TK-B8 |
| Vùng file | `app/src/main/monitor/**`, DB repo, ML client, main IPC | `collector/**`; sau B6 mới sang `app/src/renderer/**` cho B8 |
| Không đụng | renderer/collector/contract | Electron main/DB/SSH/contract |
| Điểm nối | Đọc đúng `metric-format.md`, hiện thực `monitor:*` IPC | Ghi đúng `metric-format.md`, UI chỉ gọi typed IPC |

Quy tắc WIP vẫn là một task `ĐANG LÀM` mỗi người. B không kéo B5 trước khi B4 sang `CHỜ REVIEW`;
A không kéo A15 trước khi A16 sang `CHỜ REVIEW`.

## 3. Việc của A

### Hiện tại — TK-A16, hạn 04/09

M6 Poller + Rule Engine hoàn chỉnh ở code/local gate:

- Đọc JSONL theo byte offset, chống partial/corrupt/duplicate/rotate.
- Ghi metric, đúng 5 score mỗi mẫu, rule/ML fallback.
- Mở/cập nhật/đóng alert theo consecutive.
- Expose `monitor:*` IPC và phát `monitor:tick`.
- Scheduler tuần tự, không poll chồng, stop sạch khi thoát app.
- Không chờ collector thật: dùng fixture và CLI local.

Hồ sơ chi tiết và prompt Worker nằm trọn trong
[`tasks/tk-a16-m6-poller-rule.md`](tasks/tk-a16-m6-poller-rule.md).

### Tiếp theo — TK-A15

Chỉ kéo sau khi TK-A16 vào review: giữ ba image, healthcheck/rollback/retry ổn định, khóa port và
bổ sung chẩn đoán log khi container unhealthy. Không trộn A15 vào PR M6.

## 4. Việc của B

### Bắt đầu duy nhất từ TK-B4

1. Đồng bộ `main` mới nhất; không tiếp tục branch `feat/ui-vps-control-panel` đã merge.
2. Đọc `CLAUDE.md`, file này, `tasks/README.md`, `tasks/tk-b4-m5-probes.md`,
   `prompts/m05-collector.md` và `contracts/metric-format.md`.
3. Chuyển TK-B4 `TUẦN NÀY → ĐANG LÀM`, thêm `START <ngày>` vào tk-file.
4. Chỉ sửa `collector/**`, chạy pytest, cập nhật board/tk-file và commit cục bộ. Không push, mở PR
   hoặc merge cho tới khi A yêu cầu riêng.

Prompt ngắn cho AI của B:

```text
Tôi là người B — UI/Delivery. Hãy nhận TK-B4 trong
docs/tasks/tk-b4-m5-probes.md. Đọc đủ các file trong mục "Cách B và AI bắt đầu", cập nhật
TK-B4 sang ĐANG LÀM + ghi START trước khi code. Chỉ sửa collector/** và tài liệu task; không
đổi contract, Electron main hoặc renderer. Hoàn thiện docker stats + HTTP probe đúng đơn vị/null
semantics, thêm pytest, chạy gate, cập nhật board/tk-file và commit cục bộ. KHÔNG push, mở PR hoặc
merge nếu A chưa ra lệnh riêng; bàn giao commit local và kết quả test để A review trước.
```

### Chuỗi task của B sau B4

1. **TK-B5:** append `metrics.jsonl`, atomic `latest.json`, seq liên tục, fsync và rotation.
2. **TK-B6:** đóng gói/chạy collector cùng app trên VM01, không mở thêm port.
3. **TK-B8:** Dashboard monitoring bằng `monitor:*` IPC thật; chart/score/alert đủ
   loading/empty/success/error.
4. Phần `next-blog`, `vite-spa`, fault endpoint của TK-B2 chỉ kéo sau khi đường metric xanh.

B không cần làm lại fixture TK-B3: A đã có `ml-service/scripts/gen_fake_series.py` trong PR #19.

## 5. Điểm tích hợp bắt buộc

### TK-S4 — code A16 + collector B6

Chạy ngay khi cả A16 và B6 sẵn sàng:

- Collector chạy ≥10 phút trên VM01 và sinh JSONL đúng contract.
- A đọc qua SSH, offset tăng đúng; SQLite không trùng `seq`.
- Mỗi metric có đúng 5 score; ML chưa train ghi `NULL`.
- Tắt ML service: rule/metric vẫn tiếp tục.
- Ngắt SSH rồi nối lại: nạp bù, không tạo mẫu giả.
- `monitor:tick` đủ dữ liệu cho B bắt đầu B8.

Mọi lỗi contract ở điểm nối được ghi vào TK-S4; không sửa nóng task của người kia.

## 6. Mốc ngắn hạn

| Mốc | A | B | Bằng chứng |
|---|---|---|---|
| 30/08 | Giao Worker + bắt đầu A16 | Đọc handoff, chuẩn bị B4 | Board/tk-file đúng trạng thái |
| 01/09 | CP1–CP2 A16 | B4 vào review | Parser/rule test + probe pytest |
| 02/09 | CP3 A16 | B5 vào review | 5 score/sample + JSONL/latest |
| 03/09 | CP4 A16 vào review | B6 chạy VM01 | Gate code xanh + file metric thật |
| 04/09 | Review/fix A16 + TK-S4 | Hỗ trợ TK-S4 | Metric thật vào SQLite/IPC |
| 05–07/09 | A15 | B8 Dashboard | Chart/alert từ dữ liệu thật |

Ngày lệch một ngày được phép nếu có `BLOCKED/UPDATE` đúng format; không được bỏ test để giữ lịch.

## 7. Cách bàn giao cho reviewer

Mọi Worker/AI khi xong phải cung cấp đủ:

1. Branch và commit cục bộ; URL PR chỉ có sau khi A đã cho phép push/mở PR.
2. Danh sách file đổi và phần cố ý không làm.
3. Lệnh test cùng kết quả thật.
4. Checklist DoD đã tick và bằng chứng.
5. Rủi ro/giới hạn còn lại.
6. Board + nhật ký tk-file đã cập nhật trong cùng PR.

Thiếu một mục thì task vẫn là `ĐANG LÀM`, chưa được tính `CHỜ REVIEW`.
