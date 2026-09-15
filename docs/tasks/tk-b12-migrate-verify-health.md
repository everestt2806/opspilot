# TK-B12 — Fix migrate Express fail ở VERIFY: health race sau pg_restore

> Quy trình, vòng đời và quy tắc cập nhật bắt buộc: [`README.md`](README.md).
> Trạng thái nằm ở [`board.md`](board.md) — file này chỉ giữ hồ sơ và nhật ký.

| Chủ | Hạn | Branch | Brief | Ưu tiên |
|---|---|---|---|---|
| B (A review) | 17/09/2026 | `fix/migrate-verify-health-race` (stacked trên `fix/migrate-build-time-env`) | Bug fix phát hiện khi rehearsal demo round 1 | P0 |

## Mục tiêu

Migrate `demo1609-express` (có PostgreSQL) VM02 → VM01 fail ở bước VERIFY **2 lần liên tiếp**
(job 2, job 4 — đều `rolled_back`, `failed_step: verifying`, lỗi "Đối chiếu migrate không đạt").
Số liệu verify của cả 2 job (đọc từ `opspilot.db` local): checksum SHA-256 KHỚP, files nguồn/đích
18 file / 92465 bytes KHỚP, row count bảng `items` 1000 = 1000 KHỚP, marker `MARKER-*` ở đích
**CÓ** (probe HTTP vào app đích trả body giống hệt nguồn) — chỉ duy nhất hạng mục **health FAIL**.

Nghịch lý marker PASS mà health FAIL cho thấy app đích chạy thật nhưng chưa kịp listen khi
health check chạy. Nguyên nhân gốc: RESTORE kết thúc bằng `docker compose stop app` → pg_restore
→ `docker compose up -d app collector`, nên app container **vừa được khởi động lại**; còn
`verify()` chạy `curl /health` **một lần ngay đầu tiên** (T+~0.3s) — thua cuộc đua với 1-3 giây
boot của Node. Marker probe chạy sau (T+~2-3s) thì app đã lên nên PASS. Rehearsal 13/09 của A
pass được là do timing may mắn (VM01 lúc đó ít container chạy cạnh).

Fix: đổi health check one-shot thành **poll 10 lần × 1 giây** — đúng pattern sẵn có của chính
file (`startSourceAndVerify`). Giữ nguyên lệnh `docker inspect` one-shot sau đó (semantics cũ:
`health = curlOk && inspectRunning`). Thuần bù timing, không đổi hành vi verify khác; app hỏng
thật vẫn fail đúng sau ~10 giây poll.

Đã loại trừ: `/health` của demo Express (`demo/sources/express-api/server.js:187-189`) không
đụng DB, luôn 200 khi đã listen; container name inspect khớp (A pass rehearsal cùng code).

## Được sửa

- `app/src/main/migrate/service.ts` — thêm private `waitTargetHealthy(job, target, signal)`:
  poll 10 lần × 1 giây `curl http://127.0.0.1:<host_port><healthcheck_path>`, trả `true` khi
  exit 0 + HTTP 2xx, throw khi `signal.aborted`; `verify()` dùng nó thay curl one-shot.
- Test: `app/src/main/migrate/service.test.ts` — 3 test cho `waitTargetHealthy`
  (poll tới khi listen / bỏ cuộc sau 10 lần / abort giữa chừng).

## Không được sửa

- `docs/contracts/**`, các hạng mục verify khác (checksum/files/rows/marker), UI, deploy pipeline.
- CHECK dependency chéo API trong VERIFY (vẫn ghi nhận để A quyết định sau demo round 1).

## Definition of Done

- [x] Test mới pass: `waitTargetHealthy` 3 case (fail 2 lần rồi 200 → true; luôn fail → false
      sau đúng 10 lần; signal đã abort → throw, không gọi SSH).
- [x] Toàn bộ `vitest run` 311/311 pass; `pnpm typecheck` (node + web) pass.
- [ ] Live rehearsal: migrate `demo1609-express` VM02 → VM01, giữ nguồn. Kỳ vọng: đủ 7 bước,
      bảng verify mọi hàng PASS, tới Đang chờ xác nhận → completed; URL trên VM01 có
      `MARKER` + 1000 items.
- [ ] A duyệt rồi mới push / mở PR (gộp chung PR với TK-B10).

## Nhật ký

- START 15/09 — B chẩn đoán từ `opspilot.db` local: 2 job Express fail VERIFY với duy nhất
  health=False; marker PASS ngay sau đó → race khởi động sau pg_restore. Kế hoạch fix poll
  theo pattern `startSourceAndVerify`.
- UPDATE 15/09 — Code xong: `waitTargetHealthy` + đổi `verify()`; thêm 3 test (fake timers).
  Full `vitest run` 311/311, typecheck node/web PASS. Local commit trên
  `fix/migrate-verify-health-race` (stacked trên `fix/migrate-build-time-env`); chưa push —
  chờ A duyệt. Còn: live rehearsal Express VM02 → VM01.

## Lệnh tái hiện

```powershell
cd app
pnpm exec vitest run src/main/migrate/service.test.ts
pnpm exec vitest run
pnpm run typecheck
pnpm run build
```

Live: deploy `demo\sources\express-api` lên VM02 → Di chuyển Express VM02 → VM01 (giữ nguồn) →
kỳ vọng 7 bước đủ, verify toàn PASS (trước fix: fail đúng bước verifying, rollback).

## PR

Chưa mở — chờ A duyệt push theo quy ước nhóm. Dự kiến gộp chung PR với TK-B10 vì cùng file
`migrate/service.ts`.
