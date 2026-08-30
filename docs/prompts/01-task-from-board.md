# NHẬN VIỆC TỪ BẢNG TASK — MẪU GIAO TASK CHO AI

Dùng file này khi bắt đầu **một task trong `docs/tasks/`** với ChatGPT, Claude, Codex, Gemini,
Copilot hoặc AI coding agent khác. Mục tiêu: phiên AI mới hiểu đúng việc, ranh giới A/B, điều
kiện hoàn thành, và **tự cập nhật trạng thái vào repo trước khi bàn giao**.

## Trước khi mở phiên AI

1. Mở `docs/tasks/board.md`, chọn task ở `TUẦN NÀY` (mỗi người tối đa một task `ĐANG LÀM`).
2. Mở hồ sơ `docs/tasks/tk-<id>.md`; chưa có thì tạo từ `docs/tasks/tk-template.md` và điền
   outcome, scope, branch, DoD. Quy trình đầy đủ: `docs/tasks/README.md`.
3. Đồng bộ `main`, tạo/switch đúng branch ghi trong hồ sơ.
4. Xác định brief module `docs/prompts/mXX-*.md` tương ứng.

## Chọn rõ chế độ làm việc

- Muốn AI **chỉ định hình hướng làm**: ghi "chỉ phân tích/lập kế hoạch, chưa sửa file".
- Muốn AI **thực hiện task**: ghi rõ "hãy sửa code, chạy test và commit cục bộ; dừng để review".
- `git push`, mở PR hoặc merge chỉ được phép khi người A ra một lệnh riêng, rõ ràng; không gộp quyền
  này vào câu giao task chung.
- Muốn AI **review**: cung cấp PR/diff và dùng thêm [`99-review.md`](99-review.md).

AI không được tự hiểu câu "xem giúp" là quyền sửa, commit, push hay merge.

## Prompt copy-paste

Thay toàn bộ phần trong dấu `<...>` trước khi gửi:

```text
Tôi đang làm OpsPilot trong repo hiện tại.

Vai trò của tôi: <A - Core/Algorithms | B - UI/Delivery>
Chế độ: <chỉ lập kế hoạch | hiện thực + test + commit cục bộ, dừng để review>

Task (hồ sơ trong repo):
- ID: <TK-XX> — đọc docs/tasks/tk-<xx>-<slug>.md và đối chiếu docs/tasks/board.md
- Title: <title>
- Owner: <A/B/Both>
- Deadline: <dd/mm/yyyy>
- Priority: <P0/P1/P2>
- Branch bắt buộc: <branch>
- Mục tiêu: <goal>
- Được sửa: <scope>
- Không được sửa: <avoid>
- Definition of Done:
  - [ ] <điều kiện 1>
  - [ ] <điều kiện 2>
  - [ ] <test/PR>

Trước khi làm:
1. Đọc đầy đủ CLAUDE.md, docs/README.md, docs/tasks/README.md,
   <docs/prompts/mXX-brief.md> và các contract mà brief yêu cầu.
2. Kiểm tra branch, git status và code hiện tại. Không ghi đè thay đổi chưa commit của người khác.
3. Tóm tắt lại outcome, ranh giới file, DoD và dependency/blocker. Nếu thiếu quyết định có thể
   làm thay đổi contract hoặc phạm vi, hãy hỏi tôi trước.

Khi thực hiện:
- Chỉ làm đúng task này; không thêm dependency/tính năng/refactor ngoài scope.
- Không tự sửa docs/contracts/. Nếu contract có vấn đề, dừng và báo chính xác điểm mâu thuẫn.
- Viết test và chạy các command kiểm tra phù hợp.
- Không đọc/in secret, không dùng credential của người còn lại.
- Không push, mở PR hoặc merge nếu người A chưa ra lệnh riêng.
- BẮT BUỘC — cập nhật trạng thái vào repo trước khi bàn giao:
  1. docs/tasks/tk-<xx>.md: thêm dòng nhật ký `UPDATE <ngày>` (đã xong gì / tiếp theo gì /
     test pass chưa) hoặc `BLOCKED <ngày>` (bước vướng / bằng chứng / đã thử / cần ai /
     điều kiện gỡ chặn).
  2. docs/tasks/board.md: khi handoff local đủ bằng chứng, dòng task → `CHỜ REVIEW` với ghi chú
     `local <head-sha> · chưa push`; nếu chưa đủ thì giữ `ĐANG LÀM` hoặc chuyển `BLOCKED`.
  3. Commit cả hai thay đổi trên CÙNG commit/PR của task — không tách commit riêng.
  Không tuyên bố "xong task" nếu chưa làm đủ ba việc trên.

Khi bàn giao, trả về:
1. Outcome đã đạt/chưa đạt.
2. File đã thay đổi và lý do.
3. Test đã chạy cùng kết quả chính xác.
4. Commit/branch; PR chỉ có nếu người A đã cho phép push/mở PR bằng lệnh riêng.
5. Phần DoD chưa đạt, rủi ro hoặc blocker.
6. Xác nhận đã cập nhật board + tk-file (dán lại dòng nhật ký vừa ghi).
7. Lệnh tái hiện để người sau tự chạy lại.
```

## Người dùng phải kiểm tra trước khi merge

- `git diff` chỉ chứa phạm vi task (kèm `docs/tasks/board.md` + tk-file).
- Không có secret, file cá nhân hoặc ảnh ngoài ý muốn trong commit.
- Test AI báo pass có output hoặc có thể chạy lại.
- Người làm giải thích được code AI tạo ra.
- Trạng thái trên board khớp thực tế (PR đã mở chưa, đang chờ gì).
- Chỉ chuyển `HOÀN THÀNH` sau khi PR merge vào `main` và DoD đủ bằng chứng.

Nếu AI đề xuất đổi kiến trúc/contract: ghi đề xuất vào nhật ký tk-file, hai người thống nhất,
rồi mới sửa contract và ghi `DECISIONS.md` trước khi tiếp tục code.
