# C02 review 03 — implementation analysis

## Reviewed payload

- Approved design review: `a8cfd34`.
- Code: `ce1a9ff`.
- Submitted HEAD: `0e7d207` (`2c0abb7` is the handoff payload commit, followed by the final
  provenance commit).
- The ancestry check passed. The diff contains 20 files and changes production deployment,
  monitoring, SSH and database paths.

## Findings reproduced from source and tests

### First deployment cannot establish a boundary

`DeployPipeline.executeLocked()` calls `prepareActivation()` after build and before
`stepDeploy()`. `prepareActivationFor()` immediately calls `ssh.fileSize()` and then
`fileIdentity()` for `/opt/opspilot/<app>/metrics/metrics.jsonl`. On a new app the collector has
never run, so that file does not exist. The reviewer regression makes only that file return
`ENOENT`; the deployment finishes `failed` before `docker compose up -d`.

The existing pipeline stub always returns size `10` for every path, so the normal “deploy mới”
test hides the missing-file state. The temporary regression and failure output are recorded in
`new-app-regression.test.ts.txt`; the tracked test file was restored afterward.

### The approved cutover barrier is absent

The approved amendment requires the shared app lock, then collector stop/flush, then a stable
identity and `size + 1` snapshot, followed by runtime cutover. The implementation has the shared
lock and `size + 1`, but it never stops or flushes the collector. Searches for a collector stop in
the pipeline return no command. It also reads size and identity through two separate SSH calls
without checking that the identity remained stable around the size read.

Therefore a line appended by the old collector after `fileSize()` and before `compose up` falls
at or after the candidate boundary and is routed to the candidate deployment. The same race exists
when preparing auto/manual rollback. The live run does not disprove the race; it only shows that
the observed sequence ranges happened to be contiguous.

### Rotation always drops an unread old-generation suffix

When generation changes, `MonitorPoller` calls `ActivationRepository.rotate()` with the current
cursor. `rotate()` closes the old episode at that cursor, resets `metrics_offset` to `1`, creates a
new-generation activation and always logs a data gap. Neither `MetricSource` nor the poller opens
`metrics.jsonl.1`, compares its identity with the stored old generation, or drains from the old
cursor to the rotated file end.

This implements only the “explicit gap when recovery is impossible” half of the approved
rotation contract. The mandatory matching-`.1` recovery path is absent. The rotation test swaps
synthetic in-memory content and identities after all old rows were already consumed, so it cannot
detect loss of an unread suffix.

### Failure after runtime start is not represented safely

The candidate activation is still `prepared` while `stepDeploy()` runs. If `compose up` has started
the candidate but returns an error, or `waitContainerRunning()` fails after the runtime produced
metrics, the outer catch unconditionally aborts the prepared row. The recovery command may then
restore the old runtime while its previous activation remains open. Candidate bytes produced in
that interval are consequently routed to the previous deployment.

The submitted diff does not change `pipeline.test.ts`; there is no tracked regression asserting
activation ranges for failure before runtime start, failure after runtime start, candidate
healthcheck metrics, manual rollback or auto rollback. The three new activation tests manipulate
repository state directly and do not exercise these pipeline transitions.

### Migration coverage and reproducibility gaps

The database test initializes a fresh database and changes only the expected table count and max
schema version. It does not create a schema-version-1 database with existing app/deployment/metric
rows and then upgrade it, which was a required regression. The migration runner also executes the
migration SQL and records `schema_version` outside one explicit transaction; a partial migration
can leave added columns behind without version 2 recorded, making the next startup fail on a
duplicate `ALTER TABLE`.

The handoff does not record the exact command that produced `82/82` over 18 files. Reviewer scopes
produced 81/81 over 17 files for db+monitor+deploy and 106/106 over 19 files when SSH was included.
Collector verification produced 26/26, rather than the submitted 19. All of these local suites and
static/build checks passed; they do not cover the four runtime-boundary failures above.

## Safety and live scope

Review 03 was local and read-only with respect to the persisted OpsPilot database and VM02. It did
not deploy, restart, roll back, edit app B, train/score ML, push, open a PR or merge. Existing live
evidence was read as submitted and was not presented as a reviewer rerun.
