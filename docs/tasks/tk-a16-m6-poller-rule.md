# TK-A16 — M6 Poller + Rule Engine: metric → SQLite → score/alert → IPC

> Đây là task hiện tại của người A sau buổi demo VPS/Deploy cơ bản. Worker được chỉ định:
> **GPT-5.6 Luna · Medium Effort**. Reviewer cuối: **Codex/root**. Worker không tự merge PR.

| Chủ | Hạn | Branch | Brief | Ưu tiên |
|---|---|---|---|---|
| A | 04/09/2026 | `feat/m06-monitor-poller-rule` | `docs/prompts/m06-poller-rule.md` | P0 |

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
- Không dùng GitNexus trong task này cho tới khi A cho phép lại.

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

Worker làm tuần tự và commit sau mỗi checkpoint. Không dồn toàn bộ vào một commit lớn.

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
- Chạy toàn bộ gate, cập nhật board/tk-file/trace matrix, push và mở PR.

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
- [ ] `docs/05`, board và nhật ký file này cập nhật trong cùng PR.
- [ ] Worker push branch, mở PR, ghi rõ giới hạn/chưa làm và **không tự merge**.
- [ ] Reviewer Codex/root không còn finding mức blocking/major.

Smoke metric thật trên VM01, stress/reboot và soak 24h thuộc TK-S4/W5, không chặn code gate này.

## 8. Prompt giao nguyên văn cho Worker

```text
Bạn là Worker thực hiện TK-A16 bằng GPT-5.6 Luna, reasoning effort Medium.

Repo: OpsPilot. Branch đã chuẩn bị: feat/m06-monitor-poller-rule.
Hãy đọc đầy đủ CLAUDE.md, docs/tasks/README.md và
docs/tasks/tk-a16-m6-poller-rule.md, sau đó đọc toàn bộ tài liệu bắt buộc trong mục 2 của
tk-file. Tạm thời không dùng GitNexus.

Trước khi code:
1. Xác nhận branch dựa trên origin/main >= 2addfb8.
2. Chuyển TK-A16 trên board từ TUẦN NÀY sang ĐANG LÀM và thêm START 30/08 vào nhật ký.
3. Viết lại kế hoạch CP1→CP4 ngắn gọn; nếu phát hiện contract mâu thuẫn thì dừng và báo.

Thực hiện đúng scope, không sửa docs/contracts, migration 001, renderer, collector hay deploy.
Không thêm dependency và không overengineer. Làm tuần tự CP1→CP4, mỗi checkpoint có test và
commit riêng. Dùng fixture/local source để không phụ thuộc B hoặc VPS. Không bỏ qua các case byte
offset, partial line, corrupt line, duplicate seq, ML down, exactly-five-scores, alert lifecycle,
transaction rollback và poll overlap.

Cuối task chạy: pnpm test, pnpm lint, pnpm typecheck, prettier --check và pnpm build trong app.
Cập nhật board + tk-file + docs/05 trong cùng branch; push branch và mở PR nhưng KHÔNG merge.
Bàn giao bắt buộc gồm: PR/commit, file đã đổi, lệnh + kết quả test, checklist DoD, giới hạn còn lại
và các điểm muốn reviewer chú ý. Không tuyên bố hoàn thành nếu còn test đỏ hoặc chưa cập nhật docs.
```

## 9. Quy trình review và sửa lỗi

Reviewer Codex/root sẽ:

1. Đọc toàn bộ diff so với `origin/main`, kiểm tra scope/contract/secret trước.
2. Chạy test tập trung của monitor/DB/ML client, sau đó chạy toàn bộ gate repo.
3. Kiểm tra riêng các rủi ro: byte offset UTF-8, transaction, duplicate, ML NULL, alert restart,
   timer cleanup, IPC query và log không chứa secret.
4. Trả finding có mức `BLOCKING`, `MAJOR`, `MINOR`, kèm file/dòng và cách tái hiện.
5. Worker sửa trên cùng branch, thêm test hồi quy và dòng `REVIEW-FIX` vào nhật ký; reviewer chạy lại.
6. Lặp đến khi không còn `BLOCKING/MAJOR`. Worker không tự merge; A quyết định merge sau APPROVED.

## 10. Nhật ký

- ASSIGNED 30/08 — Sau demo VPS/Deploy, A ưu tiên lát cắt dữ liệu M6. Giao Worker GPT-5.6
  Luna Medium thực hiện CP1→CP4; Codex/root chịu trách nhiệm review lặp đến khi đạt DoD.

## 11. Lệnh tái hiện và PR

Worker điền khi bắt đầu/bàn giao. PR: chưa mở.
