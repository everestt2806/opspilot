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
