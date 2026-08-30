# REVIEW 05 — TK-A16 M6 Poller + Rule Engine

> Reviewer: Codex/root
> Code được review: `fc36cfb..7c0a7d7`
> Kết luận: **REQUEST_CHANGES — chưa đạt `READY_FOR_LOCAL_REVIEW`**
> Quyền Git: chỉ commit cục bộ; không push, mở PR hoặc merge khi A chưa yêu cầu.

## 1. Bằng chứng review độc lập

- Branch/code head: `feat/m06-monitor-poller-rule@7c0a7d7`.
- GitNexus đã re-analyze đến `7c0a7d7`: 40 symbol đổi, 34 execution flow bị ảnh hưởng trong 12
  file; risk `critical` vì chạm `pollAll` → SSH/SQLite/ML/IPC và các caller shutdown/CLI.
- Node chuẩn workspace: `v22.23.2`.
- Monitor suite: **17/17 PASS**.
- CLI generator + SQLite/MonitorPoller thật: **PASS**, `150 metrics`, `750 scores`, `0 alerts`,
  retry insert `0`, offset `43008`.
- Lint: PASS, 0 error/16 warning renderer baseline. Scoped Prettier: PASS.
- Typecheck: PASS trong build. Build: **PASS** sau khoảng 52 giây, `3045 modules transformed`; lần
  Worker dừng build là dừng quá sớm, không phải build lỗi.
- Full suite verbose đã kết thúc sau 148 giây: `180/195`, 15 lỗi đều ở renderer, chủ yếu timeout
  5 giây khi chạy song song. `VpsOverviewTab.test.tsx`, gồm cả case `Retry` từng fail trong full run,
  chạy riêng **3/3 PASS**. Worker không sửa renderer nên vòng này không quy các lỗi đó cho M6.
- `git diff --check fc36cfb..7c0a7d7`: PASS. Ba file untracked và `stash@{0}` vẫn nguyên trạng.

## 2. Phần review-04 đã sửa đúng

- Có `MonitorRuntime` typed đủ `ingest/status/train`; setting dùng zod theo từng field và cho phép
  container CPU trên 100%; CLI gọi generator Python thật.
- Exact tick vẫn query theo IDs; backfill timestamp đã có regression cơ bản.
- Quit đã có lớp `finally` cuối bảo đảm `app.quit()`; hai caller CLI đã `await disconnectAll()`.
- Scoped formatting đã xanh. Các phần này không được làm lùi.

## 3. Finding phải sửa

### R5-01 — BLOCKING — Dedupe ML gọi lồng làm nuốt status/log của auto-train

- `pollAll()` truyền cho `maybeAutoTrain()` một callback đã bọc
  `reportMl(deploymentId, mlStatus, status, appId)` (`service.ts:133-136`).
- Bên trong `maybeAutoTrain()` lại gọi `this.reportMl(deploymentId, report, status)`
  (`service.ts:153-176`). Inner call cập nhật `lastMlStatus` trước rồi mới gọi callback; outer call
  thấy status không đổi và return tại `service.ts:203`, nên callback `mlStatus` thật không nhận event.
- Cùng lỗi xảy ra ở catch status/train: inner call không có `appId` nên không ghi action log, outer
  call lại bị dedupe. Khi ML status/train fail mà không có ingest failure trước đó, UI và action log
  có thể không nhận gì; recovery `running:true` cũng bị nuốt.
- GitNexus xác nhận process `PollAll → Report/LogAction` đi qua cả `maybeAutoTrain` và `reportMl` hai
  lớp. Test hiện không truyền `mlStatus`, không đếm event và không query `ml_service_restart` log.
- Yêu cầu: chỉ có **một** gateway sở hữu dedupe/cooldown/log. `maybeAutoTrain` phát status thô qua
  reporter hoặc nhận gateway trực tiếp, không bọc `reportMl` hai lần. Test sequence down → dedupe
  down → recover up, status fail không có sample mới, train fail/retry/recover và số action log trước/
  sau cooldown.

### R5-02 — MAJOR — Regression review-04 vẫn chưa được thực hiện đủ

- Commit `4ed705f` chỉ thêm một alert test và mở rộng một service test; monitor suite tăng từ 16 lên
  17. Không có test nào chứa `mlStatus`, `autoTrain:false`, `trainNow`, monitor IPC hoặc shutdown.
- Exact tick còn thiếu: same `ts_vps` cũ/mới, high chain bắc qua hai batch, alert cũ không phát lại,
  batch rỗng và hai app tuần tự. Test hiện chỉ có backfill hai sample trong cùng một app.
- Alert còn thiếu NULL không tự high/low, assert alert trỏ sample đầu và peak ban đầu/cập nhật. Setting
  còn thiếu numeric string, `rule_cpu_pct>100`, rollback mutation/log khi DB fail. Auto-train còn
  thiếu 149, disabled, ML reset, failure/recovery ngoài happy path.
- Yêu cầu: bổ sung đúng scenario, không dùng tổng số test làm bằng chứng thay thế. Có thể gom helper
  fixture để test ngắn, nhưng mỗi invariant phải có assertion trực tiếp.

### R5-03 — MAJOR — Shutdown fix không có regression nào

- Commit `55dfd34` chỉ sửa ba production/caller file, không thêm test dù R4-03 yêu cầu resolve/reject
  orchestration.
- Yêu cầu: tách helper cleanup thuần nếu cần và test thứ tự stop scheduler → stop ML → disconnect SSH
  → quit; `quit` vẫn chạy khi scheduler hoặc disconnect reject. Không cần boot Electron thật và không
  sửa renderer.

### R5-04 — MAJOR — Handoff vẫn giữ nhiều trạng thái cũ trái nhau

- Gate checklist hiện hữu vẫn ghi `188/190`, Prettier fail và build PASS cũ; DoD/giới hạn vẫn nói
  Node 22 unavailable, alert restart chưa test và CLI `3/15/0`. Mục `Review 04 cập nhật` ở cuối lại
  nói kết quả khác.
- Bảng review vòng 4 vẫn để handoff `CHƯA SỬA`; board trỏ code `4ed705f` nhưng chưa ghi handoff HEAD
  `7c0a7d7`.
- Yêu cầu: cập nhật các trường tổng hợp/gate/DoD/fixture command hiện hữu, không chỉ nối mục cuối;
  giữ lịch sử cũ và đánh dấu superseded. Ghi build reviewer PASS; full suite ghi đúng `180/195` và
  chú thích renderer baseline/isolated PASS, không gọi là “hang”.

## 4. Gate renderer được xử lý thế nào

Không sửa renderer trong TK-A16. Sau khi R5-01…R5-04 hoàn tất:

- Chạy focused monitor/CLI/scoped gate như thường.
- Chạy `pnpm test -- --run src/main/monitor` và `pnpm build` là gate bắt buộc của code M6.
- Chạy full `pnpm test -- --reporter=verbose`, ghi kết quả thật. Nếu chỉ còn renderer timeout đã có
  và các file fail chạy riêng xanh, reviewer có thể duyệt M6 với baseline exception; tạo task riêng
  cho test performance thay vì kéo renderer vào branch này.

## 5. Thứ tự commit vòng sửa 5

Tạo commit mới sau reviewer HEAD hiện tại, không checkout lùi/rewrite/rebase:

1. `fix(monitor): emit ml lifecycle through one gateway` — R5-01 + regression trực tiếp.
2. `test(monitor): complete lifecycle and exact batch coverage` — R5-02, R5-03.
3. `docs(monitor): record review five handoff` — R5-04 và gate cuối.

Không sửa renderer/contract/migration/collector/deploy, không thêm dependency, không chạm untracked
hoặc stash của user.

## 6. Gate tái hiện

```powershell
. .\tools\enter-node22.ps1
cd app
node --version
pnpm test -- --run src/main/monitor
pnpm try:monitor
pnpm lint
pnpm typecheck
pnpm exec prettier --check src/main/index.ts src/main/ipc.ts src/main/mlClient.ts src/main/monitor src/main/ssh/manager.ts scripts/try-monitor.ts
pnpm build
pnpm test -- --reporter=verbose
```

## 7. Prompt giao Worker vòng sửa 05

```text
Tiếp tục TK-A16 trên branch feat/m06-monitor-poller-rule từ HEAD hiện tại; lịch sử phải chứa commit
7c0a7d7 và commit review `docs(review): request A16 round five corrections`, không checkout lùi.
Đọc đầy đủ CLAUDE.md, docs/tasks/tk-a16-m6-poller-rule.md,
docs/tasks/tk-a16-review-05.md và handoff. Sửa toàn bộ R5-01…R5-04 theo đúng ba commit ở mục 5.

Ưu tiên sửa double-report/dedupe trong ML lifecycle và test event/action-log thật. Bổ sung các
regression còn thiếu đúng danh sách; shutdown phải có test reject. Không sửa renderer: full suite
reviewer đã chạy 180/195, 15 lỗi renderer dưới tải và file lỗi thực chạy riêng 3/3 PASS; build đã
PASS khi chờ đủ 52 giây.

Chỉ commit cục bộ. Không sửa contract/migration/collector/deploy, không thêm dependency, không chạm
untracked/stash. TUYỆT ĐỐI KHÔNG push, mở PR, merge, force-push, reset --hard, clean, rebase hoặc
pop/drop stash. Dừng sau handoff commit và báo rõ CHƯA PUSH/CHƯA PR/CHƯA MERGE.
```
