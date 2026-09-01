# REVIEW 02 — TK-A16 M6 Poller + Rule Engine

> Reviewer: Codex/root
> Code được review: `5e200c5..53482e7`
> Kết luận: **REQUEST_CHANGES — chưa đạt `READY_FOR_LOCAL_REVIEW`**
> Quyền Git: chỉ commit cục bộ; **không push, không mở PR, không merge** khi A chưa yêu cầu.

## 1. Bằng chứng review độc lập

- Branch/HEAD: `feat/m06-monitor-poller-rule@53482e7`.
- GitNexus đã re-analyze tới `53482e7`: 68 symbol đổi, 19 execution flow bị ảnh hưởng; risk tổng
  hợp `critical` vì đường chạy đi qua scheduler → SSH → SQLite/ML → IPC.
- Node chuẩn của workspace tồn tại qua `tools/enter-node22.ps1`: `v22.23.2`.
- `pnpm test -- --run src/main/monitor`: **12/12 PASS**.
- `pnpm test`: **190/190 PASS** trên Node 22. Hai renderer timeout Worker gặp trên Node 24 là nhiễu
  môi trường, không phải regression của M6.
- `pnpm try:monitor`: exit 0, in `metrics=3`, `score_rows=15`, `alerts=0`, `offset=679`, nhưng CLI
  hiện chưa chạy poller/SQLite thật nên kết quả này chưa phải smoke evidence hợp lệ.
- `pnpm lint`: 0 error, 16 warning Prettier baseline ở renderer; TK-A16 không thêm warning.
- `pnpm typecheck`, scoped Prettier và `pnpm build`: **PASS**.
- `git diff --check 5e200c5..53482e7`: **PASS**.
- File riêng của user `.devflow/`, `docs/ban-giao-20-08.md`, `logo.png` và `stash@{0}` không bị
  chạm/stage.

## 2. Finding phải sửa

### R2-01 — BLOCKING — Đường dẫn metrics trên VPS sai trên Windows

- Bằng chứng: `app/src/main/monitor/service.ts:7` import `join` từ `node:path`, rồi dòng 104 dùng nó
  để ghép đường dẫn Linux. Trên máy Windows hiện tại, lệnh tái hiện trả:

  ```text
  join('/opt/opspilot','demo-app','metrics','metrics.jsonl')
  -> \opt\opspilot\demo-app\metrics\metrics.jsonl
  ```

- Hậu quả: `SshMetricSource` gọi `stat`/`tail` với đường dẫn dấu `\`; polling production trên VPS
  Linux thất bại ngay cả khi file tồn tại.
- Yêu cầu: dùng `node:path/posix` hoặc `path.posix.join`, đúng như `metric-format.md`; test phải bắt
  chính xác `/opt/opspilot/<app>/metrics/metrics.jsonl` khi chạy trên Windows.

### R2-02 — BLOCKING — Shutdown không chờ poll hiện tại trước khi đóng DB/SSH

- Bằng chứng: `MonitorScheduler.stop()` đã thành async và chờ `this.current`, nhưng
  `app/src/main/index.ts:155-164` gọi `monitorScheduler?.stop()` mà không await. `before-quit` tiếp tục,
  `sshManager.disconnectAll()` chạy ngay và `will-quit` đóng DB.
- Hậu quả: tick đang chờ SSH/ML có thể tiếp tục dùng connection đã ngắt hoặc SQLite đã đóng; R10
  chưa được sửa ở lifecycle thực tế dù unit class có Promise.
- Yêu cầu: cài graceful-shutdown có `event.preventDefault()`/guard chống gọi lặp, chờ scheduler stop
  hoàn tất rồi mới disconnect/stop ML/cho app quit và đóng DB. Test phải giữ một poll Promise đang
  pending, gọi shutdown/stop, chứng minh DB chỉ được đóng sau khi poll resolve và không có tick mới.

### R2-03 — BLOCKING — ML runtime chưa có auto-train và chưa báo trạng thái lỗi ingest

- Bằng chứng:
  - `MlApiClient.status()` được viết nhưng không có production caller.
  - `trainNow()` là nơi duy nhất gọi `/train`; không có auto-train khi đủ ≥150 mẫu.
  - Khi `mlService.getPort()` trả null, scheduler truyền scorer `undefined`; không ghi trạng thái ML
    down. Khi `/ingest` lỗi, poller chỉ ghi action log, không phát `system:ml-status`.
- Hậu quả: nếu người dùng không bấm train tay, model luôn `ready:false` và bốn score ML tiếp tục
  `NULL`; UI cũng có thể vẫn báo ML chạy dù API ingest/status đã lỗi.
- Yêu cầu: hiện thực auto-train đúng task packet: kiểm tra status, chỉ train một lần khi đủ mẫu và
  model chưa trained, có cờ constructor/env để tắt; không train lại mỗi poll. Nối callback phát
  `system:ml-status {running:false, reason}` và action log có rate-limit khi service/ingest lỗi; khi
  phục hồi phải có trạng thái running hợp lý. Test case: 149 không train, 150 train đúng một lần,
  poll sau không train lại, disabled không train, ML down vẫn ghi rule + bốn NULL và phát status.

### R2-04 — BLOCKING — `try:monitor` là phép tính giả, chưa smoke code M6

- Bằng chứng: `app/scripts/try-monitor.ts` chỉ parse ba dòng rồi gán
  `scoreRows = parsed.length * 5`; không khởi tạo DB, không gọi `MonitorPoller`, không chạy rule/alert,
  không kiểm tra transaction/duplicate và không đọc count thật từ SQLite.
- Hậu quả: CLI vẫn PASS nếu repository/poller/alert hỏng hoàn toàn, nên không đáp ứng code gate độc
  lập hay R11.
- Yêu cầu: CLI phải tạo DB tạm, seed app/current running deployment, dùng fixture sinh bởi
  `ml-service/scripts/gen_fake_series.py` qua Python trong `ml-service/.venv` (hoặc fixture thực sự
  do script đó sinh), chạy `LocalMetricSource` + `MonitorPoller`, query count thật, poll lại để chứng
  minh idempotency, kiểm tra offset và alert/score; invariant sai phải exit khác 0. Nếu dùng
  `better-sqlite3`, giữ đúng cơ chế Electron ABI tương tự CLI deploy hiện có.

### R2-05 — MAJOR — Mutation setting chưa bảo toàn và chưa validate đúng domain

- Bằng chứng tại `service.ts:29-64`:
  - `UPDATE` chạy trước `getOrCreateSetting`; app chưa có row thì patch bị mất rồi mới tạo default.
  - Mọi số finite `>=0` đều được nhận, kể cả `rule_error_rate=9`, `ml_score_threshold=2`,
    `rule_consecutive=0.5`, interval `0`; `trusted_method` nhận string bất kỳ đến khi SQLite throw.
  - Lỗi dùng `Error` thường nên qua IPC thành `UNKNOWN`, không phải `VALIDATION`; update và action log
    không nằm chung transaction.
- Yêu cầu: tạo/lấy row trước, schema runtime/whitelist đúng miền và kiểu integer/enum/bool, trả
  `AppError('VALIDATION', ...)`, update `updated_at`, và ghi config + action log nguyên tử. Bổ sung test
  cho row chưa tồn tại, từng nhóm invalid, empty patch, SQLite failure rollback và handler IPC thật.

### R2-06 — MAJOR — Threshold/alert/action log chưa theo setting và contract

- Bằng chứng:
  - `AlertTracker.update()` nhận `threshold` nhưng không dùng; poller persist và xét trực tiếp
    `above_threshold` từ ML service mặc định 0.7. Đổi `monitor_setting.ml_score_threshold` không ảnh
    hưởng alert.
  - Khi alert được mở ở `alertTracker.ts:49-62`, không có action `alert_raised` trong cùng transaction.
  - Test alert hiện chỉ có một case cơ bản; chưa khóa NULL, first sample, peak ban đầu, restart giữa
    chuỗi high/low và năm method độc lập.
- Yêu cầu: áp dụng threshold theo setting một cách nhất quán khi ghi score/xét alert (giữ đúng quy
  tắc ensemble), ghi `alert_raised` nguyên tử khi tạo alert, và thêm toàn bộ regression nêu trên.

### R2-07 — MAJOR — Tick và phân loại lỗi runtime chưa chính xác

- Bằng chứng tại `service.ts:91-127`:
  - Batch mới được suy ra bằng `count trước + listSamples(...).slice(before)`, còn scores/alerts được
    query lại từ timestamp đầu. Mẫu cũ trùng timestamp có thể bị phát lại; sample backfill/clock lệch
    có thể bị slice sai. `MonitorPoller` đã có callback sample ID nhưng production không dùng.
  - `catch` bắt mọi lỗi, kể cả SQLite/transaction/programming error, rồi ghi tất cả thành
    `ssh_error`; có hai dòng `continue` liên tiếp.
  - Dòng JSON hoàn chỉnh bị hỏng bị filter bỏ trước vòng warning, nên không có warning/action evidence
    dù offset vẫn tiến.
- Yêu cầu: gom payload theo ID/result đúng của transaction hiện tại, phát đúng một tick chỉ chứa dữ
  liệu mới; chỉ phân loại lỗi nguồn SSH/file thành `ssh_error`, để lỗi DB/code nổi lên error boundary
  có log; consume corrupt line nhưng ghi evidence không chứa secret/raw nhạy cảm. Test cùng timestamp,
  backfill, batch rỗng, hai app tuần tự, SSH fail cô lập, DB fail không bị gắn nhãn SSH.

## 3. Thứ tự commit sửa vòng 2

Không rewrite/rebase lịch sử. Tạo commit mới sau reviewer commit `fa8a40b` (code head được review là
`53482e7`) theo thứ tự:

1. `fix(monitor): use posix paths and await graceful shutdown` — R2-01, R2-02.
2. `feat(monitor): complete ml lifecycle settings and alerts` — R2-03, R2-05, R2-06.
3. `fix(monitor): emit exact batches and classify runtime failures` — R2-07.
4. `test(monitor): make local cli exercise sqlite poller flow` — R2-04 + regression còn thiếu.
5. `docs(monitor): record review two handoff` — nhật ký, board, handoff và gate cuối.

Mỗi commit code phải có regression test liên quan. Không sửa contract/migration/renderer/collector/
deploy, không thêm dependency, không chạm file untracked/stash của user.

## 4. Gate và điều kiện bàn giao lại

Chạy từ PowerShell bằng Node 22 có sẵn:

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

Chỉ chuyển board sang `CHỜ REVIEW` và ghi `READY_FOR_LOCAL_REVIEW` khi R2-01…R2-07 đã sửa, test
Node 22 xanh, CLI chạy code thật và handoff phản ánh đúng HEAD. Full Prettier baseline ngoài scope có
thể ghi riêng; scoped file TK-A16 phải xanh.

## 5. Prompt giao Worker vòng sửa 02

```text
Tiếp tục TK-A16 trên branch feat/m06-monitor-poller-rule từ HEAD hiện tại. Xác nhận code head được
review là 53482e7 và reviewer commit là fa8a40b; không checkout lùi. Đọc đầy đủ CLAUDE.md,
docs/tasks/tk-a16-m6-poller-rule.md, docs/tasks/tk-a16-review-02.md và handoff hiện tại. Kết luận review
vòng 2 là REQUEST_CHANGES: sửa toàn bộ R2-01 đến R2-07 theo đúng thứ tự 5 commit ở mục 3; không tự thu
hẹp scope và không rewrite/rebase lịch sử.

Node 22 có sẵn qua `. .\tools\enter-node22.ps1` (v22.23.2); phải dùng nó cho gate. Được dùng GitNexus
read-only và re-analyze nếu stale. Không sửa contract/migration/renderer/collector/deploy, không thêm
dependency, không chạm `.devflow/`, `docs/ban-giao-20-08.md`, `logo.png` hay stash của user.

Sau mỗi nhóm sửa, thêm REVIEW-FIX vào nhật ký và regression test thật. CLI phải chạy DB/poller thật,
không được suy ra count bằng phép nhân. Cập nhật handoff/board đúng HEAD và bằng chứng test. Chỉ commit
cục bộ. TUYỆT ĐỐI KHÔNG push, mở PR, merge, force-push, reset --hard, clean, rebase hoặc pop/drop stash
khi A chưa yêu cầu. Dừng sau handoff commit và báo rõ CHƯA PUSH/CHƯA PR/CHƯA MERGE.
```
