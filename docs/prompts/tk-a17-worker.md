# Prompt Worker — giao đúng một chặng

> Bản giao 11/09: A yêu cầu lập kế hoạch để giao Worker triển khai. Toàn bộ phạm vi nằm ở
> [plan chi tiết](../24-ke-hoach-demo-theo-chang.md), đặc biệt ma trận R01–R25 và mục 8–10.
> Sao chép khối đầu để giao lượt đầu; các khối sau chỉ dùng khi đã có review tương ứng.
> Có khảo sát C00 local trước đó, nhưng chưa có chặng nào APPROVED.

Prompt khởi động (chỉ C00):

```text
Bạn là Worker của OpsPilot; Leader chịu trách nhiệm review. Chỉ thực hiện TK-A17/C00.
Đọc CLAUDE.md, docs/tasks/README.md, docs/tasks/board.md,
docs/24-ke-hoach-demo-theo-chang.md, docs/tasks/tk-a17-demo-checkpoint.md,
docs/tasks/tk-a17-worker-handoff.md và docs/tasks/tk-a17/c00-baseline.md.
Đọc docs/prompts/tk-a17-worker-playbook.md để có thứ tự thi công/file/lệnh và tiêu chí demo.
Đọc docs/tasks/tk-a17/preflight-11-09.md để kế thừa khảo sát, giới hạn và việc C00 còn thiếu.
Ma trận R01–R25 trong docs/24 là checklist yêu cầu checkpoint; không chỉ đọc bảng tên chặng.
Làm theo contract/spec được chặng yêu cầu. Không code C01 hoặc chặng sau.

Plan gốc ở plan/a17-demo-checkpoint, baseline code 683bfc6. Nhánh Worker
feat/a17-demo-checkpoint đã được tạo từ ac6d8cd và đang chứa cập nhật kế hoạch 11/09.
Kiểm tra git status/HEAD và đọc hồ sơ mới nhất trên nhánh này; tiếp tục HEAD hiện có.
Nếu làm trên checkout khác, phải nhận commit chứa kế hoạch 11/09 trước khi START.
Không checkout lùi/rebase/rewrite; giữ nguyên untracked và stash của A. Các helper/evidence
C00 local được liệt kê trong preflight chưa phải code đã review; kiểm tra trước dùng/commit.
Được sửa/test/commit local; không push/PR/merge/spawn subagent. Commit tiếng Anh,
bullet mô tả thay đổi; UI/tài liệu tiếng Việt. Không dọn VPS/app B hoặc dữ liệu thật.

Mục tiêu demo: người không biết DevOps vẫn thấy website nhanh → chậm/lỗi → cảnh báo
→ OpsPilot TỰ rollback → xác minh website tốt lại và ghi chú còn nguyên. A trình chiếu,
thầy quan sát. C08 bắt buộc, tách C08A/B/C; mọi số liệu/hành động phải thật.
Không mở thêm framework/migrate/theme/dependency hoặc sửa contract tùy ý.
Không tuyên bố ML-trigger/early-detection khi chỉ có rule-trigger. ML train/score thật
là yêu cầu riêng; null/stale/mất dữ liệu không được hiển thị khỏe hoặc điền số giả.

Đầu lượt, nêu ngắn chặng/phạm vi, base SHA và các kiểm tra còn thiếu so với khảo sát,
rồi thực hiện trong quyền đã giao. Không dừng chỉ để xin lại quyền sửa/test/commit local.
Nếu thiếu credential hoặc contract thật sự chặn, ghi blocker/proposal cụ thể, tiếp tục
phần độc lập trong chặng; không xin paste secret và không tự vượt live/review gate.

Ghi START, thực hiện đúng C00, test và ghi evidence. Tạo
docs/tasks/tk-a17/handoff-c00.md theo mẫu, update sổ bàn giao/board/task log.
Ghi branch/base/code HEAD/docs HEAD, commits, commands/cwd/runtime/exit code,
test count, evidence path và blocker. Không gọi test chưa chạy là PASS.
Map C00-T1…T5 và R liên quan tới evidence; yêu cầu các chặng sau ghi NOT_RUN.
Báo trạng thái app/ML/tunnel/VPS sau kiểm tra; không nhận ảnh app B là website A17.
Bàn giao READY_FOR_LOCAL_REVIEW hoặc BLOCKED, rồi dừng để A gửi Leader review.
```

Prompt giao chặng tiếp theo (A thay `<NN>` bằng ID được Leader mở):

```text
Thực hiện duy nhất TK-A17/C<NN> theo file chặng trong docs/tasks/tk-a17/.
Đọc task điều phối, sổ bàn giao, review chặng trước và source/contracts liên quan.
Đọc ma trận yêu cầu R01–R25 trong docs/24 và phần playbook liên quan; giữ toàn bộ yêu cầu
đã chốt, chỉ thực thi phạm vi chặng này. C08 dùng ID c08a/c08b/c08c tương ứng.
Xác nhận chặng trước APPROVED đúng code đang kế thừa; C08 theo thứ tự C08A → C08B → C08C.
Tiếp tục HEAD hiện tại, ghi base SHA và START. Chỉ sửa scope chặng này, dùng GitNexus
context/impact nếu khả dụng và kiểm tra source trực tiếp. Làm đầy đủ test/DoD/evidence,
commit local tiếng Anh, tạo handoff-c<NN>.md, update board/log/sổ bàn giao rồi dừng review.
Map test case và yêu cầu R liên quan tới evidence; ghi phần chưa đủ/NOT_RUN và runtime sau test.
Không push/PR/merge, không tự approve hay làm chặng kế tiếp.
```

Prompt sửa sau review:

```text
Sửa TK-A17/C<NN> theo docs/tasks/tk-a17/review-c<NN>.md, tiếp tục HEAD hiện tại.
Map từng finding tới fix commit + regression + evidence trong REVIEW-FIX.
Đóng đủ BLOCKER/MAJOR của chặng, test lại phần bị ảnh hưởng, update handoff/board/log.
Không tự đóng finding thay reviewer hoặc mở chặng tiếp; commit local, không push/PR/merge.
```
