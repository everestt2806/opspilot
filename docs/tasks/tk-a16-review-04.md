# REVIEW 04 — TK-A16 M6 Poller + Rule Engine

> Reviewer: Codex/root
> Code được review: `ba462a6..f268277`
> Kết luận: **REQUEST_CHANGES — chưa đạt `READY_FOR_LOCAL_REVIEW`**
> Quyền Git: chỉ commit cục bộ; không push, mở PR hoặc merge khi A chưa yêu cầu.

## 1. Bằng chứng review độc lập

- Branch/code head: `feat/m06-monitor-poller-rule@f268277`.
- GitNexus đã re-analyze đến `f268277`: 44 symbol đổi, 22 execution flow bị ảnh hưởng trong 14
  file; thay đổi chạm `pollAll` → SSH/SQLite/ML/IPC và `disconnectAll` có blast radius tới ba CLI.
- Node chuẩn workspace: `v22.23.2` qua `. .\tools\enter-node22.ps1`.
- Monitor suite: **16/16 PASS**.
- CLI SQLite/MonitorPoller thật: **PASS**, `150 metrics`, `750 scores`, `0 alerts`, retry insert `0`,
  offset `34093`.
- `git diff --check ba462a6..f268277`: PASS.
- Scoped Prettier: **FAIL** ở đúng bốn file mới sửa:
  `poller.ts`, `repository.ts`, `service.ts`, `service.test.ts`.
- Full suite đứng sau dòng `RUN`; reviewer tái hiện cả khi loại toàn bộ `src/main/monitor/**`, và một
  renderer test đơn lẻ cũng đứng trước assertion. Vì Worker không sửa renderer, vòng review này
  **không quy kết** hiện tượng runner/host đó là regression monitor; tuy nhiên full gate vẫn chưa có
  bằng chứng xanh ở HEAD hiện tại.
- `.devflow/`, `docs/ban-giao-20-08.md`, `logo.png` và `stash@{0}` không bị chạm/stage.

## 2. Phần vòng 3 đã sửa đúng

- Auto-train đã kiểm tra SQLite **sau poll**, không còn phụ thuộc `status.sample_count`, và có option
  `autoTrain:false`.
- `monitor:tick` đã chuyển sang lấy sample/score/alert theo ID thay vì quét lại bằng timestamp.
- `ensemble` đã được tính lại theo majority của ba child score tại ngưỡng setting.
- Scheduler đã log rejected tick; `setSetting` empty patch không ghi log; label mutation và log đã
  nằm trong transaction.

Các điểm này không được làm lùi trong vòng sửa 4.

## 3. Finding phải sửa

### R4-01 — BLOCKING — ML lifecycle vẫn spam status/log và auto-train chưa được test thật

- `pollAll()` vẫn nhận `MetricScorer` chỉ có `ingest`, rồi dùng `'status' in scorer` và ép kiểu sang
  `MlApiClient` (`service.ts:117-150`). Đây chưa phải runtime interface typed có đủ
  `ingest/status/train` như yêu cầu R3-01.
- `MonitorPoller` gọi thẳng `mlStatus.report({running:true})` cho **mỗi mẫu ingest thành công**
  (`poller.ts:88-108`), bỏ qua `MonitorService.reportMl()` nên cơ chế dedupe mới không có tác dụng.
- Log `ml_service_restart/failed` chỉ giới hạn trong một lần `poll()`; tick sau lại ghi tiếp. Lỗi
  `status/train` ở `maybeAutoTrain()` chỉ emit status và không có action log/cooldown dùng chung.
- Test `pollAll trains...` đặt assertion bên trong callback `train`, nhưng không spy/flag và không
  assert callback đã được gọi. Nếu bỏ toàn bộ lệnh train thì test vẫn PASS.
- Yêu cầu: tạo interface runtime typed; đưa ingest/status/train qua một status + action-log gate theo
  deployment, chỉ phát khi state đổi hoặc cooldown hết; giữ retry train hợp lý. Test bắt buộc: 149,
  mẫu thứ 150, poll tiếp không train lại, ML reset với baseline SQLite, `autoTrain:false`, train fail
  rồi recover, và số lần status/log không spam theo số mẫu/tick.

### R4-02 — MAJOR — Exact tick đã có code nhưng chưa có regression chứng minh contract

- `listSamplesByIds`, `listScoresBySampleIds` và `listAlertsByIds` là hướng đúng, nhưng test mới chỉ
  kiểm tra một tick có một sample/score. Không có case từng được yêu cầu ở R3-02.
- Yêu cầu: test hai sample cũ/mới trùng `ts_vps`, timestamp backfill cũ, chuỗi high bắc qua hai
  batch, batch rỗng, alert cũ không phát lại và hai app poll tuần tự. Mỗi batch có dữ liệu chỉ emit
  một tick; `scores.length === samples.length`; `new_alerts` chỉ chứa alert vừa mở.

### R4-03 — MAJOR — Cleanup khi quit vẫn có thể bỏ mất `app.quit()`

- `index.ts:166-181` đã có `finally` quanh `monitorScheduler.stop()`, nhưng bên trong `finally` lại
  `await sshManager.disconnectAll()` trước `app.quit()`. Nếu disconnect reject, async closure reject
  và `app.quit()` vẫn không chạy trong khi `quitting=true`.
- `disconnectAll()` đổi từ `void` sang `Promise<void>` có GitNexus risk HIGH; `reset-demo.ts` và
  `try-deploy.ts` vẫn gọi mà không `await`.
- Scheduler rejected-poll test là tiến bộ, nhưng chưa test thứ tự lifecycle
  stop → ML stop → SSH disconnect → quit → DB close, và cleanup/quit khi stop hoặc disconnect reject.
- Yêu cầu: bảo đảm quit trong lớp `finally` cuối cùng, cập nhật toàn bộ caller async, và thêm test
  orchestration có resolve/reject; không cần khởi động Electron thật nếu tách helper thuần để test.

### R4-04 — MAJOR — Runtime validation setting vẫn nhận sai kiểu/miền

- `setSetting()` cho phép mọi value kiểu string (`service.ts:60-77`), nên các patch như
  `{rule_latency_ms: '-1'}` hoặc `{rule_error_rate: '0.5'}` có thể lọt qua runtime boundary.
- `rule_cpu_pct` bị chặn `>100`, trái metric contract: container CPU có thể `100+` khi nhiều core
  (`docs/contracts/metric-format.md:47`). Chỉ `rule_mem_pct`/rate mới có upper bound 100/1.
- Yêu cầu: schema runtime theo từng field; numeric field phải là finite number, integer field đúng
  integer/domain, method đúng enum. Test rollback transaction/action log, toàn bộ boundary chính,
  numeric string và `rule_cpu_pct > 100`. Giữ nguyên phần label/ensemble đã sửa đúng.

### R4-05 — MAJOR — Regression và CLI fixture vẫn chưa đạt task packet

- Vòng này chỉ tăng monitor suite từ 14 lên 16 test. Vẫn thiếu alert NULL/first sample/initial peak,
  restart giữa high/low, năm method độc lập; MlApiClient response lỗi; monitor IPC; train-now
  thiếu/đủ 150; source error vs DB error; poll overlap và lifecycle Electron.
- `try-monitor.ts:10-27` tự dựng 150 JSON object inline. Nó không gọi
  `ml-service/scripts/gen_fake_series.py` và cũng không dùng fixture checked-in được sinh từ script,
  nên commit `generated fixture flow` chưa đáp ứng R3-05.
- Yêu cầu: bổ sung đúng các scenario trên; CLI dùng generator thật hoặc fixture derived có lệnh tái
  sinh/nguồn rõ ràng, sau đó vẫn chạy SQLite + `MonitorPoller` thật và kiểm idempotency/count.

### R4-06 — MAJOR — Scoped format và handoff còn mâu thuẫn

- Scoped Prettier đỏ ở bốn file monitor thuộc scope; đây không phải warning baseline renderer.
- Phần đầu handoff vẫn ghi HEAD vòng 2, `190/192`, Node 22 unavailable và DoD cũ; bảng review vẫn
  để vòng 3 `CHƯA SỬA`. Worker chỉ nối thêm mục cuối nên tài liệu có hai trạng thái trái nhau.
- Board đổi sang `ĐANG LÀM` nhưng ghi chú vẫn nói code `6f1da37` và finding vòng 3 chưa sửa.
- Yêu cầu: format bốn file, cập nhật **các trường tổng hợp hiện hữu** thay vì chỉ append; giữ lịch sử
  cũ nhưng đánh dấu superseded rõ ràng. Khi toàn bộ gate xanh mới chuyển `CHỜ REVIEW` và ghi exact
  code HEAD/handoff HEAD.

## 4. Thứ tự commit vòng sửa 4

Tạo commit mới sau `f268277`, không rewrite/rebase lịch sử:

1. `fix(monitor): rate limit ml lifecycle and validate settings` — R4-01, R4-04 + regression đi kèm.
2. `fix(system): guarantee shutdown cleanup` — R4-03 + cập nhật mọi caller/test.
3. `test(monitor): close exact batch and generated fixture regressions` — R4-02, R4-05.
4. `docs(monitor): record review four handoff` — R4-06, board, task log, handoff và gate cuối.

Chạy Prettier scoped **trước từng commit code**. Không sửa renderer để chữa runner hang khi chưa có
root cause; không sửa contract/migration/collector/deploy và không thêm dependency.

## 5. Gate và điều kiện bàn giao

```powershell
. .\tools\enter-node22.ps1
cd app
node --version
pnpm exec prettier --write src/main/index.ts src/main/monitor src/main/ssh/manager.ts scripts/try-monitor.ts
pnpm test -- --run src/main/monitor
pnpm try:monitor
pnpm test
pnpm lint
pnpm typecheck
pnpm exec prettier --check src/main/index.ts src/main/ipc.ts src/main/mlClient.ts src/main/monitor src/main/ssh/manager.ts scripts/try-monitor.ts
pnpm build
```

Nếu full suite còn đứng, chạy riêng renderer với verbose để ghi file cuối cùng và kiểm tra tài nguyên
host; không tự sửa renderer ngoài scope. Chỉ đổi board sang `CHỜ REVIEW` và outcome
`READY_FOR_LOCAL_REVIEW` khi R4-01…R4-06 có code/test thật và full gate Node 22 xanh.

## 6. Prompt giao Worker vòng sửa 04

```text
Tiếp tục TK-A16 trên branch feat/m06-monitor-poller-rule từ HEAD hiện tại; lịch sử phải chứa reviewer
commit 0e75ed3, không checkout lùi về code head f268277. Đọc đầy đủ CLAUDE.md,
docs/tasks/tk-a16-m6-poller-rule.md, docs/tasks/tk-a16-review-04.md và handoff. Review vòng 4 là
REQUEST_CHANGES: sửa toàn bộ R4-01 đến R4-06 theo đúng bốn commit ở mục 4, không tự thu hẹp scope.

Dùng Node 22 qua `. .\tools\enter-node22.ps1`. Giữ các phần vòng 3 đã sửa đúng. Mỗi finding phải có
regression scenario thật; test auto-train phải assert số lần gọi train/status/log, exact tick phải có
same timestamp/backfill/cross-batch/two-app, shutdown phải test cả reject, và CLI phải dùng generator
hoặc fixture derived thật. Format scoped source trước commit.

Không sửa renderer chỉ để né full-suite hang khi chưa chứng minh root cause. Không sửa contract,
migration, collector hoặc deploy; không thêm dependency; không chạm file untracked/stash của user.
Chỉ commit cục bộ. TUYỆT ĐỐI KHÔNG push, mở PR, merge, force-push, reset --hard, clean, rebase hoặc
pop/drop stash. Dừng sau handoff commit và báo rõ CHƯA PUSH/CHƯA PR/CHƯA MERGE.
```
