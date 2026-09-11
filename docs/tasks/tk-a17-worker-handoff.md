# Sổ bàn giao và review — TK-A17

> C00 APPROVED 11/09: [review](tk-a17/review-c00.md), code `d4ec3be`, docs `23cd248`.
> C01 APPROVED review-03 11/09: [review](tk-a17/review-c01.md),
> code `8e42856`, docs `9689ea4`. C02 review-07 đang CHANGES_REQUESTED.
> Mỗi chặng tạo handoff/review riêng trong `docs/tasks/tk-a17/`; không ghi đè lịch sử.

- Owner A solo; C01 đã được Leader approve sau review-fix-02; C02 đang sửa theo review-07.
- Baseline code `683bfc6`; branch plan `plan/a17-demo-checkpoint`.
- Branch Worker đã tạo `feat/a17-demo-checkpoint`, có cập nhật kế hoạch 11/09; tiếp tục HEAD hiện tại.
- Chặng được approve: C00, C01. C02 `REVIEW_FIX_REQUIRED`; C03–C09 chưa mở.

## Sổ gate (Leader xác nhận verdict)

| Chặng | Worker outcome | Reviewed SHA | Verdict | Handoff/review |
| ----- | -------------- | ------------ | ------- | -------------- |
| C00   | READY_FOR_LOCAL_REVIEW | code `d4ec3be` / docs `23cd248` | APPROVED | [handoff](tk-a17/handoff-c00.md) / [review](tk-a17/review-c00.md) |
| C01   | READY_FOR_LOCAL_REVIEW | code `8e42856` / docs `9689ea4` | APPROVED | [handoff](tk-a17/handoff-c01.md) / [review](tk-a17/review-c01.md) |
| C02   | READY_FOR_LOCAL_REVIEW | code `61f43df` / docs `413ec20` | CHANGES_REQUESTED (review-07) | [handoff](tk-a17/handoff-c02.md) / [review](tk-a17/review-c02.md) |
| C03   | NOT_STARTED    | —            | PENDING | Chưa có        |
| C04   | NOT_STARTED    | —            | PENDING | Chưa có        |
| C05   | NOT_STARTED    | —            | PENDING | Chưa có        |
| C06   | NOT_STARTED    | —            | PENDING | Chưa có        |
| C07   | NOT_STARTED    | —            | PENDING | Chưa có        |
| C08A  | NOT_STARTED    | —            | PENDING | Chưa có        |
| C08B  | NOT_STARTED    | —            | PENDING | Chưa có        |
| C08C  | NOT_STARTED    | —            | PENDING | Chưa có        |
| C09   | NOT_STARTED    | —            | PENDING | Chưa có        |

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

## Gate cuối

- [ ] C00–C07 APPROVED đúng SHA được kế thừa.
- [ ] C08A/B/C APPROVED, live tự khôi phục không có manual/reset can thiệp trước proof.
- [ ] C09: full tests/build, hai rehearsal, ảnh/video/runbook có bằng chứng.
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
- REVIEW C02 07 - 12/09/2026: Leader review code `61f43df`, submitted HEAD `413ec20`:
  **CHANGES_REQUESTED**. Focused 96/96, ML 19/19, collector 26/26 và static/build PASS, nhưng hai
  reviewer regressions 2/2 FAIL: prepared rollback lineage không reconcile và old episode đóng trước
  valid row sau invalid `.1`. Restart matrix cùng live activation/per-deployment split evidence chưa
  đủ. Mở `C02-R7-01…04`; C02 `REVIEW_FIX_REQUIRED`, C03-C09 đóng/`NOT_RUN`.
