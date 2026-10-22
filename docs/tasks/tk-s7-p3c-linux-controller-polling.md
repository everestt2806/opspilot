# TK-S7 P3c — Linux controller bootstrap and outbound Git polling

| Owner | Date | Branch | Status | Base |
|---|---|---|---|---|
| Worker | 22/10/2026 | `feat/deploy-reachability` | CHỜ REVIEW | P3b-3 correction `77e73b6`; review dossier `117fb0b` (Leader approved) |

## Scope

Node 22 controller process independent of Electron; explicit identity init; isolated SQLite data dir with current migrations; loopback minimal health endpoint; read-only public GitHub production branch polling and durable Product repository observation/reconciliation only. No claim/heartbeat/dispatch/pipeline/SSH, UI, real VPS install, production DB or ML state changes.

Leader accepted P3b-3 correction `77e73b6` / dossier `117fb0b`; this is authorization to implement P3c, not evidence that API/enrollment runtime exists.

## Requirement ledger

| Requirement | Evidence | State |
|---|---|---|
| Electron-free Node 22 bootstrap, explicit controller identity init, secure dedicated data directory, existing migration semantics/raw SQL imports | Linux Node 22 artifact init/status + service lifecycle on isolated WSL data dir; modes `0700/0600/0600`; no implicit enrollment or Electron imports | PASS |
| Public GitHub HTTPS branch tip query: full SHA, safe args/environment, output/time bounds, cancellation, no raw stderr | Linux real `git ls-remote` of public `octocat/Hello-World:master` returned `7fd1a60b01f91b314f59955a4e4d4e80d8edf11d`; env/args, timeout/output and failure redaction unit tests | PASS |
| Poll scheduling: default 30s+jitter/backoff, no overlap, repository/ref coalescing | Unit coverage; live poll + service startup on same DB; repeated tip retained one observation and one queued job | PASS |
| Source/ownership identity and observation sequence captured before fetch; stale writes rejected | SQLite/poller tests cover changed ownership/root and newer observation during fetch; stale result does not record old SHA | PASS |
| Durable observation/desired/job: unchanged tip reconciles; outages/missing branch do not invent or replace desired | Tests cover new/same/missing/outage/pause/startup intent; second real poll after process restart gave `observedCount=0`, single existing job remains queued | PASS |
| Minimal health loopback only; no `/v1`, fail closed on collision; clean signal shutdown | Linux lifecycle harness started/stopped twice, checked loopback `/healthz`, empty `/v1` 404 and listener release each time | PASS |
| Linux native SQLite artifact build/run isolated from Windows node_modules | Node `v22.23.4` WSL artifact built with isolated runtime dependencies/native SQLite; no Electron runtime; DB under `/var/tmp/opspilot-p3c-lab-20261022c` | PASS |
| Required gates and evidence | Node 22 Product/DB/controller/Git tests 69/69; main typecheck PASS; scoped ESLint 0 errors/0 warnings; Linux artifact/live GitHub/lifecycle PASS; `git diff --check` PASS. No VPS/deployment/executor run. | PASS |

## Design notes

- Reuse `ProductDeployRepository` and `initializeDatabase` migration semantics; bundle `?raw` SQL imports into Node artifact through a build-time loader. Do not add schema or alter migrations unless a concrete repository need requires it.
- Controller `init` is explicit and creates only controller identity. Start refuses missing/unreadable/wrong-permission identity/DB; no enrollment, ownership, or Product source rows are inferred.
- Read configured Product-owned Git apps from SQLite, validate public HTTPS GitHub URL and branch ref, capture current observation sequence/config identity, fetch one branch tip per canonical repository/ref group, then submit to existing `observeTip`. Call `reconcileDesired` on startup/every poll before fetch so persisted pending intent survives unchanged tips/outages.
- Linux experiment uses a scratch DB and source fixture for a public GitHub repo; it is not a target VPS or deployment test.

## Journal

- `START 22/10`: applied task-discipline; read CLAUDE, ADR-011, DECISIONS, P3a design, P3b contracts/repository and P3b-3 approval. Worktree had only pre-existing untracked files; preserve them. WSL Ubuntu available (Node 24 default; Node 22.23.4 available through isolated `npm exec --package=node@22`); Docker daemon unavailable. Linux lab will use WSL with separate temporary dependency/build path. No code changed yet.
- `UPDATE 22/10`: added stale-sequence regression: a concurrent newer observation during Git fetch prevents the earlier fetched SHA from being recorded. Updated source-generation fixtures so legacy app Git ref remains aligned with current Product source generation; runtime identity validation remains strict.
- `GATE 22/10`: Node 22.23.4 command `npm exec --yes --package=node@22 -- node ./node_modules/vitest/vitest.mjs run src/main/db/productDeployRepository.test.ts src/main/db/productDesiredReconciliation.test.ts src/main/db/productJobClaim.test.ts src/main/db/productMigration.test.ts src/main/controlPlane src/main/git/publicBranch.test.ts` — 8 files / 69 tests PASS. `npm exec --yes --package=node@22 -- node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false` PASS. Scoped ESLint on controller/repository/Git/script files PASS, 0 errors / 0 warnings. `git diff --check` PASS.
- `LINUX LAB 22/10`: WSL Ubuntu, Node `v22.23.4`; isolated dependencies `/var/tmp/opspilot-p3c-lab-20261022b/runtime/node_modules`; isolated DB `/var/tmp/opspilot-p3c-lab-20261022c/data/opspilot.db`; fixture app `93001`, public `octocat/Hello-World:master`, fake target only `fixture.invalid`. Built `/var/tmp/opspilot-p3c-lab-20261022b/runtime/dist/control-plane.cjs` with `scripts/build-control-plane.mjs`. Init created controller identity `7ce7e03c-c487-4f59-ab76-e4fa5e12eb90`; permissions: data dir `0700`, DB/identity marker `0600`. Real public poll returned full SHA `7fd1a60b01f91b314f59955a4e4d4e80d8edf11d`, one observation and one queued job. Repeated poll after a process restart retained sequence 1 and one queued job (`observedCount=0`). Lifecycle smoke started/stopped service twice, exits `[0,0]`, loopback `/healthz`, hidden `/v1` 404, and listener released each time. An early harness run put the bundle outside its isolated `node_modules` path and failed `MODULE_NOT_FOUND`; rebuilding under isolated runtime resolved it; final smoke passed. No VPS, SSH, claim, deployment, DNS/firewall/service installation, ML, or production DB actions.
- `HANDOFF-LOCAL`: Linux evidence is local WSL fixture + public GitHub read, not VPS/deployment evidence. Docker unavailable and not required; no `NOT_RUN` acceptance gate remains. P3c exposes no auth or `/v1` API and never claims/executes queued jobs. Implementation SHA is recorded in this note and board after the code commit.
