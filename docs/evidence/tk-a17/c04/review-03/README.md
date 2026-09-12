# TK-A17/C04 reviewer evidence — review 03

## Identity and independent gates

- Review date: 2026-09-13 (Asia/Bangkok).
- Base `611cb64`; submitted `f9fcfb5`; ancestry PASS.
- Exact Worker focused command rerun independently: 6 files / 49 tests PASS.
- `pnpm typecheck`: node/web PASS. No C04 live mutation was run by the reviewer.

## Read-only persisted state

SQLite after jobs 21/22:

| App               | VPS | Current deployment | Deployment owner | Status  |
| ----------------- | --- | ------------------ | ---------------- | ------- |
| source Express 16 | 2   | 39                 | 16               | running |
| source Vite 18    | 2   | 41                 | 18               | running |
| target Vite 23    | 1   | 46                 | 23               | running |
| target Express 24 | 1   | 47                 | 24               | running |

- Job 20 is `rolled_back`; jobs 21/22 are `completed`, `source_kept=1`.
- Job 21 recorded 22,704 transferred bytes and matching artifact SHA.
- Job 22 recorded 30,925 transferred bytes, matching artifact SHA, `items` 1001 -> 1001 and marker match.

Read-only SSH through the actual OpsPilot userData credential resolver:

| Runtime             | Result |
| ------------------- | ------ |
| VM02 source Vite    | `v1    | running | healthy`, HTTP 200 |
| VM02 source Express | `v2    | running | healthy`, HTTP 200 |
| VM01 target Vite    | `v1    | running | healthy`           |
| VM01 target Express | `v1    | running | healthy`           |

This closes the concrete source-pointer/source-runtime incident from R2-01 and accepts jobs 21/22 as two live
happy-path proofs.

## Remaining review evidence

- Diff `611cb64..f9fcfb5` changes one migrate test by 11 lines; focused count remains 49. There is no relay,
  state-machine failure/restart or renderer test.
- No renderer, preload/shared IPC API, migration repository or deploy pipeline file changed.
- RESTORE still invokes the regular local-source deploy pipeline after extracting the relayed archive, overwriting
  the authoritative payload path/config and starting app before PostgreSQL restore.
- Relay output completion listener is attached only after source completion, leaving an output-close race.
- `review-fix-02/` contains only `README.md`; the claimed raw event ledger is not committed.

The full findings and one-goal Worker instructions are in Review 03 of
[`review-c04.md`](../../../../tasks/tk-a17/review-c04.md).
