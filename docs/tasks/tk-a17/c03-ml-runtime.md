# ML runtime — DEFERRED khỏi demo 14/09/2026

> **DEFERRED đến ít nhất 28/09/2026.** File này giữ lại để không mất phạm vi ML đã lập trước đó.
> C03 hiện tại đã được đổi thành deploy ba source theo [Worker plan](c03-worker-plan.md).

## Quyết định phạm vi

- Không train, score, reset model, thay feature/threshold hoặc chạy ML live trong C03–C05 mới.
- Giữ nguyên collector, metric/score và model state hiện có để tiếp tục thu dữ liệu.
- Không dùng fixture hoặc số giả để thay cho kết quả ML trong demo.
- Khi mở lại sau 28/09, phải lập chặng/ID mới và review lại baseline provenance, train thật,
  deployment isolation, trạng thái ML down/recover và score của ba model + ensemble.

## Câu trình bày thống nhất

“Phần ML vẫn đang phát triển và cần thêm dữ liệu vận hành đủ sạch để huấn luyện, kiểm chứng. Nhóm dời
phần train/score và đánh giá sang ít nhất hai tuần sau demo này.”

Phạm vi cũ chưa được chạy và không được đánh dấu hoàn thành từ bằng chứng C02.
