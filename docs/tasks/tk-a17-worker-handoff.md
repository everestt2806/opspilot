# Sổ bàn giao và review — TK-A17

> C00 APPROVED 11/09: [review](tk-a17/review-c00.md), code `d4ec3be`, docs `23cd248`.
> C01 APPROVED review-03 11/09: [review](tk-a17/review-c01.md),
> code `8e42856`, docs `9689ea4`. C02 APPROVED review-10; C03 APPROVED review-03, mở C04 migrate.
> Phạm vi 14/09: C03 deploy → C04 migrate hai VPS → C05 rehearsal; ML deferred tới ít nhất 28/09.
> Mỗi chặng tạo handoff/review riêng trong `docs/tasks/tk-a17/`; không ghi đè lịch sử.

- Owner A solo; C00–C03 đã được Leader approve; Worker chỉ làm C04 theo task migrate.
- Baseline code `683bfc6`; branch plan `plan/a17-demo-checkpoint`.
- Branch Worker đã tạo `feat/a17-demo-checkpoint`, có cập nhật kế hoạch 11/09; tiếp tục HEAD hiện tại.
- Chặng được approve: C00, C01, C02, C03. C04 migrate `OPEN`; C05 acceptance chưa mở;
  C03–C09 cũ deferred khỏi demo 14/09.

## Sổ gate (Leader xác nhận verdict)

| Chặng | Worker outcome | Reviewed SHA | Verdict | Handoff/review |
| ----- | -------------- | ------------ | ------- | -------------- |
| C00   | READY_FOR_LOCAL_REVIEW | code `d4ec3be` / docs `23cd248` | APPROVED | [handoff](tk-a17/handoff-c00.md) / [review](tk-a17/review-c00.md) |
| C01   | READY_FOR_LOCAL_REVIEW | code `8e42856` / docs `9689ea4` | APPROVED | [handoff](tk-a17/handoff-c01.md) / [review](tk-a17/review-c01.md) |
| C02   | READY_FOR_LOCAL_REVIEW | production `8fe4842` / tests `5febcbe` / docs `313201d` | APPROVED (review-10) | [handoff](tk-a17/handoff-c02.md) / [review](tk-a17/review-c02.md) |
| C03 deploy | READY_FOR_LOCAL_REVIEW | code `c060c75` / docs `53aa07e` | APPROVED (review-03) | [Review](tk-a17/review-c03.md) |
| C04 migrate | OPEN | C03 inputs app 18/16 | PENDING; VM01 timeout | [Task](tk-a17/c04-migrate-two-vps.md) |
| C05 demo | NOT_STARTED | —            | PENDING | [Acceptance](tk-a17/c05-demo-14-09-acceptance.md) |
| ML    | DEFERRED       | —            | Sau 28/09 | [Phạm vi giữ lại](tk-a17/c03-ml-runtime.md) |
| C04–C09 cũ | DEFERRED  | —            | Sau demo | Không chạy theo plan 14/09 |

## Mẫu `handoff-cNN.md`

### Identity và phạm vi

- Chặng / outcome / branch / ngày thực hiện:
- Base SHA / code HEAD / docs HEAD (docs HEAD có thể báo ở terminal sau commit):
- Review chặng trước được kế thừa:
- Commit list và bullet tiếng Anh mô tả thay đổi:
- File đổi, lý do, scope ngoại lệ nếu có:
- Diff để reviewer chạy: `git diff <base>..<code-head> -- <paths>`.

### Bằng chứng

| Case ID                  | Command + cwd + runtime | Exit/count | PASS/FAIL/NOT_RUN | Evidence path |
| ------------------------ | ----------------------- | ---------- | ----------------- | ------------- |
| Điền từng case của chặng | Chưa chạy               | —          | NOT_RUN           | —             |

- Checklist DoD: từng checkbox map tới case/evidence, không chỉ ghi “all pass”.
- Live manifest đã bỏ secret: host/app/path/port/container/deployment IDs.
- Dữ liệu nguồn: seq/time range, counts, offset, duplicates, model/null state nếu áp dụng.
- UI: route/click path, viewport, screenshot và kết quả mong đợi/quan sát.
- Incident/recovery: fault/reset UTC, alert ID, current/runtime image, marker DB trước/sau.
- Tình trạng laptop/VPS sau test: app/collector/ML còn chạy, fault đã reset chưa.
- Blocker, giới hạn, phần NOT_RUN và điều kiện gỡ; không nhận test cũ làm kết quả mới.
- Untracked/stash không bị chạm. CHƯA PUSH — CHƯA PR — CHƯA MERGE.

### REVIEW-FIX (append mỗi vòng)

| Finding | Fix commit | Regression | Evidence | Reviewer xác nhận |
| ------- | ---------- | ---------- | -------- | ----------------- |
| Chưa có | —          | —          | —        | Chờ review        |

## Mẫu `review-cNN.md` — Leader điền

- Reviewed base/code SHA và kiểm tra có kế thừa chặng trước:
- Gate checked: source/diff, commands, live/UI evidence nào đã kiểm tra trực tiếp:
- Findings: ID `Cnn-Rm-xx`, BLOCKER/MAJOR/MINOR, file/line, trigger, expected/actual,
  cách tái hiện, fix/kiểm chứng cần có. Phân biệt evidence Worker và reviewer tự chạy.
- Verdict: APPROVED / CHANGES_REQUESTED / BLOCKED.
- Chặng tiếp được mở; C08A/B/C mỗi phần cần APPROVED trước phần tiếp.
- Nếu APPROVED: liệt kê hạn chế được chấp nhận, ảnh hưởng demo và nơi theo dõi.

## Gate cuối demo 14/09

- [x] C00–C02 APPROVED đúng SHA được kế thừa.
- [ ] C03: Express/Next/Vite đều deploy live thành công bằng pipeline thật.
- [ ] C04: stateless và PostgreSQL đều migrate live thành công giữa hai VPS thật.
- [ ] C05: full tests/build, hai rehearsal, ảnh/runbook và đường trình chiếu có bằng chứng.
- [ ] Leader xác nhận DEMO_READY đúng SHA.
- [ ] Merge + DoD đủ bằng chứng mới đổi board HOÀN THÀNH.
- REVIEW-FIX 01 - 11/09/2026: C01 `C01-R1-01…06` closed at code `0d15eb5`; handoff outcome
  is `READY_FOR_LOCAL_REVIEW`. Evidence is `docs/evidence/tk-a17/c01/review-fix-01.md`.
  The original review SHA remains historical; C02 and later stages remain `NOT_RUN`.
- REVIEW 02 - 11/09/2026: Leader xác nhận `C01-R1-01/03/04/05/06` đóng; tiếp tục
  `C01-R1-02` bằng `C01-R2-01` MAJOR. POST-only `/items` và GET `/items/:id` đang bị nhận
  nhầm là GET collection route. C01 về `REVIEW_FIX_REQUIRED`; C02 tiếp tục đóng.
- REVIEW-FIX 02: `C01-R2-01` closed at code `8e42856`; handoff is `READY_FOR_LOCAL_REVIEW`.
  Evidence: `docs/evidence/tk-a17/c01/review-fix-02.md`; C02 and later remain `NOT_RUN`.

- START/HANDOFF C02 - 11/09/2026: kế thừa VM02/app 1/deployment 9 và SQLite offset 6152 với 21 metric/105 score;
  không reset dữ liệu. Live ingestion thêm 10 metric/50 score, retry cùng snapshot `0`, duplicate `0`;
  focused 71/71 và typecheck/lint/format/build PASS. Handoff [handoff-c02](tk-a17/handoff-c02.md) là
  `READY_FOR_LOCAL_REVIEW`; C03-C09 vẫn `NOT_RUN`.
- REVIEW 03 - 11/09/2026: C01 APPROVED code `8e42856`, docs `9689ea4`; mọi finding đóng.
  Reviewer focused 75/75, collector 26/26, static/build và VM02 read-only PASS. Mở duy nhất
  C02; phải kế thừa offset 6152 cùng 21 metric/105 score rows, không reset dữ liệu.
- REVIEW C02 01 - 11/09/2026: [review](tk-a17/review-c02.md) **CHANGES_REQUESTED** tại code
  `0967fb9`, docs `8e08f76`. Mở `C02-R1-01…05`: boundary backlog là BLOCKER; scheduler live và
  đối soát toàn mutation là MAJOR; ML crash-window/provenance là MINOR. Reviewer xác nhận nền
  71/71, collector 26/26, static/build PASS; C03-C09 tiếp tục đóng.

- REVIEW-FIX C02 01 - 11/09/2026: Worker bàn giao `BLOCKED` tại `05848d1` vì C02-R1-01 cần Leader duyệt
  proposal boundary contract/schema trước khi đổi poller/deploy lifecycle hoặc chạy live mutation. Evidence:
  `docs/evidence/tk-a17/c02/review-fix-01.md`; C02-R1-02 `NOT_RUN`, C02-R1-03/04/05 đã ghi nhận; C03-C09 đóng.
- REVIEW C02 02 - 11/09/2026: Leader review proposal payload `ca0b3fa`, provenance `87fa868` và
  quyết định `APPROVED_WITH_AMENDMENTS` cho implementation. Bắt buộc activation history table,
  stream generation, pre-healthcheck cutover sau collector stop/flush và shared per-app lock.
  `C02-R1-04/05` CLOSED; `R1-03` PARTIAL; `R1-01/02` OPEN. C02 về `ĐANG LÀM`, C03-C09 đóng.

- REVIEW-FIX C02 02 - 11/09/2026: Worker đã đóng C02-R1-01…05 bằng migration `002`,
  persistent activation/cutover, rotation, rollback và shared-lock regressions; live VM02
  forward deploy/manual rollback và hai tick scheduler thật PASS. Handoff C02 là
  `READY_FOR_LOCAL_REVIEW`; code/docs SHA sẽ được chốt ngay sau commit local. C03-C09 vẫn
  `NOT_RUN`, chưa push/PR/merge.

- REVIEW-FIX C02 03 - 11/09/2026: Worker đóng C02-R3-01…05 và phần còn lại C02-R1-01 bằng
  production DeployPipeline/MonitorPoller regressions, migration fixture v1/partial reopen,
  collector stop/flush snapshot, `.1` recovery and candidate runtime-failure retention. Focused
  `88/88`, collector `19/19`, typecheck/lint/format/build PASS; live VM02 forward 15/16,
  successful rollback 18 after recorded failed attempt 17, and two scheduler ticks PASS.
  Handoff `READY_FOR_LOCAL_REVIEW`; C03-C09 vẫn `NOT_RUN`, chưa push/PR/merge.

- REVIEW-FIX C02 03 - 11/09/2026: Worker đóng C02-R3-01…05 và phần còn lại C02-R1-01 bằng
  production DeployPipeline/MonitorPoller regressions, migration fixture v1/partial reopen,
  collector stop/flush snapshot, `.1` recovery và candidate runtime-failure retention. Focused
  `88/88`, collector `19/19`, typecheck/lint/format/build PASS; live VM02 forward 15/16,
  successful rollback 18 after recorded failed attempt 17, and two scheduler ticks PASS.
  Handoff `READY_FOR_LOCAL_REVIEW`; C03-C09 vẫn `NOT_RUN`, chưa push/PR/merge.
- REVIEW C02 03 - 11/09/2026: Leader review code `ce1a9ff`, submitted HEAD `0e7d207`:
  **CHANGES_REQUESTED**. Mở `C02-R3-01…05`; first deploy thiếu `metrics.jsonl` fail độc lập,
  cutover chưa stop/flush collector, rotation không drain matching `.1`, post-runtime failure có thể
  bỏ candidate episode, và regression/migration chưa chứng minh contract. Reviewer local focused
  81/81 và 106/106, collector 26/26, static/build PASS; không chạy live. C02 về
  `REVIEW_FIX_REQUIRED`; C03-C09 đóng/`NOT_RUN`.
- REVIEW C02 04 - 11/09/2026: Leader review code `fa72a6e`, submitted HEAD `85f4810`:
  **CHANGES_REQUESTED**. Reviewer exact focused 88/88, ML service 19/19, collector 26/26 và
  static/build PASS, nhưng bốn recovery/rotation regressions đều FAIL. Mở `C02-R4-01…06` cho
  collector resume sau snapshot fail, verified restore ownership, valid live rollback target,
  first-generation adoption, partial `.1` và provenance. C02 `REVIEW_FIX_REQUIRED`; C03-C09 đóng.

- REVIEW-FIX C02 04 - 11/09/2026: Worker tiếp tục từ `e80a0f9`, commit code `c6c728c`, đóng
  `C02-R4-01...06` bằng production recovery/rollback/rotation regressions. Local focused `90/90`,
  ML `19/19`, collector `26/26`, typecheck/lint/format/build PASS; live VM02 current `18/v18`
  chọn target `16/v16`, tạo deployment `19`, scheduler hai tick `max_concurrent=1`, exit `0`.
  Handoff C02 `READY_FOR_LOCAL_REVIEW`; submitted docs HEAD được ghi trong handoff sau commit;
  C03-C09 vẫn đóng/`NOT_RUN`, không push/PR/merge.

- REVIEW-FIX C02 05 - 11/09/2026: Worker tiếp tục từ Leader review-05 `eaca497`, commit code
  `37d9e19`, đóng `C02-R5-01...06` với 95 focused tests và đầy đủ local gates. Controlled VM02
  rollback chứng minh current runtime v16 -> target runtime v15 -> deployment 20, Docker/state
  và healthcheck PASS; scheduler hai tick, max concurrency 1, exit 0. Handoff C02
  `READY_FOR_LOCAL_REVIEW`; C03-C09 đóng/`NOT_RUN`, không push/PR/merge.
- REVIEW C02 05 - 11/09/2026: Leader review code `c6c728c`, submitted HEAD `018cb70`:
  **CHANGES_REQUESTED**. Local gates Worker đều PASS nhưng ba reviewer regression FAIL: cancel cleanup
  dùng aborted signal, matching `.1` đã đọc hết ghi gap giả, và lỗi đọc `.1` đóng qua byte chưa commit.
  Restore unknown chưa giữ reconciliation barrier; rollback 19 so raw row tag nên thực tế v16 -> v16;
  pipeline coverage được khai báo nhưng chưa commit. Mở `C02-R5-01…06`; C02 về
  `REVIEW_FIX_REQUIRED`, C03-C09 đóng/`NOT_RUN`.
- REVIEW C02 06 - 11/09/2026: Leader review code `37d9e19`, submitted HEAD `4b4f82e`:
  **CHANGES_REQUESTED**. Focused 95/95, ML 19/19, collector 26/26 và static/build PASS, nhưng hai
  reviewer regressions 2/2 FAIL. Manual/auto unknown owner vẫn bỏ barrier; prepared row không có
  restart reconciliation; invalid `.1` log `[EOF,EOF]`; coverage và raw live routing evidence chưa
  đủ. `R5-01/03` CLOSED, mở `C02-R6-01…05`; C02 `REVIEW_FIX_REQUIRED`, C03-C09 đóng.
- REVIEW-FIX C02 06 - 11/09/2026: Worker code `61f43df`, evidence
  `docs/evidence/tk-a17/c02/review-fix-06.md`; local focused 96/96, ML 19/19, collector 26/26 và
  static/build PASS. Controlled VM02 deployment 21 restored runtime v16 from v15; scheduler two
  ticks, live mutation +421/+2105, deployment 21 có 5 metric rows. Handoff
  `READY_FOR_LOCAL_REVIEW`; C03-C09 đóng/`NOT_RUN`.
- REVIEW-FIX C02 07 - 12/09/2026: Worker code `65d85ac`, evidence
  `docs/evidence/tk-a17/c02/review-fix-07.md`; R7-01...04 and R6-02...05 closed. Focused 98/98,
  ML 19/19, collector 26/26, static/build PASS. Read-only VM02 activation/source/grouped evidence
  explains `416+5=421` metrics and `2080+25=2105` scores. C02 `READY_FOR_LOCAL_REVIEW`;
  C03-C09 đóng/`NOT_RUN`.
- REVIEW-FIX C02 08 - 12/09/2026: Worker code `8fe4842`, evidence
  `docs/evidence/tk-a17/c02/review-fix-08.md`; R8-01...03 and R7-03/R6-02 closed. Focused 99/99,
  ML 19/19, collector 26/26, static/build PASS. No live mutation; read-only deployment 20/21
  evidence and exact 421/2105 arithmetic retained. C02 `READY_FOR_LOCAL_REVIEW`; C03-C09 closed.
- REVIEW C02 07 - 12/09/2026: Leader review code `61f43df`, submitted HEAD `413ec20`:
  **CHANGES_REQUESTED**. Focused 96/96, ML 19/19, collector 26/26 và static/build PASS, nhưng hai
  reviewer regressions 2/2 FAIL: prepared rollback lineage không reconcile và old episode đóng trước
  valid row sau invalid `.1`. Restart matrix cùng live activation/per-deployment split evidence chưa
  đủ. Mở `C02-R7-01…04`; C02 `REVIEW_FIX_REQUIRED`, C03-C09 đóng/`NOT_RUN`.
- REVIEW C02 08 - 12/09/2026: Leader review code `65d85ac`, submitted HEAD `2503c12`:
  **CHANGES_REQUESTED**. Focused 98/98, ML 19/19, collector 26/26 và static/build PASS; lineage,
  mixed-invalid và live split đã đóng. Hai recovery regression mới 0/2 PASS: source ngắn hơn durable
  boundary vẫn activate, và pointer-update failure để activation/pointer split state. Mở
  `C02-R8-01…03`; C02 `REVIEW_FIX_REQUIRED`, C03-C09 đóng/`NOT_RUN`.
- REVIEW C02 09 - 12/09/2026: Leader review code `8fe4842`, submitted HEAD `d65ead7`:
  **CHANGES_REQUESTED**. Production R8-01/02 và full gates đạt; không có defect production mới.
  `C02-R9-01` MAJOR còn mở vì review-fix-08 khai nhiều recovery case PASS nhưng diff chỉ có một test
  mới và một test mở rộng. C02 `REVIEW_FIX_REQUIRED`; C03-C09 đóng/`NOT_RUN`; không cần live mutation.
- REVIEW-FIX C02 09: code `5febcbe`, docs `313201d`; C02-R9-01 closed by committed fail-closed,
  lineage/owner and concurrency/stale-row tests. Service 22/22, focused 113/113 và static gates PASS.
  Production unchanged; ML/collector/build/live `NOT_RUN`; `READY_FOR_LOCAL_REVIEW`.
- REVIEW C02 10 - 12/09/2026: Leader **APPROVED** production `8fe4842`, tests `5febcbe`, submitted
  HEAD `313201d`. Mọi finding C02 CLOSED; mở duy nhất C03 theo
  [c03-worker-plan.md](tk-a17/c03-worker-plan.md). C04-C09 đóng/`NOT_RUN`.

- REPLAN 12/09 — A giới hạn demo 14/09 vào deploy nhiều source và migrate hai VPS. C03 cũ về ML
  được deferred tới ít nhất 28/09; mở C03 deploy ba Tier 1. C04 migrate/C05 acceptance đã có task
  chi tiết nhưng còn đóng. Worker kế tiếp chỉ nhận [C03](tk-a17/c03-worker-plan.md).
- HANDOFF C03 - 12/09/2026: Outcome `READY_FOR_LOCAL_REVIEW`; base `c2d55ad`; code `c149291`;
  docs/evidence commit `bf0580a`; C03-T1...T7 PASS with the VM02 Express/Next.js/Vite matrix, shared
  pipeline events, deployment IDs, runtime images, Docker health, HTTP, collector and PostgreSQL
  marker proof. Focused `55/55`, collector `26/26`, node/web and scripts typecheck, scoped
  ESLint/Prettier and build PASS. C04/C05/C06-C09 remain closed/`NOT_RUN`; no ML, monitor, fault,
  Flask, app B mutation, push, PR or merge.
- Current C03 status override: `READY_FOR_LOCAL_REVIEW`; code `c149291`, evidence/docs commit
  `bf0580a`, bookkeeping commit `e10e74e`. The earlier C03 table row is historical; C04/C05 remain
  closed/`NOT_RUN`.
- REVIEW-FIX C03 01 - 12/09/2026: `C03-R1-01...04` closed; code `e3a32f1`; docs/evidence commit
  will be recorded after this append. Outcome `READY_FOR_LOCAL_REVIEW`. Final VM02 matrix,
  structured per-deployment events, durable SQLite close/reopen and demo tunnel proof are recorded
  in `docs/evidence/tk-a17/c03/review-fix-01/`. C04/C05/C06-C09 remain closed/`NOT_RUN`.
- REVIEW C03 01 - 12/09/2026: Leader **CHANGES_REQUESTED** tại code `c149291`, submitted docs
  `dcbe3b5`. Mở `C03-R1-01…04`; contract regression 0/5, live provenance chưa bền và đường public
  timeout. C03 `REVIEW_FIX_REQUIRED`; C04/C05 đóng/`NOT_RUN`. Worker tiếp tục theo
  [review-c03.md](tk-a17/review-c03.md).
- REVIEW-FIX C03 02 - 13/09/2026: code `c060c75`, base `2a15615`; `C03-R2-01...02` closed. The
  helper now uses real userData/safeStorage-backed credentials and the actual VM02 resolver; fresh
  real-profile apps `16/17/18` with deployments `38/39/40/41` are healthy on ports `30015..30017`.
  Credential audit is scrubbed, exact build-arg integration regression is committed, and focused
  `65/65` plus typecheck/scripts typecheck, scoped ESLint/Prettier and build pass. C03 is
  `READY_FOR_LOCAL_REVIEW`; C04-C09 remain closed/`NOT_RUN`, with no app B mutation or push/PR/merge.

- REVIEW C03 02 - 13/09/2026: Leader **CHANGES_REQUESTED** tại code `e3a32f1`, submitted
  `8e60243`. R1-01, production R1-02 và R1-04 đạt; R1-03 chưa đóng. Mở `C03-R2-01…02` vì profile
  phụ chứa plaintext private key/không dùng được bằng resolver thật, C03 apps vắng khỏi app DB thật
  và exact reviewer integration còn 2 fail. C04/C05 đóng/`NOT_RUN`.
- REVIEW C03 03 - 13/09/2026: Leader **APPROVED** code `c060c75`, submitted `53aa07e` sau
  independent focused 65/65, actual userData/credential resolver/cleanup và tunnel proof. Mọi finding
  C03 CLOSED. Mở duy nhất C04; source Vite app 18/deployment 41 và Express app 16/deployment 39.
  VM01 profile ID 1 đang TCP timeout nên live C04 chưa thể PASS.
