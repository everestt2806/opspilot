# HỢP ĐỒNG KỸ THUẬT (contracts)

> **Đây là nguồn sự thật duy nhất của dự án.** Khi bất kỳ tài liệu nào mâu thuẫn với thư
> mục này, thư mục này đúng.

## Vì sao tồn tại

Hai người code hai phía của cùng một interface, và mỗi phiên làm việc với AI là một bộ nhớ
trắng. Nếu tên bảng, tên trường, tên event, tên endpoint không được cố định ở một chỗ thì:

- Người B gọi `POST /ingest` với `{deployment_id}` còn Người A trả `{deploymentId}` → mất
  nửa ngày debug.
- Phiên AI hôm nay đặt cột là `ts`, phiên tuần sau đặt là `timestamp` → dữ liệu thí nghiệm
  không đọc lại được.

## Nội dung

| File | Nội dung | Ai dùng |
|---|---|---|
| [`schema.sql`](schema.sql) | Toàn bộ schema SQLite + index + comment | A (db, deploy, migrate) và B (poller, analyze.py) |
| [`ml-api.openapi.yaml`](ml-api.openapi.yaml) | 6 endpoint của ML service | B (viết), A (gọi) |
| [`ipc-contract.ts`](ipc-contract.ts) | Kênh IPC main ↔ renderer, kiểu request/response/event | A |
| [`detector-contract.ts`](detector-contract.ts) | `interface Detector`, `SourceTree`, `BuildPlan` | A |
| [`metric-format.md`](metric-format.md) | Format `metrics.jsonl` / `latest.json`, đường dẫn trên VPS | B (collector), A (poller) |
| [`deploy-events.md`](deploy-events.md) | Event của deploy & migrate pipeline | A (phát), A (UI nhận) |

## Quy tắc

1. **Không sửa khi đang code một module.** Muốn sửa → dừng code, làm theo quy trình dưới.
2. Đổi contract thì phải:
   - Nói rõ đổi gì / vì sao / ảnh hưởng module nào, **báo người kia trước**.
   - Sửa file ở đây.
   - Ghi 1 dòng vào [`../../DECISIONS.md`](../../DECISIONS.md) trong **cùng commit**.
   - Nếu là schema: thêm file migration mới `00X_*.sql`, **không sửa migration cũ** đã chạy
     trên máy người kia hoặc đã sinh ra dữ liệu thí nghiệm.
3. **Sau tuần 8 (code freeze cấu hình ML): không đổi schema của `metric_sample`,
   `score_sample`, `alert`, `experiment_run` nữa** — đổi là mất khả năng so sánh dữ liệu
   pilot với dữ liệu chính thức.
4. File `.ts` ở đây là **định nghĩa kiểu, không phải code chạy**. Khi code, copy sang
   `app/src/shared/` và import từ đó; giữ nội dung giống hệt.
