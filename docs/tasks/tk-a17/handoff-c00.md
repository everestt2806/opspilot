# Handoff C00 — TK-A17

## Identity và phạm vi

- Chặng / outcome / branch / ngày: C00 / `READY_FOR_LOCAL_REVIEW` / `feat/a17-demo-checkpoint` / 11/09/2026.
- Base SHA: `683bfc6` (code baseline); kế hoạch đầu vào `ac6d8cd`; code HEAD đầu lượt `bf951f9`.
- Code HEAD sau commit: `d4ec3be`; docs HEAD: `d4ec3be`.
- Review chặng trước: không có; C00 là gate đầu tiên.
- Scope: runtime/native ABI, focused baseline, SSH read-only inventory, target manifest, app boot/browser boundary. Không sửa `app/` source, collector, contract, pipeline, ML hoặc renderer.
- Untracked `.devflow/`, `docs/ban-giao-20-08.md`, `logo.png` và stash của A được giữ nguyên.

## Commit và file

- Commit list: `d4ec3be` — Record verified C00 runtime, read-only inventory, target manifest,
  evidence and local handoff; downstream stages remain NOT_RUN.
- File C00: `docs/evidence/tk-a17/c00/`, `docs/tasks/tk-a17/handoff-c00.md`, task log/board; helper đã rà soát gồm `tools/a17-c00-native.cjs`, `tools/a17-c00-boot.cjs`, `tools/a17-c00-inventory.py`.
- Diff scope: chỉ artifact/evidence/task records C00; không stage file ngoài danh sách.

## Case evidence

| Case | Command/cwd/runtime | Exit/count | Status | Evidence |
| --- | --- | --- | --- | --- |
| C00-T1 | Native probes via Node 22/Electron 39; runtime paths trong `baseline.md` | 0; SQLite 3.53.4 | PASS | `docs/evidence/tk-a17/c00/native-node22.json`, `native-electron-cli.json`, `native-electron.json` |
| C00-T2 | Focused Vitest, collector pytest, typecheck, build | 64/64; 26/26; 0; 0 | PASS | `docs/evidence/tk-a17/c00/*-worker*`, `build-worker.txt` |
| C00-T3 | `tools/a17-c00-inventory.py` read-only SSH | VM02 0; VM01 255 timeout | PASS + limitation | `docs/evidence/tk-a17/c00/ssh-vps-2.json`, `ssh-vps-1.json` |
| C00-T4 | SQLite mode=ro + VM02 ownership/experiment inventory | app 0; running experiments 0; target FREE | PASS | `docs/evidence/tk-a17/c00/manifest.md`, `local-inventory.json` |
| C00-T5 | Electron boot + browser/tunnel boundary | boot 0; Chrome 0; public curl 28 | PASS + limitation | `docs/evidence/tk-a17/c00/boot.json`, `tunnel.json`, `public-http.json` |

## R mapping

- R01: PASS for A-solo/Worker boundary; no B or teacher operation required — handoff scope and task log.
- R19: PASS for target isolation and preservation of app B/experiments — `manifest.md`, T3/T4 evidence.
- R20: PASS for one-chặng handoff and review gate — this file and handoff registry.
- R21: PASS; local test/commit only, no push/PR/merge/subagent — git command log and final status.
- R22: PASS; no contract/dependency/source behavior changed — scoped diff.
- R23: PASS for C00 command/count/exit evidence; C09 video/rehearsal NOT_RUN.
- R24: PASS for public timeout vs SSH tunnel distinction — T5 evidence; tunnel is app B only.
- R25: PASS; only C00 executed, downstream marked NOT_RUN.
- R02–R18: NOT_RUN in C00; these require C01–C09 live implementation/evidence.

## DoD and downstream status

- [x] T1–T5 evidence is linked, with corrected runtime/cwd/exit details.
- [x] Manifest is proposed only; no app ID/port/deployment is invented.
- [x] App B, VPS and experiment state are reported after checks; no mutation performed.
- [ ] A17 website, collector, ingestion, ML train/score, fault, alert, rollback, auto-recovery: NOT_RUN.
- C01, C02, C03, C04, C05, C06, C07, C08A, C08B, C08C, C09: **NOT_RUN** and remain closed until Leader review.

## Current state, blockers and next gate

- Laptop: build/test complete; local ML was started only by boot smoke and shut down normally.
- VM02: app B and collector remain running/healthy, restart count 0; target path/container/network remain absent.
- VM01: TCP/22 timeout is a limitation for the unused alternate VPS, not a blocker for proposed VM02 target; no auth claim made.
- Public VM02 port 30001: timeout from this client; presentation fallback was loopback SSH only and showed app B. A17 public/browser path is not yet available and is a C01/C04/C09 concern.
- No credential blocker for VM02. C01 requires Leader approval of this manifest and allocator/service-issued app/port/deployment IDs.

## Commands and evidence index

- Repo: `D:\Developing\DuAnCNTT`; app checks from `app`; collector tests from `collector`.
- Runtime: Node 22.23.2 / pnpm 11.1.0; Python venv; Electron 39.8.10.
- Pre-commit checks: `git diff --check`, `git status --short`, `git diff --stat`.
- Evidence root: `docs/evidence/tk-a17/c00/`; full command output and generated JSON are retained there.
- CHƯA PUSH — CHƯA PR — CHƯA MERGE.

## Reviewer handoff

Leader review needed for native ABI interpretation, VM02 target ownership, VM01/public network limitations, and permission to open C01. `READY_FOR_LOCAL_REVIEW`; Worker stops here.
