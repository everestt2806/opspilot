# R7h-4d4 — PostgreSQL inspector release and real acceptance

START17/11/2026 — Base68d4ddd; d1/d2/backend/Main/IPC/UI local proofs passed. Current serving ce4d6711/4bc4590/schema37/UID997,8apps/2PG at last16/11 snapshot; obtain fresh pinned snapshot before any serving effect. Kim Windows-delivery lane untouched. Normal checkpoint pushes authorized; no PR/merge/reset/clean/stash/rebase/force. Formal ML remains NOT_RUN.

| Requirement | Evidence | State |
|---|---|---|
| Freeze current candidate | Two independent default-UID Linux builds: payload ade9e58a, release63d1dca7, installer e53521cc identical;998files/145382431bytes. Eleventh descriptor added after private gates; original10 pins preserved | PASS |
| Candidate verification | Source18/Root19/Main20; three Docker suites21attempts/43checks; full2678PASS+2existingLinuxSKIP; types/scripts/lint/format/build; packaged11 descriptors/5 tamper-missing checks/cleanup PASS. Frozen candidate proof linked below | PASS |
| Fresh serving authority | Read-only pinned snapshot17/11: app/.out-scripts/r7h4d4-readonly-baseline.json, ce4d/4bc/schema37,8apps/16CIDs/2PG1000rows each,0active/quiescent/allpaused. Re-attest in upgrade driver before serving effect | PASS |
| Protected upgrade | Actual Main a6725b98625c/UUID5461c398 active/current, release63d1/schema37/UID997.8apps16CIDs/2PG1000rows/source/env/key/Root35backup unchanged; same token/client refreshed then revoked; private profile removed | PASS |
| Actual inspector acceptance | Real Main enrollment transport -> installed Root/setpriv -> sameUID CLI -> pinned target SSH -> both PG instances: inspect/tables/rows10+100; wrong instance/limit101/missing table refused; full material unchanged. Service/UI positive own-receipt path NOT_RUN, explicitly outside this transport proof; no fabricated receipts | PASS |
| Handoff/checkpoint | Candidate/live proofs + raw/source hashes, full quality results, board and limits reconciled. Normal checkpoint commit/push authorized; SHA via git log below, Kim coauthor/lane preserved. Product backup/restore/migrate/formalML remain separate | PASS |

If the VPS is unreachable, state the actual failure and continue private release gates. No unverified host-key learning or bypass. Existing helper/runtime bytes unchanged since C5 may retain historical compatibility proof by exact hash; record which final-candidate native/runtime suites actually run, never relabel previous runs as fresh. Separate candidate approval from installation; no unchanged old-release pin may approve changed bytes.

UPDATE17/11 — First private Root run59f038e529ec reached14checks, then failed
`CONTROLLER_INSTALL_UPGRADE_PROCESS_CHANGED` while the intentionally faulty
candidate exited between MainPID and /proc attestation. Safe refusal retained;
fixture cleaned. Lab now inspects the same start_pending UUID/no activation before
up to five explicit rollback retries, never weakens production attestation or
creates a new intent. Running fresh Root + base37 Main gate. Native source/actual
Python administrator/SSH/PG proof2e247200e0e8 passed18checks. Fresh Docker matrix
Express+PG, Next+ENV+PG, SPA+ENV running sequentially; historical remaining C5
combinations may be cited only with exact unchanged helper/template hashes.

UPDATE17/11 ? Fresh Root8905beab194a19checks and Mainf58435f9789520checks PASS, including exact current37 parent and installed Root/setpriv inspector refusal before restart. Three fresh runtime suites passed43checks/21attempts with cleanup. Historical helper hashes/driver/template/collector/image pin match C5; current R1 bundle differs (new inspector code), so its other four historical combinations are not reported as current runs. Full184files/2678tests PASS+1file/2existingLinuxSKIP.

UPDATE17/11 ? Frozen candidate [proof](../ui-redesign/r7h4d4-candidate-verification.json) PASS before serving. Full2678+2existingLinuxSKIP (426.09s runner), production build/typechecks PASS, scripts typecheck/scoped lint/format PASS, compiled11/prior10 exact+five packaged/tamper/missing checks/cleanup PASS. Actual Main upgrade started using a6725b98625c/original UUID5461c398; independent public HTTP observer started before any controller transfer.

## HANDOFF17/11 — scoped checkpoint PASS, CHỜ REVIEW

- Serving now `63d1dca75f976d7cd06926ccf8f1407f221b505371cd32ea8132b39de8e01899`,
  payload `ade9e58a0d1a234dcc67b0e01724e8224fc4d4f7e36fa03f35ed6a37d410c167`,
  upgrade UUID `5461c398-27e4-48b8-82e0-0ca0663aa760`, same controller/original
  installation/UID997/schema37. All10 prior compiled descriptors retained.
- [Candidate proof](../ui-redesign/r7h4d4-candidate-verification.json): native
  source18/Root19/Main20, fresh Express+PG/Next+ENV+PG/SPA+ENV21attempts43checks,
  full184files2678PASS+1file/2existingLinuxSKIP, Node/Web/Scripts types, scoped
  lint/format/build, five actual packaged/tamper/missing checks and cleanup PASS.
- [Live proof](../ui-redesign/r7h4d4-live-verification.json):7checks actual Main
  protected upgrade/Root backup/real inspector transport/cleanup. Both named
  `opspilot` databases are selected by different UUIDs/CIDs/volumes/systemIDs;
  tables/columns/10- and100-row samples read successfully, three refusal cases per
  instance PASS. No raw samples persisted. Full1,000-row count/content digests,
  both PG identities, all16app/collector CIDs/starttimes/restarts, source/env/key,
  helper files/locks/journals and SQLite inode unchanged.
- Independent HTTP observer:32rounds x8ports, all200 during transfer/upgrade/reads;
  this reports sampled availability, not a mathematical zero-downtime guarantee.
  Final0active clients/jobs/experiments/leases/unsettled; policies paused as before,
  scoped client revoked, same token/client retained during refresh, private DB and
  DPAPI profile removed. Production Desktop profile untouched.
- **Limit:** positive live Service/UI own-current-selection-receipt acceptance
  remains NOT_RUN because earlier private app-creation profiles were deliberately
  removed. Real Main enrollment transport reads above do not bypass that guard or
  imply GUI proof. d3b actual Electron proof remains synthetic-transport-labelled.
  Next core checkpoint: explicit project/configuration reconnect authority+consent
  design and real GUI acceptance using a legitimate retained profile; never insert
  fake historical prepare/select receipts. This is separate from the already
  verified controller rollout. Product backup/restore/migrate/direct-upload DB,
  Kim clean-Windows delivery, soak and formal ML remain OPEN/separate.
- Kim-owned files untouched. Formal ML NOT_RUN (two dedicated matching VPS still
  absent). No PR/merge/reset/stash/clean/rebase/force; normal push only, Kim
  coauthor. Commit lookup: `git log -1 -- docs/ui-redesign/r7h4d4-live-verification.json`.

### Reproduction / evidence

Windows Node22: `. ./tools/enter-node22.ps1`; `pnpm --prefix app exec vitest run
--reporter=dot`; `pnpm --prefix app build`; `pnpm --prefix app exec tsc -p
tsconfig.scripts.json --noEmit`; scoped ESLint/Prettier on config, both changed
upgrade labs and `scripts/product-postgres-inspector-live`. Raw logs:
`app/.out-scripts/r7h4d4-{full,build,native-retry,runtime}.log` and resource JSON.

Private Linux/root Node22/systemd/Docker: `product-postgres-lab/selection.mjs`
with inspection gate and public source fixture; `controller-upgrade-lab/run.mjs
--postgres` (35->37), then `controller-upgrade-desktop-lab/run.mjs` with base37,
exact old4bc source and frozen63d1 candidate. Three sequential runtime lab modes:
`--postgres`, `--postgres --environment --nextjs`, `--environment --spa`.
Do not run Root and Main native labs concurrently (same private8768 port).

Live harness is intentionally pinned to the **old** serving parent and cannot be
rerun with `--start` after this rollout. Its settled PASS record/private profile
cannot resume. Keep raw a6725b98625c and hashes for audit; do not create replacement
upgrade UUIDs or weaken parent checks. Seven-file dedicated inspector live harness
leaves the historical C5 harness unchanged for reproducibility.
