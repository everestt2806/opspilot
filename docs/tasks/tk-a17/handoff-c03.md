# Handoff C03 - TK-A17

## Outcome

- `READY_FOR_LOCAL_REVIEW`; scope is only C03. Branch `feat/a17-demo-checkpoint`.
- Base `c2d55ad`; code `c149291`; submitted docs commit is recorded after this append.
- C02 review-10 was approved before starting. C04/C05 remain `NOT_RUN`.

## Implementation

- Added pure priority-30 Next.js and priority-20 Vite SPA detectors; Express remains priority 10.
- Added `templates/nextjs.Dockerfile` and `templates/static-spa.Dockerfile`; both are rendered by
  the existing shared `DeployPipeline`.
- Build-time `NEXT_PUBLIC_*` and `VITE_*` values are passed as Docker build args; runtime secrets
  remain in the generated `.env` path.
- Added `scripts/c03-live.ts` and registered it in `tsconfig.scripts.json` for the controlled VM02
  matrix. No new dependency or contract/schema change.

## C03 mapping

| Item | Evidence / result |
| --- | --- |
| C03-T1 | Detector matrix tests and live DTOs identify Express, Next.js and Vite correctly; Flask untouched. |
| C03-T2 | Template tests render all three Dockerfiles without placeholders; live BUILD succeeded for all three. |
| C03-T3 | Express pipeline v1/v2 succeeded; PostgreSQL marker survived redeploy; deployment IDs 1/2 in temporary SQLite. |
| C03-T4 | Next pipeline deployment 3 succeeded, image `a17-c03-final-next:v1`, port 30007, Docker health and HTTP 200. |
| C03-T5 | Vite pipeline deployment 4 succeeded, image `a17-c03-final-vite:v1`, port 30008, Nginx health and HTTP 200. |
| C03-T6 | All sources used the same PRECHECK/UPLOAD/RENDER/BUILD/DEPLOY/HEALTHCHECK/RECORD pipeline; collectors running/restart 0. A17 and B were not mutated. |
| C03-T7 | Focused/static/build gates pass; live harness closed SSH/database cleanly. |

## Commands and counts

- cwd `app`, Node 24.16.0/pnpm 11.1.0: focused command in evidence -> exit 0, 4 files/55 tests.
- cwd `collector`, Python `ml-service/.venv`: pytest -> exit 0, 26 passed.
- cwd `app`: node/web typecheck, scripts typecheck, scoped ESLint, scoped Prettier and build -> all
  exit 0; renderer build transformed 3045 modules.
- Live command: `pnpm exec tsc -p tsconfig.scripts.json; node scripts/prepare-cli.js; node
  .out-scripts/scripts/c03-live.js`, cwd `app`, key-auth SSH to VM02; final exit 0. The raw failed
  attempts remain in terminal/evidence ledger and were not used as PASS.

## Live mutation ledger

- Target workspace names: `a17-c03-final-express`, `a17-c03-final-next`, `a17-c03-final-vite`.
- Express SQLite: app 7, deployment 1 then 2, current 2, image v2, port 30006; marker
  `c03-marker-1789207558316` remained after redeploy.
- Next SQLite: app 8, deployment 3, current 3, image v1, port 30007.
- Vite SQLite: app 9, deployment 4, current 4, image v1, port 30008.
- Final read-only Docker proof: all six app/collector containers `running`, app health `healthy`,
  restart count `0`; HTTP `200` for all three app routes.
- Existing A17 app on 30000 and B app on 30001 were not operated; no reset/delete/reassign occurred.

## Deferred scope

- C04 migrate, C05 rehearsal, ML train/score, monitor/fault/recovery, Flask, UI, app B mutation,
  push, PR and merge: `NOT_RUN`.

Evidence: [`deploy-matrix.md`](../../evidence/tk-a17/c03/deploy-matrix.md).
