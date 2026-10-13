# TK-S7 R3e - Legacy app recovery preparation UI

| Owner | Due | Branch | Brief | Priority |
|---|---|---|---|---|
| Worker | 13/10/2026 | `feat/deploy-reachability` | TK-S7 R3e | P1 |

## Goal

Offer recovery-manifest preparation for a running legacy app only when its local OpsPilot deployment record matches the current discovered image, version, and ports. Require confirmation, then rescan to show verified status and whether the manifest was created or already existed.

## Scope

- `app/src/renderer/src/components/VpsAppsTab.tsx`
- `app/src/renderer/src/components/VpsAppsTab.test.tsx`
- `app/src/renderer/src/strings.ts`
- This note and `docs/tasks/board.md`

## Out of scope

- No backend or database changes and no live VPS write. Backend remains authoritative for validation.
- No push, PR, or merge.

## Definition of Done

- [x] Only a locally managed, non-imported running app with a matching running/legacy/manifest_missing discovery snapshot gets the action.
- [x] Confirmation gates the IPC call; success rescans and distinguishes created/already exists; failure has retry.
- [x] Imported apps, runtime mismatch, invalid/unreadable manifest, or scan failure hide the action. VPS-only apps explain that guessed data is unsafe.
- [x] Interaction tests cover confirm/cancel, eligibility, success/error/retry, and stale IPC response after VPS switch; strings cover all four locales.
- [x] Focused tests, typecheck, lint, build, and `git diff --check`; inspect Electron layout if available.
- [x] Commit locally only; no push, PR, or merge.

## Log

START 13/10 - Implement R3e UI; preserve unrelated changes and do not write to VPS.

UPDATE 13/10 - UI and interaction tests implemented. Focused Vitest 15/15 PASS; typecheck PASS; scoped ESLint 0 warnings; full lint 0 errors / 6,080 existing warnings; build PASS; git diff --check PASS. Electron layout NOT_RUN: no app/browser window available. No live VPS write.

## Reproduction

- `pnpm exec vitest run src/renderer/src/components/VpsAppsTab.test.tsx`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm build`
- `git diff --check`

## PR

None by request.
