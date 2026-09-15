# TK-B10 — Fix migrate mất biến build-time khi rebuild trên VPS đích

> Quy trình, vòng đời và quy tắc cập nhật bắt buộc: [`README.md`](README.md).
> Trạng thái nằm ở [`board.md`](board.md) — file này chỉ giữ hồ sơ và nhật ký.

| Chủ | Hạn | Branch | Brief | Ưu tiên |
|---|---|---|---|---|
| B (A review) | 17/09/2026 | `fix/migrate-build-time-env` | Bug fix phát hiện khi rehearsal demo round 1 | P0 |

## Mục tiêu

Khi rehearsal demo 15/09 migrate `demo1409-vite` VM02 → VM01, tool và web quản lý VPS đều báo thành
công nhưng SPA trên VM01 hiện `Lỗi: Failed to fetch` (console: `GET http://localhost:3000/health
net::ERR_CONNECTION_REFUSED`). Nguyên nhân: RESTORE rebuild image trên VPS đích nhưng truyền
`env: {}` vào pipeline, nên build-arg `VITE_API_URL` (biến build-time bị đóng vào bundle lúc
`docker build`) rơi về default trong `.env.example` của source (`http://localhost:3000`). VERIFY
không check dependency chéo nên vẫn báo PASS. Fix: đọc `.env` đã migrate (có sẵn trong artifact
sau TRANSFER) và truyền vào pipeline khi deploy lại — giữ nguyên thứ tự ưu tiên `input.env` >
`plan.buildArgs` nên deploy thường không đổi hành vi. Cùng cơ chế sửa luôn bug tiềm ẩn
`NEXT_PUBLIC_*` của Next.js.

## Được sửa

- `app/src/main/deploy/templates.ts` — thêm helper `parseEnvFile`.
- `app/src/main/migrate/service.ts` — tách `startRestoreDeployment` + `readRestoredEnv`, truyền
  env đã parse vào pipeline.run (thay `env: {}`).
- `app/src/main/deploy/pipeline.ts` — de-dup: nhánh `remoteSource` của `stepRender` dùng
  `parseEnvFile` thay parser inline.
- Test: `deploy/templates.test.ts`, `migrate/service.test.ts`, `deploy/pipeline.test.ts`.

## Không được sửa

- `docs/contracts/**`, detector, Dockerfile template, UI.
- VERIFY của migrate (check dependency chéo API — ghi nhận để A quyết định sau demo round 1).

## Definition of Done

- [x] Test mới pass: `parseEnvFile` 3 case, `startRestoreDeployment` 2 case, pipeline regression
      2 case (user env thắng default / env rỗng rơi về default).
- [x] Toàn bộ `vitest run` 308/308 pass; `pnpm typecheck` (node + web) pass.
- [ ] Live rehearsal: migrate Vite VM02 → VM01, mở trang trên VM01 thấy `API health: OK`;
      log BUILD trên VM01 có `--build-arg VITE_API_URL=<URL Express thật>`.
- [ ] A duyệt rồi mới push / mở PR.

## Nhật ký

- START 15/09 — B phát hiện bug khi rehearsal demo round 1: migrate Vite VM02 → VM01 báo thành
  công nhưng SPA `Failed to fetch`; chẩn đoán nguyên nhân (migrate rebuild với env rỗng → build-arg
  rơi về default `.env.example`), kế hoạch fix + test.
- UPDATE 15/09 — Code xong: `parseEnvFile` trong templates, `startRestoreDeployment`/`readRestoredEnv`
  trong migrate service, de-dup parser trong pipeline; thêm 7 test. Full `vitest run` 308/308,
  typecheck node/web PASS. Local commit trên `fix/migrate-build-time-env`; chưa push — chờ A duyệt.
  Còn: live rehearsal trên VM02/VM01.

## Lệnh tái hiện

```powershell
cd app
pnpm exec vitest run src/main/deploy/templates.test.ts src/main/migrate/service.test.ts src/main/deploy/pipeline.test.ts
pnpm exec vitest run
pnpm run typecheck
```

Live: deploy `demo\sources\express-api` lên VM02 → deploy `demo\sources\vite-spa` lên VM02 với
`VITE_API_URL=<URL Express>` → Di chuyển Vite VM02 → VM01 (giữ nguồn) → mở URL trên VM01, kỳ vọng
`API health: OK` (trước fix: `Failed to fetch`, bundle gọi `http://localhost:3000`).

## PR

Chưa mở — chờ A duyệt push theo quy ước nhóm.
