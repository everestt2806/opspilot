# NHẬN VIỆC TỪ TRELLO — MẪU GIAO TASK CHO AI

Dùng file này khi bắt đầu **một card Trello** với ChatGPT, Claude, Codex, Gemini, Copilot hoặc
AI coding agent khác. Mục tiêu là để phiên AI mới hiểu đúng việc, ranh giới A/B và điều kiện hoàn thành.

## Trước khi mở phiên AI

1. Kéo card sang `ĐANG LÀM` và đảm bảo mình chỉ có một card ở trạng thái này.
2. Đồng bộ `main`, tạo/switch đúng branch ghi trên card.
3. Copy title, description, checklist và URL card; không copy secret hoặc Trello token.
4. Xác định brief module `docs/prompts/mXX-*.md` tương ứng.

## Chọn rõ chế độ làm việc

- Muốn AI **chỉ định hình hướng làm**: ghi “chỉ phân tích/lập kế hoạch, chưa sửa file”.
- Muốn AI **thực hiện task**: ghi rõ “hãy sửa code, chạy test, commit và push branch; không merge PR”.
- Muốn AI **review**: cung cấp PR/diff và dùng thêm [`99-review.md`](99-review.md).

AI không được tự hiểu câu “xem giúp” là quyền sửa, commit, push hay merge.

## Prompt copy-paste

Thay toàn bộ phần trong dấu `<...>` trước khi gửi:

```text
Tôi đang làm OpsPilot trong repo hiện tại.

Vai trò của tôi: <A - Core/Algorithms | B - UI/Delivery>
Chế độ: <chỉ lập kế hoạch | hiện thực + test + commit + push branch, không merge>

Trello card:
- URL: <url card hoặc “board private, nội dung ở dưới”>
- Title: <title>
- Owner: <A/B/Both>
- Deadline: <dd/mm/yyyy>
- Priority/labels: <P0/P1/P2 và labels>
- Branch bắt buộc: <branch>
- Mục tiêu: <goal>
- Được sửa: <scope>
- Không được sửa: <avoid>
- Definition of Done:
  - [ ] <điều kiện 1>
  - [ ] <điều kiện 2>
  - [ ] <test/PR>

Trước khi làm:
1. Đọc đầy đủ CLAUDE.md, docs/README.md, docs/18-trello-workflow.md,
   <docs/prompts/mXX-brief.md> và các contract mà brief yêu cầu.
2. Kiểm tra branch, git status và code hiện tại. Không ghi đè thay đổi chưa commit của người khác.
3. Tóm tắt lại outcome, ranh giới file, DoD và dependency/blocker. Nếu thiếu quyết định có thể làm
   thay đổi contract hoặc phạm vi, hãy hỏi tôi trước.

Khi thực hiện:
- Chỉ làm đúng card này; không thêm dependency/tính năng/refactor ngoài scope.
- Không tự sửa docs/contracts/. Nếu contract có vấn đề, dừng và báo chính xác điểm mâu thuẫn.
- Viết test và chạy các command kiểm tra phù hợp.
- Không đọc/in secret, không dùng credential của người còn lại.
- Không merge PR và không tự tuyên bố Trello card đã Done.

Khi bàn giao, trả về:
1. Outcome đã đạt/chưa đạt.
2. File đã thay đổi và lý do.
3. Test đã chạy cùng kết quả chính xác.
4. Commit/branch/PR (nếu chế độ cho phép).
5. Phần DoD chưa đạt, rủi ro hoặc blocker.
6. Một comment UPDATE/REVIEW ngắn để tôi dán vào Trello.
```

## Người dùng phải kiểm tra trước khi cập nhật Trello

- `git diff` chỉ chứa phạm vi card.
- Không có secret, file cá nhân hoặc ảnh ngoài ý muốn trong commit.
- Test AI báo pass có output hoặc có thể chạy lại.
- Người làm giải thích được code AI tạo ra.
- Có PR thì URL PR đã được dán vào card.
- Chỉ chuyển `HOÀN THÀNH` sau khi PR merge vào `main` và DoD đủ bằng chứng.

Nếu AI đề xuất đổi kiến trúc/contract, tạo hoặc cập nhật card label `Contract - ca hai duyet`, hai người
thống nhất, rồi ghi quyết định vào `DECISIONS.md` trước khi tiếp tục code.
