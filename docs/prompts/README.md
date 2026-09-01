# PROMPT CHO AI — cách dùng

Mục tiêu: **bất kỳ model AI nào** (Claude, GPT, Gemini, Copilot, Cursor…) cũng sinh ra code
khớp với phần còn lại của hệ thống, ở phiên thứ nhất hay phiên thứ hai trăm.

---

## Công thức mỗi phiên làm việc

```
[0] một task trong docs/tasks/board.md ở ĐANG LÀM  ← outcome, scope, branch và DoD
[1] docs/tasks/tk-<id>.md                            ← hồ sơ task (nhật ký, blocker, PR)
[2] docs/prompts/01-task-from-board.md               ← mẫu giao task và chọn quyền cho AI
[3] docs/prompts/00-context-chung.md                 ← ngữ cảnh dự án, luôn đọc
[4] docs/prompts/mXX-<module>.md                     ← đúng MỘT module đang làm
[5] các file trong docs/contracts/ mà brief đó liệt kê ở mục "Đọc trước"
[6] (nếu sửa code có sẵn) file code hiện tại trên đúng branch
```

**Không dán cả repo.** Ngữ cảnh loãng làm AI bịa tên hàm và "cải tiến" interface — đúng thứ
phá hỏng hợp đồng giữa hai người.

Với Claude Code: `CLAUDE.md` được nạp tự động, chỉ cần nói *"làm module M4 theo
docs/prompts/m04-deploy-pipeline.md"*.

---

## Danh sách brief

| File | Module | Người | Tuần |
|---|---|---|---|
| [`01-task-from-board.md`](01-task-from-board.md) | Mẫu giao một task (hồ sơ trong `docs/tasks/`) cho AI, chọn lập kế hoạch/thực hiện/review | cả hai | mọi task |
| [`tk-a16-worker-luna.md`](tk-a16-worker-luna.md) | Prompt thực thi đầy đủ TK-A16: quyền Git, CP1–CP4, log và handoff local | A | W3 |
| [`m00-scaffold.md`](m00-scaffold.md) | Khởi tạo repo, cấu hình build | A | W1 |
| [`m01-ssh-manager.md`](m01-ssh-manager.md) | SSH manager | A | W1 |
| [`m02-credential.md`](m02-credential.md) | Mã hoá credential | A | W1 |
| [`m03-detectors.md`](m03-detectors.md) | Detector engine | A | W2 |
| [`m04-deploy-pipeline.md`](m04-deploy-pipeline.md) | Deploy pipeline | A | W2–W4 |
| [`m05-collector.md`](m05-collector.md) | Metric collector | B | W1–W2 |
| [`m06-poller-rule.md`](m06-poller-rule.md) | Poller + rule engine | A | W3–W4 |
| [`m07-ml-service.md`](m07-ml-service.md) | ML service | A | W1–W3 |
| [`m08-auto-rollback.md`](m08-auto-rollback.md) | Auto-rollback | A | W5 |
| [`m09-migrate.md`](m09-migrate.md) | Migrate pipeline | A | W6–W7 |
| [`m10-ui.md`](m10-ui.md) | Giao diện | B | W1–W10 |
| [`m11-experiments.md`](m11-experiments.md) | Thí nghiệm + phân tích | B | W6–W10 |
| [`m12-demo-apps.md`](m12-demo-apps.md) | 3 app demo + fault endpoint | B | W1, W6 |
| [`99-review.md`](99-review.md) | Prompt tự review trước khi mở PR | cả hai | mọi tuần |

---

## Quy tắc bất di bất dịch khi làm việc với AI

1. **AI không được đổi interface trong `docs/contracts/`.** Thấy có vấn đề thì **báo, không
   tự sửa**. Người quyết định, rồi mới sửa contract + ghi `DECISIONS.md`.
2. **AI không được thêm dependency** ngoài danh sách đã duyệt ở
   [`../09-moi-truong-dev.md`](../09-moi-truong-dev.md) mục 2.
3. **Không hiểu code AI viết → không merge.** Đây là quy tắc nghiêm túc: hội đồng sẽ hỏi.
4. Mỗi module: **code + test bằng CLI trước → chạy thật với VPS → mới nối vào UI**.
5. AI đề xuất cách làm khác và nhóm **chấp nhận** → ghi 1 dòng `DECISIONS.md` kèm lý do.
   Đó là bằng chứng nhóm có phán xét, không chỉ dán code.
6. **Người làm việc với AI nào cũng phải bắt AI đó cập nhật `docs/tasks/board.md` + hồ sơ
   `docs/tasks/tk-*.md`** (nhật ký, lệnh tái hiện, local HEAD; link PR chỉ khi đã được phép) trước khi bàn giao kết quả — xem
   `docs/tasks/README.md` mục 3. AI không cập nhật = người dùng không nhận kết quả đó.
7. **Worker mặc định không có quyền push/mở PR/merge.** Chỉ commit cục bộ và bàn giao để review;
   quyền đẩy remote phải do A cấp riêng sau đó.

---

## Câu mở đầu gợi ý (dán sau khối ngữ cảnh)

> Hãy hiện thực module `<MXX>` theo đúng brief dưới đây và các hợp đồng kỹ thuật đã cung cấp.
> Yêu cầu:
> - Bám **chính xác** tên hàm, tham số, kiểu trả về, tên trường trong contract. Không đổi tên,
>   không "cải tiến" interface.
> - Không thêm thư viện ngoài danh sách đã duyệt.
> - Viết kèm script CLI để chạy thử module này độc lập, không cần giao diện.
> - Chỗ nào brief chưa đủ thông tin để quyết định: **hỏi tôi, đừng tự giả định**.
> - Viết comment tiếng Việt cho những chỗ có đánh đổi thiết kế.
