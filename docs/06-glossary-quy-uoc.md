# THUẬT NGỮ & QUY ƯỚC ĐẶT TÊN

Đọc trước khi đặt tên bất cứ thứ gì. Mục đích: 4 tháng sau, phiên AI thứ 200 vẫn đặt tên
giống hệt phiên đầu tiên.

---

## 1. Thuật ngữ chuẩn (dùng đúng từ này ở code, UI, tài liệu, báo cáo)

| Thuật ngữ | Nghĩa chính xác trong dự án | Đừng nhầm với |
|---|---|---|
| **VPS** | Một máy chủ từ xa đã lưu profile trong bảng `vps` | "server", "host" |
| **App** | Một ứng dụng cụ thể sống trên một VPS cụ thể (`app`) | "project", "service" |
| **Deployment** | **Một lần** deploy, sinh ra một `version` mới | không phải "app đang chạy" |
| **Version** | Số nguyên tăng dần trong phạm vi một app | không phải version của source code |
| **Sample / mẫu** | Một dòng `metric_sample` = một lần collector đo | không phải "record" |
| **Score** | Điểm bất thường 0..1 **đã chuẩn hoá**, của một phương pháp tại một mẫu | không phải anomaly score thô của sklearn |
| **Triggered** | Trạng thái đã vượt ngưỡng **đủ số mẫu liên tiếp** | ≠ "score > threshold" tại một mẫu |
| **Alert** | Một sự kiện triggered (một chuỗi liên tục = **một** alert) | ≠ một dòng `score_sample` |
| **Method / phương pháp** | Một trong 5: `rule`, `zscore_ewma`, `iforest`, `ocsvm`, `ensemble` | không phải "model" (rule không có model) |
| **Degraded state** | Suy giảm vận hành: app vẫn sống nhưng chỉ số xấu dần | ≠ "down" (đó là `container_up=0`) |
| **Fault injection** | Chủ động gây lỗi để tạo dữ liệu có nhãn | không phải chaos engineering |
| **Run** | Một lần chạy thí nghiệm trọn vẹn 4 pha | không phải "một lần deploy" |
| **Grace** | Khoảng ân hạn 60s sau `fault_start` không tính vào đánh giá | không phải cooldown |
| **Cooldown** | 10 phút sau auto-rollback không rollback tiếp | không phải grace |
| **Detection delay** | Giây từ `fault_start` đến mẫu triggered đầu tiên | không phải thời gian inference |
| **Baseline** | (a) dữ liệu bình thường để train; (b) phương pháp `rule` khi so sánh | nói rõ ngữ cảnh khi dùng |

---

## 2. Đặt tên trong code

| Loại | Quy ước | Ví dụ đúng | Sai |
|---|---|---|---|
| Bảng SQL | snake_case, **số ít** | `metric_sample` | `MetricSamples` |
| Cột SQL | snake_case, **đơn vị trong tên** | `latency_ms`, `mem_mb`, `poll_interval_s` | `latency`, `memory` |
| Cột boolean | `INTEGER` 0/1, tên khẳng định | `container_up`, `auto_rollback` | `is_not_down` |
| Cột thời gian | hậu tố `_at` (sự kiện) hoặc `_ts` (mốc dữ liệu) | `created_at`, `fault_start_ts` | `time`, `date` |
| Trường JSON qua IPC/REST | **snake_case** khi đến từ DB | `deployment_id` | `deploymentId` |
| Biến/hàm TS | camelCase | `pollInterval`, `readFileTail()` | `poll_interval` |
| Type/Interface TS | PascalCase, số ít | `MetricSample`, `Detector` | `IDetector` |
| Hằng số | UPPER_SNAKE | `MAX_UPLOAD_MB` | `maxUploadMb` |
| File TS | kebab-case | `auto-rollback.ts` | `autoRollback.ts` |
| Hàm/biến Python | snake_case | `compute_slope()` | `computeSlope()` |
| Class Python | PascalCase | `IsolationForestModel` | |
| Kênh IPC | `miền:hành-động` | `monitor:label-alert` | `labelAlert` |
| Nhánh git | `feat/<module>-<viec>` | `feat/deploy-healthcheck` | `newfeature` |
| Tên app (slug) | `^[a-z0-9][a-z0-9-]{1,30}$` | `express-api` | `Express API` |

**Lý do dùng snake_case cho dữ liệu qua IPC/REST:** dữ liệu từ SQLite đi thẳng ra React mà
không phải map lại tên trường. Ít code hơn, và loại hẳn một lớp bug im lặng.

---

## 3. Đơn vị & định dạng

| Đại lượng | Đơn vị chuẩn | Ghi chú |
|---|---|---|
| Thời gian trong DB | **ISO-8601 UTC**, `2026-10-06T14:32:10Z` | luôn có `Z`, chính xác tới giây |
| Khoảng thời gian | mili giây (`_ms`) trong DB; giây (`_s`) cho cấu hình người dùng chỉnh | |
| Bộ nhớ | MB (`_mb`) | không dùng bytes, không dùng GB |
| Dung lượng đĩa | GB (`_gb`) | |
| Phần trăm | 0–100 (`_pct`) | |
| Tỷ lệ | **0–1** (`http_error_rate`, `score`) | ⚠ khác với `_pct` — đọc kỹ tên |
| Giá trị không đo được | `null` | **không bao giờ dùng 0, -1, hay chuỗi rỗng** |

**Hiển thị trên UI:** giờ địa phương dạng tương đối ("2 phút trước") + tooltip giờ tuyệt đối.
Làm tròn: CPU 1 chữ số thập phân · RAM số nguyên MB · latency số nguyên ms · error rate
phần trăm 1 chữ số thập phân · score 2 chữ số thập phân.

---

## 4. Đường dẫn

| Ngữ cảnh | Cách ghép | Ví dụ |
|---|---|---|
| Trên VPS (Linux) | `path.posix.join` | `/opt/opspilot/express-api/metrics/metrics.jsonl` |
| Trên máy user (Windows) | `path.join` | `D:\Developing\DuAnCNTT\demo-apps\express-api` |
| Trong container | tuyệt đối, cố định | `/var/metrics/metrics.jsonl` |

**Không bao giờ** ghép đường dẫn Windows vào lệnh SSH. Không bao giờ dùng `path.join` cho
đường dẫn VPS (trên Windows sẽ ra `\`).

---

## 5. Mã lỗi

Danh sách đóng, khai báo trong `ipc-contract.ts` (`IpcError.code`). Thêm mã mới = sửa
contract + ghi `DECISIONS.md`. Mỗi mã phải map sang **một câu tiếng Việt** trong `strings.ts`
nói đủ 3 điều: chuyện gì · ở bước nào · làm gì tiếp.

---

## 6. Viết tiếng Việt trong code và tài liệu

- Comment, commit message, tài liệu, text UI: **tiếng Việt có dấu**.
- Tên định danh (biến, hàm, bảng, file, nhánh git): **tiếng Anh không dấu**.
- Commit message: không dấu (tránh lỗi encoding trên một số terminal Windows), thể mệnh lệnh,
  ≤72 ký tự dòng đầu: `[deploy] them buoc HEALTHCHECK va tu rollback`.
- Không emoji trong code, log, commit. UI dùng icon của AntD.
