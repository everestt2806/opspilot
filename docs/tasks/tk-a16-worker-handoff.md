# BIÊN BẢN BÀN GIAO WORKER — TK-A16

| Trường | Giá trị |
|---|---|
| Trạng thái | `READY_FOR_LOCAL_REVIEW` |
| Outcome | `READY_FOR_LOCAL_REVIEW` |
| Worker | GPT-5.6 Luna · Medium Effort |
| Reviewer | Codex/root |
| Branch | `feat/m06-monitor-poller-rule` |
| Baseline | `92bb19f` (review-06 anchor `6333008`) |
| Code head trước handoff | `734fccc` |
| Handoff head | `d332931` |
| Remote/PR | `CHƯA PUSH — CHƯA MỞ PR` |

## 1. Outcome

Đã sửa R6-01 đến R6-04. Backend monitor giữ lifecycle ML `down → up` khi
`autoTrain:false`, train-now trả `VALIDATION` dưới 150 mẫu, IPC/SQLite và
batch/two-app regression có bằng chứng thật. Không sửa renderer, contract,
migration, collector, deploy hoặc dữ liệu người dùng.

## 2. Commit vòng 6

| Commit | Nội dung |
|---|---|
| `5adaccb` | `fix(monitor): recover ml status with auto train disabled` |
| `734fccc` | `test(monitor): close train and ipc contract regressions` |
| `d332931` | `docs(monitor): reconcile round six handoff` |

Các commit review trước đó vẫn giữ nguyên; không checkout lùi, rewrite hoặc
rebase lịch sử.

## 3. File thay đổi vòng này

- `app/src/main/monitor/poller.ts`
- `app/src/main/monitor/service.ts`
- `app/src/main/monitor/service.test.ts`
- `app/src/main/ipc.test.ts`
- `docs/05-truy-vet-yeu-cau.md`
- `docs/tasks/board.md`
- `docs/tasks/tk-a16-m6-poller-rule.md`
- `docs/tasks/tk-a16-worker-handoff.md`

Ngoài scope không bị chạm: `app/src/renderer/**`, `docs/contracts/**`,
migration, `collector/**`, `demo-apps/**`, `experiments/**`, deploy/detector,
`.devflow/`, `docs/ban-giao-20-08.md`, `logo.png` và stash của user.

## 4. Evidence test/gate Node 22

Môi trường: Node `v22.23.2`, pnpm `11.1.0`, Windows.

| Command | Exit | Kết quả |
|---|---:|---|
| `. .\tools\enter-node22.ps1; Set-Location app; node --version` | 0 | `v22.23.2` |
| `pnpm test -- --run src/main/monitor src/main/shutdown.test.ts src/main/ipc.test.ts` | 0 | 9 files, `25/25 PASS` |
| `pnpm try:monitor` | 0 | SQLite thật: `150 metrics`, `750 scores`, `0 alerts`, `offset 43008`, `retry 0` |
| `pnpm lint` | 0 | 0 errors, 16 warning renderer baseline |
| `pnpm typecheck` | 0 | PASS |
| `pnpm exec prettier --check src/main/index.ts src/main/ipc.ts src/main/monitor src/main/shutdown.ts src/main/shutdown.test.ts scripts/try-monitor.ts` | 0 | PASS |
| `pnpm build` | 0 | PASS, 3045 modules transformed |
| `pnpm test -- --reporter=verbose` | 1 | `189/200 PASS`, 11 renderer-only failures/timeouts; no monitor failure |
| `pnpm test -- --run src/renderer/src/components/VpsOverviewTab.test.tsx` | 0 | 1 file, `3/3 PASS` |
| Reviewer: focused/CLI/lint/typecheck/Prettier/build | 0 | PASS trên Node 22.23.2 |
| Reviewer: `pnpm test -- --reporter=verbose` | 1 | `180/200`, 20 renderer-only timeout; no monitor failure |
| Reviewer: `VpsOverviewTab.test.tsx` isolated | 0 | `3/3 PASS` |

Full-suite renderer failures là baseline/environment timeout ngoài scope; file
renderer bị ảnh hưởng chạy riêng `3/3 PASS`, không sửa renderer.

## 5. Definition of Done

- [x] Ingest fixture, byte offset, partial/corrupt/duplicate/shrink và rollback transaction.
- [x] Rule strict/null semantics và alert open/peak/resolve/restart.
- [x] Chính xác 5 score mỗi sample; ML down/not-ready là `NULL`.
- [x] ML status recovery qua một gateway khi `autoTrain:false`; không gọi train.
- [x] Train-now 149 mẫu trả `VALIDATION`; 150 mẫu gọi đúng deployment/count.
- [x] Poll non-overlap, scheduler cleanup, shutdown reject orchestration.
- [x] Hai app chạy tuần tự, exact tick batch/identity/content, empty tick không emit.
- [x] Monitor IPC đọc/ghi SQLite thật: samples, scores, alerts, setting, label, train-now.
- [x] CLI local chạy SQLite/MonitorPoller thật không cần collector/VPS.
- [x] `docs/05`, board, task log và handoff cập nhật trong branch.
- [x] Chưa push, chưa mở PR, chưa merge.
- [ ] Full suite tuyệt đối xanh: còn 11 renderer-only failures/timeouts baseline; không thuộc TK-A16.
- [x] Reviewer Codex/root xác nhận không còn finding blocking/major tại review-07.

## 6. Giới hạn và rủi ro

- Full suite vẫn có renderer timeout/failure dưới tải; test renderer liên quan
  chạy riêng `3/3 PASS`. Không sửa renderer theo phạm vi review-06.
- Smoke VPS thật, stress/reboot và soak 24 giờ thuộc TK-S4/W5, chưa chạy ở đây.
- ML HTTP xảy ra trước transaction SQLite theo contract hiện hữu; crash-window
  này không thay đổi trong vòng sửa.

## 7. Lệnh tái hiện

```powershell
. .\tools\enter-node22.ps1
Set-Location app
node --version
pnpm test -- --run src/main/monitor src/main/shutdown.test.ts src/main/ipc.test.ts
pnpm try:monitor
pnpm lint
pnpm typecheck
pnpm exec prettier --check src/main/index.ts src/main/ipc.ts src/main/monitor src/main/shutdown.ts src/main/shutdown.test.ts scripts/try-monitor.ts
pnpm build
pnpm test -- --reporter=verbose
```

## 8. Điểm reviewer cần kiểm tra

- `MonitorPoller` báo `running:true` một lần sau batch ingest thành công và
  gateway dedupe không tạo action-log/status trùng.
- `trainNow` giữ `AppError('VALIDATION', ...)` và IPC map đúng error code.
- Exact tick không kéo sample/alert cũ; two-app order và SQLite IPC payload.
- Handoff/task log không còn trạng thái tổng hợp mâu thuẫn; renderer exception
  được giữ ngoài scope.

## 9. Lịch sử review

| Vòng | Kết luận | Finding | Trạng thái |
|---|---|---|---|
| 1 | `REQUEST_CHANGES` | R01–R12 | đã sửa ở các commit review trước |
| 2 | `REQUEST_CHANGES` | R2-01–R2-07 | superseded |
| 3 | `REQUEST_CHANGES` | R3-01–R3-06 | superseded |
| 4 | `REQUEST_CHANGES` | R4-01–R4-06 | superseded |
| 5 | `REQUEST_CHANGES` | R5-01–R5-04 | superseded |
| 6 | `REQUEST_CHANGES` | R6-01–R6-04 | đã xử lý trong vòng này, chờ review local |
| 7 | `APPROVED LOCAL` | Không còn BLOCKING/MAJOR | code head `d332931`; chưa push/PR/merge |

## 10. Xác nhận an toàn Git

- Chỉ commit local trên `feat/m06-monitor-poller-rule`.
- Không `push`, mở PR, merge, force-push, reset-hard, clean, rebase hoặc thao
  tác stash.
- `.devflow/`, `docs/ban-giao-20-08.md` và `logo.png` vẫn untracked nguyên vẹn.
- Dừng sau commit handoff để Codex/root review vòng tiếp theo.
