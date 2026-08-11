# Bản đồ tài liệu

> Nguyên tắc: **mỗi thông tin chỉ tồn tại ở đúng một chỗ.** File khác cần thì trỏ link,
> không copy lại. Copy lại = hai nguồn sự thật = AI làm sai.

## Thứ tự ưu tiên khi mâu thuẫn

`docs/contracts/` → `01-ke-hoach.md` → các file còn lại.
Phát hiện mâu thuẫn → dừng, báo người dùng, ghi vào `DECISIONS.md` sau khi sửa.

---

## Tài liệu nền

| File | Nội dung | Khi nào đọc |
|---|---|---|
| [`00-de-tai-goc.md`](00-de-tai-goc.md) | Đề tài đã nộp giảng viên — **bất biến**, không sửa | Khi cần đối chiếu "đã hứa gì" |
| [`01-ke-hoach.md`](01-ke-hoach.md) | Kiến trúc chốt + spec 10 module M1–M10 + danh sách không làm | Trước khi code bất kỳ module nào |
| [`02-ui-ux-spec.md`](02-ui-ux-spec.md) | Design token, 7 màn hình, quy tắc UX | Khi code renderer |
| [`03-quy-trinh-team.md`](03-quy-trinh-team.md) | Git flow, nhịp làm việc, quy tắc dùng AI, review chéo | Tuần 0, và mỗi đầu tuần |
| [`04-timeline.md`](04-timeline.md) | Lịch 16 tuần theo ngày thật, DoD từng tuần, quy tắc cắt phạm vi | Mỗi đầu tuần |
| [`05-truy-vet-yeu-cau.md`](05-truy-vet-yeu-cau.md) | Ma trận FR/NFR → module → contract → test → màn hình → tuần | Khi cần biết "còn thiếu gì" |
| [`06-glossary-quy-uoc.md`](06-glossary-quy-uoc.md) | Thuật ngữ, đơn vị, timezone, quy ước đặt tên | Trước khi đặt tên bất cứ thứ gì |
| [`18-trello-workflow.md`](18-trello-workflow.md) | Board, trạng thái, card template và script dựng task W1 | Khi tạo/cập nhật Trello |

## Kỹ thuật

| File | Nội dung |
|---|---|
| [`contracts/`](contracts/) | **Hợp đồng kỹ thuật** — schema, API, IPC, interface, format file. Xem [`contracts/README.md`](contracts/README.md) |
| [`08-vps-setup.md`](08-vps-setup.md) | Runbook dựng VPS từ đầu trong 30 phút |
| [`09-moi-truong-dev.md`](09-moi-truong-dev.md) | Setup máy dev (Windows), dependency đã duyệt, bẫy đã biết |
| [`10-quy-uoc-code.md`](10-quy-uoc-code.md) | Cấu trúc code, xử lý lỗi, logging, quy ước async/SSH |
| [`11-chien-luoc-test.md`](11-chien-luoc-test.md) | Unit test (chỉ 3 chỗ), smoke test 10 phút, soak test 24h |
| [`14-quyet-dinh-kien-truc.md`](14-quyet-dinh-kien-truc.md) | 10 ADR — trade-off đã cân nhắc, dùng để trả lời phản biện |

## Thí nghiệm & báo cáo

| File | Nội dung |
|---|---|
| [`07-giao-thuc-thi-nghiem.md`](07-giao-thuc-thi-nghiem.md) | **Phần ăn điểm nhất.** Kịch bản fault, ground truth, quy trình 1 run, phân tích offline |
| [`12-outline-bao-cao.md`](12-outline-bao-cao.md) | Outline 6 chương, phân công, lịch viết, quy tắc trích dẫn |
| [`13-so-rui-ro.md`](13-so-rui-ro.md) | Risk register, review 2 tuần/lần |
| [`15-checklists.md`](15-checklists.md) | Tuần 0, smoke test, hằng tuần, trước thí nghiệm, ngày bảo vệ |
| [`16-bao-ve-va-qa.md`](16-bao-ve-va-qa.md) | Slide, 3 lớp demo dự phòng, 15 câu hỏi phản biện + hướng trả lời |
| [`smoke-log.md`](smoke-log.md) | Nhật ký smoke test hằng tuần (vào phụ lục báo cáo) |

## Cho AI

| File | Nội dung |
|---|---|
| [`prompts/00-context-chung.md`](prompts/00-context-chung.md) | Khối ngữ cảnh dán vào đầu mọi phiên chat với model bất kỳ |
| [`prompts/01-task-from-trello.md`](prompts/01-task-from-trello.md) | Mẫu giao một Trello card cho AI, gồm scope, DoD, quyền sửa/commit/push và mẫu bàn giao |
| [`prompts/m01`…`m12`](prompts/) | Một brief hoàn chỉnh cho mỗi module: input, output, ràng buộc, định nghĩa xong, cách test |
| [`prompts/99-review.md`](prompts/99-review.md) | Prompt để AI tự review code trước khi mở PR |

---

## ⚠ `_archive/`

Chứa 4 file kế hoạch **bản gốc 26/07/2026, đã bị thay thế**. Giữ lại chỉ để đối chiếu lịch sử
và để biết đã sửa những gì. **Không dùng làm tài liệu tham chiếu** — xem
[`_archive/README.md`](_archive/README.md).

---

## Quy tắc bảo trì tài liệu

- Sửa contract → ghi `DECISIONS.md` **cùng commit**.
- Xong một module → tick vào `05-truy-vet-yeu-cau.md`.
- Cuối mỗi tuần → cập nhật cột "Thực tế" trong `04-timeline.md` (bảng này vào phụ lục báo cáo).
- Tài liệu và code lệch nhau → sửa tài liệu trước, code sau.
