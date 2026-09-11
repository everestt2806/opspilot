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
