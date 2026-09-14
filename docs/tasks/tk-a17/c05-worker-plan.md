# TK-A17/C05 — Worker plan rehearsal demo 14/09

> **OPEN.** Run as one long goal from the HEAD containing Leader Review 05. Do not reopen C04 hardening unless a
> rehearsal produces a reproducible demo blocker.

## Outcome

Produce one frozen local SHA and two consecutive 6–8 minute rehearsals for:

1. explaining and showing Express, Next.js and Vite deployment through the shared pipeline;
2. migrating Vite stateless and Express/PostgreSQL from VM02 to VM01 with `keepSource=true`;
3. showing checksum/files, PostgreSQL rows/marker, runtime/HTTP, source-kept and history;
4. stating that ML remains under development/data collection and is deferred until at least 28/09/2026.

## One-goal execution order

1. Read `c05-demo-14-09-acceptance.md`, `docs/25-nguyen-ly-deploy-migrate-demo-14-09.md` and current C03/C04
   handoffs. Check Git identity and both VPS read-only. Stop only for an external connectivity/credential blocker.
2. Run the full Node suite sequentially on Node 22 if available, scripts typecheck, lint/Prettier and production
   build. Do not change dependency/contract/schema. If Node 22 is unavailable, record exact installed version and
   continue; do not claim the Node 22 gate.
3. Create `docs/26-kich-ban-demo-deploy-migrate-14-09.md`: exact spoken script, clicks, expected screens, URLs,
   timing per segment, fallback/tunnel commands, recovery decision tree and the approved ML deferral sentence.
4. Rehearsal 1 from a clean app launch. Use real UI/events and actual credentials. Capture duration, exact SHA,
   deploy proof for all three Tier 1 apps, Vite then PostgreSQL migration proof, tunnel/public path and final state.
5. Fix only reproducible blockers that prevent this demo path; add focused regression and rerun affected gates.
   Do not implement C04-D1…D4 opportunistically.
6. Rehearsal 2 from a fresh app launch on the final SHA with new target/job IDs. It must complete without manual
   DB edits, pointer repair, hidden helper mutation or unexplained retry. Assert both source and target apps plus
   collectors healthy, PostgreSQL marker/rows, checksums, ownership and no active migration/helper/tunnel left.
7. Save scrubbed raw evidence under `docs/evidence/tk-a17/c05/rehearsal-01/` and `rehearsal-02/`; create
   `handoff-c05.md`. Update board/task with exact commands, counts, durations, failures/retries and final IDs.

## Guardrails and verdict

- Do not touch app B, C02 data, ML train/score, monitor/fault/recovery, contracts, dependencies or protected
  untracked files. Do not push, open PR, merge or spawn subagents.
- Preserve existing jobs/apps as history. Cleanup only resources created by C05, only when the runbook requires
  it and after replacement health is proven; record every cleanup.
- Handoff `READY_FOR_LOCAL_REVIEW` only after two consecutive rehearsals on the final SHA. Otherwise hand off
  `BLOCKED` with the exact failed step and safe current state. Only Leader may issue `DEMO_READY`.

## Prompt to run

```text
Thực hiện duy nhất TK-A17/C05 từ HEAD chứa Leader Review 05 theo
docs/tasks/tk-a17/c05-worker-plan.md, trong một goal dài tới READY_FOR_LOCAL_REVIEW hoặc external BLOCKED.
Chạy full gate, viết runbook demo, rồi hai rehearsal liên tiếp trên final SHA. Chỉ sửa blocker demo tái hiện được;
không mở hardening C04-D1…D4, ML hay chặng khác. Không push/PR/merge/subagent và giữ protected untracked files.
```
