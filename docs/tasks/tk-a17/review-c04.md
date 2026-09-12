# TK-A17/C04 — Leader review

## Review 01 — submitted `24d1f93`

### Phạm vi và verdict

- Reviewed base `4635a9b`, code `259bc58`, submitted docs HEAD `24d1f93`; ancestry hợp lệ.
- Verdict: **CHANGES_REQUESTED**. C04 chuyển sang `REVIEW_FIX_REQUIRED`; live C04 vẫn bị chặn ngoài hệ
  thống do VM01 `221.121.1.79:22` TCP timeout. C05 và các chặng sau tiếp tục đóng/`NOT_RUN`.
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
4. Probe lại cả hai VPS read-only. Nếu VM01 còn timeout, bàn giao `BLOCKED_EXTERNAL` với toàn bộ local test
   PASS. Nếu VM01 mở, chạy tuần tự stateless trước rồi PostgreSQL, luôn `keepSource=true`; chỉ mở C05 sau khi
   hai lượt live và reviewer review đều PASS.

### Gate đóng review-fix 01

1. Tất cả R1-01..08 có regression và CLOSED; không sửa contract/schema/dependency để hợp thức hoá code.
2. Focused gồm migrate service/repository/SSH stream/UI cùng deploy precheck/pipeline/service/IPC regression;
   node/web/scripts typecheck, scoped ESLint, Prettier và build đều PASS.
3. Test matrix local phải có stateless/DB success, từng failure/cancel/checksum/health/marker/port/disk, double
   action, race và crash/reopen; terminal event đúng một lần và source cuối cùng chạy ở mọi nhánh rollback.
4. VM01/VM02 read-only preflight ghi profile ID, disk/port/clock/artifact estimate. Không thay target âm thầm,
   không dùng hai container cùng VPS để thay C04-T9.
5. Khi hai VPS thật cùng reachable: chạy app 18 stateless và app 16 PostgreSQL tuần tự; verify artifact SHA/size,
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
review. Probe lại VM01/VM02 read-only: nếu VM01 còn timeout thì bàn giao BLOCKED_EXTERNAL dù local xanh; nếu cả
hai mở thì mới chạy tuần tự Vite app 18 rồi Express/PostgreSQL app 16, luôn keepSource=true, giữ marker và app B.
Không push/PR/merge/subagent, không log secret/.env, không sửa contract/schema/dependency tuỳ ý. Giữ nguyên
.devflow/, docs/ban-giao-20-08.md và logo.png. Append REVIEW-FIX 01 vào evidence/handoff, bàn giao đúng trạng thái
rồi dừng; không tự mở C05.
```
