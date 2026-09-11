# Handoff C01 — TK-A17

## Identity and scope

- Chặng / outcome / branch / ngày: C01 / `READY_FOR_LOCAL_REVIEW` / `feat/a17-demo-checkpoint` / 11/09/2026.
- Base HEAD: `1b447e4` (C00 review commit); inherited C00 approved code `d4ec3be`, docs `23cd248`.
- Code HEAD: `66cbdab`; docs HEAD: `c10814c`.
- C01 scope: collector packaging, compose service/DB readiness, live deploy/redeploy,
  PostgreSQL marker persistence, JSONL soak and collector failure isolation. C02+ not implemented.
- App B, experiment data and A's untracked `.devflow/`, `docs/ban-giao-20-08.md`, `logo.png` preserved.

## Changes

- `templates/docker-compose.template.yml`: add collector service, 128m limit, metrics bind,
  Docker socket RO, app business URL and DB DSN interpolation; add app DB readiness dependency.
- `app/src/main/deploy/templates.ts`: render collector image/path and PostgreSQL healthcheck/
  `service_healthy` dependency without exposing credentials.
- `app/src/main/deploy/pipeline.ts`: upload collector source, verify remote files, build collector
  image, preserve collector in restore compose, and use `/items?limit=1` for Express probes.
- Deploy/template tests and `tools/a17-c01-live.cjs` provide focused regression/live evidence.
- Commit list: `66cbdab` — Package collector in deploy/restore compose, add DB readiness and
  live C01 evidence/handoff; no push/PR/merge.
  `c6c8064` — Pin the C01 code/docs provenance.
  `c10814c` — Finalize the exact documentation head.

## Case evidence

| Case | Command / cwd / runtime | Outcome | Evidence |
| --- | --- | --- | --- |
| C01-T1 | Focused template/pipeline tests from `app`, Node 22 | PASS: app+DB+collector, no-DB remains valid, DSN is `${DATABASE_URL:-}` | `app/src/main/deploy/templates.test.ts`, `pipeline.test.ts` |
| C01-T2 | Unit restore-compose regression + live v6/v7 redeploy on VM02 | PASS: collector/config/metrics remained in forward/restore render; DB volume persisted | `docs/evidence/tk-a17/c01/live-deploy.md`, `live-deploy-pass.txt` |
| C01-T3 | Collector soak from 20:27:30Z to 20:37:30Z; SSH JSONL read | PASS: 91 copied rows, seq continuous, >10 minutes; latest matches last | `metrics.jsonl`, `latest.json`, `soak-status.txt` |
| C01-T4 | VPS collector stats/business/DB metrics, not laptop metrics | PASS: Docker stats, `/items?limit=1`, PostgreSQL `db_response_ms` real | `metrics.jsonl`, `live-deploy.md` |
| C01-T5 | Real v6/v7, marker POST, `/meta`, item offset verification | PASS: current v7, marker preserved, PostgreSQL records 1003, port 30000 | `live-deploy-pass.txt`, `live-deploy.md` |
| C01-T6 | Stop/restart only A17 collector, app health and unique container check | PASS: app stayed healthy; collector resumed, one container, restart 0 | `collector-failure-recovery.txt` |
| C01-T7 | Focused tests, collector pytest, typecheck, lint, build | PASS: 44/44 deploy tests, 26/26 collector, typecheck/lint/build exit 0 | command logs below; `live-deploy.md` |

### Commands

- `pnpm exec vitest run --maxWorkers=1 src/main/deploy` / `app` / Node 22.23.2: 5 files, 44 tests, exit 0.
- `pnpm typecheck` / `app` / Node 22.23.2: node+web exit 0.
- `pnpm exec eslint --no-cache ...deploy files` / `app` / Node 22.23.2: exit 0.
- `pnpm exec electron-vite build` / `app` / Node 22.23.2: 3045 renderer modules, exit 0.
- `..\ml-service\.venv\Scripts\python.exe -m pytest tests -q` / `collector` / Python venv: 26 passed.
- Live runner: `pnpm exec electron ..\tools\a17-c01-live.cjs` / `app` / Electron 39.8.10,
  profile A; individual `finished` events and live response were checked, not helper exit alone.

## R mapping and downstream gates

- R01: PASS for A-solo/Worker boundary; R02: C01 deploy/redeploy step exists, full recovery NOT_RUN.
- R03: partial PASS for real PostgreSQL marker persistence; UI add/reload C04 NOT_RUN.
- R06: PASS for deployment/runtime/metric sources in C01; Monitor projection C05+ NOT_RUN.
- R07: PASS collector included in compose, persisted through redeploy and resumed after controlled stop.
- R17: partial PASS for PostgreSQL marker/volume through v6→v7; rollback proof C07/C08C NOT_RUN.
- R19/R20/R21/R22/R23/R24/R25: PASS for target isolation, staged review, local-only commit,
  contract adherence, command/evidence records, network boundary and C01-only scope.
- R04/R05/R08/R09/R10/R11/R12/R13/R14/R15/R16/R18: NOT_RUN or downstream-only; do not infer
  ingestion, ML trigger, alert, UI, manual/automatic rollback or research result from C01.
- C02, C03, C04, C05, C06, C07, C08A, C08B, C08C, C09: **NOT_RUN**.

## State and blocker

- A17: current v7 at VM02 port 30000; app/DB/collector running and healthy; PostgreSQL marker/data retained.
- App B: `express-demo-app` and `express-demo-collector` unchanged/running on port 30001; no B operation.
- Local ML: only started by live runner and shut down with normal app exit; no ML train/score claimed.
- Tunnel: none left open; public access was not used as proof. App URL is recorded as `http://221.121.1.80:30000`, with network reachability to be rechecked at C04/C09.
- Experiments: no running `run_experiment.py` process before/after; no experiment DB rows created.
- Initial v1 readiness failure and two runner query corrections are documented, not hidden.
- No credential blocker. C01 review must inspect compose forward/restore, secret handling, target state and the failed-v1 history before opening C02.

## Handoff

- Evidence root: `docs/evidence/tk-a17/c01/`.
- CHƯA PUSH — CHƯA PR — CHƯA MERGE. Dừng tại C01 để Leader review.

## Leader review 01 — 11/09/2026

- Reviewed submission: code `66cbdab`, docs `f0b73aa`.
- Verdict: **CHANGES_REQUESTED** tại [review-c01.md](review-c01.md).
- Worker cần đóng `C01-R1-01`…`C01-R1-06`, append bảng REVIEW-FIX với commit/regression/
  evidence mới và bàn giao lại. C02 chưa được mở; không reset dữ liệu SQLite đã phát sinh.

## REVIEW-FIX 01 - 11/09/2026

- Outcome: `READY_FOR_LOCAL_REVIEW`; code commit `0d15eb5`; docs commit is the commit that
  contains this append. Base remains current HEAD `7e34b96`; no checkout/rebase/rewrite,
  push, PR or merge.
- Evidence: `docs/evidence/tk-a17/c01/review-fix-01.md`.
- `C01-R1-01` through `C01-R1-06`: **CLOSED**. Packaging/resource resolution, verified
  Express probe fallback, tag-safe cleanup, live collector recovery, deploy-only helper
  isolation, and exact provenance are covered by the evidence and regressions.
- C01-T1/T2/T3/T4/T5/T6/T7: **PASS**. T7 includes focused deploy/detector `53/53`, collector
  `26/26`, typecheck, lint, format, electron-vite build, and successful unpacked artifact.
- Live final state: VM02 `a17-notes-0911` app v9, PostgreSQL and collector running; collector
  restart `0`; seq `105` through `109` increased after helper exit; marker id `1004` retained.
  App B was untouched. Existing SQLite data was retained.
- R01/R02/R06/R07/R17/R19/R20/R21/R22/R23/R24/R25 are mapped by this evidence; downstream
  R04/R05/R08/R09/R10/R11/R12/R13/R14/R15/R16/R18 remain `NOT_RUN`.
- C02, C03, C04, C05, C06, C07, C08A, C08B, C08C and C09 remain **NOT_RUN** and unopened.

## Leader review 02 — 11/09/2026

- Reviewed review-fix submission: code `0d15eb5`, docs `518644f`.
- Verdict vẫn **CHANGES_REQUESTED** tại [review-c01.md](review-c01.md).
- `C01-R1-01/03/04/05/06` CLOSED. `C01-R1-02` tiếp tục bằng `C01-R2-01` MAJOR:
  resolver phải phân biệt GET collection `/items` với POST-only và `/items/:id`.
- Worker chỉ sửa `C01-R2-01`, append REVIEW-FIX 02 và bàn giao lại. C02 chưa được mở.
- REVIEW-FIX 02 - 11/09/2026: Outcome `READY_FOR_LOCAL_REVIEW`; code `8e42856`; base review
  HEAD `f37c493`. `C01-R2-01` CLOSED: only static GET collection `/items` selects the business
  probe; POST-only `/items` and GET `/items/:id` fall back to `/health`. Evidence:
  `docs/evidence/tk-a17/c01/review-fix-02.md`. Focused `55/55`, typecheck/lint/format/build
  PASS; read-only VM02 seq `372→373`; no deploy/marker; C02 and later remain `NOT_RUN`.

## Leader review 03 — 11/09/2026

- Reviewed code `8e42856`, docs `9689ea4`; verdict **APPROVED** tại
  [review-c01.md](review-c01.md). `C01-R2-01` và toàn bộ finding C01 đã đóng.
- Reviewer focused 75/75, collector 26/26, typecheck/lint/format/build và VM02 read-only
  PASS; collector seq `1791→1792`, app B vẫn running.
- Mở duy nhất C02. C02 kế thừa offset 6152, 21 metric/105 score rows; không reset dữ liệu.
  C03–C09 tiếp tục đóng; chưa push/PR/merge và chưa DEMO_READY.
