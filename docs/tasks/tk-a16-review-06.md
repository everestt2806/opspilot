# REVIEW 06 — TK-A16 M6 Poller + Rule Engine

> Reviewer: Codex/root
> Code được review: `f924420..b35c821`
> Kết luận: **REQUEST_CHANGES — chưa đạt `READY_FOR_LOCAL_REVIEW`**
> Quyền Git: chỉ commit cục bộ; không push, mở PR hoặc merge khi A chưa yêu cầu.

## 1. Bằng chứng review độc lập

- Branch/code head: `feat/m06-monitor-poller-rule@b35c821`.
- GitNexus đã re-analyze đến `b35c821`: diff vòng 5 đổi 28 symbol, ảnh hưởng 3 execution
  process quanh `pollAll → maybeAutoTrain → status/train/report`; risk `medium`.
- Node chuẩn workspace: `v22.23.2`.
- Focused monitor + shutdown: **18/18 PASS**.
- CLI generator + SQLite/MonitorPoller thật: **PASS**, `150 metrics`, `750 scores`, `0 alerts`,
  retry insert `0`, offset `43008`.
- Lint: PASS, 0 error/16 warning renderer baseline. Typecheck: PASS. Scoped Prettier: PASS.
- Build: **PASS**, `3045 modules transformed` sau khoảng 35 giây.
- Full suite gần nhất của reviewer: `180/195`; 15 lỗi renderer dưới tải, trong khi
  `VpsOverviewTab.test.tsx` chạy riêng `3/3 PASS`. Vòng code này không đổi renderer, nên đây là
  baseline exception và không phải finding M6.
- `git diff --check f924420..b35c821`: PASS. `.devflow/`, `docs/ban-giao-20-08.md`, `logo.png` và
  `stash@{0}` không bị chạm.

## 2. Phần review-05 đã sửa đúng

- `maybeAutoTrain()` nay phát status thô qua một callback; chỉ `reportMl()` ở gateway ngoài sở hữu
  dedupe/action log. Sequence status thành công → lỗi → phục hồi đã có assertion trực tiếp.
- Exact tick dùng query theo ID vẫn được giữ; test đã có một batch chứa timestamp backfill.
- Helper shutdown và regression đã chứng minh thứ tự cleanup, đồng thời `quit()` vẫn chạy khi
  scheduler và disconnect cùng reject.
- Các gate scoped đã xanh. Không được làm lùi những phần này.

## 3. Finding phải sửa

### R6-01 — BLOCKING — Tắt auto-train làm mất sự kiện ML phục hồi

- `pollAll()` chỉ gọi `maybeAutoTrain()` khi `options.autoTrain !== false`
  (`app/src/main/monitor/service.ts:133-136`).
- `MonitorPoller` chỉ report `running:false` khi `/ingest` throw
  (`app/src/main/monitor/poller.ts:96-104`); ingest thành công không report `running:true`.
- Vì vậy ở chế độ thí nghiệm `autoTrain:false`, sau một lần ingest lỗi, lần poll thành công tiếp theo
  không thể đưa `system:ml-status` về `running:true`; UI có thể giữ trạng thái ML down vô hạn dù
  service đã phục hồi. Cờ này chỉ được tắt việc **train**, không được tắt health lifecycle.
- Yêu cầu: route tín hiệu phục hồi qua đúng gateway `reportMl()` mà không gọi `/train`. Không emit
  theo từng sample và không tạo thêm status/log trùng. Regression bắt buộc:
  `autoTrain:false` + ingest fail → ingest success phải cho event `[down, up]`, một log failure và
  `trainCalls === 0`.

### R6-02 — MAJOR — `trainNow(<150)` trả sai loại lỗi và chưa có regression biên

- `trainNow()` đang throw `Error` thường tại `service.ts:96`; `toIpcError()` sẽ biến nó thành
  `UNKNOWN`. Thiếu mẫu là input không hợp lệ đã biết trước, phải là `AppError('VALIDATION', ...)`,
  không phải lỗi hệ thống không xác định.
- Chưa có test nào gọi `trainNow`. Yêu cầu test 149 mẫu không gọi ML và trả validation; 150 mẫu gọi
  `/train` đúng deployment, đúng số mẫu, trả đúng `train_sample_count`. Nếu test qua IPC wrapper,
  assert `IpcResult.error.code === 'VALIDATION'` cho case thiếu mẫu.

### R6-03 — MAJOR — Bộ regression bắt buộc vẫn chưa đủ dù commit tuyên bố “complete”

- Vòng này chỉ mở rộng một test `pollAll` và thêm một test shutdown; focused suite tăng 17 → 18.
  Test exact-batch mới chỉ assert độ dài hai array, chưa assert identity/content của sample, score,
  alert được phát.
- Các case bắt buộc trong task packet vẫn chưa có bằng chứng trực tiếp: hai app poll tuần tự; các
  `monitor:*` handler trong scope đọc DB thật (`fromTs`, limit, aggregate score, setting, label,
  train-now); tick
  rỗng không emit; timestamp trùng/backfill không kéo row hoặc alert cũ vào tick mới.
- Yêu cầu: bổ sung regression theo invariant, không dùng tổng số test hoặc CLI aggregate làm bằng
  chứng thay thế. Ưu tiên test ở tầng service/repository/IPC bằng SQLite memory/temp; không boot
  Electron và không sửa renderer.

### R6-04 — MAJOR — Handoff và nhật ký vẫn mâu thuẫn, đồng thời bị nối lặp

- Handoff đầu file còn ghi code head `96b116f`, gate `188/190`, Node 22 unavailable, fixture
  `3/15/0`, alert restart chưa đủ và review 5 `CHƯA SỬA`; các dòng này trái với evidence mới ở cuối.
- Task log từ dòng `HANDOFF-LOCAL` vòng 5 bị nối thiếu newline rồi lặp ba bộ
  `UPDATE/REVIEW-FIX/HANDOFF-LOCAL`. Board chỉ trỏ code `96b116f`, chưa trỏ handoff `b35c821`.
- Yêu cầu: xóa đúng hai bộ log vòng 5 bị lặp, giữ một bộ lịch sử hợp lệ; cập nhật các trường tổng
  hợp/gate/DoD/giới hạn hiện hữu trong handoff thay vì chỉ nối mục cuối. Giữ lịch sử cũ và đánh dấu
  superseded khi cần. Handoff cuối phải ghi exact code HEAD + handoff HEAD, gate reviewer/Worker và
  baseline exception renderer một cách nhất quán.

## 4. Thứ tự commit vòng sửa 6

Tạo commit mới sau reviewer HEAD hiện tại, không checkout lùi/rewrite/rebase:

1. `fix(monitor): recover ml status with auto train disabled` — R6-01 và regression trực tiếp.
2. `test(monitor): close train and ipc contract regressions` — R6-02/R6-03; production fix nhỏ cho
   validation `trainNow` nằm trong commit này.
3. `docs(monitor): reconcile round six handoff` — R6-04 và evidence gate cuối.

Không sửa renderer/contract/migration/collector/deploy, không thêm dependency, không chạm untracked
hoặc stash của user.

## 5. Gate tái hiện

```powershell
. .\tools\enter-node22.ps1
cd app
node --version
pnpm test -- --run src/main/monitor src/main/shutdown.test.ts src/main/ipc.test.ts
pnpm try:monitor
pnpm lint
pnpm typecheck
pnpm exec prettier --check src/main/index.ts src/main/ipc.ts src/main/monitor src/main/shutdown.ts src/main/shutdown.test.ts scripts/try-monitor.ts
pnpm build
pnpm test -- --reporter=verbose
```

Full suite phải được ghi đúng kết quả thật. Nếu chỉ còn renderer timeout baseline và file lỗi chạy
riêng xanh, không sửa renderer trong TK-A16; ghi exception rõ trong handoff.

## 6. Prompt giao Worker vòng sửa 06

```text
Tiếp tục TK-A16 trên branch feat/m06-monitor-poller-rule từ HEAD hiện tại; lịch sử phải chứa Worker
handoff b35c821 và reviewer commit 6333008, không checkout lùi. Đọc đầy đủ CLAUDE.md,
docs/tasks/tk-a16-m6-poller-rule.md, docs/tasks/tk-a16-review-06.md và handoff. Sửa toàn bộ
R6-01…R6-04 theo đúng ba commit ở mục 4.

Ưu tiên lỗi autoTrain:false: cờ này chỉ tắt train, không được ngăn ML down → up recovery; regression
phải assert event, action log và trainCalls=0. Sửa trainNow thiếu 150 mẫu thành VALIDATION và bổ sung
test biên. Hoàn thiện regression exact tick/two-app/monitor IPC bằng DB thật, rồi dọn handoff/task log
để chỉ còn một trạng thái tổng hợp nhất quán. Không sửa renderer; full-suite renderer hiện là baseline
exception, nhưng vẫn chạy và ghi kết quả thật.

Chỉ commit cục bộ. Không sửa contract/migration/collector/deploy, không thêm dependency, không chạm
untracked/stash. TUYỆT ĐỐI KHÔNG push, mở PR, merge, force-push, reset --hard, clean, rebase hoặc
pop/drop stash. Dừng sau handoff commit và báo rõ CHƯA PUSH/CHƯA PR/CHƯA MERGE.
```
