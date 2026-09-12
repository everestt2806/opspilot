# Handoff C02 - TK-A17

## Identity and scope

- Stage / outcome / branch / date: C02 / `READY_FOR_LOCAL_REVIEW` / `feat/a17-demo-checkpoint` / 11/09/2026.
- Base SHA: `4510d5e` (C01 APPROVED handoff commit); inherited C01 approved code `8e42856`, docs `9689ea4`.
- Code HEAD: `fa72a6e`; docs HEAD: `1f128ed`.
- Scope: SSH metric ingestion into SQLite, byte offsets, transaction/dedupe, reconnect and deployment boundary regressions. No C03/UI/fault/rollback policy/ML model.
- Untracked `.devflow/`, `docs/ban-giao-20-08.md`, and `logo.png` were preserved.

## Changes

- `app/src/main/db/migrations/002_metric_activation.sql`: append-only activation history and
  stream identity columns; migration `001` is unchanged.
- `app/src/main/monitor/activation.ts` and `app/src/main/monitor/poller.ts`: persistent byte
  boundary routing, lazy legacy initialization, rotation handling and fail-closed prepared state.
- `app/src/main/deploy/pipeline.ts` and `app/src/main/monitor/appLock.ts`: cutover/rollback
  lifecycle and shared per-app deploy/monitor lock.
- `app/scripts/a17-c02-live.ts` and `tools/a17-c02-live-rollback.cjs`: hard-scoped VM02 live
  ingestion, scheduler and manual rollback runners.

Commit: `ce1a9ff` - Implement C02 persistent ingestion boundary.

Diff for review: `git diff 4510d5e..HEAD -- app/scripts/a17-c02-live.ts app/tsconfig.scripts.json app/src/main/monitor/poller.test.ts`

## Evidence

See [`docs/evidence/tk-a17/c02/ingestion.md`](../../evidence/tk-a17/c02/ingestion.md). The inherited SQLite boundary was offset `6152`, 21 metrics and 105 scores. The live run preserved all data and ended at offset `627450`, 2141 metrics and 10705 scores. It added 10 metrics/50 scores, retry added zero, reconnect added zero, and duplicate `(deployment_id, seq)` groups remained zero.

| Case | Command / cwd / runtime | Exit / count | Result | Evidence |
| --- | --- | --- | --- | --- |
| C02-T1..T4 | `pnpm exec electron .out-scripts/scripts/a17-c02-live.js`, `app`, Electron 39.2.6/Node 24.16.0 | 0; 10 inserted, 50 scores, retry 0 | PASS | `docs/evidence/tk-a17/c02/ingestion.md` |
| C02-T3/T4 focused regressions | `pnpm exec vitest run --maxWorkers=1 src/main/monitor src/main/deploy`, `app` | 0; 12 files, 71 tests | PASS | command output; test source |
| C02-T5 scheduler/service/shutdown tests | included in focused monitor suite, `app` | 0; included in 71 tests | PASS | focused suite |
| C02-T6 typecheck | `pnpm typecheck`, `app` | 0 | PASS | command output |
| C02-T6 lint | `pnpm exec eslint src/main/monitor/poller.test.ts scripts/a17-c02-live.ts`, `app` | 0; 0 errors | PASS | command output |
| C02-T6 format | `pnpm exec prettier --check ...`, `app` | 0 | PASS | command output |
| C02-T6 build | `pnpm build`, `app` | 0; renderer 3045 modules | PASS | command output |
| Collector pytest | `python -m pytest -q`, `collector` | 1; pytest unavailable | NOT_RUN | environment blocker; collector files unchanged |

## Contract mapping

- C02-T1 through C02-T6 are mapped above. C03 and all later stages are `NOT_RUN` and remain closed.
- Related R checks are limited to ingestion, offset, dedupe, deployment-boundary and lifecycle behavior. R checks requiring ML, UI, fault injection, rollback policy or final demo are `NOT_RUN`.

## Live manifest and state

- VM02 / app id `1` / name `a17-notes-0911` / deployment `9` / metrics path above.
- PostgreSQL source record count and collector health were not changed by this worker; no app B operation occurred.
- SQLite ML methods remain null where null before; no fake values were filled and no ML claim is made.
- No push, PR or merge. C03 remains `NOT_RUN`.

## REVIEW-FIX 01 and blocker

- `C02-R1-01` is a contract/schema boundary decision, not a safe local resolver fix. See [`review-fix-01.md`](../../evidence/tk-a17/c02/review-fix-01.md) for the byte-boundary proposal covering deploy, failed attempt, manual/auto rollback, clock skew, rotation/restart, scheduler race and transaction routing.
- `C02-R1-03/04/05` are documented in this review-fix; `C02-R1-02` is `NOT_RUN` because scheduler live observation would mutate the unapproved boundary state.
- Collector pytest was unavailable in the prior run because the current Python environment has no `pytest` module; collector code was not changed.
- Handoff: `BLOCKED` pending Leader approval. No schema change, live redeploy/rollback, reset, reassignment, push, PR or merge was performed.

## REVIEW-FIX provenance

- Review-fix base/code HEAD: `05848d1` / `0967fb9` (no production code change in this fix).
- Review-fix docs HEAD: `ca0b3fa`.
- Commit: `ca0b3fa` - Record the activation-byte boundary proposal and blocker.

## Leader review 01 — 11/09/2026

- Reviewed code `0967fb9`, docs submission `8e08f76`; verdict
  **CHANGES_REQUESTED** tại [review-c02.md](review-c02.md).
- Findings mở: `C02-R1-01` BLOCKER; `C02-R1-02/03` MAJOR; `C02-R1-04/05` MINOR.
- Reviewer xác nhận focused 71/71, collector 26/26 và static/build PASS. Boundary regression mới
  1/1 FAIL; SQLite read-only cho thấy 80 rows seq `22..101` trước activation v9 đang bị gán vào
  deployment 9. Tổng mutation từ C01 approved là `+2120 metrics/+10600 scores`, không chỉ batch
  cuối `+10/+50`.
- C02 về `REVIEW_FIX_REQUIRED`; C03–C09 tiếp tục đóng. Không reset/xóa/reassign dữ liệu lịch sử.

## Leader review 02 — proposal decision 11/09/2026

- Reviewed proposal payload `ca0b3fa`, provenance HEAD `87fa868`; decision
  **APPROVED_WITH_AMENDMENTS** cho implementation tại [review-c02.md](review-c02.md), mục 6.
- Thay hai cột trên `deployment` bằng migration `002` có lịch sử activation theo runtime episode;
  bắt buộc stream generation, shared per-app lock và boundary `size+1` sau collector stop/flush,
  trước runtime cutover/healthcheck.
- `C02-R1-04/05` CLOSED; `C02-R1-03` PARTIAL; `C02-R1-01/02` OPEN. Handoff `BLOCKED` được gỡ để
  Worker tiếp tục sửa C02 trên HEAD chứa commit Leader; C02 chưa APPROVED, C03–C09 vẫn đóng.

## REVIEW-FIX 02 — 11/09/2026

- Implemented the approved-amended persistent byte-boundary model from Leader review 02:
  migration `002`, append-only activation episodes, stream identity/generation, cutover after
  collector stop/flush, fail-closed prepared state, rotation gap logging, repeated rollback
  activation, and one shared per-app lock for deploy/rollback/monitor.
- Closed `C02-R1-01` with regression coverage for migration/lazy legacy, backlog across two
  forward deploys, candidate healthcheck metrics, failure before/after runtime start,
  manual/auto rollback, prepared crash, shared-lock no-overlap, rotation smaller/larger than
  cursor, retry/dedupe/cardinality and transaction rollback.
- Closed `C02-R1-03` with the two-attempt audit. Attempt A raw output is `MISSING`, exit `1`;
  Attempt B exit `0` records before/after state. Reconciliation is `21+2120=2141` metrics and
  `105+2120*5=10705` scores; the 80 historical rows were not modified.
- Live VM02 forward redeploy and manual rollback passed; real MonitorService/Scheduler ran two
  30-second ticks with `max_concurrent=1`, clean stop and exit `0`. Current A target is healthy;
  DB and collector are running, PostgreSQL marker is `1005`, and app B was only read-verified.
- C02 outcome: `READY_FOR_LOCAL_REVIEW`. C03-C09 remain closed and `NOT_RUN`; no ML train/score,
  UI, fault coordinator, push, PR, merge or app B mutation was performed.

## REVIEW-FIX 04 - 11/09/2026

- **Outcome:** `READY_FOR_LOCAL_REVIEW`.
- **Scope:** only C02-R4-01...06; C03-C09 remain closed/`NOT_RUN`.
- **Branch/base:** `feat/a17-demo-checkpoint`, continued from Leader-review HEAD `e80a0f9`; no
  checkout/reset to `fa72a6e` or `85f4810`.
- **Code commit:** `c6c728c` (`Fix C02 recovery and rotation state handling`).
- **Submitted docs commits:** `d57d342` (evidence/task append) and `492354d` (provenance pin).
- **Evidence:** [`docs/evidence/tk-a17/c02/ingestion.md`](../../evidence/tk-a17/c02/ingestion.md).

### C02-T / R mapping

| Item | Evidence / status |
| --- | --- |
| C02-T1 | Live `a17-c02-live.js`: 489 new metrics, 2445 scores, exactly 5 scores/metric; PASS |
| C02-T2 | SQLite before/after offset and counts, transaction/dedupe output; PASS |
| C02-T3 | 90 focused tests: complete/partial/missing/mismatched rotation, warning/data-gap, first-generation adoption and retry; PASS |
| C02-T4 | Controlled rollback: current 18/v18 -> target 16/v16 -> deployment 19, activation/runtime image and healthcheck verified; PASS |
| C02-T5 | Real MonitorService/Scheduler: 2 ticks, `max_concurrent=1`, clean stop, process exit 0; PASS |
| C02-T6 | ML 19, collector 26, typecheck node/web/scripts, scoped lint, Prettier check and build all exit 0; PASS |
| C02-R4-01 | Collector resume after post-stop failures and verified collector running; production pipeline regressions; CLOSED |
| C02-R4-02 | Restore exit/runtime image/state verification and fail-closed activation; production pipeline regressions; CLOSED |
| C02-R4-03 | Helper exact `current_deployment_id`; target id/image differ, raw before/after attempt; CLOSED |
| C02-R4-04 | First real generation adoption without false gap; regression and live generation evidence; CLOSED |
| C02-R4-05 | Committed-byte rotation boundary and explicit identity/cursor/range gap for partial/invalid tails; CLOSED |
| C02-R4-06 | Exact commands, counts, code/docs provenance and live raw output appended; CLOSED |

### Commands / runtime / exit

- `app`: `pnpm exec vitest run --maxWorkers=1 src/main/db src/main/monitor src/main/deploy src/main/shutdown.test.ts` -> exit 0, 18 files/90 tests.
- `ml-service`: `..\\ml-service\\.venv\\Scripts\\python.exe -m pytest -q` -> exit 0, 19 passed.
- `collector`: `..\\ml-service\\.venv\\Scripts\\python.exe -m pytest -q` -> exit 0, 26 passed.
- `app`: `pnpm typecheck; pnpm exec tsc -p tsconfig.scripts.json`; scoped ESLint; scoped
  `prettier --check`; `pnpm build` -> all exit 0, renderer 3045 modules.
- `app`: `pnpm exec tsc -p tsconfig.scripts.json`; `node scripts/prepare-cli.js`; controlled
  rollback helper and live scheduler runner -> both live processes exit 0.

### Live status / limits

- Target only VM02 / app `1` / `a17-notes-0911`; final A runtime was healthy, app/DB/collector
  running, healthcheck passed, and deployment `19` was current using restored runtime image v16.
- PostgreSQL data was preserved; no marker mutation, reset, delete, or historical-row reassignment
  was performed. App B was not operated; no app B result is used to claim A17 success.
- ML model training/scoring, UI, fault coordinator and C03-C09 are `NOT_RUN`.

## REVIEW-FIX 05 - 11/09/2026

- **Outcome:** `READY_FOR_LOCAL_REVIEW`.
- **Review base:** Leader review-05 HEAD `eaca497`; no checkout/reset to `c6c728c` or `018cb70`.
- **Code commit:** `37d9e19`.
- **Docs/evidence:** this handoff and `docs/evidence/tk-a17/c02/ingestion.md`; docs append commit
  `9d336cb` (final provenance pin follows).
- **Scope:** C02-R5-01...06 closed; R1-R4 invariants retained; C03-C09 remain closed/`NOT_RUN`.

| Requirement | Evidence / result |
| --- | --- |
| C02-R5-01 | Cleanup uses independent bounded signal after cancellation; compose exit and collector running state verified; failure writes action log; production regression PASS |
| C02-R5-02 | `runtimeOwner` candidate/previous/down/unknown; unknown preserves prepared durable barrier and poller fail-closed; restore image/state/exit regressions PASS |
| C02-R5-03 | Matching `.1` at cursor >= EOF is recovered without gap; regression PASS |
| C02-R5-04 | Drain advances only from committed `nextOffset`; tail failure keeps old cursor/generation for retry; invalid warning logs identity/cursor/range; regression PASS |
| C02-R5-05 | Helper resolves `is_rollback_of` lineage and verifies live Docker image/state before/after; VM02 current v16 -> target v15 -> final v15; PASS |
| C02-R5-06 | Production regressions committed in `37d9e19`; exact gates and counts recorded in evidence; PASS |

### Gate record

- `app`: `pnpm exec vitest run --maxWorkers=1 src/main/db src/main/monitor src/main/deploy src/main/shutdown.test.ts` -> exit 0, 18 files/95 tests.
- `ml-service`: `..\\ml-service\\.venv\\Scripts\\python.exe -m pytest -q` -> exit 0, 19 passed.
- `collector`: `..\\ml-service\\.venv\\Scripts\\python.exe -m pytest -q` -> exit 0, 26 passed.
- `app`: `pnpm typecheck; pnpm exec tsc -p tsconfig.scripts.json --noEmit`, scoped ESLint,
  scoped Prettier check and `pnpm build` -> all exit 0; renderer 3045 modules.
- Live compile/prepare, controlled rollback helper and scheduler runner -> exit 0.

### Live mutation ledger

- Target only VM02/app `1`/`a17-notes-0911`; current deployment `19` resolved/runtime v16 and
  target deployment `15` resolved/runtime v15 were different before rollback.
- Rollback created deployment `20` (`is_rollback_of=15`), resolved/runtime Docker image v15,
  state running, healthcheck PASS, current pointer 20; collector stop/start was present in raw
  deploy events.
- SQLite before/after live ingestion: `4474/22370/1312320` -> `4833/24165/1417673` for
  metrics/scores/offset; +359/+1795, retry 0, reconnect 0, duplicates 0, five scores/metric.
- Scheduler: 2 real ticks, `max_concurrent=1`, clean stop, process exit 0. PostgreSQL preserved;
  no marker mutation, reset/delete/reassignment, app B operation, or ML train/score.

### REVIEW-FIX 02 gate table

| Finding | Fix / regression | Evidence | Status |
| --- | --- | --- | --- |
| C02-R1-01 | Persistent activation/cutover/rotation/shared-lock model; 82 focused tests plus live deploy/rollback/scheduler | `docs/evidence/tk-a17/c02/ingestion.md` | CLOSED |
| C02-R1-02 | Two real scheduler ticks, no-overlap and clean shutdown | `docs/evidence/tk-a17/c02/ingestion.md` | CLOSED |
| C02-R1-03 | Attempt A/B history, `MISSING` raw output and arithmetic reconciliation | `docs/evidence/tk-a17/c02/ingestion.md` | CLOSED |
| C02-R1-04 | SQLite-vs-ML crash-window limitation documented in contract/evidence | `docs/evidence/tk-a17/c02/ingestion.md` | CLOSED |
| C02-R1-05 | This append records implementation/docs provenance after commit | `docs/tasks/tk-a17/handoff-c02.md` | CLOSED |

## REVIEW-FIX 03 — 11/09/2026

- Closed `C02-R3-01…05` and the remaining `C02-R1-01` gap. First deploy now establishes a
  generation-agnostic boundary at byte `1` when `metrics.jsonl` is absent; production cutover
  stops/flushes collector and takes one atomic identity/device/inode/size snapshot before
  compose up. Stop/flush or snapshot failure is fail-closed.
- Rotation drains a matching `metrics.jsonl.1` suffix under the old episode before opening the
  new generation. Missing or mismatched `.1` records an explicit data gap. Candidate activation
  remains auditable after runtime start even if a later deploy step fails.
- Migration `002` and `schema_version` recording are atomic and idempotent across a populated v1
  fixture and partial v2 reopen; migration `001` remains unchanged.
- Regression gates: focused exact command in evidence, `18 files/88 tests`, collector venv
  `19 passed`, scripts/node/web typechecks, ESLint, Prettier and build exit `0`.
- Live VM02 forward deploys `15/16` passed, first rollback helper failure for deployment `17`
  is retained as FAIL evidence, retry rollback deployment `18` passed, and real scheduler ran
  two 30-second ticks with `max_concurrent=1`, clean stop and exit `0`.
- Outcome: `READY_FOR_LOCAL_REVIEW`. C03-C09 remain closed/`NOT_RUN`; no ML train/score, UI,
  fault coordinator, app B mutation, push, PR or merge.

| Finding | Fix / regression | Evidence | Status |
| --- | --- | --- | --- |
| C02-R3-01 | First-deploy missing/empty source and stat failure paths through DeployPipeline | `docs/evidence/tk-a17/c02/ingestion.md` | CLOSED |
| C02-R3-02 | Collector stop/flush barrier plus atomic production snapshot and fail-closed tests | `docs/evidence/tk-a17/c02/ingestion.md` | CLOSED |
| C02-R3-03 | Production MonitorPoller matching/missing/mismatched `.1` drain/gap regressions | `docs/evidence/tk-a17/c02/ingestion.md` | CLOSED |
| C02-R3-04 | Candidate episode retained after runtime start; manual/auto rollback paths covered | `docs/evidence/tk-a17/c02/ingestion.md` | CLOSED |
| C02-R3-05 | Populated v1 and partial-v2 migration tests plus exact reproducible gates | `docs/evidence/tk-a17/c02/ingestion.md` | CLOSED |

## Leader review 03 — 11/09/2026

- Reviewed code `ce1a9ff`, handoff payload `2c0abb7`, submitted HEAD `0e7d207`; verdict
  **CHANGES_REQUESTED** tại [review-c02.md](review-c02.md), mục 7.
- `C02-R1-02/03/04/05` CLOSED; `C02-R1-01` vẫn OPEN. Mở `C02-R3-01…05`: first deploy thiếu
  `metrics.jsonl` fail, cutover chưa stop/flush, rotation không drain matching `.1`, failure sau
  runtime start có thể bỏ candidate episode, regression/migration chưa chứng minh contract.
- Reviewer local: focused 81/81 và 106/106, collector 26/26, typecheck/lint/format/build PASS;
  regression app mới 1/1 FAIL. Không chạy live, không sửa SQLite/VPS/app B, không push/PR/merge.
- C02 về `REVIEW_FIX_REQUIRED`; C03-C09 tiếp tục đóng/`NOT_RUN`. Evidence reviewer:
  `docs/evidence/tk-a17/c02/review-03/`.

## Leader review 04 — 11/09/2026

- Reviewed code `fa72a6e`, submitted HEAD `85f4810`; verdict **CHANGES_REQUESTED** tại
  [review-c02.md](review-c02.md), mục 8.
- Mở `C02-R4-01…06`: snapshot/preparation fail có thể để collector bị dừng; restore nonzero vẫn mở
  previous activation; live retry 18 chọn chính current deployment 16; first generation ghi gap giả;
  matching `.1` partial bị bỏ mất không gap; coverage/provenance chưa khớp.
- Reviewer: exact focused 88/88, ML service 19/19, collector 26/26, static/build PASS; bốn regression
  recovery/rotation mới đều FAIL. Không chạy live hoặc sửa SQLite/VPS/app B.
- C02 tiếp tục `REVIEW_FIX_REQUIRED`; C03-C09 đóng/`NOT_RUN`. Evidence:
  `docs/evidence/tk-a17/c02/review-04/`.

## Leader review 05 — 11/09/2026

- Reviewed code `c6c728c`, submitted HEAD `018cb70`; verdict **CHANGES_REQUESTED** tại
  [review-c02.md](review-c02.md), mục 9.
- Mở `C02-R5-01…06`: cleanup cancel dùng aborted signal; restore unknown bỏ barrier; matching `.1`
  đã đọc hết ghi gap giả; lỗi drain đóng qua byte chưa commit; live rollback 19 vẫn dùng cùng runtime
  image v16; pipeline regression được khai báo nhưng chưa commit.
- Reviewer xác nhận focused 90/90, ML service 19/19, collector 26/26 và static/build PASS; ba
  regression recovery/rotation mới đều FAIL. Không chạy live hoặc sửa SQLite/VPS/app B.
- C02 về `REVIEW_FIX_REQUIRED`; C03–C09 tiếp tục đóng/`NOT_RUN`. Evidence:
  `docs/evidence/tk-a17/c02/review-05/`.

## Leader review 06 — 11/09/2026

- Reviewed code `37d9e19`, submitted HEAD `4b4f82e`; verdict **CHANGES_REQUESTED** tại
  [review-c02.md](review-c02.md), mục 10.
- `R5-01/03` CLOSED; `R5-02/04/05/06` còn mở. Mở `C02-R6-01…05`: manual/auto owner vẫn suy từ DB
  pointer, prepared barrier chưa reconcile được sau restart, invalid `.1` log gap rỗng tại EOF,
  coverage thiếu và live run 20 chưa có raw/per-deployment evidence.
- Reviewer xác nhận focused 95/95, ML service 19/19, collector 26/26 và static/build PASS; hai
  regression owner/gap-range mới 2/2 FAIL. Không chạy live hoặc sửa SQLite/VPS/app B.
- C02 tiếp tục `REVIEW_FIX_REQUIRED`; C03–C09 đóng/`NOT_RUN`. Evidence:
  `docs/evidence/tk-a17/c02/review-06/`.

## REVIEW-FIX 06 — 11/09/2026

- Base `24c669b`; code commit `61f43df`; evidence `docs/evidence/tk-a17/c02/review-fix-06.md`.
- Closed `C02-R6-01...05` and remaining `C02-R5-02/04/05/06`: owner is no longer inferred from
  `current_deployment_id`; unknown compose/inspect/collector failures retain a durable prepared
  barrier; restart reconciliation runs under the shared app lock and retries idempotently; invalid
  rotated lines retain exact skipped byte ranges.
- Local gates PASS: focused `18 files/96 tests`, ML `19/19`, collector `26/26`, node/web/scripts
  typecheck, scoped lint, Prettier check, and build (`3045` renderer modules), all exit `0`.
- Controlled VM02/A rollback: deployment `20` resolved runtime v15 -> target `19` resolved v16 ->
  deployment `21`; Docker v16/running, health exit `0`, collector running. Real scheduler: two ticks,
  `max_concurrent=1`, clean shutdown/process exit `0`.
- SQLite mutation: `4836/24180/1418551` -> `5257/26285/1542238`, or `+421 metrics/+2105 scores`;
  retry/reconnect `0`, duplicate groups `0`, deployment 21 has `5` rows. PostgreSQL and app/DB/
  collector were verified read-only; app B was read-only only.
- Outcome: `READY_FOR_LOCAL_REVIEW`; C03-C09 remain closed/`NOT_RUN`.

## REVIEW-FIX 07 — 12/09/2026

- Base `1b2f150`; code commit `65d85ac`; docs before append `413ec20`; evidence
  `docs/evidence/tk-a17/c02/review-fix-07.md`.
- Closed `C02-R7-01...04` and remaining `C02-R6-02...05`: prepared/active rollback images resolve
  through validated lineage; cycle/missing/SSH unknown keeps the barrier; mixed-invalid rotation
  closes the old episode at committed EOF and records each invalid byte range.
- Focused production suite: `18 files/98 tests`; ML `19/19`; collector `26/26`; node/web/scripts
  typecheck, scoped lint, Prettier and build (`3045` renderer modules) all exit `0`.
- Read-only VM02 evidence: generation `2050:520983`, size `1720293`, cursor `1543119`; activation
  deployment 20 `[1417093,1541655)`, deployment 21 `[1541655,EOF)`; grouped counts `20=424/2120`,
  `21=5/25`, proving `416+5=421` metrics and `2080+25=2105` scores.
- Final A17 app v16/running, collector/DB healthy, HTTP 200; app B read-only only. Outcome:
  `READY_FOR_LOCAL_REVIEW`; C03-C09 remain closed/`NOT_RUN`.

## REVIEW-FIX 08 — 12/09/2026

- Base `deb69b9`; code commit `8fe4842`; docs before append `2503c12`; evidence
  `docs/evidence/tk-a17/c02/review-fix-08.md`.
- Closed `C02-R8-01...03` and remaining `C02-R7-03/R6-02`: app IDs are enumerated outside the
  lock only, prepared rows are reloaded under lock, source durable boundary is verified, and
  activation plus current pointer are one SQLite transaction.
- Local gates PASS: focused `18 files/99 tests`, ML `19/19`, collector `26/26`, node/web/scripts
  typecheck, scoped lint, Prettier and build (`3045` modules), all exit `0`.
- No live mutation. Existing read-only VM02 evidence remains deployment 20 `424/2120`, deployment
  21 `5/25`, activation `[1417093,1541655)` -> `[1541655,EOF)`, and `416+5=421` / `2080+25=2105`.
- Outcome: `READY_FOR_LOCAL_REVIEW`; C03-C09 remain closed/`NOT_RUN`.

## Leader review 07 — 12/09/2026

- Reviewed code `61f43df`, submitted HEAD `413ec20`; verdict **CHANGES_REQUESTED** tại
  [review-c02.md](review-c02.md), mục 11.
- `R6-01` CLOSED; `R6-02…05` còn phần mở. Mở `C02-R7-01…04`: reconciliation CTE trả raw row tag
  thay vì rollback lineage, valid rows sau invalid `.1` nằm ngoài episode đã đóng, restart coverage
  thiếu rollback/close-reopen matrix và live split 416/5 thiếu activation proof.
- Reviewer xác nhận focused 96/96, ML service 19/19, collector 26/26 và static/build PASS; hai
  lineage/mixed-invalid regressions 2/2 FAIL. Không chạy live hoặc sửa SQLite/VPS/app B.
- C02 tiếp tục `REVIEW_FIX_REQUIRED`; C03–C09 đóng/`NOT_RUN`. Evidence:
  `docs/evidence/tk-a17/c02/review-07/`.

## Leader review 08 — 12/09/2026

- Reviewed base `1b2f150`, code `65d85ac`, submitted HEAD `2503c12`; verdict
  **CHANGES_REQUESTED** tại [review-c02.md](review-c02.md), mục 12.
- `R7-01/02/04` CLOSED. `R7-03/R6-02` còn mở qua `C02-R8-01…03`: reconciliation chưa kiểm
  snapshot size đạt durable boundary, activation và current pointer commit tách transaction, và
  committed recovery matrix/evidence chưa khớp tuyên bố second tick.
- Reviewer xác nhận focused 98/98, ML 19/19, collector 26/26, static/build PASS; hai regression
  boundary/atomicity mới 0/2 PASS. Worker live evidence 20/21 được chấp nhận read-only cho R7-04.
- C02 tiếp tục `REVIEW_FIX_REQUIRED`; C03–C09 đóng/`NOT_RUN`. Evidence:
  `docs/evidence/tk-a17/c02/review-08/`. Không cần live mutation để đóng review-fix 08.

## Leader review 09 — 12/09/2026

- Reviewed base `deb69b9`, code `8fe4842`, submitted HEAD `d65ead7`; verdict
  **CHANGES_REQUESTED** tại [review-c02.md](review-c02.md), mục 13.
- `R8-01/02` CLOSED về implementation và regression chính. `R8-03` còn PARTIAL qua
  `C02-R9-01` MAJOR vì evidence khai một recovery matrix rộng hơn test thực tế đã commit.
- Reviewer xác nhận focused 99/99, ML 19/19, collector 26/26 và static/build PASS. Không phát hiện
  production defect mới; review-fix tiếp theo chỉ cần test/provenance nếu tests không lộ lỗi.
- C02 tiếp tục `REVIEW_FIX_REQUIRED`; C03–C09 đóng/`NOT_RUN`. Không cần live mutation;
  evidence reviewer: `docs/evidence/tk-a17/c02/review-09/`.
