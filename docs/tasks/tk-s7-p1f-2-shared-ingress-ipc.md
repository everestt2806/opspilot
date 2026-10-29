# TK-S7 P1f-2 — Shared ingress IPC

> Trạng thái: CHỜ REVIEW. Chỉ contract và main-process IPC/service wiring; không sửa renderer/pipeline, không thao tác VPS.

## START 19/10/2026

- Đọc `CLAUDE.md`, `DECISIONS.md`, task-discipline, P1f-1 và contract IPC hiện tại.
- Thêm list/status/action IPC với DTO dùng chung; list/status chỉ đọc SQLite, không đòi DNS propagated/fingerprint/runtime sẵn sàng.
- Inject `SharedIngressService`, validate input từ renderer, giữ policy certificate trong main và chuyển action đúng phương thức service.
- Test parity contract, dữ liệu pending, không network, quyền sở hữu VPS/app/binding, payload bất hợp lệ, dispatch và sanitize lỗi.
- Gate: Node 22 IPC + service/repository tests, typecheck, build, scoped lint, diff check. Không có thao tác VPS.

## UPDATE 19/10/2026

- Added the shared IPC DTOs and the matching `domain:ingress-list`, `domain:ingress-status`, and `domain:ingress-action` channels in the documented and renderer-safe contracts. The renderer supplies only IDs and the allowlisted action; all other identity, policy, DNS/firewall evidence, and runtime decisions remain in main/service code.
- `SharedIngressService.listBindings()` reads app/VPS scoped SQLite bindings directly and does not require DNS propagation, a pinned fingerprint, or a healthy current deployment. Status is DB-only; action dispatch maps exactly to install, reconcile, or HTTPS check. Main injects the service with production policy; staging is not caller-selectable.
- IPC rejects null/non-object, missing, unsafe/non-positive IDs, unknown actions, and extra fields. Service exceptions are converted to sanitized IPC errors; result reasons expose only typed codes and generic messages.
- Node `v22.23.3`: IPC + service + repository focused tests **3 files / 60 passed**; typecheck PASS; build PASS; scoped ESLint PASS (**0 errors / 103 warnings**, same count as baseline in existing code; new lines formatted clean); `git diff --check` PASS. No VPS activity; renderer/pipeline changes and live checks NOT_RUN by scope.
- Code commit SHA: `f49292d15c06a0cd7594ac015c5b0a94f2bc82d7`.


## HANDOFF-LOCAL 19/10/2026

- Implementation commit: `f49292d15c06a0cd7594ac015c5b0a94f2bc82d7` on `feat/deploy-reachability`; task note, board, and contract decision are recorded in this documentation commit.
- Tests: `pnpm --filter @opspilot/app exec vitest run src/main/ipc.test.ts src/main/domain/ingress/sharedIngressService.test.ts src/main/domain/repository.test.ts` ? 3 files, 60 passed.
- Node `v22.23.3`: typecheck PASS; build PASS; scoped ESLint 0 errors / 103 warnings (same as baseline; new code adds 0 warnings); `git diff --check` PASS. Full Vitest NOT_RUN; VPS, renderer, and pipeline NOT_RUN by scope.

## START 2026-10-19 — persisted status consistency review

- Scope: unify persisted binding projection for list/status, preserve typed stored reason codes with safe IPC messages, test failure/disabled states against real SQLite through IPC, retain DB-only behavior and action uncertainty handling.
- Baseline: HEAD `4cd799b`; implementation under review `f49292d`; existing untracked files preserved.
- Gates required: Node 22 IPC/service/repository focused tests, typecheck, build, scoped lint, `git diff --check`; no VPS activity or renderer/pipeline changes.

## UPDATE 2026-10-19 — persisted status mapping review

- Replaced separate list/status state mappings with one persisted projection. `active` now requires propagated DNS, active route, valid certificate, and passed HTTPS probe; route/DNS failures or conflicts, degraded route, failed/expired certificate, and failed probe map to degraded. Disabled maps to blocked and is not retryable. Initial DNS-ready/not-configured state remains ready.
- Stored reason codes are retained; IPC messages use a fixed generic safe message. Read status still verifies app/current deployment and keeps action eligibility separate from persisted display state. No network or action replay was added.
- Added real-SQLite IPC regression coverage using a valid running app/deployment for route failed/conflict/degraded, certificate failed/expired, probe failed, and disabled. List/status must match on status, reason, retryability and HTTP URL; DNS refresh preserves the reason. Existing pending/no-fingerprint/no-network coverage remains.

## HANDOFF-LOCAL 2026-10-19 — review fix

- Code commit: `497e8b0be2e47dc03efe1b785e7c0b3423f1ee2f` on `feat/deploy-reachability`.
- Node `v22.23.3`: IPC/service/repository focused tests **3 files / 68 passed**; typecheck PASS; build PASS; scoped ESLint **0 errors / 18 warnings**, with all remaining warnings at pre-existing lines outside this change; new/changed lines add **0 warnings**; `git diff --check` PASS.
- Full Vitest NOT_RUN (not required by this review). VPS, renderer and pipeline NOT_RUN by scope. Existing untracked files preserved.
