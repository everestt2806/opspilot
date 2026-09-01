# REVIEW 03 — TK-A16 M6 Poller + Rule Engine

> Reviewer: Codex/root
> Code được review: `1b9b222..6f1da37`
> Kết luận: **REQUEST_CHANGES — chưa đạt `READY_FOR_LOCAL_REVIEW`**
> Quyền Git: chỉ commit cục bộ; không push, mở PR hoặc merge khi A chưa yêu cầu.

## 1. Bằng chứng review độc lập

- Branch/code head: `feat/m06-monitor-poller-rule@6f1da37`.
- GitNexus đã re-analyze đến `6f1da37`: 34 symbol đổi, 20 execution flow bị ảnh hưởng; mức risk
  `critical` do thay đổi chạm scheduler → SSH → SQLite/ML → IPC.
- Node chuẩn workspace: `v22.23.2` qua `. .\tools\enter-node22.ps1`.
- Monitor suite: **14/14 PASS**.
- CLI SQLite/MonitorPoller thật: **PASS**, `3 metrics`, `15 scores`, `0 alerts`, retry insert `0`,
  offset `679`.
- Full suite reviewer chạy lại: **192/192 PASS**. Hai renderer timeout trong handoff là flaky test,
  không phải blocker và không được tiếp tục dùng làm lý do giữ board `BLOCKED`.
- Lint: 0 error, 16 warning Prettier baseline ở renderer. Typecheck, scoped Prettier và build: PASS.
- `git diff --check 1b9b222..6f1da37`: PASS.
- `.devflow/`, `docs/ban-giao-20-08.md`, `logo.png` và `stash@{0}` không bị chạm/stage.

## 2. Finding phải sửa

### R3-01 — BLOCKING — Auto-train vẫn không đúng lifecycle đã chốt

- `MonitorService` không có constructor/env option để tắt auto-train, trái yêu cầu thí nghiệm chủ
  động train trong task packet.
- Điều kiện tại `service.ts:117-125` yêu cầu cả `status.sample_count >= 150` và SQLite có ≥150 mẫu.
  Nếu state ML bị mất/reset nhưng SQLite còn baseline, status trả `sample_count=0`; duplicate DB
  không được ingest lại nên model có thể không bao giờ tự phục hồi/train từ baseline đã lưu.
- Auto-train được kiểm tra trước poll, nên mẫu thứ 150 chỉ có thể train ở tick sau; chấp nhận độ trễ
  một tick, nhưng phải quyết định dựa trên SQLite sau batch và `status.trained`, không phụ thuộc ML đã
  giữ đủ history.
- Lỗi status/train chỉ emit `running:false`; không ghi action log có rate-limit. `MonitorPoller` lại
  emit `running:true` cho từng mẫu ingest thành công và reset giới hạn log ở mỗi poll, có thể spam
  event/log theo thời gian.
- Không có test nào gọi `pollAll`, `status` hoặc `train`; commit R2-03 chỉ làm test count tăng nhờ hai
  test POSIX/scheduler không liên quan.
- Yêu cầu: tạo interface ML runtime typed có `status/ingest/train`; option auto-train bật mặc định và
  tắt được trong test/experiment; lấy baseline từ SQLite, train đúng một lần khi DB đủ 150 và status
  chưa trained; retry hợp lý sau failure; status/action log chỉ phát khi trạng thái đổi hoặc hết
  cooldown. Test 149, mẫu thứ 150, poll sau, restart/mất state ML, disabled và failure/recovery.

### R3-02 — BLOCKING — `monitor:tick` vẫn không chứa đúng batch

- `samples` đã lấy theo `result.sampleIds`, nhưng `service.ts:167-168` vẫn gọi `scores()` và
  `listAlertsFrom()` bằng timestamp của sample đầu.
- Hai mẫu cũ/mới trùng `ts_vps` làm score cũ bị phát lại. Query alert theo `alert.ts_vps` cũng có thể
  đưa alert cũ vào `new_alerts`; ngược lại, alert vừa mở ở batch hiện tại nhưng trỏ tới mẫu đầu chuỗi
  của batch trước có thể bị bỏ sót nếu chỉ lọc theo timestamp/sample hiện tại.
- Không có test `pollAll`/tick; thay đổi R2-07 chỉ sửa expectation `sampleIds` trong poller unit.
- Yêu cầu: transaction/poller trả định danh chính xác của sample, ScoreSet và alert vừa mở; repository
  query theo ID thay vì `fromTs`. Mỗi batch có dữ liệu phát đúng một tick, số score bằng số sample,
  `new_alerts` chỉ gồm alert vừa tạo. Test trùng timestamp, chuỗi high bắc qua hai batch, backfill
  timestamp cũ, batch rỗng và hai app tuần tự.

### R3-03 — MAJOR — Shutdown/error boundary vẫn có đường mắc kẹt và nuốt lỗi

- `index.ts:170-175` không có `try/finally`. Nếu tick hiện tại reject, `await monitorScheduler.stop()`
  reject; `quitting` đã là true nhưng ML/SSH không dọn và `app.quit()` không được gọi lại. Ứng dụng có
  thể không thoát được nếu không kill process.
- Interval callback trong `scheduler.ts:12-13` vẫn `.catch(() => undefined)`, nên DB/programming error
  mà `pollAll` chủ ý ném lên bị nuốt hoàn toàn, trái yêu cầu error boundary có log.
- Test mới chỉ chứng minh class `stop()` chờ Promise resolve; không test rejected poll hoặc thứ tự
  stop → disconnect → close DB của lifecycle Electron.
- Yêu cầu: shutdown phải cleanup/quit trong `finally`, log lỗi nhưng không mắc kẹt; scheduler nhận
  error callback/logger thay vì nuốt. Test pending poll resolve và reject, không tick mới, thứ tự đóng
  DB sau poll, cleanup vẫn chạy khi poll lỗi.

### R3-04 — MAJOR — Setting, label và threshold còn sai domain

- `setSetting` chưa validate `auto_rollback` là đúng `0|1`, `cooldown_minutes` là integer, miền
  `rule_mem_pct`, và empty patch vẫn ghi action `config_change` dù không đổi gì.
- `labelAlert` chưa runtime-validate label, không kiểm tra alert tồn tại và vẫn ghi success log khi
  UPDATE thay đổi 0 row; mutation label/log cũng chưa nguyên tử.
- Child ML method đã so với `ml_score_threshold`, nhưng `ensemble` vẫn tin
  `result.above_threshold.ensemble` do ML service tính ở threshold mặc định 0.7. Khi user đổi setting,
  child và ensemble dùng hai ngưỡng khác nhau.
- Test service vẫn chỉ là một case cũ, không test row chưa tồn tại, domain invalid, rollback action
  log, empty patch, label invalid/missing hay handler IPC.
- Yêu cầu: zod/runtime schema đầy đủ; mutation + action log nguyên tử; empty patch là no-op hoặc
  VALIDATION nhưng không ghi log giả; ensemble recompute theo majority của ba child tại threshold
  setting. Bổ sung test trực tiếp và qua IPC.

### R3-05 — MAJOR — Regression alert/ML/runtime và CLI fixture chưa đạt task packet

- Sau vòng sửa chỉ có 14 monitor test; hai test mới là scheduler wait và phép `node:path/posix` tự
  thân. `service-path.test.ts` không gọi production path builder nên có thể vẫn PASS nếu service bị
  đổi lại sai import.
- Alert suite vẫn chỉ có một case; chưa khóa NULL, first sample, peak ban đầu, restart giữa chuỗi
  high/low và năm method độc lập như DoD.
- Không có test MlApiClient response lỗi, bảy monitor IPC, train-now thiếu/đủ 150, exact tick, source
  error vs DB error hoặc auto-train.
- CLI đã chạy SQLite/poller thật — phần này tốt — nhưng fixture vẫn là ba dòng viết tay, chưa dùng dữ
  liệu sinh bởi `ml-service/scripts/gen_fake_series.py` hoặc fixture checked-in thực sự sinh từ script
  như task packet quy định.
- Yêu cầu: thêm các regression còn thiếu; test production helper/caller, không test lại chính thư
  viện chuẩn; CLI dùng fixture generator/derived fixture và vẫn chạy idempotency + DB counts thật.

### R3-06 — MINOR — Handoff/board không phản ánh HEAD và gate thật

- Handoff để `Head local = HEAD của commit handoff`, checkbox gate còn `188/190`, nhiều dòng vẫn nói
  Node 22 unavailable dù evidence ngay dưới đã dùng Node 22; review history vòng 2 vẫn `CHƯA SỬA`.
- Board chỉ ghi timeout là blocker, trong khi reviewer đã xác nhận full suite xanh và blocker thật là
  R3-01/R3-02.
- Yêu cầu: sau code fix, ghi exact SHA/range/count; cập nhật review history, DoD và board dựa trên
  reviewer gate. Không xóa lịch sử cũ, chỉ sửa trường tổng hợp hiện tại và nối log mới.

## 3. Thứ tự commit vòng sửa 3

Tạo commit mới sau reviewer HEAD hiện tại, không rewrite/rebase lịch sử:

1. `fix(monitor): complete auto train and exact tick batches` — R3-01, R3-02.
2. `fix(monitor): harden shutdown settings and alert semantics` — R3-03, R3-04.
3. `test(monitor): cover runtime lifecycle and generated fixture flow` — R3-05.
4. `docs(monitor): record review three handoff` — R3-06 và gate cuối.

Không sửa contract/migration/renderer/collector/deploy, không thêm dependency, không chạm file
untracked/stash của user. Mỗi commit code phải có regression tương ứng; không được dùng test count
tổng để thay bằng chứng scenario.

## 4. Gate và điều kiện bàn giao

```powershell
. .\tools\enter-node22.ps1
cd app
node --version
pnpm test -- --run src/main/monitor
pnpm try:monitor
pnpm test
pnpm lint
pnpm typecheck
pnpm exec prettier --check src/main/index.ts src/main/ipc.ts src/main/mlClient.ts src/main/monitor scripts/try-monitor.ts
pnpm build
```

Chỉ đổi board sang `CHỜ REVIEW` và outcome `READY_FOR_LOCAL_REVIEW` khi R3-01…R3-05 có code + test
thật, full gate Node 22 xanh và handoff đúng exact HEAD. Nếu renderer timeout một lần, chạy lại chính
file timeout rồi full suite; không tự kết luận blocker khi reviewer/baseline chạy xanh.

## 5. Prompt giao Worker vòng sửa 03

```text
Tiếp tục TK-A16 trên branch feat/m06-monitor-poller-rule từ HEAD hiện tại. Đọc đầy đủ CLAUDE.md,
docs/tasks/tk-a16-m6-poller-rule.md, docs/tasks/tk-a16-review-03.md và handoff. Review vòng 3 là
REQUEST_CHANGES: sửa toàn bộ R3-01 đến R3-06 theo đúng 4 commit ở mục 3, không tự thu hẹp scope.

Dùng Node 22 qua `. .\tools\enter-node22.ps1`. Full suite reviewer đã chạy 192/192 PASS, nên không
được lấy hai timeout cũ làm blocker. Mỗi finding phải có regression scenario thật; đặc biệt phải test
pollAll auto-train, exact tick, rejected shutdown, setting/ensemble/label và alert restart. Được dùng
GitNexus read-only/re-analyze nếu stale.

Không sửa contract/migration/renderer/collector/deploy, không thêm dependency, không chạm file
untracked hoặc stash của user. Chỉ commit cục bộ. TUYỆT ĐỐI KHÔNG push, mở PR, merge, force-push,
reset --hard, clean, rebase hoặc pop/drop stash. Dừng sau handoff commit và báo rõ CHƯA PUSH/CHƯA
PR/CHƯA MERGE.
```
