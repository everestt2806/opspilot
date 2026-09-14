# Review C02 — SSH/SQLite ingestion và ranh giới deployment

## 1. Phạm vi và verdict

- Reviewed base: C01 APPROVED tại `4510d5e` (code C01 `8e42856`, docs C01 `9689ea4`).
- Reviewed code: `0967fb9`; reviewed docs HEAD: `8e08f76`.
- Branch: `feat/a17-demo-checkpoint`; ancestry từ C01 APPROVED hợp lệ.
- Diff C02 chỉ có runner live, hai regression monitor, cấu hình compile script và hồ sơ. Không có
  thay đổi production ở poller, repository, scheduler, service hay deployment lifecycle.
- Verdict: **CHANGES_REQUESTED**. C02 chưa APPROVED; C03–C09 tiếp tục đóng/`NOT_RUN`.

Reviewer giữ nguyên SQLite/VPS, không deploy/restart/rollback, không chạy ML, không thao tác app B,
không push/PR/merge. Bằng chứng độc lập nằm tại
[review-01](../../evidence/tk-a17/c02/review-01/).

## 2. Kiểm chứng độc lập

| Gate | Kết quả reviewer |
| --- | --- |
| Scope/ancestry | `4510d5e` là ancestor; C02 có 8 file đổi, production logic ingestion không đổi |
| Focused monitor/deploy | 12 files, 71/71 PASS trên Node 22.23.2 |
| Static/build | typecheck node + scripts, ESLint, Prettier và electron-vite build đều exit 0; renderer 3045 modules |
| Collector | 26/26 PASS bằng `ml-service/.venv`; ghi chú “thiếu pytest” của Worker không còn là blocker |
| Regression reviewer | 1/1 FAIL: backlog trước activation bị gán vào deployment mới |
| SQLite read-only | 2141 metrics/10705 scores; deployment 9 có 2120 rows, trong đó 80 rows có timestamp trước lúc deployment 9 bắt đầu |
| VPS read-only | app v9/DB healthy, collector và app B running/restart 0; raw seq 22/102/105/latest được đối chiếu |
| GitNexus | analyze PASS với cảnh báo FTS; 31 symbol đổi, 6 affected, risk HIGH; `MonitorPoller.poll` có 8 upstream callers |

## 3. Findings phải sửa

### C02-R1-01 — BLOCKER — backlog phiên bản cũ bị gán vào deployment hiện tại

- Vị trí: `app/src/main/monitor/poller.ts:49-52,92-118`; regression Worker tại
  `app/src/main/monitor/poller.test.ts:132-145`.
- Trigger: `current_deployment_id` đổi sang deployment mới trong khi `app.metrics_offset` vẫn trỏ
  vào phần file được collector của phiên bản cũ ghi trước activation.
- Expected: C02 bước 6/C02-T4 yêu cầu không nhập backlog v1 thành mẫu v2, kể cả forward deploy,
  failed attempt, manual rollback và auto rollback.
- Actual: poller lọc duplicate và insert toàn bộ dòng mới bằng `deploymentId` được truyền vào; không
  có activation boundary. Test Worker poll deployment 1 trước khi chuyển deployment 2 nên shared
  offset đã vượt backlog và không tái hiện trigger.
- Bằng chứng live: deployment 9 bắt đầu `2026-09-11T01:43:53Z`, nhưng 80 rows seq `22..101`
  đang được gán deployment 9 có `ts_vps=2026-09-10T20:26:55Z..20:40:05Z`, sớm hơn 5 giờ.
  Regression reviewer với một dòng trước activation và một dòng sau activation nhận cả hai ở
  deployment 2 thay vì chỉ dòng sau activation.
- Fix bắt buộc: trước khi đổi contract/schema hoặc chọn timestamp/offset theo suy đoán, lập proposal
  cụ thể cho Leader. Proposal phải xác định nguồn sự thật của activation boundary và cách giữ backlog
  đúng deployment cho forward deploy, failed attempt, manual rollback, auto rollback; xử lý clock
  skew, rotation/restart, scheduler đang poll và tính nguyên tử của routing + offset. Không được âm
  thầm bỏ mọi backlog.
- Regression bắt buộc: current deployment đổi trước lần poll đầu; backlog cũ và mẫu mới cùng một
  tail; failure trước activation; manual rollback; auto rollback quay về deployment cũ; rotation và
  retry. Mỗi case phải chứng minh `(deployment_id, seq)`, score cardinality và offset.
- Live bắt buộc sau khi policy được Leader chấp thuận và triển khai: redeploy/rollback có backlog
  kiểm soát, đối chiếu raw JSONL với SQLite theo seq/time/deployment. Không sửa hoặc xóa 80 rows lịch
  sử để làm evidence đẹp; ghi chúng là dữ liệu đã nhiễm và giữ nguyên cho audit.

### C02-R1-02 — MAJOR — C02-T5 chưa quan sát scheduler thật

- Vị trí: `app/scripts/a17-c02-live.ts:64-77`; `app/src/main/monitor/scheduler.ts:12-38`;
  `app/src/main/monitor/service.ts:102-146`.
- Expected: C02 bước 2–3/T5 yêu cầu CLI live chạy qua `MonitorService`/scheduler thật, quan sát mặc
  định 30 giây, không overlap và shutdown không treo/open handle.
- Actual: runner tạo `MonitorPoller` và gọi `poll()` trực tiếp ba lần; evidence cũng ghi rõ không start
  scheduler. Unit tests scheduler không thay thế live observation nên C02-T5 không thể là PASS.
- Fix/evidence bắt buộc: runner hẹp phải gọi đúng service và `MonitorScheduler` production, quan sát
  ít nhất hai tick 30 giây, ghi UTC start/end từng tick, concurrent count tối đa 1, inserted/offset mỗi
  tick; gọi `stop()`, đóng SSH/DB/Electron và chứng minh process exit 0 không còn timer/open handle.
  Giữ ML disabled/null trong C02.

### C02-R1-03 — MAJOR — hồ sơ chỉ nêu batch cuối, bỏ thiếu mutation của lần chạy đầu

- Vị trí: `docs/evidence/tk-a17/c02/ingestion.md:8-9,31-39` và
  `docs/tasks/tk-a17/handoff-c02.md:18-20`.
- Expected: evidence trước/sau phải đối soát toàn bộ thay đổi từ baseline C01 đã approve:
  offset `6152`, 21 metrics, 105 scores.
- Actual: trạng thái cuối là offset `627450`, 2141 metrics, 10705 scores. Tổng mutation C02 là
  **+2120 metrics/+10600 scores**; `+10/+50` chỉ là batch của lần chạy thành công cuối. Lần chạy đầu
  không có raw command/output riêng và đã tạo phần lớn rows, gồm 80 rows bị gán sai boundary.
- Fix bắt buộc: append lịch sử hai lượt chạy, before/after của từng lượt nếu còn truy xuất được,
  command/runtime/exit và lý do lần đầu không hoàn tất assertion. Nếu raw output không còn thì ghi
  `MISSING`, không tái dựng thành log thật. Đối soát số học `21+2120=2141` và
  `105+2120*5=10705`; không reset/xóa/reassign SQLite.

### C02-R1-04 — MINOR — chưa ghi giới hạn crash-window của ML ingest

- Vị trí: `app/src/main/monitor/poller.ts:95-108,113-185`; hồ sơ C02.
- Expected: C02 bước 7 yêu cầu nói rõ giới hạn khi ML nằm ngoài SQLite transaction và không tuyên bố
  exactly-once toàn hệ thống.
- Actual: `scorer.ingest()` chạy trước transaction metric/score/offset. Process có thể crash sau khi
  ML nhận sample nhưng trước khi SQLite commit; retry có thể gửi cùng sample lại cho ML.
- Fix bắt buộc: ghi contract thực tế: transaction chỉ đảm bảo metric + năm score rows + offset trong
  SQLite; ML delivery hiện là at-least-once trong crash-window và cần idempotency theo
  `(deployment_id, seq)` ở phía ML nếu muốn chống lặp.

### C02-R1-05 — MINOR — provenance và trạng thái hồ sơ chưa đúng bản nộp

- Vị trí: `docs/tasks/tk-a17/handoff-c02.md:7-8`; sổ bàn giao và board.
- Actual: handoff ghi docs HEAD `5e934a3` trong khi bản nộp là `8e08f76`; sổ ghi “chưa commit”.
- Fix bắt buộc: append REVIEW-FIX với exact code/docs HEAD và đủ commit, giữ lịch sử bản nộp vòng 1.
  Trong lúc sửa, TK-A17 là `ĐANG LÀM`, C02 `REVIEW_FIX_REQUIRED`, C03–C09 đóng.

## 4. Kết quả được giữ

Không cần làm lại các phần sau nếu diff sửa không tác động: parser partial/invalid/UTF-8, SSH failure
giữ offset, reconnect, unique `(deployment_id, seq)`, SQLite transaction rollback và năm score rows
mỗi metric. Focused 71/71, collector 26/26 và static/build hiện đạt, nhưng Worker phải chạy lại suite
bị ảnh hưởng sau sửa.

## 5. Bàn giao vòng sửa cho Worker

```text
Sửa duy nhất TK-A17/C02 theo docs/tasks/tk-a17/review-c02.md, verdict CHANGES_REQUESTED.
Tiếp tục HEAD hiện tại có commit review; không checkout/reset về 0967fb9 hoặc 8e08f76.
Đóng C02-R1-01…05; giữ nguyên SQLite/VPS hiện có và 80 rows đã nhiễm để audit.

Ưu tiên C02-R1-01: trước mọi thay đổi schema/contract hoặc cách cắt boundary, viết proposal cụ thể
bao phủ forward deploy, failed attempt, manual rollback, auto rollback, clock skew, rotation/restart,
scheduler concurrent và transaction routing+offset. Nếu cần đổi contract/schema, bàn giao BLOCKED
kèm proposal để Leader duyệt; không tự đoán, không âm thầm bỏ backlog và chưa chạy live mutation.

Các việc không phụ thuộc proposal được làm ngay: sửa hồ sơ tổng mutation +2120/+10600, ghi ML
crash-window, bổ sung regression tái hiện, và tạo runner dùng MonitorService + MonitorScheduler thật.
Sau khi policy được chấp thuận/triển khai, chạy live redeploy/rollback C02-T4 và ít nhất hai tick 30s
C02-T5; chứng minh no-overlap + clean shutdown, raw JSONL↔SQLite boundary, retry/dedupe/offset.
Chạy focused ingestion/deploy tests, collector pytest bằng ml-service/.venv, typecheck/lint/format/build;
append REVIEW-FIX vào handoff, cập nhật board/task/sổ và commit local.

C03-C09 vẫn NOT_RUN; không train/score ML, không làm UI/fault/auto-rollback policy, không thao tác
app B, không push/PR/merge/subagent. Bàn giao READY_FOR_LOCAL_REVIEW khi đủ mọi gate; nếu contract
cần quyết định Leader thì bàn giao BLOCKED với proposal và dừng trước implementation/live mutation.
```

## 6. Review 02 — quyết định proposal tại `87fa868`

- Proposal payload `ca0b3fa`, provenance HEAD `87fa868`, kế thừa review `05848d1` hợp lệ.
- Decision: **APPROVED_WITH_AMENDMENTS để triển khai C02**. C02 vẫn `CHANGES_REQUESTED`; C03–C09
  tiếp tục đóng. Chi tiết quyết định và impact ở
  [proposal-analysis](../../evidence/tk-a17/c02/review-02/proposal-analysis.md).
- `C02-R1-04` và `C02-R1-05`: CLOSED. `C02-R1-03`: PARTIAL, vẫn thiếu lịch sử hai lượt chạy với
  command/runtime/exit, raw output `MISSING` và phép đối soát số học như review-01 yêu cầu.
- `C02-R1-01`: không còn blocked chờ quyết định; vẫn OPEN cho tới khi implementation, regression và
  live redeploy/rollback đạt. `C02-R1-02` vẫn OPEN/`NOT_RUN`.

Leader chấp thuận chiến lược byte boundary với các amendment bắt buộc:

1. Dùng migration `002` và bảng append-only `deployment_activation`, mỗi lần runtime hoạt động là
   một row có stream generation, start inclusive/end exclusive và lifecycle state. Không đặt một cặp
   `metrics_start_offset/activated_at` duy nhất trên `deployment`; auto rollback tái kích hoạt cùng
   deployment nhiều lần.
2. Dùng một per-app async lock chung cho deploy/rollback và monitor. Dừng/flush collector trước khi
   chụp file identity + `size + 1`; boundary nằm tại runtime cutover trước healthcheck. Metric do
   candidate sinh trong healthcheck thuộc candidate.
3. Failed attempt đã chạy giữ activation interval của chính candidate. Auto rollback tạo activation
   row mới trỏ về previous deployment; manual rollback dùng deployment row mới hiện có.
4. File identity/generation là bắt buộc. Rotation phải được nhận ra ngay cả khi file mới đã lớn hơn
   cursor cũ; drain `.1` nếu identity khớp, nếu không thì log/expose data gap thay vì báo lossless.
5. DB cũ lazy-init từ offset/current deployment hiện có dưới cùng lock. Giữ nguyên toàn bộ historical
   rows. Prepared activation sau crash phải fail closed trước scheduler, có action log.

### Bàn giao implementation cho Worker

```text
Tiếp tục sửa duy nhất TK-A17/C02 từ HEAD có commit Leader review 02; không checkout/reset về 87fa868.
Proposal byte boundary được APPROVED_WITH_AMENDMENTS theo mục 6 của review-c02.md và
docs/evidence/tk-a17/c02/review-02/proposal-analysis.md. Triển khai đúng persistent model, cutover,
failure/rollback, rotation và shared-lock contract đã chốt; migration mới là 002, không sửa 001.

Đóng C02-R1-01 bằng regression đầy đủ: v1→v2 migration/lazy legacy, backlog qua hai forward deploy,
candidate metrics trong healthcheck, fail trước/sau runtime start, manual rollback, auto rollback tái
kích hoạt cùng deployment, prepared crash fail-closed, scheduler/deploy no-overlap, rotation với file
mới nhỏ hơn/lớn hơn cursor, retry/dedupe/cardinality/transaction rollback.

Hoàn tất C02-R1-03 bằng lịch sử từng live runner attempt: command/cwd/runtime/exit, before/after còn
truy xuất được, ghi raw output MISSING nếu không còn, và phép tính 21+2120=2141,
105+2120*5=10705. Không sửa/xóa/reassign 80 historical rows.

Sau khi local gates đạt, chạy live có kiểm soát chỉ VM02/a17-notes-0911: forward redeploy + manual
rollback để chứng minh boundary bằng raw JSONL↔SQLite; chạy MonitorService + MonitorScheduler thật
ít nhất hai tick 30s, concurrent max 1, stop/close sạch và process exit 0. Xác nhận app/DB/collector,
PostgreSQL marker và app B sau test; phục hồi target A về trạng thái running khỏe mạnh.

Chạy focused deploy/monitor/db/shutdown, collector pytest bằng ml-service/.venv,
typecheck node/web/scripts, scoped lint/format và build. Cập nhật contract/schema, evidence,
handoff/board/task/sổ; commit local và bàn giao READY_FOR_LOCAL_REVIEW.
C03-C09 NOT_RUN; không train/score ML, không làm UI/fault/auto-rollback coordinator, không thao tác
app B, không push/PR/merge/subagent.
```

## 7. Review 03 — implementation tại `0e7d207`

### Phạm vi và verdict

- Reviewed code `ce1a9ff`, handoff payload `2c0abb7`, submitted HEAD `0e7d207`; ancestry từ
  design review `a8cfd34` hợp lệ.
- Verdict: **CHANGES_REQUESTED**. C02 chưa APPROVED; C03–C09 tiếp tục đóng/`NOT_RUN`.
- `C02-R1-02/03/04/05` được CLOSED theo live scheduler, audit lịch sử, crash-window và provenance
  cuối. `C02-R1-01` vẫn OPEN vì implementation chưa đáp ứng đầy đủ contract đã duyệt.
- Reviewer chỉ chạy local. Không sửa SQLite thật, không thao tác VM02/app B, không deploy/rollback,
  không ML train/score và không push/PR/merge.

Chi tiết nguồn, regression và kết quả kiểm tra nằm tại
[review-03](../../evidence/tk-a17/c02/review-03/).

### Kiểm chứng độc lập

| Gate | Kết quả reviewer |
| --- | --- |
| Ancestry/diff | PASS; 20 file đổi từ `a8cfd34`, chạm deployment/monitor/SSH/DB |
| Focused db+monitor+deploy | 17 file, 81/81 PASS |
| Focused thêm SSH | 19 file, 106/106 PASS |
| Collector | 26/26 PASS bằng `ml-service/.venv` |
| Typecheck/lint/format/build | PASS; renderer 3045 modules |
| Regression app mới | 1/1 FAIL: `metrics.jsonl` chưa tồn tại làm deploy kết thúc `failed` trước lần `compose up` đầu |
| GitNexus | analyze PASS; diff risk CRITICAL; `prepareActivationFor` CRITICAL, poll/rotation HIGH |
| Live | Không chạy lại; chỉ đọc evidence Worker, không nhận là evidence reviewer |

Con số `82/82` trên 18 file và collector 19 tests trong handoff không tái tạo được vì handoff không
ghi exact focused command. Hai scope reviewer nêu trên đều PASS và collector hiện có 26 tests.

### C02-R3-01 — BLOCKER — first deploy fail khi chưa có `metrics.jsonl`

- Vị trí: `app/src/main/deploy/pipeline.ts:368-389,490-504`.
- Trigger: app mới chưa từng chạy collector. Pipeline chụp `fileSize`/identity trước
  `docker compose up -d`; file metric chưa được tạo nên SSH trả lỗi.
- Actual: regression reviewer tạo đúng trạng thái `ENOENT` chỉ cho file metric; finished status là
  `failed`. Test “deploy mới” hiện tại không thấy lỗi vì stub trả size `10` cho mọi file.
- Expected/fix: first deploy phải dùng generation/activation khởi tạo an toàn với boundary `1` khi
  source chưa tồn tại, rồi khởi động candidate/collector và giữ candidate healthcheck metrics cho
  deployment đầu. Không được nuốt các lỗi source khác thành “file chưa tồn tại”.
- Regression bắt buộc: app mới không có thư mục/file metric; app mới có file rỗng; lỗi SSH/stat thật;
  mỗi case phải phân biệt đúng, chứng minh deploy status, activation, offset và metric routing.

### C02-R3-02 — BLOCKER — thiếu stop/flush barrier nên boundary vẫn có race

- Vị trí: `app/src/main/deploy/pipeline.ts:368-389,490-504,997-1058`.
- Amendment đã duyệt yêu cầu giữ shared per-app lock, dừng/flush collector, chụp identity +
  `size + 1`, rồi mới cutover runtime. Code chỉ có shared lock và `size + 1`; không có lệnh
  stop/flush collector. Size và identity còn được đọc bằng hai SSH call rời nhau mà không xác nhận
  generation ổn định.
- Trigger: collector cũ append sau lần đọc size nhưng trước `compose up`. Byte cũ nằm sau boundary
  và bị route cho candidate. Cửa sổ tương tự tồn tại ở manual/auto rollback.
- Fix bắt buộc: cài barrier đúng contract cho forward deploy và rollback; snapshot identity/size phải
  nhất quán. Nếu stop/flush hoặc snapshot thất bại, fail closed và không đổi runtime/activation.
- Regression bắt buộc: collector append đúng trong cửa sổ cũ, identity đổi giữa stat, failure khi
  stop/flush, cùng các đường forward/manual/auto rollback. Assert raw byte → activation episode →
  `(deployment_id, seq)` → 5 score rows → offset.

### C02-R3-03 — BLOCKER — rotation không drain `.1`, làm mất unread suffix

- Vị trí: `app/src/main/monitor/poller.ts:68-89` và
  `app/src/main/monitor/activation.ts:162-186`.
- Actual: khi generation đổi, code đóng episode cũ ngay tại cursor, reset offset `1`, mở generation
  mới và luôn log data gap. Không có đường mở `metrics.jsonl.1`, so identity với generation cũ hoặc
  đọc phần `[old_cursor, old_file_end]`.
- Expected/fix: nếu `.1` có identity khớp thì drain suffix cũ dưới episode cũ rồi mới mở generation
  mới; chỉ ghi explicit gap khi `.1` thiếu/không khớp/không đọc được. Gap phải có old/new identity,
  cursor và lý do đủ để vận hành đối soát.
- Regression hiện tại không đủ vì đã ingest hết file cũ trước khi thay identity. Bổ sung rotation khi
  file mới nhỏ hơn và lớn hơn cursor, mỗi case có unread `.1` matching; thêm missing/mismatched `.1`,
  retry sau crash giữa drain và switch, dedupe/cardinality/offset cho cả hai generation.

### C02-R3-04 — MAJOR — failure sau runtime start làm mất candidate episode

- Vị trí: `app/src/main/deploy/pipeline.ts:495-515,871-887`.
- Candidate vẫn ở `prepared` trong toàn bộ `stepDeploy`. Nếu `compose up` đã tạo runtime nhưng trả
  lỗi, hoặc `waitContainerRunning` lỗi sau khi candidate đã ghi metric, outer catch luôn `abort()`
  prepared row. Previous activation tiếp tục mở, nên candidate bytes có thể bị gán previous.
- Fix bắt buộc: phân biệt failure trước runtime mutation với failure sau candidate start. Một candidate
  đã chạy phải giữ interval của chính nó; recovery về previous phải tạo activation mới. Trạng thái DB,
  runtime và activation phải được reconcile/fail closed khi không xác định chắc chắn.
- Regression bắt buộc phải đi qua `DeployPipeline`, không gọi repository trực tiếp: pre-runtime fail,
  compose partial failure, container wait failure sau start, healthcheck fail có/không previous,
  recovery fail và retry/restart.

### C02-R3-05 — MAJOR — regression/migration evidence chưa chứng minh các claim bắt buộc

- Diff không sửa `pipeline.test.ts`. Ba activation tests mới thao tác repository trực tiếp; chúng
  không kiểm candidate healthcheck metrics, pre/post-runtime failure, manual rollback, auto rollback
  hoặc barrier scheduler/deploy theo lifecycle thật như handoff tuyên bố.
- `index.test.ts` chỉ tạo DB mới rồi đổi expected table count/version. Không có v1→v2 migration từ
  DB có app/deployment/metric/score/offset lịch sử. `runMigrations()` còn chạy SQL và ghi
  `schema_version` ngoài một transaction rõ ràng, nên migration dở dang có thể để schema nửa vời và
  lần khởi động sau lỗi duplicate `ALTER TABLE`.
- Fix bắt buộc: thêm integration regressions qua pipeline/poller; tạo fixture DB version 1 có dữ liệu
  rồi upgrade và chứng minh bảo toàn; làm migration + version record atomic, có test rollback/reopen
  sau lỗi giữa migration. Handoff phải ghi exact command/count có thể chạy lại.

### Bàn giao review-fix 03 cho Worker

```text
Tiếp tục sửa duy nhất TK-A17/C02 từ HEAD có commit Leader review 03; không checkout/reset về
ce1a9ff hoặc 0e7d207. Verdict CHANGES_REQUESTED. C03-C09 vẫn đóng/NOT_RUN.

Đóng C02-R3-01…05 và phần còn lại của C02-R1-01. Sửa first deploy khi metrics.jsonl chưa tồn tại;
triển khai collector stop/flush + stable identity/size snapshot trước mọi forward/manual/auto cutover;
drain matching metrics.jsonl.1 trước khi chuyển generation, chỉ log gap khi không thể recovery; giữ
candidate episode nếu runtime đã bắt đầu dù deploy sau đó lỗi; làm migration 002 + schema_version
atomic và kiểm v1→v2 có dữ liệu lịch sử.

Regression phải đi qua production DeployPipeline/MonitorPoller, không chỉ gọi ActivationRepository:
new app missing/empty metric file và stat error; old append trong cutover; identity đổi giữa snapshot;
stop/flush fail; candidate healthcheck; failure trước/sau runtime start; healthcheck fail có/không
previous; manual/auto rollback lặp; matching/missing/mismatched .1 với file mới nhỏ/lớn cursor; crash
giữa drain/switch và restart. Mỗi case assert activation intervals, generation, deployment+seq,
5 score rows, dedupe và offset. Thêm migration fixture v1 thật và partial-migration reopen.

Chạy focused bằng exact command được ghi vào handoff, collector pytest từ ml-service/.venv,
typecheck node/web/scripts, lint, prettier check và build. Chỉ sau khi local gates đạt mới chạy live
có kiểm soát trên VM02/a17-notes-0911 để tái chứng minh forward deploy + manual rollback + ít nhất
hai scheduler tick. Ghi rõ stop/flush, identity/size/boundary, raw JSONL/.1→SQLite và trạng thái cuối.
Không sửa/xóa/reassign dữ liệu lịch sử; app B chỉ read-only; không ML train/score, UI/fault, push/PR/merge.

Append REVIEW-FIX 03 vào handoff/evidence/board/task/sổ, commit local và bàn giao
READY_FOR_LOCAL_REVIEW khi toàn bộ gate đạt. Nếu phát hiện cần đổi contract ngoài amendment đã duyệt,
bàn giao BLOCKED với proposal trước implementation/live mutation.
```

## 8. Review 04 — review-fix tại `85f4810`

### Phạm vi và verdict

- Reviewed code `fa72a6e`, submitted HEAD `85f4810`, kế thừa Leader review `044cc0f` hợp lệ.
- Verdict: **CHANGES_REQUESTED**. C02 vẫn `REVIEW_FIX_REQUIRED`; C03–C09 đóng/`NOT_RUN`.
- Migration atomic/populated-v1 và cutover snapshot cơ bản đạt. Các recovery/rotation edge case dưới
  đây vẫn có thể dừng collector hoặc gán sai/mất metric nên C02-R1-01 và R3-02/03/04 chưa CLOSED.
- Evidence reviewer: [review-04](../../evidence/tk-a17/c02/review-04/). Review chỉ local/read-only đối
  với dữ liệu thật; không deploy/rollback, không thao tác app B, không ML train/score, push/PR/merge.

### Kiểm chứng độc lập

| Gate | Kết quả reviewer |
| --- | --- |
| Exact focused Worker | 18 file, 88/88 PASS |
| ML service | 19/19 PASS tại `ml-service` |
| Collector | 26/26 PASS tại `collector` bằng venv của ML service |
| Typecheck node/web/scripts, lint, format, build | PASS; renderer 3045 modules |
| Pipeline recovery regressions | 2/2 FAIL |
| First-generation/partial-rotation regressions | 2/2 FAIL |
| GitNexus | analyze PASS; 55 symbol đổi, 71 affected, risk CRITICAL; `prepareActivationFor` CRITICAL |

### C02-R4-01 — BLOCKER — snapshot/preparation fail để collector hiện tại bị dừng

- Vị trí: `app/src/main/deploy/pipeline.ts:381-437,534-579` và manual rollback `236-325`.
- `prepareActivationFor()` dừng collector rồi mới gọi snapshot và ghi activation. Nếu snapshot/DB
  lỗi, outer catch kết thúc deployment nhưng không restart collector. App current có thể vẫn healthy
  trong khi nguồn metric bị tắt vô thời hạn.
- Regression reviewer cho snapshot lần hai throw sau stop: deployment fail và không có
  `compose start collector`/`compose up` nào sau lệnh stop.
- Fix: quản lý ownership của collector bằng `try/finally` hoặc state machine. Sau stop thành công,
  mọi exit trước khi compose mới nhận ownership phải khôi phục collector hiện tại và kiểm exit/state;
  nếu khôi phục thất bại phải fail closed với trạng thái/action rõ ràng. Bao phủ forward, manual và
  auto rollback, image validation fail, snapshot fail, DB prepare fail và cancellation.

### C02-R4-02 — BLOCKER — restore nonzero vẫn mở activation cho previous

- Vị trí: `app/src/main/deploy/pipeline.ts:942-955,997-1030` và recovery trong catch `558-577`.
- `restorePreviousOrDown()` không kiểm `result.code` của restore `compose up`; nó vẫn log “đã quay
  lại”. Catch ngoài sau đó tạo activation previous dù runtime chưa được xác nhận đã quay về previous.
- Regression reviewer: candidate báo Started nhưng nonzero, restore previous cũng nonzero; active
  episode cuối trỏ deployment 1 thay vì candidate deployment 2 đang cần reconcile.
- Fix: restore phải kiểm exit, container identity/image và running state rồi trả kết quả phân biệt
  `restored | not_restored | unknown`. Chỉ mở previous episode khi `restored`; nếu chưa xác định thì
  giữ candidate interval/fail closed, không suy từ `current_deployment_id`. Thêm cùng contract cho
  manual rollback fail/healthcheck fail và restart/reconcile.

### C02-R4-03 — MAJOR — retry live rollback thực tế chọn chính deployment current

- Vị trí: `tools/a17-c02-live-rollback.cjs:40-54`; evidence `ingestion.md:190-200`.
- Attempt 17 fail và deployment 16 vẫn current. Vì ID lớn nhất lúc retry là failed 17,
  `currentBefore` trở thành undefined; target filter chọn running deployment 16. Deployment 18 có
  `is_rollback_of=16` và image v16, nên retry chỉ chạy lại chính phiên bản current.
- Fix: lấy exact `app.current_deployment_id`, chọn target running khác current và assert trước khi gọi
  IPC. Live rerun phải chứng minh before/current image khác target image, `is_rollback_of` đúng target,
  activation boundary, raw rows và final health. Ghi raw error/step/output của mọi attempt fail.

### C02-R4-04 — MAJOR — first generation tạo data-gap giả

- Vị trí: sentinel tại `pipeline.ts:402-406`; mismatch handling `poller.ts:75-94`.
- First deploy thành công với generation `pending-first-generation`, nhưng poll đầu thấy identity thật
  khác sentinel, không có `.1`, rồi ghi `ssh_error/failed` data-gap. Không có byte cũ nào bị mất.
- Regression reviewer nhận data-gap count 1 thay vì 0.
- Fix: adopt identity đầu tiên theo một transaction khi episode pending bắt đầu ở byte 1 và chưa có
  committed data; không đi qua loss rotation. Assert generation, episode, metric/score/offset và không
  có action lỗi giả.

### C02-R4-05 — BLOCKER — matching `.1` partial suffix bị đánh dấu recovered rồi bỏ mất

- Vị trí: `app/src/main/monitor/poller.ts:75-94`.
- Code đặt `oldEndOffset=rotatedSize+1` và `recovered=true` chỉ dựa identity match. Nếu suffix cuối
  thiếu newline, recursive poll commit 0 byte nhưng episode cũ vẫn đóng qua toàn bộ file và không log
  gap. Regression reviewer tái hiện đúng trường hợp này.
- Fix: recovery phải dựa `nextOffset/committedBytes` thực tế. Chỉ đóng old episode ở byte đã commit;
  persist trạng thái drain để retry, hoặc ghi explicit gap cho phần không thể hoàn tất với identity,
  cursor và byte range. Test matching `.1` complete/partial/invalid/UTF-8, crash giữa drain/switch,
  retry và file mới nhỏ/lớn cursor; assert không mất/trùng và 5 score rows.

### C02-R4-06 — MINOR — coverage/provenance chưa khớp bản nộp

- Sáu test mới không bao phủ bốn trigger reviewer vừa tái hiện dù handoff nói đã đóng toàn bộ
  post-runtime/recovery. Bổ sung integration tests qua production pipeline/poller như yêu cầu trên.
- Handoff ghi docs HEAD `1f128ed`, nhưng submitted HEAD là `85f4810`. Suite 19 tests là
  `ml-service`, không phải collector; collector riêng hiện có 26/26. Append provenance và tách đúng
  hai suite, giữ lịch sử cũ.

### Bàn giao review-fix 04 cho Worker

```text
Tiếp tục sửa duy nhất TK-A17/C02 từ HEAD có commit Leader review 04; không checkout/reset về
fa72a6e hoặc 85f4810. Verdict CHANGES_REQUESTED; C03-C09 vẫn đóng/NOT_RUN.

Đóng C02-R4-01…06: bảo đảm collector được restart nếu bất kỳ bước nào fail sau stop và trước khi
compose mới nhận ownership; kiểm exit + runtime image/state thật của restore trước khi mở activation
previous; giữ candidate/fail closed khi restore unknown; sửa manual rollback các nhánh image/snapshot/
compose/healthcheck failure theo cùng state machine. Không dùng current DB pointer để suy runtime.

Sửa helper live lấy exact app.current_deployment_id, cấm target=current và chứng minh target image
khác current. First deploy phải adopt generation thật không ghi data-gap giả. Rotation matching .1
chỉ được recovered đến nextOffset đã commit; partial/invalid tail phải retry được hoặc ghi gap có
identity/cursor/range, không đóng episode qua byte chưa xử lý.

Thêm regression production cho: snapshot/DB/cancel fail sau stop và collector resume; restore
nonzero/missing/wrong image; candidate partial start; manual/auto rollback fail; first generation
adoption; .1 complete/partial/invalid/UTF-8/crash/retry. Assert runtime ownership, collector state,
activation ranges, generation, deployment+seq, five scores, dedupe, offset và action log.

Chạy exact focused, ML-service 19 tests, collector 26 tests, typecheck node/web/scripts, lint,
prettier check và build. Sau local PASS, chạy lại manual rollback có kiểm soát trên VM02 với target
khác current; lưu từng attempt command/runtime/exit/raw error, before/target/after IDs+images,
activation/raw JSONL→SQLite, scheduler hai tick và final A healthy. App B chỉ read-only; giữ nguyên
dữ liệu lịch sử; không ML train/score, UI/fault, push/PR/merge.

Append REVIEW-FIX 04 vào evidence/handoff/board/task/sổ với exact code và submitted docs HEAD;
commit local và bàn giao READY_FOR_LOCAL_REVIEW khi đủ mọi gate.
```

## 9. Review 05 — review-fix tại `018cb70`

### Phạm vi và verdict

- Reviewed code `c6c728c`, submitted HEAD `018cb70`, kế thừa Leader review `e80a0f9` hợp lệ.
- Verdict: **CHANGES_REQUESTED**. C02 về `REVIEW_FIX_REQUIRED`; C03–C09 tiếp tục đóng/`NOT_RUN`.
- Các nhánh snapshot exception, first-generation và partial tail cơ bản đã tiến bộ, nhưng cleanup khi
  cancel, restore unknown, hai trạng thái rotation và live rollback khác runtime vẫn chưa đúng.
- Evidence reviewer: [review-05](../../evidence/tk-a17/c02/review-05/). Review chỉ local/read-only;
  không deploy/rollback, không sửa SQLite/VPS/app B, không ML train/score, push/PR/merge.

### Kiểm chứng độc lập

| Gate | Kết quả reviewer |
| --- | --- |
| Exact focused Worker | 18 file, 90/90 PASS |
| ML service | 19/19 PASS tại `ml-service` |
| Collector | 26/26 PASS tại `collector` bằng venv của ML service |
| Typecheck node/web/scripts, lint, format, build | PASS; renderer 3045 modules |
| Reviewer recovery/rotation regressions | 3/3 FAIL; 39 existing tests PASS |
| GitNexus | analyze PASS; 39 symbol đổi, 80 affected process, risk CRITICAL |

### C02-R5-01 — BLOCKER — cleanup khi cancel dùng chính signal đã aborted

- Vị trí: `app/src/main/deploy/pipeline.ts:448-469,739-751`; production behavior tại
  `app/src/main/ssh/manager.ts:385-420`.
- `resumeCollector()` truyền `ctx.signal` vào `compose start collector` và lệnh inspect. Khi catch do
  user cancel, signal này đã aborted; `SshManager` từ chối lệnh cleanup ngay. Collector có thể bị
  dừng vô hạn dù code có gọi helper.
- Regression reviewer cancel sau stop nhận warning `error=aborted`; cleanup call mang signal
  `aborted=true`.
- Fix: dùng cleanup context/signal riêng có timeout chặt, không bị cancel theo operation; kiểm
  compose exit và `collector .State.Status=running`. Ghi action có deployment/app/reason nếu cleanup
  thất bại. Bao phủ forward, manual và auto rollback cancellation sau stop.

### C02-R5-02 — BLOCKER — restore `unknown` vẫn bỏ reconciliation barrier

- Vị trí: `pipeline.ts:595-623,981-1004,1045-1093`.
- Restore chỉ đặt `runtimeStarted=true` khi candidate/previous đã verify. Nếu previous compose trả 0
  nhưng wait/image inspect lỗi hoặc không xác định, `restoreStatus='unknown'` nhưng outer catch đi
  nhánh `runtimeStarted=false`, abort prepared candidate và để episode previous active. Poller tiếp tục
  dù runtime ownership chưa biết. Check `restoreStatus` hiện nằm trong nhánh đối nghịch và không bảo
  vệ trường hợp restore vừa được thử.
- Fix: biểu diễn runtime owner độc lập (`candidate | previous | down | unknown`) và quyết định
  activation từ owner đã verify. `unknown` phải giữ một prepared/reconciliation barrier bền vững để
  poller fail closed; restart phải reconcile bằng live image/state trước khi mở polling. Thêm restore
  nonzero, missing, wrong image, inspect timeout/disconnect và process restart tests cho forward,
  manual, auto rollback.

### C02-R5-03 — MAJOR — matching `.1` đã đọc hết vẫn ghi data-gap giả

- Vị trí: `app/src/main/monitor/poller.ts:97-123`.
- Khi `rotatedSize + 1 <= offset`, không còn byte nào cần drain nhưng `recovered` vẫn false. Rotation
  bình thường vì vậy ghi `ssh_error/failed` data-gap.
- Regression reviewer poll hết old file rồi rotate với matching `.1`: data-gap count là 1 thay vì 0.
- Fix: coi `oldCursor >= oldEOF` là recovered, không log loss; assert episode end, generation,
  offset, seq, 5 score rows và retry dedupe.

### C02-R5-04 — BLOCKER — lỗi đọc `.1` đóng episode qua byte chưa commit

- Vị trí: `poller.ts:97-123`.
- Code gán `oldEndOffset=rotatedSize+1` trước recursive drain. Nếu `size/tail/DB/onSample` throw,
  catch giữ EOF này, rotate vẫn chạy và log `range=[EOF,EOF]`. Cursor thật cùng byte chưa đọc bị mất,
  không thể retry hay audit đúng.
- Regression reviewer: cursor thật 236, EOF 471; output sai là `cursor=471 range=[471,471]`.
- Fix: chỉ nhận `nextOffset` từ drain đã commit; trên lỗi giữ cursor cũ và durable pending drain để
  retry, hoặc ghi chính xác `[oldCursor,oldEOF]` trước khi chuyển generation. Test size/tail throw,
  invalid complete line, partial UTF-8/JSON, DB rollback, callback throw/crash, retry và new file nhỏ/
  lớn hơn cursor; assert không mất/trùng, boundary và action đúng.

### C02-R5-05 — BLOCKER — live rollback 19 vẫn dùng cùng runtime image

- Vị trí: `tools/a17-c02-live-rollback.cjs:36-67`; `deploymentRepository.ts:93-115`; evidence
  `ingestion.md:190-244,291-306`.
- Helper so raw `Deployment.image_tag`. Deployment 18 là manual rollback của 16: row tag là v18
  nhưng evidence trước đó xác nhận runtime thật v16. Target 16 cũng resolve runtime v16. Check
  `v18 != v16` đã qua trên row metadata, nhưng deployment 19 chỉ compose lại v16; đây chưa phải
  rollback giữa hai runtime version khác nhau.
- Fix: resolve `runtimeImageTag` theo toàn bộ `is_rollback_of` lineage cho current và target, cấm
  target có cùng resolved runtime image, đồng thời đọc `.Config.Image|.State.Status` container trước/
  sau. Chỉ chạy lại live sau khi local gates đạt; chọn/chuẩn bị current và target có runtime image
  thật sự khác nhau, lưu raw IDs, row tags, resolved tags, inspect, events, exit, activation và health.

### C02-R5-06 — MAJOR — regression đã khai báo không tồn tại trong commit

- `c6c728c` chỉ thêm hai `it()` trong `activation.test.ts`; diff `pipeline.test.ts` chỉ mở rộng harness,
  không thêm pipeline test. Handoff/evidence lại tuyên bố đã cover snapshot/DB/cancel, restore
  exit/image/state, candidate retention và manual/auto rollback failure.
- Fix: commit regression production cho toàn bộ matrix R4/R5; test phải fail trên code trước fix và
  pass sau fix. Tách rõ ML-service 19 và collector 26; ghi exact command/cwd/runtime/exit/count cùng
  final code/docs provenance, không gọi coverage chưa commit là PASS.

### Bàn giao review-fix 05 cho Worker

```text
Tiếp tục sửa duy nhất TK-A17/C02 từ HEAD có commit Leader review 05; không checkout/reset về
c6c728c hoặc 018cb70. Verdict CHANGES_REQUESTED; C03-C09 vẫn đóng/NOT_RUN.

Đóng C02-R5-01...06 và giữ các invariant R1-R4. Cleanup collector phải dùng signal/timeout riêng
để vẫn chạy sau cancel, kiểm exit + collector running và ghi failure rõ. Thay boolean rời rạc bằng
runtime-owner state rõ ràng cho candidate/previous/down/unknown; chỉ activate owner đã verify.
Restore unknown phải để durable reconciliation barrier, process restart/poller vẫn fail closed cho
đến khi live image/state được reconcile.

Sửa rotation: matching .1 với cursor >= EOF là recovered không gap; không gán EOF trước khi drain
commit. Lỗi size/tail/parse/DB/callback/crash phải giữ cursor để retry hoặc log đúng identity và
[oldCursor,oldEOF] trước switch. Không mất/trùng metric, không route sai deployment, mỗi metric vẫn
đúng 5 score rows và ML null không bị điền giả.

Sửa helper rollback resolve runtime image qua is_rollback_of lineage, không so raw row image_tag.
Assert current id, target id, row tags, resolved runtime tags và live Docker .Config.Image/state;
cấm cùng runtime image. Chỉ sau full local green mới chạy một controlled rollback trên VM02/app A
với current/target thật sự khác runtime image. Giữ mọi failed attempt raw; xác minh boundary,
SQLite/raw JSONL, scheduler hai tick, max_concurrent=1, clean shutdown và final app/DB/collector A
healthy. App B chỉ read-only; không dùng B làm success signal; giữ PostgreSQL/SQLite lịch sử.

Commit production regressions cho snapshot + DB + cancel sau stop; cleanup failure; restore
nonzero/missing/wrong image/inspect timeout/restart; forward/manual/auto failure; fully consumed,
complete, partial, invalid, UTF-8 và throwing/crash/retry .1. Chạy exact focused, ML-service 19,
collector 26, node/web/scripts typecheck, scoped lint, Prettier check và build. Ghi exact
base/code/docs HEAD, command/cwd/runtime/exit/count, mutation ledger và raw live evidence.

Không sửa app B, không reset/xóa/reassign dữ liệu, không train/score ML C03, không làm UI/fault,
không push/PR/merge. Giữ nguyên .devflow/, docs/ban-giao-20-08.md và logo.png. Chỉ bàn giao
READY_FOR_LOCAL_REVIEW khi tất cả finding và regression đã đóng; nếu cần đổi contract/schema ngoài
amendment đã duyệt thì bàn giao BLOCKED kèm proposal trước implementation/live mutation.
```

## 10. Review 06 — review-fix tại `4b4f82e`

### Phạm vi và verdict

- Reviewed code `37d9e19`, submitted HEAD `4b4f82e`, kế thừa Leader review `eaca497` hợp lệ.
- Verdict: **CHANGES_REQUESTED**. C02 tiếp tục `REVIEW_FIX_REQUIRED`; C03–C09 đóng/`NOT_RUN`.
- R5-01 và R5-03 đã đóng; R5-02/R5-04/R5-05/R5-06 còn phần mở. Hai regression reviewer mới
  2/2 FAIL dù toàn bộ suite hiện hữu PASS.
- Evidence reviewer: [review-06](../../evidence/tk-a17/c02/review-06/). Review chỉ local/read-only;
  không deploy/rollback, không sửa SQLite/VPS/app B, không ML train/score, push/PR/merge.

### Kiểm chứng độc lập

| Gate | Kết quả reviewer |
| --- | --- |
| Exact focused Worker | 18 file, 95/95 PASS |
| ML service | 19/19 PASS |
| Collector | 26/26 PASS |
| Typecheck node/web/scripts, lint, format, build | PASS; renderer 3045 modules |
| Manual-owner/invalid-range regressions | 2/2 FAIL; 42 existing tests PASS |
| GitNexus | analyze PASS; 26 symbol đổi, 114 affected process, risk CRITICAL |

### Trạng thái finding R5

| Finding | Review 06 |
| --- | --- |
| C02-R5-01 | CLOSED — cleanup dùng signal riêng, kiểm collector running |
| C02-R5-02 | OPEN — forward unknown có barrier, manual/auto và restart reconciliation chưa có |
| C02-R5-03 | CLOSED — `.1` đã đọc hết không còn false gap |
| C02-R5-04 | PARTIAL — tail failure retry được; invalid complete line vẫn log sai byte range |
| C02-R5-05 | PARTIAL — helper lineage đúng; raw live artifact/boundary routing chưa đủ audit |
| C02-R5-06 | OPEN — regression matrix và provenance evidence vẫn overclaim |

### C02-R6-01 — BLOCKER — manual/auto rollback suy runtime owner từ DB pointer

- Vị trí: `app/src/main/deploy/pipeline.ts:439-451,243-315,1187-1265`.
- `stopCollectorAndFlush()` gán `runtimeOwner` từ `ctx.app.current_deployment_id`. Stop collector
  không đổi app runtime và DB pointer không chứng minh container đang chạy image nào. Với auto
  rollback, pointer còn là previous trong khi runtime vừa chuyển sang candidate.
- Manual rollback compose nonzero + inspect không xác định đi vào catch với owner `previous`, abort
  prepared target và để polling mở. Regression reviewer nhận prepared count 0 thay vì barrier 1.
  Auto rollback có cùng lỗi chuyển state khi attempt không xác minh được runtime.
- Fix: không thay owner khi chỉ stop collector; set `unknown` trước mọi compose có thể đổi app, rồi
  chỉ set `candidate/previous/down` từ exit + live image/state đã verify. Dùng cùng transition cho
  forward/manual/auto; unknown phải giữ barrier. Không suy owner từ current DB pointer.

### C02-R6-02 — BLOCKER — prepared barrier sau restart không có đường reconcile

- Vị trí: `activation.ts:114-136`, `poller.ts:77-81`; không có startup/service recovery consumer.
- Prepared row bền vững hiện chỉ làm poller throw. Restart không inspect runtime để activate/abort
  atomically; deploy mới sẽ đụng unique `one_prepared_activation`. App có thể bị khóa monitor/deploy
  vô hạn. Test mới chỉ giữ row trong cùng process, không restart/reconcile như handoff tuyên bố.
- Fix: thêm explicit reconciliation workflow khi service/startup gặp prepared row: lock theo app,
  đọc episode + lineage, inspect app/collector image/state, snapshot generation/offset, rồi atomically
  activate verified owner hoặc giữ BLOCKED với action/error có thể vận hành. Không tự đoán khi SSH
  unavailable. Test close/reopen DB + new pipeline/service cho candidate/previous/down/unknown và
  retry sau reconnect.

### C02-R6-03 — MAJOR — invalid `.1` ghi gap rỗng tại EOF

- Vị trí: `app/src/main/monitor/poller.ts:97-128,149-272` và `activation.ts:185-227`.
- Inner poll chỉ trả `hadWarnings`. Khi complete invalid line bị consume, `nextOffset=EOF`; outer
  dùng EOF làm cả cursor và gap end, tạo `range=[EOF,EOF]` thay vì byte đã bỏ qua.
- Regression reviewer bỏ qua `[236,247]` nhưng nhận `cursor=247 range=[247,247]`.
- Fix: mang warning byte range thật qua parse/transaction/result; log generation, first skipped byte
  và exclusive EOF. Test invalid ở đầu/giữa/cuối, valid rows hai phía, nhiều invalid line, UTF-8,
  retry/dedupe, episode end và 5 score rows.

### C02-R6-04 — MAJOR — coverage tiếp tục không khớp handoff

- Commit chỉ thêm hai pipeline tests: cancellation cleanup thành công và forward restore unknown.
  Chưa có cleanup start/inspect failure, manual/auto unknown, inspect timeout/disconnect hoặc
  close/reopen reconciliation. Hai regression reviewer tìm đúng khoảng trống và đều FAIL.
- Fix: commit đủ matrix R5/R6 qua production pipeline/poller; mỗi test phải assert owner/barrier,
  collector state, activation ranges, action log, current pointer và retry. Handoff chỉ liệt kê case
  thật sự có test hoặc live artifact.

### C02-R6-05 — MAJOR — live evidence chưa lưu raw và routing chưa giải thích được

- Helper code đã resolve lineage và verify Docker trước/sau, nhưng `ingestion.md` chỉ có prose; không
  có raw helper JSON/events/SQL artifact như review-05 yêu cầu.
- Evidence nói run thêm 359 metrics nhưng deployment 20 chỉ có `5 rows`, không nêu đó là metric hay
  score, không ghi per-deployment counts hoặc activation start/end để giải thích phần còn lại vào 19.
- Fix: không cần chạy live lại nếu raw output của run 20 còn lưu và đủ. Commit bản scrubbed gồm
  before/target/after row+resolved image, Docker inspect, events, health exit, activation rows,
  per-deployment metric/score counts, source generation/size, cursor before/after và arithmetic
  `+359/+1795`. Nếu raw không còn, chỉ rerun sau local green với target runtime khác current.

### Bàn giao review-fix 06 cho Worker

```text
Tiếp tục sửa duy nhất TK-A17/C02 từ HEAD chứa Leader review 06; không checkout/reset về 37d9e19
hoặc 4b4f82e. Verdict CHANGES_REQUESTED; C03-C09 vẫn đóng/NOT_RUN.

Đóng C02-R6-01...05 và phần còn mở R5-02/04/05/06. Không gán runtimeOwner trong
stopCollectorAndFlush dựa current_deployment_id. Trước mọi compose có thể đổi app, chuyển owner sang
unknown; chỉ xác nhận candidate/previous/down bằng exit và live Config.Image/State. Manual và auto
rollback khi inspect/nonzero/disconnect không xác định phải giữ prepared reconciliation barrier,
không abort rồi cho poller chạy.

Thêm reconciliation thật sau process restart cho prepared row: shared app lock, đọc episode/lineage,
inspect app+collector, snapshot stream, rồi transaction activate/abort owner đã xác minh. SSH chưa
sẵn sàng thì giữ BLOCKED và action rõ; retry sau reconnect phải idempotent. Bao phủ close/reopen DB,
candidate/previous/down/unknown, reconnect và deploy tiếp sau reconcile.

Sửa invalid rotated line để action gap ghi đúng byte interval bị skip, không [EOF,EOF]. Mang warning
offset/range qua parser/poller; test valid+invalid xen kẽ, nhiều invalid, UTF-8/partial, tail/DB/callback
failure, retry/dedupe, deployment routing, activation range, offset và đúng 5 score/sample. Giữ ML
null, không điền giả.

Commit production regressions còn thiếu: cleanup start/inspect fail, forward/manual/auto unknown,
compose nonzero/missing/wrong image, inspect timeout/disconnect, restart reconciliation và retry.
Chạy exact focused, ML-service 19, collector 26, node/web/scripts typecheck, scoped lint, Prettier
check và build.

Khôi phục raw evidence của live deployment 20 nếu còn: helper JSON/events, row tag + resolved tag,
Docker image/state trước/sau, health exit, activation rows, raw source generation/size, cursor và
per-deployment metric/score counts giải thích đủ +359/+1795 và dòng “deployment-20 5 rows”. Nếu
không còn raw thì chỉ rerun controlled VM02 sau local green, current/target khác resolved runtime.
App B chỉ read-only; không reset/xóa/reassign PostgreSQL/SQLite, không ML train/score C03, UI/fault,
push/PR/merge. Giữ .devflow/, docs/ban-giao-20-08.md, logo.png.

Append REVIEW-FIX 06 vào evidence/handoff/board/task/sổ với exact base/code/docs HEAD và mutation
ledger. Chỉ bàn giao READY_FOR_LOCAL_REVIEW khi regression mới cùng full gates đều PASS; nếu cần đổi
schema/contract ngoài amendment thì bàn giao BLOCKED kèm proposal trước implementation/live mutation.
```

## 11. Review 07 — review-fix tại `413ec20`

### Phạm vi và verdict

- Reviewed code `61f43df`, submitted HEAD `413ec20`, kế thừa Leader review `24c669b` hợp lệ.
- Verdict: **CHANGES_REQUESTED**. C02 tiếp tục `REVIEW_FIX_REQUIRED`; C03–C09 đóng/`NOT_RUN`.
- Owner transition trước compose đã sửa đúng hướng và warning đơn ở EOF có range đúng. Reconcile
  rollback lineage và episode có valid row sau warning vẫn sai; hai reviewer regressions 2/2 FAIL.
- Evidence reviewer: [review-07](../../evidence/tk-a17/c02/review-07/). Review chỉ local/read-only;
  không deploy/rollback, không sửa SQLite/VPS/app B, không ML train/score, push/PR/merge.

### Kiểm chứng độc lập

| Gate | Kết quả reviewer |
| --- | --- |
| Exact focused Worker | 18 file, 96/96 PASS |
| ML service | 19/19 PASS |
| Collector | 26/26 PASS |
| Typecheck node/web/scripts, lint, format, build | PASS; renderer 3045 modules |
| Lineage/mixed-invalid regressions | 2/2 FAIL; 17 existing tests PASS |
| GitNexus | analyze PASS; 20 symbol đổi, 38 affected process, risk CRITICAL |

### Trạng thái R6

| Finding | Review 07 |
| --- | --- |
| C02-R6-01 | CLOSED — stop collector không còn suy owner từ DB pointer |
| C02-R6-02 | PARTIAL — hook/barrier có; rollback lineage resolve sai và chưa test đủ |
| C02-R6-03 | PARTIAL — single invalid EOF đúng; mixed/multiple invalid làm episode sai |
| C02-R6-04 | OPEN — test reconciliation chỉ cover normal row tag = runtime tag |
| C02-R6-05 | PARTIAL — compact JSON có; thiếu activation/per-deployment split và raw events |

### C02-R7-01 — BLOCKER — reconciliation không resolve runtime lineage của rollback row

- Vị trí: `app/src/main/monitor/service.ts:152-253`.
- Recursive CTE anchor toàn bảng rồi subquery `WHERE id=d.id`; kết quả là row `image_tag` của prepared
  attempt, không phải ancestor cuối theo `is_rollback_of`. Nhánh previous owner cũng đọc raw tag.
- Regression reviewer: active deployment 2/v2, prepared deployment 3 `is_rollback_of=1`, Docker
  v1/running. Expected prepared 3 active; actual vẫn prepared vì code so Docker v1 với row tag v3.
- Fix: dùng một resolver runtime lineage duy nhất, tốt nhất `DeploymentRepository.runtimeImageTag()`,
  cho cả prepared và active owner dưới app lock. Cycle/missing lineage phải giữ barrier + action rõ.
  Test rollback chain một/nhiều tầng, active cũng là rollback row, wrong image, unknown và retry.

### C02-R7-02 — BLOCKER — valid rows sau invalid `.1` nằm ngoài episode đã đóng

- Vị trí: `app/src/main/monitor/poller.ts:105-140,181-190,301-309`.
- Inner drain commit toàn bộ complete bytes và insert valid rows sau warning. Outer lại gán
  `oldEndOffset=firstWarning.start`, nên activation episode đóng trước các valid rows vừa route vào
  old deployment. Nhiều warning range cũng bị rút còn range đầu tiên.
- Regression reviewer: metric 1/2/3 đều insert, nhưng old episode end 236 thay vì committed EOF 482.
- Fix: giữ episode end bằng committed `drained.nextOffset`. Warning/data-gap là các interval độc lập;
  ghi từng skipped range hoặc một danh sách/range union chính xác mà không cắt ownership của valid
  bytes. Test invalid đầu/giữa/cuối, valid hai phía, nhiều invalid, UTF-8, scores/dedupe/retry.

### C02-R7-03 — MAJOR — restart regression chưa chứng minh rollback reconciliation

- Test mới chỉ tạo deployment thường với row tag `app:v1` bằng runtime `app:v1`, trong cùng DB handle.
  Nó không cover `is_rollback_of`, active rollback lineage, close/reopen DB, previous/down/unknown,
  reconnect hoặc deploy tiếp sau reconcile như R6 yêu cầu.
- Fix: commit integration matrix qua `MonitorService` với DB close/reopen và production resolver;
  assert activation state/ranges, current pointer không bị suy thành owner, action log, idempotent
  second tick và new deploy sau reconcile.

### C02-R7-04 — MAJOR — live split 416/5 chưa có boundary proof

- `review-fix-06.md` đã có compact before/target/after và total mutation JSON. Nó nói `+421` metric
  nhưng deployment 21 chỉ thêm/đang có `5` rows; chưa có activation start/end, generation, source size
  hoặc per-deployment before/after để chứng minh 416 backlog thuộc deployment 20.
- Fix: ưu tiên read-only append, không rerun live: lưu raw activation rows và SQL grouped counts/scores
  cho deployment 20/21, cursor/source generation+size và helper events đã nhắc tới. Reconcile arithmetic
  total `+421/+2105`, mỗi metric 5 scores, không reassign lịch sử.

### Bàn giao review-fix 07 cho Worker

```text
Tiếp tục sửa duy nhất TK-A17/C02 từ HEAD chứa Leader review 07; không checkout/reset về 61f43df
hoặc 413ec20. Verdict CHANGES_REQUESTED; C03-C09 vẫn đóng/NOT_RUN.

Đóng C02-R7-01...04 và phần còn mở R6-02...05. Trong MonitorService reconciliation, bỏ CTE resolve
lineage hiện tại hoặc sửa bằng root_id đúng; ưu tiên tái sử dụng DeploymentRepository.runtimeImageTag
cho prepared deployment và active deployment dưới shared app lock. Prepared rollback một/nhiều tầng
phải activate khi Docker image/state + collector + stream generation khớp resolved target. Live owner
khớp resolved active thì abort prepared; cycle/missing/SSH unknown giữ barrier và retry idempotent.

Sửa rotation mixed invalid: episode cũ luôn kết thúc tại committed drained.nextOffset, không tại
firstWarning.start. Ghi đầy đủ từng byte range invalid riêng với generation/cursor; valid records sau
warning vẫn nằm trong old episode audit. Bao phủ invalid đầu/giữa/cuối, valid trước/sau, nhiều warning,
UTF-8/partial, tail/DB/callback failure, retry, dedupe, routing và 5 scores/sample.

Thêm restart integration thật: tạo active v2 + prepared rollback-attempt v3 -> v1, close/reopen DB,
khởi tạo MonitorService mới, reconcile candidate/previous/down/unknown và chạy tick lần hai. Thêm chain
rollback nhiều tầng, active owner cũng là rollback, wrong image, reconnect và deploy tiếp sau reconcile.
Hai reviewer regressions trong docs/evidence/tk-a17/c02/review-07 phải PASS.

Không cần mutate live để sửa code. Sau local full green, lấy read-only evidence hiện tại cho deployment
20/21: activation rows start/end/generation, grouped metric + score counts trước/sau nếu còn, source
identity/size/cursor và raw helper events. Giải thích chính xác 421 metric chia 416/5 và đối chiếu 2105
scores. Chỉ rerun live nếu dữ liệu cần thiết không còn và sau khi code gate xanh; target/current phải
khác resolved runtime.

Chạy exact focused, ML-service 19, collector 26, node/web/scripts typecheck, scoped lint, Prettier và
build. Không sửa app B ngoài read-only, không reset/xóa/reassign dữ liệu, không ML train/score C03,
UI/fault, push/PR/merge. Giữ .devflow/, docs/ban-giao-20-08.md, logo.png. Append evidence/handoff/
board/task/sổ với exact base/code/docs HEAD; chỉ bàn giao READY_FOR_LOCAL_REVIEW khi tất cả regression
và full gates PASS.
```

## 12. Review 08 — review-fix tại `2503c12`

### Phạm vi và verdict

- Reviewed base `1b2f150`, code `65d85ac`, submitted HEAD `2503c12`; ancestry hợp lệ.
- Verdict: **CHANGES_REQUESTED**. C02 tiếp tục `REVIEW_FIX_REQUIRED`; C03–C09 đóng/`NOT_RUN`.
- `C02-R7-01`, `C02-R7-02` và `C02-R7-04` được đóng: multi-level runtime lineage, mixed-invalid
  committed EOF và read-only boundary arithmetic đều đạt.
- Recovery vẫn thiếu hai invariant của `C02-R6-02/R7-03`; reviewer regressions 0/2 PASS dù 98 test
  hiện hữu và toàn bộ static/build gate đều PASS.
- Evidence reviewer: [review-08](../../evidence/tk-a17/c02/review-08/). Review chỉ local/read-only;
  không deploy/rollback, không sửa SQLite/VPS/app B, không ML train/score, push/PR/merge.

### Kiểm chứng độc lập

| Gate | Kết quả reviewer |
| --- | --- |
| Exact focused Worker | 18 file, 98/98 PASS |
| ML service | 19/19 PASS |
| Collector | 26/26 PASS |
| Typecheck node/web/scripts, lint, format, build | PASS; renderer 3045 modules |
| Recovery boundary/atomicity regressions | 0/2 PASS; 2 FAIL |
| GitNexus | analyze PASS với FTS warning; 17 symbol, 300 affected flow, risk CRITICAL |

### Trạng thái finding trước

| Finding | Review 08 |
| --- | --- |
| C02-R7-01 | CLOSED — prepared và active dùng terminal runtime lineage; cycle/missing fail closed |
| C02-R7-02 | CLOSED — episode cũ kết thúc tại committed EOF; từng invalid range được giữ riêng |
| C02-R7-03 | PARTIAL — close/reopen + multi-level candidate có; boundary/atomicity/matrix còn thiếu |
| C02-R7-04 | CLOSED — activation và grouped counts giải thích đủ split `416+5` |

### C02-R8-01 — BLOCKER — reconciliation bỏ qua durable start boundary

- Vị trí: `app/src/main/monitor/service.ts:157-170,206-214`.
- Query không lấy `start_offset`; `ownerVerified` chỉ kiểm runtime image/state, collector và
  `snapshot.generation`. Nó không chứng minh source còn đủ bytes tới boundary đã prepare.
- Regression reviewer: prepared boundary `100`, Docker candidate/running, collector running,
  generation đúng nhưng snapshot size `20`. Expected giữ `prepared` và pointer cũ; actual episode
  chuyển `active`.
- Fix: đọc chính prepared row bên trong app lock, gồm `start_offset`; chỉ activate khi snapshot tồn
  tại, generation khớp và `snapshot.size + 1 >= start_offset`. Trường hợp missing/short/truncated phải
  giữ barrier và log action có episode, generation, expected boundary, observed size.

### C02-R8-02 — BLOCKER — activation và current pointer commit tách rời

- Vị trí: `app/src/main/monitor/service.ts:215-221` và `activation.ts:148-168`.
- `activation.activate()` tự commit transaction trước khi `UPDATE app SET current_deployment_id` chạy.
  Nếu câu update thứ hai lỗi/crash, activation mới đã active, previous đã closed nhưng app pointer vẫn
  trỏ deployment cũ; prepared barrier không còn để startup sau retry.
- Regression reviewer inject SQLite trigger làm pointer update fail. Expected toàn bộ transition rollback;
  actual prepared không còn `prepared` trong khi pointer vẫn là deployment 1.
- Fix: bao activation transition và pointer update trong một outer SQLite transaction hoặc tạo repository
  method duy nhất thực hiện cả hai. Regression phải inject lỗi ở pointer update và chứng minh episode,
  pointer, offset/generation cùng giữ nguyên; bỏ lỗi và retry phải commit đúng một lần.

### C02-R8-03 — MAJOR — evidence và recovery matrix vẫn chưa khớp code đã commit

- `review-fix-07.md` nói restart regression chạy second tick idempotently, nhưng test tại
  `service.test.ts:9-47` chỉ gọi `pollAll()` một lần và không assert pointer, ranges hoặc action count.
- Cycle test không cover missing lineage như tên test; chưa có recovery regression cho previous active
  cũng là rollback row, wrong image, collector down/missing, short snapshot, SSH reconnect, idempotent
  retry và deploy mới sau reconcile. Query prepared rows cũng chạy trước app lock rồi chỉ kiểm “có một
  prepared row”, thay vì đọc lại đúng `prepared_id` dưới lock.
- Fix: commit production integration matrix. Mỗi case assert exact prepared/active/closed state,
  `current_deployment_id`, boundary/generation, action log và second tick. Trong lock phải reload đúng
  episode ID; stale/replaced row phải no-op fail closed.

### Bàn giao review-fix 08 cho Worker

```text
Tiếp tục sửa duy nhất TK-A17/C02 từ HEAD chứa Leader review 08; không checkout/reset về 65d85ac hoặc
2503c12. Verdict CHANGES_REQUESTED; C03-C09 vẫn đóng/NOT_RUN.

Đóng C02-R8-01...03 và phần còn mở R7-03/R6-02. Trong reconcilePrepared, danh sách ngoài lock chỉ được
dùng để lấy app ID; sau khi lấy shared app lock phải reload đúng prepared episode ID cùng deployment,
generation và start_offset. Nếu row đã đổi/biến mất thì no-op an toàn. Resolve prepared và active runtime
lineage dưới lock. Candidate chỉ được xác nhận khi Docker image/state, collector running, snapshot
generation và snapshot size đều chứng minh source đã đạt durable boundary (`size + 1 >= start_offset`).
Missing/short/truncated snapshot, cycle/missing lineage, wrong image, SSH/inspect timeout hoặc owner không
xác định phải giữ prepared barrier và ghi action vận hành rõ; không đoán từ current_deployment_id.

Gộp activation state transition và UPDATE app.current_deployment_id trong cùng một SQLite transaction.
Inject failure tại pointer update để chứng minh previous active + prepared + pointer + stream cursor không
đổi; bỏ failure và retry phải activate đúng một lần. Second scheduler tick phải idempotent, không tạo thêm
activation/action giả. Abort prepared khi previous owner được xác minh cũng phải dùng row đã reload dưới
lock và không được abort một prepared episode mới thay thế stale row.

Commit regression matrix qua production MonitorService/ActivationRepository: exact boundary, boundary-1,
missing snapshot, generation mismatch, one/multi-level prepared rollback, active owner cũng là rollback
chain, missing/cycle lineage, candidate/previous/wrong/down owner, collector missing/down, SSH disconnect
rồi reconnect, close/reopen DB, stale prepared replacement, injected SQLite failure, second tick và deploy
tiếp sau reconcile. Assert state/ranges/current pointer/action count/dedupe; không claim case chưa commit.

Giữ nguyên fix lineage và mixed-invalid đã đạt. Có thể xóa block legacy resolver đã comment trong
deploymentRepository.ts khi sửa, nhưng không đổi contract ngoài phạm vi. Chạy exact focused 18 files cùng
regressions mới, ML service 19, collector 26, node/web/scripts typecheck, scoped lint, Prettier và build.

Không cần live mutation để đóng R8-01...03. Chỉ dùng read-only health nếu cần xác nhận drift; không deploy,
rollback, reset/xóa/reassign SQLite/PostgreSQL, train/score C03, thao tác app B, push/PR/merge. Giữ nguyên
.devflow/, docs/ban-giao-20-08.md, logo.png. Append REVIEW-FIX 08 vào evidence/handoff/board/task/sổ với
exact base/code/docs HEAD. Chỉ bàn giao READY_FOR_LOCAL_REVIEW khi regression mới và full gates đều PASS.
```

## 13. Review 09 — review-fix tại `d65ead7`

### Phạm vi và verdict

- Reviewed base `deb69b9`, code `8fe4842`, submitted HEAD `d65ead7`; ancestry hợp lệ.
- Verdict: **CHANGES_REQUESTED**. C02 tiếp tục `REVIEW_FIX_REQUIRED`; C03–C09 đóng/`NOT_RUN`.
- Implementation của `C02-R8-01/02` đạt: row được reload dưới lock, durable boundary được kiểm và
  activation/pointer dùng một SQLite transaction. Focused 99/99 và toàn bộ gate độc lập PASS.
- `C02-R8-03` còn PARTIAL vì evidence khai nhiều recovery regression không có trong code test đã commit.
- Evidence reviewer: [review-09](../../evidence/tk-a17/c02/review-09/). Không chạy live, deploy,
  rollback, ML train/score hoặc thao tác app B; read-only evidence 20/21 tiếp tục được chấp nhận.

### Kiểm chứng độc lập

| Gate | Kết quả reviewer |
| --- | --- |
| Exact focused Worker | 18 file, 99/99 PASS |
| ML service | 19/19 PASS |
| Collector | 26/26 PASS |
| Typecheck node/web/scripts, lint, format, build | PASS; renderer 3045 modules |
| GitNexus | analyze PASS với FTS warning; 13 symbol, 300 affected flow, risk CRITICAL |
| Audit committed recovery matrix | FAIL — một test mới + một test mở rộng không cover toàn bộ case đã khai |

### Trạng thái finding R8

| Finding | Review 09 |
| --- | --- |
| C02-R8-01 | CLOSED — `snapshot.size + 1 >= start_offset` và short-source barrier có code/test |
| C02-R8-02 | CLOSED — injected pointer failure rollback toàn transition; retry thành công |
| C02-R8-03 | PARTIAL — close/reopen, multi-level candidate và second tick đạt; matrix/provenance còn thiếu |

### C02-R9-01 — MAJOR — regression matrix và evidence không khớp commit

- Vị trí: `app/src/main/monitor/service.test.ts:10-179` và
  `docs/evidence/tk-a17/c02/review-fix-08.md:27-38`.
- Diff chỉ thêm một test boundary/atomic retry và mở rộng test multi-level candidate bằng second tick.
  Cycle test cũ không tạo missing lineage dù tên nói “cyclic or missing”.
- Không có committed reconciliation regression cho exact boundary/boundary-1, missing snapshot,
  generation mismatch, wrong image, collector missing/down, SSH failure/reconnect, active previous owner
  là rollback chain, previous-owner abort, missing lineage, stale prepared replacement hoặc deploy tiếp.
  Evidence hiện ghi tất cả các case này PASS.
- Fix: thêm test production table-driven/targeted cho các nhánh đã khai và assert episode states,
  pointer, boundary/generation, cursor, action status/count cùng idempotent retry; hoặc sửa evidence về
  đúng case thực sự có nhưng vẫn phải commit các case bắt buộc trong review-08. Không cần live mutation.

### Bàn giao review-fix 09 cho Worker

```text
Tiếp tục duy nhất TK-A17/C02 từ HEAD chứa Leader review 09. Không checkout/reset về 8fe4842 hoặc d65ead7.
Production fix R8-01/02 đã được Leader chấp nhận; ưu tiên không sửa production nếu regression mới không
phát hiện lỗi. C03-C09 vẫn đóng/NOT_RUN.

Đóng C02-R9-01 và phần còn lại R8-03 bằng regression đã commit, không chỉ mô tả trong evidence. Tại
MonitorService/ActivationRepository, thêm matrix có thể table-driven cho: source đúng exact boundary
(`size + 1 == start_offset`) và boundary-1; snapshot missing; generation mismatch; runtime wrong/down;
collector missing/down; SSH/inspect throw rồi retry; prepared rollback một/nhiều tầng; active previous
owner cũng resolve qua rollback lineage; missing và cycle lineage; previous-owner abort; stale prepared
row bị thay trong lúc pollAll chờ shared app lock; close/reopen DB; pointer-update injected failure rồi
retry; second tick; target/pointer nhìn thấy được cho workflow deploy tiếp.

Mỗi case phải assert đúng prepared/active/closed/aborted rows, start/end/generation, current_deployment_id,
metrics_offset không đổi ở failure, action type/status/count và không duplicate sau retry. Với stale-row,
giữ app lock, cho pollAll enumerate app ID rồi thay old prepared bằng row mới trước khi nhả lock; chứng
minh service reload row mới và không activate/abort/log success theo dữ liệu stale. Với missing lineage,
tạo is_rollback_of trỏ ID không tồn tại thay vì chỉ dùng cycle.

Sửa review-fix-08 evidence để mỗi dòng PASS map tới tên test/file/line thật; bỏ mọi claim chưa có test.
Chạy lại exact focused, ML 19, collector 26, node/web/scripts typecheck, scoped ESLint, Prettier và build.
Không cần chạy live hoặc đọc SSH lại; giữ nguyên evidence deployment 20/21 và arithmetic 416+5=421,
2080+25=2105. Không deploy/rollback, reset/xóa/reassign SQLite/PostgreSQL, train/score C03, thao tác app B,
push/PR/merge. Giữ .devflow/, docs/ban-giao-20-08.md, logo.png. Append REVIEW-FIX 09 với exact code/docs
HEAD và chỉ bàn giao READY_FOR_LOCAL_REVIEW khi matrix thực sự nằm trong commit và full gates PASS.
```

## 14. Review 10 — fast-track closure tại `313201d`

### Phạm vi và verdict

- Reviewed base `35a4bfa`, production `8fe4842`, test commit `5febcbe`, submitted HEAD `313201d`;
  ancestry hợp lệ và không có production diff sau review 09.
- Verdict: **APPROVED**. `C02-R9-01`, phần còn lại `R8-03/R7-03/R6-02` và toàn bộ finding C02 đã đóng.
- Mở duy nhất C03 theo [C03 Worker plan](c03-worker-plan.md); C04–C09 đóng/`NOT_RUN`.
- Evidence reviewer: [review-10](../../evidence/tk-a17/c02/review-10/). Review chỉ local/test/docs;
  không deploy/rollback, không chạy ML/collector/build/live và không thao tác app B theo fast-track đã duyệt.

### Kiểm chứng độc lập

| Gate | Kết quả reviewer |
| --- | --- |
| `service.test.ts` | 22/22 PASS |
| Exact focused | 18 file, 113/113 PASS |
| Node/web/scripts typecheck | PASS |
| Scoped ESLint + test Prettier | PASS |
| Production diff từ review 09 | Không có; production giữ tại `8fe4842` |
| Recovery matrix audit | PASS; case đã khai map tới committed test |
| GitNexus | analyze PASS với FTS warning; 11 symbol, 231 affected flow, risk CRITICAL |
| ML/collector/build/live rerun | `NOT_RUN` được chấp nhận vì test/docs-only; kết quả production HEAD trước giữ nguyên |

Prettier mở rộng ngoài scoped gate báo các markdown lịch sử chưa theo formatter. Đây không phải code
regression và không chặn C02; C03 phải format các file mới/đổi thuộc chặng của mình.

### Closure finding

| Finding | Review 10 |
| --- | --- |
| C02-R8-01 | CLOSED — exact boundary, boundary-1 và dependency fail-closed committed |
| C02-R8-02 | CLOSED — atomic transition, injected failure và retry committed |
| C02-R8-03 | CLOSED — close/reopen, second tick, lineage/owner, reconnect và stale-row matrix committed |
| C02-R9-01 | CLOSED — evidence đã map tới tên test thật; production không đổi |

### Điều kiện chuyển C03

- Kế thừa SQLite/activation/source state C02; không reset hoặc reassign lịch sử.
- Revalidate current target/runtime/generation trước mutation; không giả định deployment 21 vẫn current.
- Dùng real `MlServiceManager` + `MlApiClient`; baseline current deployment `>=180` sạch rồi mới train.
- C03 mới có quyền train/score và ML lifecycle; chưa có quyền deploy/fault/UI hoặc mở C04.
- Handoff chi tiết và fast path nằm tại [c03-worker-plan.md](c03-worker-plan.md).
