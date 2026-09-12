# TK-A17/C05 reviewer evidence

- Review date: 2026-09-13 (Asia/Bangkok).
- Rehearsal SHA `936e643`; submitted docs `e21ba1c`; ancestry PASS.
- Independent Node suite: 50 files / 287 tests PASS in 117.22 seconds.
- Independent ML service: 19/19 PASS. Independent collector: 26/26 PASS.
- SQLite jobs 25, 26, 27 and 28: all completed, `source_kept=1`, correct target ownership, no active migration.
- Rehearsal-02 apps Express/Next/Vite and migration source/target runtime: SSH read-only running/healthy,
  HTTP 200; collectors running.
- Git-tracked evidence includes README, deploy JSON/log and migrate log for both rehearsals.
- Secret-pattern scan across C05 evidence: no match.
- Node 22 unavailable; independent and Worker gates used Node 24.16.0.
- Reviewer performed no live mutation.

Verdict: **DEMO_READY** for the scoped 14/09 deploy-and-migrate presentation.
