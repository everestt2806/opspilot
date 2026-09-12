# TK-A17/C02 review-09 coverage audit

Reviewed `deb69b9..8fe4842`; submitted documentation HEAD was `d65ead7`.

The production implementation closes the two review-08 blockers. `reconcilePrepared()` reloads the
current prepared episode under the app lock, checks the source boundary, and uses resolved runtime
lineage. `activateAndPoint()` commits the previous close, candidate activation, and current deployment
pointer in one SQLite transaction. The injected pointer failure and retry test passes.

The submitted evidence overstates committed recovery coverage. The code diff adds one test and extends
one existing test. Those tests cover multi-level candidate lineage with close/reopen and a second tick,
plus a short source, injected pointer failure, and retry. The cycle test predates this review and does
not contain a missing-lineage case despite its title.

No committed reconciliation test exercises stale prepared-row replacement, missing lineage, active
previous owner through rollback lineage, previous-owner abort, wrong runtime image, missing/down
collector, missing/mismatched snapshot, SSH failure followed by reconnect, exact boundary versus
boundary-minus-one, or a subsequent deploy-visible workflow. These cases are listed as PASS in
`review-fix-08.md`, so R8-03 remains incomplete even though source inspection finds the intended guards.

No live mutation or temporary reviewer test was run. Existing deployment 20/21 read-only evidence and
its `416+5=421` / `2080+25=2105` arithmetic remain accepted.
