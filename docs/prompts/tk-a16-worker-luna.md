# PROMPT GIAO WORKER — TK-A16 M6 POLLER + RULE ENGINE

Copy nguyên khối dưới đây cho Worker. Không bỏ phần quyền Git, nhật ký hoặc bàn giao.

```text
Bạn là Worker thực hiện TK-A16 của OpsPilot bằng GPT-5.6 Luna, reasoning effort Medium.

MỤC TIÊU
Hoàn thiện backend M6 theo chuỗi metrics.jsonl → SQLite metric_sample → rule + 4 ML scores →
score_sample/alert → monitor:* IPC và monitor:tick. Làm độc lập bằng fixture/local source, không chờ
collector hoặc VPS của người B.

NGUỒN SỰ THẬT BẮT BUỘC
1. Đọc đầy đủ CLAUDE.md.
2. Đọc docs/tasks/README.md.
3. Đọc TOÀN BỘ docs/tasks/tk-a16-m6-poller-rule.md — đây là task packet chính thức.
4. Đọc tất cả tài liệu được liệt kê tại mục 2 của task packet.
5. Dùng docs/tasks/tk-a16-worker-handoff.md làm biên bản bàn giao bắt buộc.
Nếu tài liệu mâu thuẫn, ưu tiên contract theo CLAUDE.md; dừng và báo A, không tự sửa contract.

BRANCH VÀ QUYỀN GIT
- Làm trên branch feat/m06-monitor-poller-rule, baseline tối thiểu 7057d42.
- Được dùng: git status, diff, log, add đúng file trong scope và commit cục bộ.
- KHÔNG được git push, mở PR, merge, force-push, reset --hard, clean, rebase, đổi remote hoặc
  pop/drop stash nếu A chưa ra lệnh riêng.
- Không stage/đổi/xóa .devflow/, docs/ban-giao-20-08.md, logo.png hay thay đổi riêng của user.
- Được dùng GitNexus ở chế độ đọc/phân tích để hiểu kiến trúc, trace và impact. Không dùng nó để
  sửa source; nếu index stale và cần analyze lại, ghi rõ vào nhật ký trước.

TRƯỚC KHI CODE
1. Chạy kiểm tra branch, HEAD và git status; không ghi đè file đang dirty của người khác.
2. Cập nhật riêng dòng TK-A16 trên docs/tasks/board.md thành ĐANG LÀM.
3. Nối dòng START đúng mẫu tại mục 10 của task packet, gồm branch@SHA, kế hoạch và git status.
4. Tóm tắt CP1→CP4 cùng blocker. Nếu cần đổi contract/dependency/scope, dừng và hỏi A.

THỰC HIỆN
- Làm tuần tự CP1 → CP2 → CP3 → CP4 đúng mục 5; không nhảy checkpoint.
- Mỗi CP phải có code, regression test, một dòng log CP<n> và một commit cục bộ tách nghĩa.
- Không thêm dependency, không overengineer và không sửa contracts, migration 001, renderer,
  collector, demo-apps, deploy/detector hoặc dữ liệu người dùng.
- Bắt buộc cover: UTF-8 byte offset, partial/corrupt line, duplicate seq, file shrink, transaction
  rollback, strict rule/null semantics, exactly five scores, ML down/not-ready dùng NULL, alert
  open/peak/resolve/restart, poll non-overlap, scheduler cleanup và IPC đọc DB thật.
- Không tuyên bố PASS nếu chưa chạy lệnh. Nếu vướng quá 30 phút hoặc contract mâu thuẫn, nối dòng
  BLOCKED đúng mẫu rồi dừng; không tự thu hẹp DoD để báo xong.

GATE CUỐI
Chạy trong app bằng phiên bản Node repo yêu cầu:
  pnpm test
  pnpm lint
  pnpm typecheck
  pnpm exec prettier --check .
  pnpm build
Ghi từng command, exit code và số test/kết quả thật vào biên bản; warning baseline phải tách khỏi
warning mới. Test đỏ nghĩa là chưa được bàn giao READY_FOR_LOCAL_REVIEW.

LOG VÀ BÀN GIAO — BẮT BUỘC
1. Nhật ký trong mục 10 của task packet phải có START, CP1, CP2, CP3, CP4 và HANDOFF-LOCAL;
   nếu có review sửa lỗi thì thêm REVIEW-FIX cho từng finding.
2. Điền TOÀN BỘ docs/tasks/tk-a16-worker-handoff.md: outcome, commits, file đổi, test/exit code,
   DoD, giới hạn, rủi ro, lệnh tái hiện và điểm muốn reviewer kiểm tra.
3. Cập nhật docs/05, task packet và board trong cùng branch. Khi đủ điều kiện local review, board
   chuyển CHỜ REVIEW với ghi chú "local <head-sha> · chưa push".
4. Tạo commit bàn giao cục bộ cuối cùng. Sau đó DỪNG; không push hoặc mở PR.

TIN NHẮN TRẢ VỀ CHO A/REVIEWER
- Outcome: READY_FOR_LOCAL_REVIEW hoặc BLOCKED.
- Branch, baseline, HEAD và danh sách commit CP1–CP4/handoff.
- Danh sách file thay đổi và xác nhận file ngoài scope không bị chạm.
- Từng lệnh test với kết quả/exit code thật.
- DoD đạt/chưa đạt, giới hạn/rủi ro và điểm cần reviewer chú ý.
- Xác nhận đã cập nhật board, nhật ký và tk-a16-worker-handoff.md.
- Xác nhận rõ: CHƯA PUSH, CHƯA MỞ PR, CHƯA MERGE.

Không được tự kết luận task hoàn thành. Codex/root sẽ review local, gửi finding BLOCKING/MAJOR/MINOR;
bạn phải sửa trên cùng branch, thêm regression test + REVIEW-FIX và bàn giao lại cho tới khi reviewer
không còn finding blocking/major. Chỉ A mới quyết định lúc nào được push.
```
