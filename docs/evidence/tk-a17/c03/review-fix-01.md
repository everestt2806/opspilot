# TK-A17/C03 REVIEW-FIX 01

- Scope: C03 only. Base `c2d55ad`; review-01 submitted docs `dcbe3b5`; production changes are
  committed at `4396fb3`, `4140e47`, and `6ee83ca`. C04/C05 remain closed/`NOT_RUN`.
- Final live target: VM02 `221.121.1.80`, fresh workspaces `a17-c03-review01-final2-*`; existing A17,
  app B, and earlier C03 targets were read-only/preserved. No data reset, delete, or reassignment.

## Finding closure

| Finding | Closure | Regression/evidence |
| --- | --- | --- |
| C03-R1-01 | CLOSED | `detectors.test.ts`: dependency-only Next/Express, devDependency-only Vite, malformed/routing matrix, and Next-over-Vite / Vite-over-Express priority cases. `needsDb`, versions and explain signals use the same contract sections. |
| C03-R1-02 | CLOSED | `templates.test.ts` and live BUILD evidence cover generated public keys, default/override values, shell-safe spaces and `$`, empty build-arg branch, no duplicate `npm ci`, and Next `public/` runtime copy. Final live logs show `NEXT_PUBLIC_SITE_NAME=OpsPilot C03 Next` and `VITE_API_URL=http://221.121.1.80:30012`. |
| C03-R1-03 | CLOSED | `c03-live.ts` records per-deployment event slices and exact seven-step sequence, structured Docker/HTTP/collector records, durable profile path, `app:list`-equivalent service read, and SQLite close/reopen proof. Raw structured output: `live-structured-final.json`; profile: `profile-final2/`. |
| C03-R1-04 | CLOSED | SSH local-forward proof from the demo machine is in `demo-tunnel.txt`; Express, Next.js and Vite each returned HTTP 200 with recognizable content, then the tunnel process exited cleanly. |

## Local gates

All commands ran after the production fix in `D:\Developing\DuAnCNTT\app` unless noted:

| Command | Runtime/result |
| --- | --- |
| `pnpm exec vitest run --maxWorkers=1 src/main/detectors/detectors.test.ts src/main/deploy/templates.test.ts src/main/deploy/pipeline.test.ts src/main/deploy/service.test.ts` | Node 24.16.0 / `61 passed`, exit 0 |
| `..\\ml-service\\.venv\\Scripts\\python.exe -m pytest -q` | `collector`, Python venv / `26 passed`, exit 0 |
| `pnpm typecheck` | node + web TypeScript, exit 0 |
| `pnpm exec tsc -p tsconfig.scripts.json --noEmit` | scripts TypeScript, exit 0 |
| scoped `pnpm exec eslint ...` | changed C03 files, exit 0 |
| scoped `pnpm exec prettier --check ...` | changed C03 files, exit 0 |
| `pnpm build` | renderer transformed 3045 modules, exit 0 |

## Controlled live proof

- Command: `pnpm exec tsc -p tsconfig.scripts.json; node scripts/prepare-cli.js; node .out-scripts/scripts/c03-live.js`, cwd `app`, final exit 0.
- Final SQLite profile `profile-final2/opspilot.db` was closed and reopened. `app:list`-equivalent
  read returned Express app 13/current deployment 2 with deployments 1,2; Next app 14/current 3;
  Vite app 15/current 4. No temporary DB deletion was performed.
- Express: deployments 1 -> 2, port 30012, image `a17-c03-review01-final2-express:v2`, Docker
  `running/healthy`, HTTP 200, collector `running`, restart count 0. Marker
  `c03-marker-1789230057851` was created before redeploy and found after redeploy in
  `express-marker-proof.json`.
- Next.js: deployment 3, port 30013, image `a17-c03-review01-final2-next:v1`, Docker
  `running/healthy`, HTTP 200, collector `running`, restart count 0.
- Vite SPA: deployment 4, port 30014, image `a17-c03-review01-final2-vite:v1`, Docker
  `running/healthy`, HTTP 200, collector `running`, restart count 0.
- Every final attempt asserted `PRECHECK -> UPLOAD -> RENDER -> BUILD -> DEPLOY -> HEALTHCHECK ->
  RECORD`. The final raw output and failed retries are retained in this directory.

## Failure ledger

| Attempt | Result | Evidence |
| --- | --- | --- |
| `live-attempt-01` | SSH manager received a key path instead of key contents; fail-closed at PRECHECK, no target mutation. | `live-attempt-01.txt` |
| `live-attempt-02` | Same SSH parse error because the generated script artifact had not yet been rebuilt; no target mutation. | `live-attempt-02.txt` |
| `live-attempt-03` | Correct SSH, but stale port 30006 was detected at PRECHECK; no target mutation. | `live-attempt-03.txt` |
| `live-attempt-04` | Full pipeline retry succeeded on `a17-c03-review01-retry3-*`; retained as intermediate proof. | `live-attempt-04.txt` |
| `live-attempt-05` | Stale port 30009 detected at PRECHECK; no target mutation. | `live-attempt-05.txt` |
| `live-attempt-06` | Final2 full matrix succeeded, exit 0. | `live-attempt-06.txt`, `live-structured-final.json` |

## Review result

- C03-R1-01 through C03-R1-04: `CLOSED`.
- Outcome: `READY_FOR_LOCAL_REVIEW`; Worker does not self-approve C03 and does not open C04.
- C04/C05 and later, ML, monitor/fault/recovery, Flask, app B mutation, push, PR and merge:
  `NOT_RUN`.
