# Handoff C02 - TK-A17

## Identity and scope

- Stage / outcome / branch / date: C02 / `READY_FOR_LOCAL_REVIEW` / `feat/a17-demo-checkpoint` / 11/09/2026.
- Base SHA: `4510d5e` (C01 APPROVED handoff commit); inherited C01 approved code `8e42856`, docs `9689ea4`.
- Code HEAD: `fa72a6e`; docs HEAD: `a0e2de1`.
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
