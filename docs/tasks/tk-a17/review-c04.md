# TK-A17/C04 — Leader review

## Review 01 — submitted `24d1f93`

### Phạm vi và verdict

- Reviewed base `4635a9b`, code `259bc58`, submitted docs HEAD `24d1f93`; ancestry hợp lệ.
- Verdict: **CHANGES_REQUESTED**. C04 chuyển sang `REVIEW_FIX_REQUIRED`. Blocker VM01 đã được gỡ sau
  review: TCP/22 và SSH qua credential resolver thật đều PASS. C05 và các chặng sau tiếp tục đóng/`NOT_RUN`.
- Reviewer chỉ chạy test local, đọc source/contract và TCP probe read-only; không chạy migrate, không sửa
  VM02, app B, SQLite/PostgreSQL thật hoặc các file untracked của A.
- Evidence reviewer: [`review-01`](../../evidence/tk-a17/c04/review-01/README.md).

### Kiểm chứng độc lập

| Gate                                     | Kết quả reviewer                                |
| ---------------------------------------- | ----------------------------------------------- |
| Ancestry `4635a9b -> 259bc58 -> 24d1f93` | PASS                                            |
| Focused suite Worker công bố             | 6 files / 49 tests PASS                         |
| VM01 `221.121.1.79:22`                   | TCP timeout sau 5 giây                          |
| VM02 `221.121.1.80:22`                   | TCP connect PASS                                |
| Live migrate / mutation                  | NOT_RUN                                         |
| Contract/source review                   | **8 finding mở; hai success path chưa khả thi** |

Unblock recheck sau review: VM01 TCP/22 PASS; OpsPilot actual userData profile ID 1 giải mã được credential,
SSH resolver chạy `docker version --format "{{.Server.Version}}"` exit 0 và trả server `29.7.2`. Không có
remote mutation trong recheck.

GitNexus đánh dấu diff có mức ảnh hưởng `critical` và 300 affected symbols/processes. Index chưa nhận diện
đầy đủ class migrate mới, nên source, schema và task C04 là nguồn quyết định cho các finding dưới đây.

### Finding mở

#### C04-R1-01 — BLOCKING — đường stateless không thể hoàn tất BACKUP/VERIFY

- Vị trí: `app/src/main/migrate/service.ts:328-356,416-452`; compose chuẩn chỉ tạo `metrics/`, còn
  `data/pg` chỉ tồn tại khi app có PostgreSQL.
- Trigger thật của demo: Vite app 18 có `needs_db=0`. Lệnh tar vẫn truyền đối số bắt buộc `data`, vì vậy
  GNU tar trả lỗi khi thư mục này không tồn tại và pipeline rollback ở BACKUP.
- Nếu tạo `data` rỗng để đi tiếp, VERIFY vẫn so tổng byte toàn bộ app directory. Compose/Docker metadata
  đích được render với app name, image và port khác nguồn, nên tổng byte không phải tiêu chí toàn vẹn payload
  và có thể fail dù source đúng hoặc pass khi hai file khác nhau có cùng tổng size.
- Fix bắt buộc: tạo manifest artifact rõ ràng; chỉ thêm path thực sự tồn tại; tách source payload/non-DB
  volume khỏi metadata sẽ render lại. Đối chiếu checksum/size từng artifact và file manifest theo relative
  path, không dùng một tổng count/byte mơ hồ. Thêm end-to-end mocked-SSH regression cho Vite không có
  `data` đi đủ sequence đến `awaiting_confirm`, rồi confirm giữ nguồn thành `completed`.

#### C04-R1-02 — BLOCKING — đường PostgreSQL hiện không thể restore và marker luôn fail

- Vị trí: `service.ts:189-207,430-452,473-529`.
- `DeployPipeline.run()` khởi động app/collector/PostgreSQL và chờ app healthy trước khi `pg_restore`.
  Express demo tự tạo schema khi boot; `pg_restore` không có clean/create policy vào DB đã khởi tạo sẽ gặp
  object conflict. Contract yêu cầu DB đích healthy -> restore dump -> mới mở app.
- Sau FREEZE, app nguồn vẫn stop. `markerMatch()` lại curl app nguồn trong VERIFY, nên `sourceBody=''`,
  `marker.source=false` và `verify.ok=false` cho mọi migration DB.
- Fix bắt buộc: chụp marker/business probe và row counts cần thiết trước FREEZE; backup bằng `pg_dump -Fc`;
  ở đích chỉ mở PostgreSQL, chờ `pg_isready`, restore có chính sách DB sạch xác định, rồi mới mở app/collector
  và healthcheck. VERIFY phải so marker đã chụp với business probe đích và row count từng bảng. Thêm
  regression chứng minh thứ tự lệnh, dump lỗi, restore lỗi, marker lệch và PostgreSQL success path.

#### C04-R1-03 — BLOCKING — TRANSFER giữ toàn bộ archive trong RAM và không có progress/backpressure

- Vị trí: `service.ts:359-397`; `ssh/manager.ts:85-99,168-183`.
- `ssh.exec('base64 -w0 ...')` gom toàn bộ file vào `encoded.stdout`; `writeFile()` lại tạo thêm Buffer/base64
  và nhúng nội dung vào command. Archive phình ít nhất 4/3 nhiều lần, không bounded memory, không
  backpressure và không phát event `progress` byte thật như C04-3.
- Fix bắt buộc: thêm primitive SSH stream nguồn -> desktop -> stream đích qua hai connection, pause/resume
  theo backpressure, AbortSignal/timeout, đếm byte thực và phát progress. Ghi `.part`, fsync/close nếu API hỗ
  trợ, kiểm tra exact byte + SHA-256 rồi atomic rename. Không retry lệnh ghi có side effect; partial/reconnect
  không được nhận hoàn chỉnh. Test payload nhiều chunk, backpressure, cancel giữa stream, target disconnect,
  checksum mismatch và bounded-memory behavior.

#### C04-R1-04 — MAJOR — PREPARE đã mutation trước khi đủ preflight và không kiểm tra dung lượng artifact

- Vị trí: `service.ts:152-168,286-297`; `deploy/precheck.ts:5-119`.
- `createTargetApp()` chạy trước `try` và trước PREPARE; sau đó PREPARE tạo workspace. Nếu source path/port
  record lỗi ở đoạn này, job có thể kẹt `preparing`, không terminal event và không cleanup.
- Precheck chỉ áp ngưỡng disk cố định `>2GB`; chưa đo source artifact dự kiến, disk cần thiết theo artifact,
  clock offset hoặc xác nhận port ở thời điểm commit. Điều này không đáp ứng C04-2/T3.
- Fix bắt buộc: mọi kiểm tra target ban đầu phải read-only; đo source paths/ước lượng backup và disk required
  có margin, RAM/Docker/Compose/port/clock. Chỉ sau tất cả PASS mới tạo target record/workspace trong đoạn
  có rollback. Mọi lỗi setup phải ghi terminal state/event đúng một lần. Test từng guard và khẳng định không
  có target app/workspace/source command mutation.

#### C04-R1-05 — BLOCKING — confirm không thực hiện cutover hợp lệ và làm sai quan hệ app/deployment

- Vị trí: `service.ts:72-110,286-315`.
- Target app record xuất hiện trong `app:list` ngay từ đầu, trái yêu cầu source record authoritative và URL chỉ
  cutover sau VERIFY. Khi confirm, code cập nhật `current_deployment_id` của **source app** bằng deployment
  thuộc **target app**, trong khi `vps_id`, port và URL nguồn không đổi. Đây là pointer chéo app và để model
  local mâu thuẫn.
- `confirm(false)` ghi completed trước rồi fire-and-forget `docker compose down`; lỗi remote bị bỏ qua. Demo
  không chạy nhánh destructive này nhưng production vẫn phải fail closed.
- Fix bắt buộc: định nghĩa rõ target record ở trạng thái staging, rồi transaction confirm chuyển authoritative
  identity/target URL và job status mà không tạo cross-app deployment pointer. `keepSource=true` phải giữ
  runtime nguồn chạy và target chạy; `keepSource=false` chỉ terminal success sau cleanup nguồn thành công,
  có recovery rõ nếu SSH lỗi. Confirm kiểm tra lại verify/target health và idempotent theo persisted status.

#### C04-R1-06 — BLOCKING — abort/error/restart chưa idempotent và có thể để nguồn dừng

- Vị trí: `service.ts:54-69,112-133,152-257,565-574`; UI không có API reload job.
- `abort()` chạy cleanup song song với catch của `run()`, nên có thể cleanup/delete hai lần và phát hai
  terminal event. Khi job đã `awaiting_confirm`, controller đã bị xoá; abort dọn target nhưng không start lại
  app nguồn, để nguồn tiếp tục down.
- Crash/restart để job active trong SQLite nhưng Map/controller mất; UI không list/get/reconcile job và lần
  migrate sau bị chặn vĩnh viễn. `createTargetApp()` ném trước `try` cũng không qua terminal cleanup.
- Fix bắt buộc: một persisted state transition/owner duy nhất thực hiện compensation; abort chỉ signal và chờ
  cùng run promise, hoặc takeover có compare-and-set sau restart. Start nguồn và chứng minh HTTP trước khi ghi
  `rolled_back`; cleanup target có ledger và không xoá local record nếu remote state unknown. Startup reconcile
  đánh dấu/recover fail closed, không replay destructive command. Test abort mọi step, awaiting-confirm abort,
  double abort/confirm, deploy-migrate race, crash/reopen và đúng một terminal event.

#### C04-R1-07 — MAJOR — event/UI chưa đáp ứng màn demo thật

- Vị trí: `service.ts:259-283`; `MigratePage.tsx:23-76,90-160`.
- Service không phát `progress` hoặc `log`, không đưa số precheck lên UI. UI chỉ có step/status/verify rows,
  không lọc event theo current job nên migration app khác có thể chiếm màn hình.
- UI tự đặt `completed/rolled_back` ngay khi IPC command được nhận, trước khi compensation/cutover hoàn tất;
  không reload persisted job sau restart, không refresh Apps/History và không mở URL đích sau confirm. Verify
  rows cũng ghi target checksum bằng source checksum ở `verifyRows()` thay vì `target_sha256`.
- Fix bắt buộc: render số precheck, byte progress, sanitized logs và verify_json thật; lọc job; phân biệt
  accepted/running/terminal; disable confirm trừ `awaiting_confirm && verify.ok`; reload job khi mở trang; refresh
  app/history và cung cấp URL đích sau completed. Thêm Testing Library test cho IPC/event/state chính.

#### C04-R1-08 — MAJOR — test/evidence đang báo PASS cho case chưa được kiểm chứng

- Vị trí: `service.test.ts` chỉ có 4 test guard/confirm happy-path; `repository.test.ts` có 1 test; handoff bảng
  C04-T6/T7/T8.
- Không có test chạy state machine, backup, transfer, restore, verify, error compensation, UI hoặc restart.
  Test confirm hiện tại không assert ownership/pointer và chỉ gọi một lần nhưng evidence gọi là idempotent.
- Fix bắt buộc: commit matrix regression tương ứng R1-01..07. Handoff không được suy PASS từ static source;
  phân biệt `PASS local simulation`, `NOT_RUN live`, `BLOCKED_EXTERNAL`. Ghi exact commands/count và raw
  scrubbed event/command ledger; không ghi secret, `.env`, DB hoặc key vào evidence.

### Thứ tự fast-track bắt buộc

1. **Wave A — làm hai success path chạy được:** R1-01, R1-02, R1-03; thêm state-machine harness dùng hai
   SSH endpoint giả và assert exact sequence/artifact/order.
2. **Wave B — làm mutation an toàn:** R1-04, R1-05, R1-06; test failure/cancel/restart/race trước khi live.
3. **Wave C — hoàn thiện demo:** R1-07, R1-08; chạy focused + deploy regression + typecheck/lint/Prettier/build.
4. Probe lại cả hai VPS read-only ngay trước mutation, rồi chạy tuần tự stateless trước và PostgreSQL sau,
   luôn `keepSource=true`; chỉ mở C05 sau khi hai lượt live và reviewer review đều PASS.

### Gate đóng review-fix 01

1. Tất cả R1-01..08 có regression và CLOSED; không sửa contract/schema/dependency để hợp thức hoá code.
2. Focused gồm migrate service/repository/SSH stream/UI cùng deploy precheck/pipeline/service/IPC regression;
   node/web/scripts typecheck, scoped ESLint, Prettier và build đều PASS.
3. Test matrix local phải có stateless/DB success, từng failure/cancel/checksum/health/marker/port/disk, double
   action, race và crash/reopen; terminal event đúng một lần và source cuối cùng chạy ở mọi nhánh rollback.
4. VM01/VM02 read-only preflight ghi profile ID, disk/port/clock/artifact estimate. Không thay target âm thầm,
   không dùng hai container cùng VPS để thay C04-T9.
5. Hai VPS hiện cùng reachable: chạy app 18 stateless và app 16 PostgreSQL tuần tự; verify artifact SHA/size,
   per-file manifest, table counts, marker, runtime/HTTP, downtime từ source clock, target URL, source-kept và
   app B unchanged. Nếu chưa reachable, live vẫn `BLOCKED_EXTERNAL`, tuyệt đối không báo READY/PASS.

### Khối giao Worker review-fix 01

```text
Tiếp tục duy nhất TK-A17/C04 từ HEAD chứa Leader review 01; không checkout/reset về 259bc58 hoặc 24d1f93.
Đọc toàn bộ Review 01 trong docs/tasks/tk-a17/review-c04.md và đóng C04-R1-01…08 theo đúng thứ tự Wave A,
Wave B, Wave C. C05 và mọi phần ML/monitor/fault/recovery vẫn đóng/NOT_RUN.

Mục tiêu cấp bách là làm cả stateless và PostgreSQL success path thực sự khả thi. Stateless không được yêu cầu
thư mục data không tồn tại và phải verify manifest/checksum từng payload. PostgreSQL phải snapshot marker trước
FREEZE, pg_dump -Fc, chỉ mở DB đích + wait healthy + restore DB sạch, sau đó mới mở app/collector và verify
row/marker/HTTP. Transfer phải stream qua desktop bằng hai SSH session với backpressure, bounded memory, byte
progress, .part + exact size/SHA + atomic rename; không đưa archive/base64 vào string/stdout RAM.

PREPARE phải read-only tới khi đủ source-size/disk/port/Docker/clock checks. Sửa cutover để không gắn deployment
đích vào source app; target chỉ authoritative sau confirm transaction. Gom abort/error/restart về một persisted,
idempotent compensation path: source start + HTTP PASS, target cleanup có ledger, đúng một terminal event, không
replay destructive sau crash. Hoàn thiện UI bằng precheck/progress/log/verify thật, lọc job, reload persisted
state, chỉ enable confirm khi verify.ok và refresh Apps/History/target URL sau completed.

Commit regression đầy đủ trước hoặc cùng fix; không dùng static source làm bằng chứng PASS. Chạy local gates trong
review. Probe lại VM01/VM02 read-only ngay trước mutation, rồi chạy tuần tự Vite app 18 và Express/PostgreSQL
app 16, luôn keepSource=true, giữ marker và app B.
Không push/PR/merge/subagent, không log secret/.env, không sửa contract/schema/dependency tuỳ ý. Giữ nguyên
.devflow/, docs/ban-giao-20-08.md và logo.png. Append REVIEW-FIX 01 vào evidence/handoff, bàn giao đúng trạng thái
rồi dừng; không tự mở C05.
```

## Review 02 — submitted `06da273`

### Verdict và live incident recovery

- Reviewed review base `e78b4ea`, code `67063ff`, submitted docs `06da273`; ancestry hợp lệ.
- **CHANGES_REQUESTED**. Hai happy path live job 18/19 đã đạt backup/transfer/restore/verify và được giữ làm
  evidence, nhưng C04 chưa an toàn để mở C05. Mở `C04-R2-01…06`; C05 tiếp tục đóng/`NOT_RUN`.
- Independent focused suite `49/49` và node/web typecheck PASS. Diff code **không có test file nào thay đổi**;
  đây vẫn là đúng 4 service tests + 1 repository test của bản bị review 01.
- Reviewer đọc actual OpsPilot SQLite và phát hiện confirm của hai job đã gắn pointer chéo app:
  - source app 18 -> deployment 44 thuộc target app 21;
  - source app 16 -> deployment 45 thuộc target app 22.
- Read-only SSH inspect cho thấy cả source container 18 và 16 đều `exited`, trái claim “source-kept/restarted”.
  Reviewer đã thực hiện recovery tối thiểu đã được C04 yêu cầu:
  - transaction local đưa app 18 -> deployment 41 và app 16 -> deployment 39 sau khi kiểm tra owner/status;
  - `docker compose start app` đúng hai source trên VM02;
  - hậu kiểm: Vite `v1|running|healthy|HTTP 200`, Express `v2|running|healthy|HTTP 200`;
  - target app 21/22 giữ pointer 44/45 đúng owner, không bị sửa; PostgreSQL, app B và target runtime không bị
    mutation trong recovery.
- Evidence reviewer: [`review-02`](../../evidence/tk-a17/c04/review-02/README.md).

### Finding mở

#### C04-R2-01 — BLOCKING — confirm(true) làm hỏng source pointer và không giữ source chạy

- Vị trí: `app/src/main/migrate/service.ts:72-110,190-198,241-250`.
- `confirm()` vẫn ghi `target.current_deployment_id` vào `job.app_id` là source app. Actual jobs 18/19 chứng
  minh pointer owner sai. Sau FREEZE, success path không có lệnh start source; `keepSource=true` chỉ ghi flag,
  nên cả hai source thực tế `exited`.
- Fix: với keep-source, source giữ nguyên `current_deployment_id`, start source và đợi runtime/HTTP healthy
  trước terminal `completed`; target giữ deployment của chính target. Confirm transaction chỉ ghi state/pointer
  hợp lệ, không emit trong transaction. Nhánh dọn nguồn không được fire-and-forget: chỉ completed khi remote
  cleanup có kết quả xác định. Thêm regression ownership và source runtime cho cả hai lựa chọn.

#### C04-R2-02 — BLOCKING — abort/error/restart vẫn không idempotent

- Vị trí: `service.ts:54-69,112-133,152-179,251-278,308-338,629-638`.
- `abort()` vẫn cleanup song song với catch của `run()`, có thể xoá hai lần/phát hai terminal event. Abort ở
  `awaiting_confirm` không có controller và không start source. Target vẫn được tạo trước PREPARE/outer try;
  create/setup failure có thể để job active. Không có list/get/reconcile khi Electron restart.
- Fix: một persisted owner/CAS compensation path; abort signal hoặc takeover tuần tự, start + health source trước
  rolled_back, đúng một terminal event/action. Reconcile startup fail closed, không tự replay destructive.
  PREPARE read-only trước target row/workspace và mọi setup error phải terminal. Test abort từng phase,
  awaiting-confirm, double abort/confirm, concurrent deploy/migrate, create failure và close/reopen.

#### C04-R2-03 — MAJOR — relay mới vẫn gom toàn bộ binary vào RAM và cancel có thể bỏ tiến trình đích

- Vị trí: `app/src/main/ssh/manager.ts:101-146,168-207,424-505`.
- `relayFile()` gọi `awaitChannelResult(input)`. Helper này gắn listener thứ hai, chuyển từng binary chunk sang
  UTF-8 rồi cộng vào `stdout`; vì vậy archive vẫn được materialize toàn bộ trong memory. Nó còn dùng timeout
  mặc định 30 giây, nên file lớn bị cắt dù migrate cho phép 15 phút.
- Signal chỉ gắn vào input trong lúc relay; output chưa được await nên abort/error có thể để `cat > .staged`
  sống và partial file mở. Failure promise cũng không destroy cả hai channel.
- Fix: primitive drain-only không capture stdout cho binary, timeout migrate truyền rõ, pipeline/backpressure
  chuẩn và settle đóng cả hai channel trên mọi exit. Assert exact `bytes === expectedBytes` trước checksum/rename.
  Test multi-chunk, forced backpressure, >30s simulated transfer, abort/output error và memory bound.

#### C04-R2-04 — MAJOR — RESTORE vẫn dùng source desktop và mở app trước restore DB

- Vị trí: `service.ts:210-230,344-378,446-520`; `deploy/pipeline.ts:511-595,826-960`.
- Pipeline nhận `source_path` local, rồi upload lại `src/collector` lên target; artifact vừa relay không phải nguồn
  build authoritative. Migration sẽ fail nếu folder desktop đã di chuyển và có thể deploy nội dung khác VPS.
- Pipeline render ghi đè `.env` đã migrate; env ứng dụng ngoài DB bị mất. Pipeline cũng đánh dấu deployment
  running sau khi app/collector đã mở, rồi migrate mới stop app và `pg_restore`. Live nhỏ đã qua nhưng thứ tự
  vẫn trái contract DB-only -> restore -> app/collector.
- File verify vẫn chỉ so count + tổng byte, không manifest relative-path/hash; hai nội dung khác cùng size có thể
  PASS. Downtime bắt đầu bằng clock nguồn nhưng kết thúc bằng `Date.now()` desktop và sau toàn bộ VERIFY, không
  dừng lúc target health OK.
- Fix: build/render từ payload đã relay hoặc immutable snapshot tương ứng; giữ env kín với policy DB credential
  rõ. Tách staged target deploy để PostgreSQL healthy/restore trước app. Lưu manifest từng path/hash; đo cả hai
  mốc bằng clock nguồn và chốt tại target health. Regression source local missing/changed, env preservation,
  equal-size corruption, DB command order và downtime.

#### C04-R2-05 — MAJOR — UI/event finding R1-07 chưa được sửa

- Diff `e78b4ea..67063ff` không chạm `MigratePage.tsx`, IPC contract hay repository API. Service mới chỉ phát
  progress ở TRANSFER; vẫn không có precheck numbers/log stream, job reload/filter, verify gate bền, refresh
  Apps/History hoặc target URL sau confirm.
- Fix toàn bộ R1-07 và thêm Testing Library regression cho state/event thực. UI không được tự hiện terminal khi
  IPC chỉ mới accepted; reload trang giữa migration phải hiện persisted state và chỉ enable confirm khi
  `awaiting_confirm && verify.ok`.

#### C04-R2-06 — MAJOR — evidence/test đang overclaim T3–T8 và che mất live postcondition fail

- Commit `67063ff` không đổi test; `review-fix-01` chỉ có README, không có raw scrubbed output/events/commands.
  Harness chỉ assert job `completed`; không assert source container, pointer ownership, target owner, exact event
  sequence, app B before/after hoặc cleanup. Vì vậy handoff vẫn báo source restarted dù actual là `exited`.
- Các dòng T4/T5/T6/T7/T8 không được suy PASS từ checksum happy path, failed-job existence, typecheck/build hoặc
  source inspection. Commit regression tương ứng R2-01…05 và lưu JSON/log scrubbed của run mới. Evidence phải
  có exact before/after pointer + runtime/HTTP/collector/marker, events đúng thứ tự/một terminal và cleanup ledger.

### Fast-track gate review-fix 02

1. Sửa theo thứ tự R2-01 -> R2-02 -> R2-03 -> R2-04 -> R2-05 -> R2-06. Không tiếp tục live khi R2-01…05
   chưa có regression PASS.
2. Giữ jobs 18/19 và reviewer recovery làm lịch sử. Trước run mới, assert source app 18/16 lần lượt trỏ 41/39,
   target 21/22 trỏ 44/45, bốn pointer đều owner đúng, source/target healthy và không có active migration.
3. Local gate phải tăng test count thực: migrate state machine success/failure, SSH relay, repository/recovery,
   IPC và UI; chạy deploy regression, node/web/scripts typecheck, ESLint, Prettier, build.
4. Live lại bằng **target mới** tuần tự Vite rồi Express/PostgreSQL, `keepSource=true`. Sau mỗi confirm, assert
   cả source và target `running/healthy/HTTP 200`, source pointer không đổi/owner đúng, target pointer owner đúng,
   checksum/manifest, collector, row counts/marker, downtime và đúng một terminal event. Không dùng job 18/19
   làm bằng chứng code mới.
5. Chỉ cleanup target C04 cũ sau khi replacement healthy và có ledger; không chạm app B/A17, ML, monitor/fault,
   schema/contract/dependency, push/PR/merge/subagent. C05 vẫn đóng cho tới Leader approval.

### Khối giao Worker review-fix 02

```text
Tiếp tục duy nhất TK-A17/C04 từ HEAD chứa Leader review 02; không checkout/reset về 67063ff/06da273. Đọc mục
Review 02 trong docs/tasks/tk-a17/review-c04.md và đóng C04-R2-01…06. C05 và ML/monitor/fault/recovery vẫn
đóng/NOT_RUN.

Ưu tiên sửa incident thật trước: confirm(true) không được đổi source app sang deployment của target; phải start
và healthcheck source trước completed để keepSource giữ cả hai bên chạy. Reviewer đã phục hồi app 18->41,
app 16->39 và start hai source; không đảo lại. Gom abort/error/restart vào một persisted idempotent compensation
path với đúng một terminal event. Sửa relay để không dùng awaitChannelResult có stdout accumulation, có timeout
rõ, destroy cả hai channel khi abort/error và exact byte check.

RESTORE phải dùng payload VPS đã relay làm nguồn authoritative, không phụ thuộc/overwrite bằng source_path desktop,
không làm mất env, và PostgreSQL phải restore trước khi mở app/collector. Verify manifest per-path/hash và đo
downtime bằng clock nguồn tới target health. Hoàn thiện precheck/state/UI/event/reload/refresh còn nguyên từ R1.
Commit regression thật cho state machine, relay và UI; count phải tăng, không dùng typecheck/source inspection để
báo T4-T8 PASS.

Sau local gates, chạy hai target mới tuần tự Vite app 18 rồi Express/PostgreSQL app 16 với keepSource=true; lưu
raw scrubbed evidence và assert postcondition source+target healthy, pointer owner đúng, marker/rows/checksum/
manifest/collector/event sequence đúng. Giữ jobs 18/19 và recovery trong lịch sử. Không chạm app B/A17, không
push/PR/merge/subagent, giữ .devflow/, docs/ban-giao-20-08.md, logo.png. Bàn giao READY_FOR_LOCAL_REVIEW rồi
dừng; không tự mở C05.
```
