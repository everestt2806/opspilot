# C04 evidence

## Local implementation

- Base: `4635a9bfa280a95078c365d3bebed0f1825e750b`
- Branch: `feat/a17-demo-checkpoint`
- Live mutation: not run. VM01 is unreachable on TCP/22.
- Preserved: `.devflow/`, `docs/ban-giao-20-08.md`, `logo.png`, and existing untracked files.

## Commands

| Command                                                                                                                                                                                                                               | cwd             | Runtime                                    | Exit/count             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------ | ---------------------- |
| `pnpm exec vitest run --maxWorkers=1 src/main/migrate/repository.test.ts src/main/migrate/service.test.ts src/main/deploy/precheck.test.ts src/main/deploy/pipeline.test.ts src/main/deploy/service.test.ts src/main/ipc.test.ts`     | `app`           | Node 24.16.0 / pnpm 11.1.0 / Vitest 4.1.10 | 0 / 6 files / 49 tests |
| `pnpm typecheck`                                                                                                                                                                                                                      | `app`           | TypeScript 5.9.3                           | 0                      |
| `pnpm exec tsc -p tsconfig.scripts.json --noEmit`                                                                                                                                                                                     | `app`           | TypeScript 5.9.3                           | 0                      |
| `pnpm exec eslint src/main/migrate/repository.ts src/main/migrate/repository.test.ts src/main/migrate/service.ts src/main/migrate/service.test.ts src/main/ipc.ts src/main/index.ts src/renderer/src/pages/MigratePage.tsx`           | `app`           | ESLint 9                                   | 0                      |
| `pnpm exec prettier --check src/main/migrate/repository.ts src/main/migrate/repository.test.ts src/main/migrate/service.ts src/main/migrate/service.test.ts src/main/ipc.ts src/main/index.ts src/renderer/src/pages/MigratePage.tsx` | `app`           | Prettier 3                                 | 0                      |
| `pnpm build`                                                                                                                                                                                                                          | `app`           | electron-vite / Vite 7                     | 0                      |
| `Test-NetConnection -ComputerName 221.121.1.79 -Port 22 -InformationLevel Quiet`                                                                                                                                                      | repository root | Windows PowerShell                         | `False` (TCP timeout)  |
| `Test-NetConnection -ComputerName 221.121.1.80 -Port 22 -InformationLevel Quiet`                                                                                                                                                      | repository root | Windows PowerShell                         | `True`                 |

## Case mapping

- C04-T3 guard coverage: PASS locally for same VPS, non-running source, and active migration; evidence is `service.test.ts`.
- C04-T7 guard/repository coverage: PASS locally for idempotent confirmation and persistent terminal state; evidence is `repository.test.ts` and `service.test.ts`.
- C04-T1, C04-T2, C04-T4, C04-T5, C04-T6, C04-T8: NOT_RUN against real SSH/pipeline because VM01 is unreachable and no live mutation was authorized.
- C04-T9: BLOCKED; both real VPS profiles must be reachable and both live migrations must pass.
- C05-C09: NOT_RUN and remain closed.

## Blocker

`221.121.1.79:22` timed out while `221.121.1.80:22` was reachable. Unblock requires VM01 SSH service/firewall/routing to accept the existing configured credential, followed by a fresh read-only precheck. Until then this evidence must not be treated as live migration PASS.
