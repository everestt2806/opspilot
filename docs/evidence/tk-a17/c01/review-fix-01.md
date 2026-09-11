# C01 REVIEW-FIX 01 - Evidence

Date: 2026-09-11. Target only: VM02 id=2, `deploy@221.121.1.80`, workspace
`/opt/opspilot/a17-notes-0911`, slug `a17-notes-0911`. App B was not operated and no
SQLite/VPS data was reset.

## Gates

- Code fix commit: `0d15eb5`; current docs commit is the commit containing this file.
- `pnpm exec vitest run --maxWorkers=1 src/main/deploy src/main/detectors` / `app`: 6 files,
  53 tests, exit 0.
- `..\ml-service\.venv\Scripts\python.exe -m pytest tests -q` / `collector`: 26 passed,
  exit 0.
- `pnpm typecheck` / `app`: node and web exit 0.
- Scoped ESLint for changed TS files / `app`: exit 0.
- Prettier check for changed TS/CJS/YAML files / `app`: exit 0.
- `pnpm exec electron-vite build` / `app`: 3045 renderer modules, exit 0.
- `pnpm exec electron-builder --dir --config electron-builder.yml --config.asar=false
  --config.npmRebuild=false` / `app`: exit 0. Unpacked proof:
  `app/dist/win-unpacked/resources/collector/collect.py` and
  `app/dist/win-unpacked/resources/collector/Dockerfile` exist, with `tests/` and
  `requirements.txt` present.
- `node tools/a17-c01-live-regression.test.cjs` / repo root: exit 0.

## Live evidence

- Read-only preflight before deploy confirmed VM02/workspace; app v7 and DB were healthy,
  collector was the previously observed exited container, and no experiment process was
  present. The helper did not inspect or operate app B.
- `pnpm exec electron ..\tools\a17-c01-live.cjs` / `app`, Electron 39.8.10: outcome checks
  passed, deployments v8 and v9 were `running`, and helper exit was 0. The helper sets
  `OPSPILOT_C01_DEPLOY_ONLY=1`, disabling scheduler and ML startup.
- PostgreSQL marker POST returned id `1004`; v2 `/meta` reported PostgreSQL and records
  `1004`; current image was `a17-notes-0911:v9` on port `30000`.
- Independent SSH checks after helper exit at UTC `01:44:37`, `01:44:51`, and `01:45:04`
  reported collector `running|0|0`, app v9 running, and DB running. JSONL seq increased
  `105,106,107,108,109` across the snapshots.

## Finding closure

| Finding | Regression/evidence | Status |
| --- | --- | --- |
| C01-R1-01 | Packaged `extraResources`, `process.resourcesPath` resolver, unit test, and unpacked artifact proof. | CLOSED |
| C01-R1-02 | Source-verified Express `/items` route, health fallback, and restore compose path preservation; live A17 rendered `/items?limit=1`. | CLOSED |
| C01-R1-03 | Cleanup checks pre-existing tags; app-build-fail regression proves existing collector tag is retained. | CLOSED |
| C01-R1-04 | Post-helper VM02 state and seq proof above. | CLOSED |
| C01-R1-05 | Deploy-only helper flag skips scheduler/ML; native regression passes. Existing SQLite rows retained; no C02 operation. | CLOSED |
| C01-R1-06 | Handoff appends exact fix provenance without rewriting the historical submission. | CLOSED |

C01-T1 through C01-T7 are PASS as mapped in `docs/tasks/tk-a17/handoff-c01.md`.
R01/R02/R06/R07/R17/R19/R20/R21/R22/R23/R24/R25 are mapped by the C01 evidence and this
file. R04/R05/R08/R09/R10/R11/R12/R13/R14/R15/R16/R18 remain downstream/NOT_RUN.
C02, C03, C04, C05, C06, C07, C08A, C08B, C08C and C09 remain `NOT_RUN` and unopened.
