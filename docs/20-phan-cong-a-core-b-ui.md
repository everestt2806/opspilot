# PHÂN CÔNG MỚI — A CORE/ALGORITHMS, B UI/DELIVERY

> **Cập nhật hiện hành 30/08/2026:** TK-B9 đã merge qua PR #21 và demo cơ bản đã hoàn tất.
> Điểm vào mới của A/B nằm ở [`23-ke-hoach-sau-demo-30-08.md`](23-ke-hoach-sau-demo-30-08.md):
> A làm TK-A16 M6; B làm TK-B4 rồi B5→B6→B8. Các đoạn ngày 19–20/08 bên dưới được giữ làm
> lịch sử quyết định, không còn là lệnh kéo task hiện tại.

**Hiệu lực từ 15/08/2026.** Các task/PR đã hoàn thành trước mốc này giữ nguyên owner thực tế;
không đổi lịch sử để làm đẹp bảng tiến độ.

Sau phần đã merge ngày 11/08, cả A và B bận nên nhóm nghỉ đến hết 14/08. Mọi task chưa hoàn
thành được dời sang từ 15/08; khoảng nghỉ này không tính là trễ.

Mục tiêu của cách chia mới là để B có thể làm giao diện độc lập trong khi A xử lý những phần có
rủi ro kỹ thuật cao. Đây là phân công theo **ranh giới file và artifact**, không phải chia thành hai
sản phẩm riêng.

### Cập nhật 19/08/2026 — tuần chạy demo (19/08–23/08), A làm hết

B bận tuần này → **từ 19/08 đến 23/08 A đảm nhận toàn bộ task: backend lẫn UI** (quyết định
với người dùng; board là nguồn sự thật). Mục tiêu chi phối tuần: **demo với thầy 24/08** gồm:

1. **Chẩn đoán lỗi kết nối VPS cho người mới** — case mẫu: firewall WiService mặc định chặn
   inbound (máy báo Running nhưng TCP timeout toàn bộ cổng). App tự phân loại nguyên nhân và
   in hướng dẫn sửa tiếng Việt (TK-A10 + phần hiển thị TK-B7).
2. **Auto-deploy 1 app Express thật lên VM01 từ UI** (TK-B2 lát cắt express-api + TK-A13).
3. **Ops dashboard** quản lý VPS, deploy, lịch sử, log live (TK-A14).

Collector (TK-B4/B5/B6) + 2 demo app còn lại + M7 (TK-A6) lùi W2 — chart metric lên dashboard
cùng đợt poller W2–W3. Trong tuần này A được sửa `app/src/renderer/**` (ranh giới mục 1 tạm
nới); từ W2 quay lại đúng phân công trừ khi có quyết định mới.

### Cập nhật 20/08/2026 — B nhận VPS Control Panel khi quay lại

A giao **TK-B9 — VPS Control Panel v1** làm task đầu tiên của B khi quay lại. TK-B7 vẫn giữ
nguyên lịch sử (A đã làm thay phần 4 trạng thái trong tuần demo); TK-B9 là scope mới: biến màn
VPS thành trung tâm vận hành có tổng quan đội máy, chi tiết VPS, ứng dụng/deploy và hoạt động.

Panel chỉ tổng hợp các khả năng OpsPilot đã có qua typed IPC. B sở hữu renderer và test, không
sửa Electron main/SSH/DB/pipeline, không tự đổi contract, và không mở rộng thành terminal/file
manager/firewall/DNS/SSL. Nếu UI cần handler chưa có, B ghi blocker để A tạo task backend riêng.
Nguồn sự thật để bắt đầu là `tasks/board.md` + `tasks/tk-b9-vps-control-panel.md`.

## 1. Ranh giới sở hữu

| | Người A — Core/Algorithms | Người B — UI/Delivery |
|---|---|---|
| Kết quả chính | Backend Electron, hạ tầng VPS, pipeline, monitoring và thuật toán ML | Giao diện dùng được, demo/fixture, collector, kiểm thử và bằng chứng bàn giao |
| Thư mục sở hữu | `app/src/main/**`, `ml-service/**`, `templates/**` | `app/src/renderer/**`, `collector/**`, `demo-apps/**`, `experiments/**` |
| Tài liệu báo cáo | Kiến trúc, module core, thuật toán và quyết định kỹ thuật | UI/UX, hướng dẫn thao tác, kịch bản demo, bảng/hình kết quả |
| Không tự sửa | Renderer của B, collector/demo/experiment runner của B | Electron main, DB, SSH, pipeline và model của A |

Vùng dùng chung: `app/src/shared/**`, `docs/contracts/**`, migration và giao thức thí nghiệm.
Thay đổi ở đây phải được ghi rõ trong nhật ký tk-file và cả hai review.

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
- Mỗi task tích hợp phải ghi rõ channel/event nào là điểm giao và PR dependency nào cần merge trước.
- B gặp thiếu field thì ghi vào nhật ký tk-file và báo A; không sửa contract âm thầm để vừa giao diện.

## 3. Rebaseline W1–W4

| Tuần | Người A — việc khó/core | Người B — UI/delivery | Điểm nối bắt buộc |
|---|---|---|---|
| W1 · 10/08–21/08 | DB đã merge; từ 15/08: credential, SSH connect/exec/files/resource, ML skeleton | Từ 15/08: collector, 3 demo app, fake metric, UI kết nối/tài nguyên | VPS List hiện loading/error/online/RAM/disk; A đọc được `metrics.jsonl` của B |
| W2 · 22/08–28/08 | Detector 3 Tier 1; deploy `PRECHECK→BUILD`; train/ingest/replay và 4 method | TK-B9 VPS Control Panel v1, sau đó hoàn tất collector | Panel quản lý được VPS/app/deploy/history bằng IPC thật; Express build trên VPS; `metrics.jsonl` đúng contract |
| W3 · 29/08–04/09 | Deploy `DEPLOY→RECORD`; poller/rule; nối score/alert vào SQLite/IPC | Hoàn thiện collector; Dashboard chart + score panel | Deploy 3 app từ UI; metric/score thật thấy trên Dashboard |
| W4 · 05/09–11/09 | Redeploy/rollback/retry; alert lifecycle; reconnect/offset/dedupe | Versions/History; alert feedback UI; fault script và smoke evidence | Smoke 16/24 FR trên `main`, mỗi bằng chứng có link/log |

### Thứ tự ưu tiên của A

1. W1 gate: credential → SSH connect/exec → files/resource.
2. Lát cắt Express: detector → deploy đến BUILD → deploy đến RECORD.
3. Data path: ML service → poller/rule → score/alert.
4. Redeploy/rollback và xử lý reconnect.

### Thứ tự ưu tiên của B

1. **TK-B9 VPS Control Panel v1** — task đầu tiên khi quay lại, scope/DoD chốt trong tk-file.
2. Hoàn tất collector TK-B4→B5→B6 để khép `metrics.jsonl` và Gate G1.
3. Phần còn lại của demo app TK-B2; mỗi lần chỉ kéo một task.
4. TK-B8 nối chart/score vào Dashboard, sau đó Versions/Alert UI.

## 4. Definition of Done riêng theo vai trò

Task của A chỉ sang `CHỜ REVIEW` khi có unit/integration test cho core API, không log secret,
có lệnh tái hiện và nếu dùng VPS thì có smoke log đã che thông tin nhạy cảm.

Task của B chỉ sang `CHỜ REVIEW` khi có đủ loading/empty/success/error, không truy cập Node
từ renderer, dùng type trong `app/src/shared`, có ảnh/video ngắn hoặc component test và không
hard-code payload khác contract.

Task tích hợp chỉ `HOÀN THÀNH` khi cả mock test của B và handler test của A đều pass trên `main`.

## 5. Quy tắc tái cân bằng

- Mỗi người vẫn chỉ có một task `ĐANG LÀM`.
- A không nhận UI polish khi còn task core P0; B không nhận model/pipeline chỉ vì đang chờ IPC.
- Nếu A trễ quá 1 ngày ở P0, B ưu tiên viết fixture, test, tài liệu tái hiện hoặc smoke script để
  giúp A; không sửa thẳng file core.
- Nếu cuối W2 A chưa build được Express trên VPS, hạ mục tiêu W4 xuống 50–55% thay vì bỏ test.
- Review chéo vẫn bắt buộc: B phải giải thích được luồng core ở mức sử dụng; A phải giải thích
  được state và error UX của màn demo.

## 6. Theo dõi task trong repo

Từ 19/08/2026 task và trạng thái nằm trong repo: **quy trình** ở
[`tasks/README.md`](tasks/README.md), **trạng thái** ở [`tasks/board.md`](tasks/board.md),
**hồ sơ từng task** ở `tasks/tk-*.md`. Phân công W1–W4 trong mục 3 của file này đã được chuyển
thành các task trên board.
