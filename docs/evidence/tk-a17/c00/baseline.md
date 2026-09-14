# C00 baseline evidence

Ngày thực hiện: 11/09/2026 (Asia/Bangkok). Branch `feat/a17-demo-checkpoint` tại lúc bắt
đầu `bf951f9`; baseline code theo task là `683bfc6`; kế hoạch 11/09 được kế thừa từ
`ac6d8cd`. Các file `*-worker*` là lượt chạy Worker; các raw file khác là artifact được
kiểm tra lại từ preflight hoặc do helper tạo trong lượt này.

## C00-T1 — runtime/native database

- Node executable: `C:\Users\everestt28\AppData\Local\pnpm\bin\node.exe`, `v22.23.2`, ABI 127.
- pnpm: 11.1.0.
- Python executable: `D:\Developing\DuAnCNTT\ml-service\.venv\Scripts\python.exe`, Python 3.12.10 theo environment preflight; pytest chạy được ở collector.
- Electron: 39.8.10, embedded Node `v22.22.1`, ABI 140.
- better-sqlite3 in-memory probe: SQLite 3.53.4, Node 22 và Electron CLI/GUI exit 0.
- Evidence: `native-node22.json`, `native-electron-cli.json`, `native-electron.json`.
- Result: PASS.

## C00-T2 — baseline tests/build

| Check | Command/cwd/runtime | Result | Evidence |
| --- | --- | --- | --- |
| Focused | `pnpm exec vitest run --maxWorkers=1 src/main/deploy src/main/monitor` / `app` / Node 22 | 12 files, 64 tests, exit 0 | `focused-tests-worker.txt` |
| Collector | `..\ml-service\.venv\Scripts\python.exe -m pytest tests -q` / `collector` / Python venv | 26 passed, exit 0 | `collector-tests-worker-corrected.txt` |
| Typecheck | `pnpm typecheck` / `app` / Node 22 | exit 0 | `typecheck-worker.txt` |
| Build | `pnpm exec electron-vite build` / `app` / Node 22 | 3045 renderer modules, exit 0 | `build-worker.txt` |

An initial Worker attempt used the wrong relative runtime path from `app` and is not counted
as a pass; the corrected commands above were run with explicit Node 22/Python venv. A separate
initial collector capture used root cwd and returned no tests; it was corrected from `collector`
and is retained as a truthful correction, not a pass.

Result: PASS for the corrected checks.

## C00-T3 — SSH and VPS read-only gate

- VM02 SSH with `BatchMode=yes`, strict host key checking and A's configured identity: exit 0.
- Docker 29.7.2, Compose v5.5.0; available RAM reported 3280 MiB and disk 31716 MiB.
- `experiment_process_count=0`; existing app B `/health` returned 200 locally on VM02.
- VM01 TCP/22 timed out, exit 255; no authentication conclusion was made.
- Evidence: `ssh-vps-2.json`, `ssh-vps-1.json`, `local-inventory.json`.
- Result: PASS for planned VM02 read-only gate; VM01 is a documented limitation.

## C00-T4 — ownership/manifest/experiment safety

- Local SQLite read-only inventory: two VPS records, zero app records, zero running experiments.
- VM02 target path/container/network `a17-notes-0911` were free.
- Existing `express-demo-*` containers and metrics were only listed/health-probed; no mutation.
- Evidence: `manifest.md`, `local-inventory.json`, `ssh-vps-2.json`.
- Result: PASS.

## C00-T5 — app/browser entry and network boundary

- Boot command: `pnpm exec electron ..\tools\a17-c00-boot.cjs` from `app`, after Node 22 activation; exit 0.
- Real built renderer loaded `file:///D:/Developing/DuAnCNTT/app/out/renderer/index.html`, ML local status was running, and 28 CDP screencast frames were received.
- Public `http://221.121.1.80:30001/` timed out, curl exit 28. Loopback tunnel to existing app B returned 200 and Chrome screenshot exit 0.
- The screenshot/tunnel are app B evidence only; they do not establish A17 website readiness. C09 still needs real A17 video.
- Evidence: `boot.json`, `website-browser.json`, `tunnel.json`, `website-via-ssh.png`, `public-http.json`.
- Result: PASS for local app boot and documented presentation boundary; A17 website NOT_RUN.

## Scope status

- C01–C09: NOT_RUN. No deploy, collector installation, ingestion, ML training/score,
  A17 website, alert, rollback or automatic recovery was performed.
- App A17: not deployed; ML local boot process was cleaned up by normal app shutdown.
- App B: running state preserved; no reset/restart/fault was issued.
- VPS target: no workspace/container/network was created.
