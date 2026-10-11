# TK-S7 R3b — Xác minh ứng viên khôi phục từ VPS

## Mục tiêu

Đối chiếu container OpsPilot được R2 phát hiện với manifest v1 an toàn trên VPS và hiển thị trạng thái đủ điều kiện khôi phục. Chỉ đọc từ VPS; không nhập hay sửa dữ liệu SQLite.

## Tiêu chí nghiệm thu

- Đọc đúng manifest path cố định theo slug đã xác thực, giới hạn byte và parse schema allowlist; không trả/log raw JSON hoặc secret.
- Đối chiếu identity, image/version, running state và host/container port với bằng chứng Docker/Compose độc lập; mọi tình huống không xác minh được có status/reason an toàn.
- UI hiển thị eligible và metadata đã lọc, bao gồm trạng thái legacy, theo bốn locale; giữ scan/retry remote-only.
- Test focused/full Vitest, typecheck, lint, build, `git diff --check`; commit local, không thao tác VPS thật.

## Nhật ký

- START 11/10/2026 — Đọc CLAUDE.md, DECISIONS.md, task-discipline, R2 và R3a; xác nhận Node 22.23.3 sẵn có. Ledger: scanner/strict parser, IPC decision, UI/locales, tests/gates đều OPEN.
- UPDATE 11/10/2026 — Scanner đọc manifest chỉ từ `/opt/opspilot/<validated-slug>/.opspilot-app.json` với `head -c 16385`; parser v1 từ chối field thừa, credential-bearing Git URL, field/type sai và payload quá 16 KiB. Đối chiếu Docker image/tag, running state và host/container port; status/reason rõ cho verified, legacy, invalid, mismatch, duplicate, stopped, và runtime không xác minh được. IPC contract mirror, DECISIONS, UI 4 locale hoàn tất; không có import/SQLite mutation.
- HANDOFF-LOCAL 11/10/2026 — Commit code `4815d92`. Node 22.23.3: focused 14/14; full Vitest 734/734 (74 files); `pnpm typecheck` PASS; `pnpm lint` 0 errors/14 formatting warnings có sẵn ở các file deploy không thuộc task; `pnpm build` PASS; `git diff --check` PASS. VPS/live `NOT_RUN`; không import app/deployment records.

## Requirement ledger

| Requirement | Result | Evidence |
|---|---|---|
| Bounded fixed-path manifest read, strict allowlist parser, no raw secret/error exposure | PASS | `discovery.test.ts`, `appManifest.test.ts`; 16 KiB cap and fixed validated slug |
| Docker/Compose identity, image/tag, runtime state and published port verification with explicit safe failures | PASS | Focused discovery tests for verified, missing, malformed, oversized, name/port mismatch, duplicate, stopped, unverifiable and SSH failure |
| Remote-only recovery eligibility UI, sanitized metadata and four locales; no import | PASS | `VpsAppsTab.test.tsx`; locale status assertions and unchanged read-only handler path |
| Focused/full tests, typecheck, lint, build, diff check; local commit | PASS | 14 focused; 734 full; Node 22 gates above; code commit `4815d92` |
| Live VPS validation | N/A | Explicitly not run in this checkpoint; no VPS mutation authorized |
