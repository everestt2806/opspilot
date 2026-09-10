# Handoff C01 — TK-A17

## Identity and scope

- Chặng / outcome / branch / ngày: C01 / `READY_FOR_LOCAL_REVIEW` / `feat/a17-demo-checkpoint` / 11/09/2026.
- Base HEAD: `1b447e4` (C00 review commit); inherited C00 approved code `d4ec3be`, docs `23cd248`.
- Code/docs HEAD after C01 commit: `66cbdab`.
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
