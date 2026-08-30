# TK-A16 — M6 Poller + Rule Engine: metric → SQLite → score/alert → IPC

> Đây là task hiện tại của người A sau buổi demo VPS/Deploy cơ bản. Worker được chỉ định:
> **GPT-5.6 Luna · Medium Effort**. Reviewer cuối: **Codex/root**. Worker chỉ commit cục bộ;
> không được `git push`, mở PR hay merge nếu A chưa ra lệnh riêng.

| Chủ | Hạn | Branch | Brief | Ưu tiên |
|---|---|---|---|---|
| A | 04/09/2026 | `feat/m06-monitor-poller-rule` | `docs/prompts/m06-poller-rule.md` | P0 |

**Bộ giao việc chính thức:**

- Prompt copy-paste: [`../prompts/tk-a16-worker-luna.md`](../prompts/tk-a16-worker-luna.md).
- Biên bản Worker phải điền trước khi dừng: [`tk-a16-worker-handoff.md`](tk-a16-worker-handoff.md).
- File này là nguồn sự thật về scope, checkpoint, test và DoD. Nếu prompt tóm tắt khác file này,
  dừng và hỏi A; không tự chọn phiên bản thuận tiện hơn.

## 1. Kết quả cần tạo ra

Hoàn thiện lát cắt backend giám sát chạy độc lập với UI và collector thật:

```text
metrics.jsonl (fixture hoặc SSH)
  → parse dòng hoàn chỉnh + quản lý byte offset
  → metric_sample
  → rule + 4 score ML
  → score_sample + alert
  → monitor:* IPC + monitor:tick
```

Task này là **code gate độc lập**. Smoke collector thật trên VM01 được chốt ở TK-S4 sau khi B
hoàn thành TK-B6; không được chờ B mới viết hoặc test M6.

## 2. Baseline và thứ tự đọc bắt buộc

- Baseline: `origin/main` tại hoặc sau commit `2addfb8` (PR #21, #22, #23 đã merge).
- Trước khi code, đọc theo đúng thứ tự:
  1. `CLAUDE.md`.
  2. `docs/tasks/README.md` và file này.
  3. `docs/prompts/m06-poller-rule.md`.
  4. `docs/contracts/metric-format.md` mục 2–4.
  5. `docs/contracts/schema.sql`: `app.metrics_offset`, `monitor_setting`, `metric_sample`,
     `score_sample`, `alert`.
  6. `docs/contracts/ml-api.openapi.yaml`: `/status`, `/ingest`, `/train`.
  7. `docs/contracts/ipc-contract.ts`: `monitor:*`, `monitor:tick`, `system:ml-status`.
  8. Code hiện có: `SshManager.readFileTail/fileSize`, `MlServiceManager`, DB repositories,
     `app/src/main/index.ts`, `app/src/main/ipc.ts`.

Nếu contract và brief mâu thuẫn, dừng và báo reviewer. Không tự sửa contract để hợp thức hóa code.

## 3. Ranh giới file

### Được sửa

- `app/src/main/monitor/**` — module mới, gồm parser/source/poller/rules/service và test.
- `app/src/main/db/**Repository.ts` — thêm repository giám sát nhỏ, không sửa migration đã chạy.
- `app/src/main/mlClient.ts` + test — thêm client typed tối thiểu cho `/status`, `/ingest`, `/train`.
- `app/src/main/ipc.ts`, `app/src/main/index.ts` + test — đăng ký service, scheduler và handler.
- `app/scripts/try-monitor.ts`, `app/tsconfig.scripts.json`, `app/package.json` nếu cần CLI độc lập.
- `docs/05-truy-vet-yeu-cau.md`, `docs/tasks/board.md` và file này khi bàn giao.

### Không được sửa

- `docs/contracts/**`, `app/src/main/db/migrations/001_init.sql`, migration cũ nói chung.
- `app/src/renderer/**`, `collector/**`, `demo-apps/**`, `experiments/**`.
- Logic deploy/rollback, detector hoặc VPS Control Panel.
- Không thêm dependency. Dùng `zod`, `better-sqlite3`, `fetch` và thư viện đã có.
- Không triển khai auto-rollback M8; task này chỉ tạo/đóng alert.
- Được dùng GitNexus ở chế độ đọc/phân tích để hiểu kiến trúc, truy vết và kiểm tra impact. Không
  dùng lệnh clean index hoặc thay đổi source thông qua GitNexus; nếu index stale và cần re-analyze,
  ghi vào nhật ký trước khi chạy.

## 4. Thiết kế tối thiểu bắt buộc

Tên file có thể điều chỉnh nhẹ, nhưng trách nhiệm không được nhập nhằng:

```text
app/src/main/monitor/
  metricParser.ts          zod schema + parse JSONL theo byte
  metricSource.ts          nguồn local cho test và adapter SSH thật
  rules.ts                 evaluateRule thuần
  alertTracker.ts          consecutive/open/peak/resolve theo từng method
  repository.ts            query/insert/update SQLite
  poller.ts                poll một app và scheduler tuần tự
  service.ts               query IPC, setting, train-now, lifecycle
  *.test.ts                test cạnh biên tương ứng
```

Không tạo framework DI, event bus hoặc abstraction tổng quát. Một interface nguồn metric nhỏ để
test local là đủ.

### 4.1 Target giám sát

Repository nội bộ query các app có `current_deployment_id` trỏ tới deployment `running`, lấy:

- `app_id`, `vps_id`, `app_name`, `deployment_id`, `metrics_offset`.
- `monitor_setting`; nếu chưa có thì tạo/lấy đúng default trong schema.

Không thêm `metrics_offset` vào IPC `App` chỉ để phục vụ main process.

### 4.2 Parse và byte offset

- `offset` là byte 1-based dùng với `tail -c +N`.
- Chỉ commit các dòng kết thúc bằng `\n`; dòng cuối viết dở phải giữ cho lượt sau.
- Tính byte bằng `Buffer.byteLength(..., 'utf8')`, không dùng `string.length`.
- Dòng JSON hoàn chỉnh nhưng hỏng: ghi warning/action log và **vẫn tiêu thụ byte**.
- Validate đủ field/miền giá trị theo `metric-format.md`; `null` giữ nguyên, không đổi thành `0`.
- Nếu file nhỏ hơn offset: ghi action log, reset về 1 và đọc lại an toàn.
- `UNIQUE(deployment_id, seq)` là lớp idempotency DB. Dòng `seq` đã có được tiêu thụ nhưng không
  gọi ML và không tạo score/alert lần hai.
- Không dùng trực tiếp `readFileTail().nextByte` làm offset đã commit khi còn dòng viết dở.

### 4.3 Rule engine

Giữ đúng chữ ký trong brief:

```ts
evaluateRule(sample, setting): { violated: boolean; reasons: string[] }
```

- So sánh nghiêm ngặt `>` cho CPU, RAM, latency, error rate.
- `null` không tự tạo vi phạm; `container_up === 0` luôn vi phạm.
- `score=1/0`, `above_threshold=violated`; reasons phải ổn định để test và ghi `detail_json`.

### 4.4 Score ML và lỗi service

- Gọi `/ingest` tuần tự theo `seq` tăng dần; không `Promise.all`.
- Với mỗi metric mới luôn có đúng 5 method trong `score_sample`:
  `rule`, `zscore_ewma`, `iforest`, `ocsvm`, `ensemble`.
- `ready:false` hoặc ML không phản hồi: 4 score ML là `NULL`, `above_threshold=0`; rule vẫn ghi.
- ML chết không làm poller fail cả mẻ; phát `system:ml-status {running:false}` và ghi action log
  có giới hạn, không spam mỗi mẫu.
- Validate response bằng zod. Không tin JSON thô từ service.
- `monitor:train-now` lấy mẫu của đúng deployment, yêu cầu ≥150 và gọi `/train` đúng OpenAPI.
- Auto-train tối thiểu: chỉ gọi một lần khi đủ 150 mẫu và model chưa trained; cho phép tắt bằng
  constructor/env để thí nghiệm chủ động train. Không train lại mỗi lượt poll.

Gọi HTTP xảy ra trước transaction ghi kết quả cuối của mẻ; Worker phải ghi rõ trong nhật ký giới
hạn crash-window còn lại. Không mở rộng API ML hoặc dựng distributed transaction trong task này.

### 4.5 Alert lifecycle

Theo từng `(deployment_id, method)`, độc lập giữa 5 method:

- Rule mở alert sau `rule_consecutive` mẫu cao liên tiếp; ML dùng `ml_consecutive`.
- Alert trỏ tới **mẫu đầu tiên** của chuỗi cao.
- Một chuỗi liên tục chỉ có một alert; khi tiếp tục cao chỉ cập nhật `peak_score`.
- Hạ dưới ngưỡng 3 mẫu liên tiếp mới điền `ts_resolved`.
- Restart Electron không được làm mất alert đang mở/counter cần thiết; khôi phục từ các score/alert
  gần nhất trong SQLite hoặc tính lại từ DB, không chỉ giữ state RAM.
- Score `NULL` không được tính là cao hoặc thấp để tự đóng alert; nó ngắt quyết định của ML cho mẫu
  đó nhưng không bịa dữ liệu.

### 4.6 Transaction, scheduler và lỗi

- Toàn bộ insert metric/5 score, thay đổi alert và cập nhật offset của **một mẻ đã chấm xong** nằm
  trong một transaction `better-sqlite3`.
- Nếu transaction fail, offset không được tiến.
- Khóa theo `app_id`: poll trước chưa xong thì bỏ lượt mới.
- Nhiều app poll tuần tự, không mở đồng thời nhiều SSH connection.
- SSH/file lỗi: không tạo mẫu giả, ghi action log, lượt sau retry từ offset cũ.
- Scheduler mặc định 30 giây, có `start()`/`stop()` rõ ràng; Electron `before-quit` phải stop timer.

### 4.7 IPC hiện thực, không đổi contract

Các channel phải trả dữ liệu thật từ SQLite:

- `monitor:samples(deploymentId, fromTs)`.
- `monitor:scores(deploymentId, fromTs)` — gộp 5 row DB thành một `ScoreSet` theo `ts_vps`.
- `monitor:alerts(deploymentId, limit)`.
- `monitor:get-setting(appId)` — tạo default nếu chưa có.
- `monitor:set-setting(appId, patch)` — whitelist field, validate miền giá trị, ghi `action_log`.
- `monitor:train-now(deploymentId)`.

Sau mỗi mẻ có dữ liệu mới, phát đúng một `monitor:tick` với samples, scores và alerts mới.

## 5. Kế hoạch triển khai theo checkpoint

Worker làm tuần tự và commit cục bộ sau mỗi checkpoint. Không dồn toàn bộ vào một commit lớn.
Sau mỗi checkpoint, bắt buộc thêm một dòng `CP<n>` theo mẫu ở mục 10 vào nhật ký rồi mới tạo
commit. Dòng log ghi commit message dự kiến; SHA thực tế được chốt trong biên bản bàn giao. Không
được tự push các commit này.

### CP1 — Ingest foundation

- Parser zod, byte offset, incomplete/corrupt line.
- Monitor repository và local metric source.
- Insert idempotent `metric_sample`, cập nhật offset cùng transaction.
- Test parser UTF-8, duplicate seq, file shrink và transaction rollback.

Commit gợi ý: `feat(monitor): ingest metric batches with byte-safe offsets`

### CP2 — Rule và alert

- `evaluateRule` thuần.
- Ghi rule score.
- Consecutive/open/peak/resolve, khôi phục state từ DB.
- Test ngưỡng biên, 3 mẫu cao, một alert/chuỗi, peak, 3 mẫu thấp, 5 method độc lập.

Commit gợi ý: `feat(monitor): evaluate rules and persist alert lifecycle`

### CP3 — ML và IPC

- Typed ML client ingest/status/train.
- 4 ML score hoặc NULL fallback, luôn đủ 5 row.
- MonitorService và 6 handler IPC hiện có; `monitor:tick`.
- Test ready=false, service down, response lỗi, aggregate ScoreSet và setting validation.

Commit gợi ý: `feat(monitor): connect ml scores and typed monitor ipc`

### CP4 — Scheduler, CLI và bàn giao

- SSH adapter, sequential scheduler, non-overlap, lifecycle start/stop.
- `try-monitor` local dùng fixture sinh bởi `ml-service/scripts/gen_fake_series.py`.
- Chạy toàn bộ gate, cập nhật board/tk-file/trace matrix và commit cục bộ. Dừng lại để A review;
  chỉ push/mở PR khi A ra lệnh riêng.

Commit gợi ý: `test(monitor): add scheduler coverage and local smoke cli`

## 6. Test bắt buộc

### Unit/integration không cần VPS

- Parser nhiều dòng hoàn chỉnh, UTF-8 và offset byte chính xác.
- Bỏ dòng cuối thiếu `\n` mà không tăng offset.
- JSON hỏng hoàn chỉnh được consume và không chặn dòng sau.
- Duplicate `seq` không tạo thêm metric/score/alert hoặc gọi ML lại.
- File nhỏ hơn offset reset đúng.
- Rule dùng `>`; null và `container_up=0` đúng semantics.
- Trigger đúng consecutive, alert trỏ mẫu đầu, cập nhật peak, resolve sau 3 low.
- ML `ready:false` và ML chết vẫn tạo đủ 5 score row, 4 row ML có `NULL`.
- Transaction lỗi không tiến offset.
- Hai poll cùng app không chạy chồng; hai app chạy tuần tự.
- IPC lọc `fromTs`, limit và aggregate score đúng.
- Stop scheduler không còn timer/process giữ app.

### Gate repo

```powershell
cd app
pnpm test
pnpm lint
pnpm typecheck
pnpm exec prettier --check .
pnpm build
```

Nếu warning đã có từ baseline, ghi số lượng và chứng minh task không thêm warning mới.

## 7. Definition of Done của TK-A16

- [ ] CP1–CP4 có commit tách nghĩa, không có commit chứa secret/DB/runtime state.
- [ ] Fixture JSONL đi vào `metric_sample` đúng thứ tự và retry không trùng.
- [ ] Mỗi metric mới có đúng 5 `score_sample`; ML chưa sẵn sàng dùng `NULL`, không dùng `0`.
- [ ] Rule và alert lifecycle pass toàn bộ case consecutive/open/peak/resolve/restart.
- [ ] 6 channel `monitor:*` trong scope trả DB thật và `monitor:tick` phát đúng mẻ.
- [ ] ML chết, SSH lỗi, file rotate và poll overlap không làm crash app hoặc bịa mẫu.
- [ ] CLI local tái hiện được từ fixture mà không cần collector/VPS của B.
- [ ] Test/lint/typecheck/prettier/build xanh.
- [ ] `docs/05`, board và nhật ký file này cập nhật trong cùng branch/commit bàn giao.
- [ ] Worker bàn giao commit cục bộ và ghi rõ giới hạn/chưa làm; chưa push/mở PR/merge khi A chưa yêu cầu.
- [ ] Reviewer Codex/root không còn finding mức blocking/major.

Smoke metric thật trên VM01, stress/reboot và soak 24h thuộc TK-S4/W5, không chặn code gate này.

## 8. Prompt giao nguyên văn cho Worker

Dùng nguyên văn file [`../prompts/tk-a16-worker-luna.md`](../prompts/tk-a16-worker-luna.md). Không
rút gọn thêm khi giao, vì file đó khóa quyền Git, định dạng nhật ký, điều kiện dừng và mẫu bàn giao.

## 9. Quy trình review và sửa lỗi

Reviewer Codex/root sẽ:

1. Đọc toàn bộ diff so với `origin/main`, kiểm tra scope/contract/secret trước.
2. Chạy test tập trung của monitor/DB/ML client, sau đó chạy toàn bộ gate repo.
3. Kiểm tra riêng các rủi ro: byte offset UTF-8, transaction, duplicate, ML NULL, alert restart,
   timer cleanup, IPC query và log không chứa secret.
4. Trả finding có mức `BLOCKING`, `MAJOR`, `MINOR`, kèm file/dòng và cách tái hiện.
5. Worker sửa trên cùng branch, thêm test hồi quy và dòng `REVIEW-FIX` vào nhật ký; reviewer chạy lại.
6. Lặp đến khi không còn `BLOCKING/MAJOR`. Worker không push/mở PR/merge nếu chưa có lệnh riêng;
   A quyết định thời điểm đẩy remote sau APPROVED.

## 10. Nhật ký thực thi bắt buộc

Worker nối thêm dòng mới, không sửa/xóa lịch sử cũ. Mỗi dòng phải có bằng chứng thật; không ghi
`PASS` nếu chưa chạy lệnh trong phiên hiện tại.

```text
START dd/mm HH:mm — branch <name>@<short-sha> · kế hoạch CP1→CP4 · git status <clean/dirty + file>
CP1 dd/mm HH:mm — commit `<message>` · file <danh sách ngắn> · test `<lệnh>` = PASS/FAIL (<số test>) · tiếp theo <việc>
CP2 dd/mm HH:mm — commit `<message>` · file <danh sách ngắn> · test `<lệnh>` = PASS/FAIL (<số test>) · tiếp theo <việc>
CP3 dd/mm HH:mm — commit `<message>` · file <danh sách ngắn> · test `<lệnh>` = PASS/FAIL (<số test>) · tiếp theo <việc>
CP4 dd/mm HH:mm — commit `<message>` · file <danh sách ngắn> · gate <PASS/FAIL + tóm tắt> · tiếp theo handoff
BLOCKED dd/mm HH:mm — bước <...> · bằng chứng <...> · đã thử <...> · cần A quyết định <...>
HANDOFF-LOCAL dd/mm HH:mm — commits <base..head> · gate <PASS/FAIL> · handoff `tk-a16-worker-handoff.md` · CHƯA PUSH
REVIEW-FIX dd/mm HH:mm — finding <ID> · commit <sha> · regression test `<lệnh>` = PASS/FAIL
```

Nhật ký hiện tại:

- START 30/08 00:00 — branch feat/m06-monitor-poller-rule@affc6d8 · kế hoạch CP1→CP4 · git status dirty + .devflow/, docs/ban-giao-20-08.md, logo.png (giữ nguyên)
- CP1 30/08 18:09 — commit `feat(monitor): ingest metric batches with byte-safe offsets` · file monitor/metricParser.ts, metricSource.ts, repository.ts, poller.ts · test `cd app && pnpm test -- --run src/main/monitor` = PASS (4 tests) · tiếp theo rule và alert lifecycle
- CP2 30/08 18:10 — commit `feat(monitor): evaluate rules and persist alert lifecycle` · file monitor/rules.ts, alertTracker.ts, repository.ts, poller.ts · test `cd app && pnpm test -- --run src/main/monitor` = PASS (7 tests) · tiếp theo ML và IPC
- CP3 30/08 18:12 — commit `feat(monitor): connect ml scores and typed monitor ipc` · file monitor/mlApi.ts, service.ts, repository.ts, poller.ts · test `cd app && pnpm typecheck:node && pnpm test -- --run src/main/monitor` = PASS (7 tests) · tiếp theo scheduler, CLI và gate
- CP4 30/08 18:18 — commit `test(monitor): add scheduler coverage and local smoke cli` · file monitor/scheduler.ts, service.ts, ipc.ts, index.ts, docs/05 · gate FAIL do DoD còn thiếu; test 186/186, lint 0 errors + 16 baseline warnings, typecheck PASS, prettier scoped PASS, build PASS · tiếp theo ghi BLOCKED và handoff
- BLOCKED 30/08 18:19 — bước hoàn thiện DoD M6 · bằng chứng poller chưa tích hợp ML động/IPC tick/train-now/setting patch/label-alert và CLI fixture chưa có · đã thử unit test, typecheck, lint, build · cần A quyết định tiếp tục implementation trên cùng branch · điều kiện gỡ thêm đủ integration + regression test rồi mới READY_FOR_LOCAL_REVIEW
- HANDOFF-LOCAL 30/08 18:20 — commits affc6d8..8139978 · gate FAIL (DoD chưa đủ, prettier full exit 1) · handoff `tk-a16-worker-handoff.md` · CHƯA PUSH
- UPDATE 30/08 18:25 — xác nhận code head bfba6c4, reviewer commit baae52f và continuation HEAD 5e200c5; bắt đầu sửa R01–R12 theo REQUEST_CHANGES, giữ nguyên commit cũ và dirty ngoài scope
- UPDATE 30/08 21:14 — tiếp tục vòng sửa 2 theo reviewer `fa8a40b`/`1b9b222`; giữ nguyên branch, stash và ba file dirty ngoài scope
- REVIEW-FIX 30/08 21:14 — finding R2-01/R2-02 · commit `fix(monitor): use posix paths and await graceful shutdown` pending · regression `cd app && pnpm typecheck:node && pnpm test -- --run src/main/monitor` = PASS (14 tests)
- REVIEW-FIX 30/08 21:18 — finding R2-03/R2-05/R2-06 · commit pending `feat(monitor): complete ml lifecycle settings and alerts` · regression `cd app && pnpm typecheck:node && pnpm test -- --run src/main/monitor` = PASS (14 tests)
- REVIEW-FIX 30/08 18:45 — finding R05/R07/R08/R06 · commit `f251368` · regression `cd app && pnpm test -- --run src/main/monitor` = PASS (8 tests)
- REVIEW-FIX 30/08 18:46 — finding R02/R03/R06/R09 · commit `e1194cb` · regression `cd app && pnpm test -- --run src/main/monitor` = PASS (11 tests)
- REVIEW-FIX 30/08 18:48 — finding R01/R04/R09/R10 · commit `5aed052` · regression `cd app && pnpm typecheck:node && pnpm test -- --run src/main/monitor` = PASS (11 tests)
- REVIEW-FIX 30/08 18:50 — finding R11/R12 · commit `4b762dc` · regression `cd app && pnpm try:monitor && pnpm test -- --run src/main/monitor` = PASS (12 tests; CLI metrics=3, score_rows=15, alerts=0, offset=679)
- UPDATE 30/08 18:55 — gate bằng Node 24.16.0 vì máy không có Node 22; typecheck/build/scoped Prettier PASS, full test FAIL 2 renderer timeout (188/190); chưa READY_FOR_LOCAL_REVIEW
- HANDOFF-LOCAL 30/08 18:58 — commits 5e200c5..HEAD · gate FAIL (Node 22 unavailable; full test 188/190) · handoff `tk-a16-worker-handoff.md` · CHƯA PUSH
- REVIEW 30/08 18:35 — `REQUEST_CHANGES` · review file `tk-a16-review-01.md` · R01–R05 BLOCKING, R06–R11 MAJOR, R12 MINOR · test độc lập Node 22: 186/186, lint 0 error/16 baseline warning, typecheck/build/scoped Prettier PASS · CHƯA PUSH
- REVIEW 30/08 19:15 — commit `fa8a40b` · `REQUEST_CHANGES` vòng 2 · review file `tk-a16-review-02.md` · R2-01–R2-04 BLOCKING, R2-05–R2-07 MAJOR · test độc lập Node 22.23.2: monitor 12/12, full 190/190, lint 0 error/16 baseline warning, typecheck/build/scoped Prettier PASS · CLI hiện chưa chạy DB/poller thật · CHƯA PUSH
- ASSIGNED 30/08 — Sau demo VPS/Deploy, A ưu tiên lát cắt dữ liệu M6. Giao Worker GPT-5.6
  Luna Medium thực hiện CP1→CP4; Codex/root chịu trách nhiệm review lặp đến khi đạt DoD.

## 11. Biên bản bàn giao bắt buộc

Trước khi dừng, Worker phải điền đầy đủ
[`tk-a16-worker-handoff.md`](tk-a16-worker-handoff.md), chuyển TK-A16 trên board sang `CHỜ REVIEW`
với ghi chú `local <head-sha> · chưa push`, thêm dòng `HANDOFF-LOCAL` ở mục 10 và tạo commit bàn
giao cục bộ. Thiếu một trong bốn phần này thì task vẫn là `ĐANG LÀM`:

1. Outcome đạt/chưa đạt và phạm vi thực tế.
2. Bảng commit CP1–CP4 cùng danh sách file thay đổi.
3. Lệnh test/gate, exit code và kết quả thực tế.
4. DoD, giới hạn, rủi ro, bước tái hiện và câu hỏi cho reviewer.

Worker dừng sau commit bàn giao. Không push, mở PR hay merge; reviewer sẽ kiểm tra local trước.

## 12. Lệnh tái hiện và trạng thái remote

Worker điền lệnh tối thiểu vào biên bản bàn giao để reviewer chạy lại từ repository root.

- Remote push: **chưa được A cho phép**.
- PR: **chưa mở**.
