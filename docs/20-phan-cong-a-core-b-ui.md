# PHÂN CÔNG MỚI — A CORE/ALGORITHMS, B UI/DELIVERY

**Hiệu lực từ 12/08/2026.** Các task/PR đã hoàn thành trước mốc này giữ nguyên owner thực tế;
không đổi lịch sử để làm đẹp bảng tiến độ.

Mục tiêu của cách chia mới là để B có thể làm giao diện độc lập trong khi A xử lý những phần có
rủi ro kỹ thuật cao. Đây là phân công theo **ranh giới file và artifact**, không phải chia thành hai
sản phẩm riêng.

## 1. Ranh giới sở hữu

| | Người A — Core/Algorithms | Người B — UI/Delivery |
|---|---|---|
| Kết quả chính | Backend Electron, hạ tầng VPS, pipeline, monitoring và thuật toán ML | Giao diện dùng được, demo/fixture, collector, kiểm thử và bằng chứng bàn giao |
| Thư mục sở hữu | `app/src/main/**`, `ml-service/**`, `templates/**` | `app/src/renderer/**`, `collector/**`, `demo-apps/**`, `experiments/**` |
| Tài liệu báo cáo | Kiến trúc, module core, thuật toán và quyết định kỹ thuật | UI/UX, hướng dẫn thao tác, kịch bản demo, bảng/hình kết quả |
| Không tự sửa | Renderer của B, collector/demo/experiment runner của B | Electron main, DB, SSH, pipeline và model của A |

Vùng dùng chung: `app/src/shared/**`, `docs/contracts/**`, migration và giao thức thí nghiệm.
Thay đổi ở đây phải có label `Contract - ca hai duyet` và cả hai review.

## 2. Cách hai người làm độc lập

```text
A: typed contract -> handler/service thật -> test backend
              |                         |
              +------ điểm giao --------+
              |                         |
B: fixture/mock cùng type -> UI states -> thay mock bằng window.api.invoke
```

- A chốt type và ví dụ payload trước; B không cần chờ handler thật để dựng màn hình.
- B đặt fixture trong renderer/test, không tạo IPC tạm và không import Node/Electron trực tiếp.
- Khi handler của A merge, B chỉ nối typed IPC và chạy các state: loading, empty, success, error.
- Mỗi card tích hợp phải ghi rõ channel/event nào là điểm giao và PR dependency nào cần merge trước.
- B gặp thiếu field thì comment vào card Contract; không sửa contract âm thầm để vừa giao diện.

## 3. Rebaseline W1–W4

| Tuần | Người A — việc khó/core | Người B — UI/delivery | Điểm nối bắt buộc |
|---|---|---|---|
| W1 · 10/08–16/08 | DB/credential; SSH connect/exec/files/resource; ML skeleton | Collector cơ bản; 3 demo app; fake metric; UI kết nối/tài nguyên bằng typed mock | VPS List hiện loading/error/online/RAM/disk; A đọc được `metrics.jsonl` của B |
| W2 · 17/08–23/08 | Detector 3 Tier 1; deploy `PRECHECK→BUILD`; train/ingest/replay và 4 method | Hoàn tất collector; Deploy Wizard và Deploy Log bằng mock event | Express build trên VPS; UI render đúng deploy event contract |
| W3 · 24/08–30/08 | Deploy `DEPLOY→RECORD`; poller/rule; nối score/alert vào SQLite/IPC | Nối Deploy Wizard vào IPC thật; Dashboard chart + score panel | Deploy 3 app từ UI; metric/score thật thấy trên Dashboard |
| W4 · 31/08–06/09 | Redeploy/rollback/retry; alert lifecycle; reconnect/offset/dedupe | Versions/History; alert feedback UI; fault script và smoke evidence | Smoke 16/24 FR trên `main`, mỗi bằng chứng có link/log |

### Thứ tự ưu tiên của A

1. W1 gate: credential → SSH connect/exec → files/resource.
2. Lát cắt Express: detector → deploy đến BUILD → deploy đến RECORD.
3. Data path: ML service → poller/rule → score/alert.
4. Redeploy/rollback và xử lý reconnect.

### Thứ tự ưu tiên của B

1. Hoàn thành collector/demo app đang làm; không bỏ ngang branch có PR.
2. VPS connection/resource states bằng mock typed.
3. Deploy Wizard và Deploy Log bằng mock typed.
4. Nối UI vào IPC thật, sau đó Dashboard và Versions/Alert UI.

## 4. Definition of Done riêng theo vai trò

Card của A chỉ sang `CHỜ REVIEW` khi có unit/integration test cho core API, không log secret,
có lệnh tái hiện và nếu dùng VPS thì có smoke log đã che thông tin nhạy cảm.

Card của B chỉ sang `CHỜ REVIEW` khi có đủ loading/empty/success/error, không truy cập Node
từ renderer, dùng type trong `app/src/shared`, có ảnh/video ngắn hoặc component test và không
hard-code payload khác contract.

Card tích hợp chỉ `HOÀN THÀNH` khi cả mock test của B và handler test của A đều pass trên `main`.

## 5. Quy tắc tái cân bằng

- Mỗi người vẫn chỉ có một card `ĐANG LÀM`.
- A không nhận UI polish khi còn card core P0; B không nhận model/pipeline chỉ vì đang chờ IPC.
- Nếu A trễ quá 1 ngày ở P0, B ưu tiên viết fixture, test, tài liệu tái hiện hoặc smoke script để
  giúp A; không sửa thẳng file core.
- Nếu cuối W2 A chưa build được Express trên VPS, hạ mục tiêu W4 xuống 50–55% thay vì bỏ test.
- Review chéo vẫn bắt buộc: B phải giải thích được luồng core ở mức sử dụng; A phải giải thích
  được state và error UX của màn demo.

## 6. Áp dụng trên Trello

Chạy xem trước:

```powershell
.\tools\setup-trello.ps1 -PlanOnly -SyncExisting
```

Đồng bộ board hiện có:

```powershell
.\tools\setup-trello.ps1 `
  -BoardUrl 'https://trello.com/b/RrSCc5uu/opspilot-delivery-board' `
  -PartnerUsername 'voththienkim' `
  -SyncExisting
```

Chế độ này đổi tên label A/B, cập nhật card được chuyển owner và tạo các card W1–W4 còn thiếu.
Nó không archive/xóa card, không đổi list/custom label của card đã tồn tại và không xóa
comment/attachment.
