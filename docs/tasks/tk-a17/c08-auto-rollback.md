# C08 — Tự khôi phục theo score: bước tiến bắt buộc

C08 thay đổi từ tùy chọn sang bắt buộc theo yêu cầu demo mới của A. A trình chiếu, thầy
quan sát hệ thống tự xử lý sau khi bật fault. C07 thủ công là nền đã kiểm chứng, không thay C08.

## Thứ tự review

| Phần | Đầu vào       | File giao                               | Kết quả                                           |
| ---- | ------------- | --------------------------------------- | ------------------------------------------------- |
| C08A | C07 APPROVED  | [Quyết định](c08a-decision.md)          | Policy/candidate đúng, chưa gọi rollback          |
| C08B | C08A APPROVED | [Coordinator](c08b-coordinator.md)      | Completion, durable guard, restart/failure đúng   |
| C08C | C08B APPROVED | [UI và live](c08c-live-presentation.md) | Automatic recovery thật, business verification rõ |

Worker chỉ làm một phần mỗi lượt rồi dừng review. Dùng handoff-c08a/b/c.md,
review-c08a/b/c.md và evidence c08a/b/c/ riêng. Không gom cả M8 vào một diff.
Đọc [playbook](../../prompts/tk-a17-worker-playbook.md) và M08/contract trước code.

## Tiêu chí tổng C08

- Quyết định từ score/method thật; chống replay/stale, chọn target hợp lệ.
- Pipeline được gọi tự động, completion/attribution/cooldown/failure đúng.
- Website được xác minh bằng business samples mới, không chỉ /health.
- Image/current deployment đổi thật, marker PostgreSQL còn, collector tiếp tục.
- Không có A/helper bấm rollback/reset trước kết quả trong live window.
- Rule-triggered live là gate bắt buộc có nhãn đúng; 3 ML+ensemble vẫn score thật.
  ML-triggered/early-detection chỉ tuyên bố khi có evidence riêng.

M08 research DoD memory-leak/early-detection không tự hoàn thành từ functional gate này.
Không còn DEFERRED để vượt C09. Nếu blocker chưa giải quyết: bàn giao BLOCKED,
giữ auto OFF và hỏi A định hướng scope qua review, không báo DEMO_READY.
