# TASK VÀ TRẠNG THÁI — NGUỒN SỰ THẬT TRONG REPO (từ 19/08/2026)

> **Thư mục này là nguồn sự thật cho task và trạng thái** — GitHub là nguồn sự thật cho
> code/test/merge. Không dùng GitHub Issues.

## 1. Hai loại file

| File | Nội dung | Ai sửa |
|---|---|---|
| `board.md` | Một bảng tổng: mọi task, chủ, hạn, trạng thái, branch, PR, ghi chú | Người làm + AI của người đó |
| `tk-*.md` | Hồ sơ một task: mục tiêu, ranh giới file, DoD, **nhật ký**, lệnh tái hiện, link PR | Người làm + AI; tạo từ `tk-template.md` khi nhận task, đọc tiếp khi bàn giao |

Toàn bộ lịch sử trạng thái nằm trong git — diff được, review được như code. Không cần tool ngoài.

## 2. Vòng đời task

```
BACKLOG → TUẦN NÀY → ĐANG LÀM → CHỜ REVIEW → HOÀN THÀNH
                        │            │
                        └→ BLOCKED ←─┘  (hết vướng thì quay lại ĐANG LÀM, ghi dòng UPDATE)
```

- WIP: **mỗi người tối đa 1 task `ĐANG LÀM`**; phần còn lại đứng `TUẦN NÀY` theo thứ tự kéo.
- Vướng > 30 phút → `BLOCKED` kèm nguyên nhân + điều kiện gỡ chặn (ghi cả vào nhật ký tk).
- Mặc định Worker chỉ commit cục bộ; **không được push/mở PR nếu A chưa yêu cầu riêng**. Khi đã có
  handoff local đủ bằng chứng, task được sang `CHỜ REVIEW` với ghi chú `local <sha> · chưa push`.
  `HOÀN THÀNH` chỉ khi PR được phép mở, merge `main`, test pass và DoD đủ bằng chứng.
- Chủ nhật/tối thứ 6: task trễ về đầu hàng tuần sau hoặc về `BACKLOG` có ghi lý do.

## 3. Cập nhật trạng thái — BẮT BUỘC với mọi phiên AI (A và B)

Đây là luật ràng buộc, vi phạm thì PR bị reject, giống như thiếu test:

1. **Đầu phiên:** đọc `board.md` → chuyển task của mình thành `ĐANG LÀM` (nếu đủ slot WIP) →
   thêm dòng `START <ngày> — <kế hoạch phiên>` vào nhật ký tk-file.
2. **Cuối mỗi lần làm:** thêm dòng `UPDATE <ngày>`: đã xong gì, tiếp theo gì, test gì pass/chưa.
3. **Bàn giao local:** ghi `HANDOFF-LOCAL <ngày> — <head sha> · kết quả test · file handoff`;
   board chuyển `CHỜ REVIEW` với ghi chú `local <sha> · chưa push`. Chỉ sau khi A cho phép push mới
   bổ sung `REVIEW <ngày> — PR: <url> · ...` và link PR.
4. **PR merge:** tick DoD → ghi `DONE <ngày> — PR <url> · test <kết quả> · việc tiếp theo` →
   board chuyển `HOÀN THÀNH`.
5. **Vướng > 30 phút:** ghi `BLOCKED <ngày> — <bước vướng> / <bằng chứng> / <đã thử> /
   <cần ai> / <điều kiện gỡ>`; board chuyển `BLOCKED`.

**AI không được tuyên bố "xong task" nếu chưa cập nhật `board.md` + tk-file.** Người review
kiểm tra mục này trước khi approve — cùng cấp độ với kiểm tra test xanh. Người sau nhận task
chỉ cần đọc tk-file + board là hiểu toàn bộ ngữ cảnh, **không hỏi lại người trước**.

Cập nhật trạng thái đi **cùng commit/PR của task** (cùng nhánh), không phải commit riêng sau đó.

## 4. Quy ước

- Trạng thái hợp lệ: `BACKLOG | TUẦN NÀY | ĐANG LÀM | CHỜ REVIEW | HOÀN THÀNH | BLOCKED`.
- **Không sửa task của người kia**, trừ khi: (a) bug chặn đã báo trong nhật ký, hoặc
  (b) chuyển vùng sở hữu có dòng ghi rõ trong tk-file ("A làm thay B từ <ngày> vì…").
- Tên file hồ sơ: `tk-<id>-<slug>.md`, id theo bảng (`TK-A*` = A, `TK-B*` = B, `TK-S*` = chung).
- Mọi ngày trong nhật ký viết `dd/mm`, tham chiếu deadline luôn là ngày thật (xem `docs/04`).

## 5. Giao task cho AI

Dùng [`docs/prompts/01-task-from-board.md`](../prompts/01-task-from-board.md) kèm tk-file của
task — không dán cả board. AI làm xong phải tự cập nhật tk-file + board (mục 3) trước khi trả
kết quả.

Quyền mặc định khi giao AI là **sửa + test + commit cục bộ**. `git push`, mở PR và merge không nằm
trong quyền mặc định; chỉ được làm sau một lệnh riêng, rõ ràng của A. TK-A16 có prompt và mẫu bàn
giao chuyên biệt tại [`../prompts/tk-a16-worker-luna.md`](../prompts/tk-a16-worker-luna.md).

## 6. Nhịp tuần

| Khi | Việc |
|---|---|
| Thứ Hai | Kéo task vào tuần; chốt owner/hạn/scope/DoD vào tk-file mới; cập nhật dòng board |
| Mỗi phiên | Nhật ký START/UPDATE trong tk-file; sửa dòng board khi đổi trạng thái |
| Có PR | Sang `CHỜ REVIEW` + link PR cả ở board và tk-file |
| Thứ Sáu | Rà task trễ (hạn < hôm nay, chưa HOÀN THÀNH) → ưu tiên tuần sau; chạy gate tuần |
