# C03 deploy matrix

- Scope: TK-A17/C03 only. Branch `feat/a17-demo-checkpoint`; base `c2d55ad`; code commit
  `c149291`; no C04/C05 work. Untracked `.devflow/`, `docs/ban-giao-20-08.md`, and `logo.png`
  were preserved.
- Target: VM02 `221.121.1.80`, user `deploy`, target-only names `a17-c03-final-*`; app B was only
  read-only inventory. The existing A17 app on port `30000` and B app on `30001` were preserved;
  allocator selected `30006..30008` after read-only port checks.

## Matrix

| Source | Detector / plan | SQLite deployment | Runtime image / port | Docker / HTTP / collector |
| --- | --- | --- | --- | --- |
| Express + PostgreSQL | `express`, `express.Dockerfile`, `node server.js`, `/health`, DB | app `7`, v1 `1`, v2 `2`, current `2` | `a17-c03-final-express:v2`, `30006:3000` | `running/healthy/restart 0`, HTTP `200`, collector `running/0` |
| Next.js | `nextjs`, `nextjs.Dockerfile`, `npm start`, `/` | app `8`, v1 `3`, current `3` | `a17-c03-final-next:v1`, `30007:3000` | `running/healthy/restart 0`, HTTP `200`, collector `running/0` |
| Vite SPA | `static-spa`, `static-spa.Dockerfile`, Nginx `/` | app `9`, v1 `4`, current `4` | `a17-c03-final-vite:v1`, `30008:80` | `running/healthy/restart 0`, HTTP `200`, collector `running/0` |

Every successful attempt emitted the exact pipeline sequence `PRECHECK -> UPLOAD -> RENDER ->
BUILD -> DEPLOY -> HEALTHCHECK -> RECORD -> finished:running`. Express v1 and v2 both passed the
sequence; Next v1 and Vite v1 passed it once.

## PostgreSQL proof

- Express marker `c03-marker-1789207558316` was created through the deployed API after v1.
- Read-only query after v2 redeploy at `http://127.0.0.1:30006/items?limit=10&offset=1000` returned
  the marker, proving the PostgreSQL-backed row survived redeploy. The API caps one page at 1000,
  so the offset is intentional.
- Final read-only checks returned HTTP `200` for Express `/health`, Next `/`, and Vite `/`.

## Failure ledger

| Attempt | Failure | Recovery / retained evidence |
| --- | --- | --- |
| `a17-c03-express` | PRECHECK rejected remote port `30000`, already owned by A17 | No target mutation; raw `PRECHECK_FAILED` retained in command output |
| `a17-c03-express` rerun | Reused workspace with a fresh temporary DB credential; PostgreSQL health failed with `28P01` | Pipeline failed closed and kept the failed workspace; raw DEPLOY logs retained |
| `a17-c03-0912b-next` | Next runtime used `next start` directly and exited `127` (`next: not found`) | Fixed detector plan to emit `npm start`; rerun succeeded as `a17-c03-final-next` |
| `a17-c03-final-*` | All three source deploys and Express redeploy | PASS; no failure evidence removed |

## Local gates

- `app`: `pnpm exec vitest run --maxWorkers=1 src/main/detectors/detectors.test.ts src/main/deploy/templates.test.ts src/main/deploy/pipeline.test.ts src/main/deploy/service.test.ts` -> exit `0`, 4 files / 55 tests.
- `collector`: `..\\ml-service\\.venv\\Scripts\\python.exe -m pytest -q` -> exit `0`, 26 passed.
- `app`: `pnpm typecheck` -> exit `0`; `pnpm exec tsc -p tsconfig.scripts.json --noEmit` -> exit `0`;
  scoped ESLint -> exit `0`; scoped Prettier -> exit `0`; `pnpm build` -> exit `0`, renderer 3045 modules.
- ML tests were not run because C03 explicitly defers ML train/score/runtime work.

## Final state

- Final target apps, PostgreSQL, and collectors are healthy/running. Existing A17 app/DB/collector
  remained untouched; app B was not used as a success signal.
- C03-T1 through C03-T7: PASS. C04 and C05: `NOT_RUN`; no ML, monitor, fault, Flask, push, PR or merge.

## Leader review 01 override

Đây là evidence Worker đã nộp, không phải verdict cuối. Review độc lập tại code `c149291`, docs
`dcbe3b5` có verdict **CHANGES_REQUESTED**: contract regression 0/5, live SQLite provenance không còn
sau khi harness xóa DB tạm, và ba public URL timeout. C03 hiện `REVIEW_FIX_REQUIRED`; xem
[`review-c03.md`](../../../tasks/tk-a17/review-c03.md) và [`review-01`](review-01/).
