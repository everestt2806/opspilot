# TK-A17/C03 REVIEW-FIX 02

- Scope: C03 only, from base `2a15615`; production/test commit `c060c75`. C04-C09 remain
  closed/`NOT_RUN`.
- Findings closed: `C03-R2-01` and `C03-R2-02`.

## R2-01 secure profile

- `scripts/c03-live.ts` now runs as Electron with the real OpsPilot userData directory,
  `createCredentialCipher`, `loadSecret`, and the real `SshManager` resolver. It no longer reads
  or writes a private key, fake IV/tag, temporary VPS, or temporary profile database.
- Real profile: `%APPDATA%/OpsPilot`; VPS ID `2`, VM02 `221.121.1.80`. The reopened database was
  read through `DeployService.listApps`, and the reopened resolver completed Docker SSH inspect
  with exit `0`, Docker `29.7.2`.
- Scrubbed credential audit is in `credential-audit-real.json`: AES-256-GCM, ciphertext length
  `399`, IV `12`, tag `16`, decryptable `true`, protected master key `true`; no secret is present.
- Four unsafe ignored profile directories from review-01 were removed after the secure targets were
  healthy: `profile-final`, `profile-final2`, `profile-retry2`, `profile-retry3`. A read-only scan
  found no remaining `opspilot.db` below the old profile evidence directory.

## R2-02 regression

- `src/main/deploy/templates.test.ts` now runs a detector-plan -> `renderBuildArgs` ->
  `renderDockerfile` integration matrix for Next.js (two public keys), Vite (two public keys),
  and Express (no build args). Each generated key is asserted as both `ARG` and `ENV` in the
  rendered Dockerfile. Existing default/override/quoting and empty-argument tests remain.
- Focused result: 4 files, `65 passed`, exit `0`.

## Live matrix and failure ledger

- Successful real-profile run: C03 apps `16/17/18`; deployments `38/39/40/41`; Express port `30015`
  with redeploy `38 -> 39`, Next port `30016`, Vite port `30017`.
- Every successful deployment asserted `PRECHECK -> UPLOAD -> RENDER -> BUILD -> DEPLOY ->
  HEALTHCHECK -> RECORD`; all app containers were `running/healthy`, HTTP status `200`, and all
  collectors were `running` with restart count `0`. Express PostgreSQL marker survived redeploy.
- Durable output: `live-real-profile.json`; credential output: `credential-audit-real.json`.
- Retained failed attempts: `live-retry-*.txt`. The first correct-profile attempts failed closed on
  occupied ports `30001`, `30003`, `30004`, `30006`, `30007`, and earlier occupied-port retries;
  no A17 or app B mutation was performed. The successful run used the first available matrix
  ports `30015-30017`.

## Local gates

| Command | Result |
| --- | --- |
| `pnpm exec vitest run --maxWorkers=1 src/main/detectors/detectors.test.ts src/main/deploy/templates.test.ts src/main/deploy/pipeline.test.ts src/main/deploy/service.test.ts` | `65 passed`, exit `0` |
| `pnpm typecheck` | exit `0` |
| `pnpm exec tsc -p tsconfig.scripts.json --noEmit` | exit `0` |
| `pnpm exec eslint src/main/deploy/templates.test.ts scripts/c03-live.ts` | exit `0` |
| `pnpm exec prettier --check src/main/deploy/templates.test.ts scripts/c03-live.ts` | exit `0` |
| `pnpm build` | exit `0`, renderer `3045` modules |

## Outcome

- `C03-R2-01...02`: `CLOSED`.
- Outcome: `READY_FOR_LOCAL_REVIEW`; Worker does not self-approve C03 and does not open C04.
- C04-C09, ML train/score, monitor/fault/recovery, Flask, app B mutation, push, PR and merge:
  `NOT_RUN`.

## Leader review 03

Leader independently verified focused 65/65, actual userData records, credential resolver/at-rest
properties, unsafe-profile cleanup and a fresh three-app tunnel. C03 is **APPROVED** at code `c060c75`,
submitted `53aa07e`; see [`review-c03.md`](../../../tasks/tk-a17/review-c03.md) and
[`review-03`](review-03/). C04 is now open; VM01 TCP 22 is currently unreachable.
