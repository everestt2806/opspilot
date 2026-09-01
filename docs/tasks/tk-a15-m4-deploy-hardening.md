# TK-A15 — M4 Deploy Hardening: rollback đúng sự thật, image retention, port/diagnostic

| Chủ | Hạn        | Branch                      | Baseline                    | Brief                                 | Ưu tiên |
| --- | ---------- | --------------------------- | --------------------------- | ------------------------------------- | ------- |
| A   | 08/09/2026 | `feat/m04-deploy-hardening` | `d40afc9` · PR #24 đã merge | `docs/prompts/m04-deploy-pipeline.md` | P0      |

## 1. Mục tiêu

Hardening pipeline M4 đã demo, không viết lại deploy. Sau task này, deploy/redeploy/rollback phải
ghi trạng thái đúng với thực tế trên VPS, không xóa image đang cần để khởi động lại, không cấp trùng
port khi nhiều app cùng VPS và đưa ra chẩn đoán hữu ích khi container không chạy/không healthy.

TK-A15 độc lập với collector của B. A tiếp tục làm task này trong khi B làm B4 → B5 → B6; hai người
chỉ dừng để tích hợp tại TK-S4 khi B6 sẵn sàng.

## 2. Nguồn sự thật bắt buộc

Đọc đủ trước khi sửa code:

1. `CLAUDE.md`, `docs/tasks/README.md`, file task này.
2. `docs/prompts/m04-deploy-pipeline.md`.
3. `docs/contracts/deploy-events.md`.
4. `docs/contracts/schema.sql`: bảng `app`, `deployment`, `action_log`.
5. `docs/contracts/ipc-contract.ts`: `DeployEvent`, `DeployInput`, `Deployment`, `IpcError`.
6. `docs/contracts/detector-contract.ts`: `BuildPlan`.
7. `docs/14-quyet-dinh-kien-truc.md`: ADR-004 và ADR-006.
8. `docs/10-quy-uoc-code.md`: timeout, retry, log và secret.
9. `docs/tasks/tk-a13-m4-deploy-slice.md`: nền đã demo, không làm lại.

Nếu mâu thuẫn: contract thắng. Không tự sửa `docs/contracts/**`; ghi `BLOCKED` và báo A.

## 3. Baseline đã có — không làm lại

- Pipeline đủ `PRECHECK → UPLOAD → RENDER → BUILD → DEPLOY → HEALTHCHECK → RECORD`.
- Deploy mới/redeploy Express + PostgreSQL thật đã demo; giữ DB credential khi redeploy.
- Có `activeByApp`, `AbortController`, version transaction và unique `(vps_id, host_port)`.
- Healthcheck tối đa 10 lần; có nhánh auto/manual rollback.
- Có `pruneImages()` giữ ba tag theo version ở mức nền.
- Có log event, file deploy log và đúng một `finished` trong luồng deploy chính.
- Baseline Node 22 ngày 01/09: deploy/repository focused `28/28 PASS`, `typecheck:node PASS`.

## 4. Khoảng trống hardening đã xác minh

### H1 — Rollback phải phản ánh đúng thực tế

`handleHealthcheckFail()` hiện catch lỗi rollback nhưng vẫn emit `step-done`, ghi deployment
`rolled_back`, đổi `current_deployment_id` về bản cũ và log success. Đây là lỗi P0.

Yêu cầu:

- Auto rollback chỉ thành công sau `compose up` exit 0, container chạy và healthcheck bản cũ PASS.
- Rollback lỗi phải emit `step-failed` cho bước phụ `DEPLOY`, kết thúc `failed`, không ghi
  `rollback_auto success` và không đổi current deployment sang bản chưa xác minh.
- Manual rollback dùng cùng invariant; target sai app/không dùng được phải trả lỗi có mã rõ.
- Mọi nhánh vẫn đúng một `finished` và luôn release lock/controller.

### H2 — Giữ tối đa ba image nhưng không xóa tag đang cần

`pruneImages()` hiện chỉ sort version rồi xóa `slice(3)` bằng `-f`. Nếu app đang rollback về một
version cũ, tag đang chạy có thể bị xóa khỏi VPS và lần restart sau không lên được.

Yêu cầu:

- Tối đa ba tag của app sau cleanup, nhưng luôn bảo vệ tag của `current_deployment_id`/rollback
  target; hai slot còn lại ưu tiên version mới nhất.
- Không dùng force để che việc image đang được container dùng; lỗi xóa một tag chỉ warn và tiếp tục.
- Cleanup sau cancel không dùng `AbortSignal` đã aborted khiến cleanup bị bỏ toàn bộ.
- Không đụng image repository của app khác, image nền hoặc volume/data.

### H3 — Port và khóa nhiều app

- Giữ khóa cùng app; deploy app khác được phép song song.
- Việc cấp port khi `start()` mới là quyết định cuối; hai app mới trên cùng VPS phải nhận hai port
  khác nhau trong `30000–30999`, kể cả precheck UI trước đó đã cũ.
- Unique conflict phải thành `PORT_EXHAUSTED`/`VALIDATION` dễ hiểu, không rơi thành `DB_ERROR` mơ hồ.
- Không giữ lock sau success/fail/cancel/rollback failure.

### H4 — Retry có giới hạn và chẩn đoán container

- Chỉ retry probe đọc-an-toàn: `docker inspect`, health `curl`, list image hoặc reconnect trước khi
  lệnh thực sự chạy. Không retry `upload`, ghi file, `docker build`, `docker compose up/down`, xóa
  image hoặc bất kỳ lệnh có tác dụng phụ.
- Khi container `missing/exited/restarting/unhealthy` hoặc chờ quá hạn, thu thập trạng thái tối thiểu:
  status, health, exit code và error; có thể lấy `docker logs --tail` nhưng phải mask secret trước khi
  emit/ghi file. Không chạy `docker inspect` lấy env.
- `IpcError.message` nói rõ chuyện gì, bước nào, người dùng nên làm gì; technical không chứa secret.

## 5. Phạm vi file

Được sửa:

- `app/src/main/deploy/**` và test tương ứng.
- `app/src/main/db/appRepository.ts`, `deploymentRepository.ts` và test nếu cần cho lookup/port.
- `app/scripts/try-deploy.ts` nếu cần chế độ smoke tái hiện an toàn.
- `docs/05-truy-vet-yeu-cau.md`, board, file task, prompt và handoff TK-A15.

Chỉ sửa `app/src/main/ssh/manager.ts` nếu regression chứng minh cần API read-only retry typed; phải
giữ tương thích caller M6/M9. Trước khi sửa phải ghi impact vào nhật ký.

Không được sửa:

- `docs/contracts/**`, migration đã chạy, dependency/package lock.
- `app/src/renderer/**`, `collector/**`, `ml-service/**`, `experiments/**`, `demo-apps/**`.
- M6 monitor, detector breadth M3 hoặc migrate M9.
- `.devflow/`, `docs/ban-giao-20-08.md`, `logo.png`, stash hay dữ liệu user.

## 6. Checkpoint và commit cục bộ

### CP1 — Rollback truthful

- Gom invariant rollback dùng chung ở mức vừa đủ; không đổi IPC/contract.
- Test auto rollback compose fail, old container không running, old healthcheck fail và success.
- Test manual rollback success/fail; đúng event, DB, current deployment, action log và release lock.
- Commit: `fix(deploy): make rollback outcome truthful`.

### CP2 — Image retention và port lock

- Retention bảo vệ current/target, tối đa ba tag, không force, cleanup signal độc lập.
- Test ≥5 version, current là version cũ, app khác cùng tên-prefix và lỗi xóa một tag.
- Test hai app mới cùng VPS cấp port khác nhau; cùng app vẫn bị khóa; lock được giải phóng mọi nhánh.
- Commit: `fix(deploy): protect rollback images and port allocation`.

### CP3 — Diagnostic và retry boundary

- Chẩn đoán `missing/exited/restarting/unhealthy`, message/action log có ích và được mask.
- Retry chỉ probe idempotent; assert side-effect command gọi đúng một lần khi lỗi.
- Test cancel trong healthcheck/cleanup vẫn kết thúc và không rò lock/timer.
- Commit: `fix(deploy): add bounded probes and container diagnostics`.

### CP4 — CLI, traceability và handoff

- Chạy focused/full gate, cập nhật `docs/05`, board, task log và handoff.
- Không tự chạy deploy thật/xóa image trên VM01 nếu A chưa ra lệnh smoke riêng trong phiên.
- Commit: `docs(deploy): hand off A15 hardening`.

## 7. Test bắt buộc và Definition of Done

- [ ] Rollback success chỉ được ghi sau healthcheck bản đích PASS.
- [ ] Rollback failure không emit success/không đổi current deployment sai; đúng một `finished`.
- [ ] Success/fail/cancel đều release lock và controller; cùng app bị chặn, app khác chạy được.
- [ ] Nhiều app cùng VPS không trùng port; dải port và error mapping đúng.
- [ ] Sau ≥5 version còn tối đa ba tag và tag current/rollback target luôn còn.
- [ ] Không xóa image app khác, volume hoặc `/opt/opspilot/<app>/data`.
- [ ] Container fail có status/health/exit/error hữu ích, đã mask secret.
- [ ] Không retry lệnh side-effect; retry probe đọc-an-toàn có giới hạn và test trực tiếp.
- [ ] Luồng Express deploy/redeploy hiện tại không regression.
- [ ] Focused tests, CLI an toàn, lint, typecheck, scoped Prettier và build PASS.
- [ ] Full suite được chạy và ghi kết quả thật; renderer baseline tách riêng nếu còn.
- [ ] Docs/board/handoff cập nhật; không push/PR/merge khi A chưa cấp quyền riêng cho TK-A15.
- [ ] Reviewer Codex/root không còn finding BLOCKING/MAJOR.

Smoke VM01 chỉ chạy sau unit gate và lệnh rõ của A. Smoke cần chụp: image list trước/sau, deploy
vN success, healthcheck fail → rollback thật, URL cũ còn 200 và `data/`/PostgreSQL không mất.

## 8. Gate tái hiện

```powershell
. .\tools\enter-node22.ps1
Set-Location app
node --version
pnpm test -- --run src/main/deploy src/main/db/deploymentRepository.test.ts src/main/db/appRepository.test.ts
pnpm lint
pnpm typecheck
pnpm exec prettier --check src/main/deploy src/main/db/appRepository.ts src/main/db/deploymentRepository.ts scripts/try-deploy.ts
pnpm build
pnpm test -- --reporter=verbose
```

## 9. Nhật ký

- START 01/09 17:50 — branch `feat/m04-deploy-hardening@d40afc9` từ `origin/main` sau PR #24;
  untracked `.devflow/`, `docs/ban-giao-20-08.md`, `logo.png` giữ nguyên. Đã đọc M4/contracts/ADR,
  audit pipeline hiện hữu; kế hoạch CP1 rollback → CP2 image/port → CP3 diagnostic/retry → CP4
  handoff. Baseline Node 22 focused `28/28 PASS`, `typecheck:node PASS`. GitNexus re-index thành
  công nhưng MCP impact timeout handshake; fallback raw caller/source/test inspection.
- CP1 01/09 18:03 — rollback auto chỉ ghi `rolled_back` sau compose/running/healthcheck target;
  rollback fail phát `step-failed DEPLOY`, không đổi current và có action log failed. Manual rollback
  từ chối target không `running`, healthcheck fail không đổi current, success/fail đều release lock.
  Node 22 `pnpm test -- --run src/main/deploy/pipeline.test.ts` = `12/12 PASS`.
- CP2 01/09 18:07 — image retention giữ tối đa ba tag nhưng bảo vệ image current/rollback target,
  không dùng `rm -f`, một tag xóa lỗi không chặn tag sau và cleanup không dùng signal đã abort. Hai
  app cùng VPS được cấp `30000/30001` ở `start`; unique port/name map rõ thành
  `PORT_EXHAUSTED/VALIDATION`; lock được tái sử dụng sau success/rollback failure/cancel. Node 22
  focused pipeline/port/repository `19/19 PASS`, `typecheck:node PASS`.
- CP3 01/09 18:16 — `docker inspect` chỉ đọc `.State` và validate bằng zod; diagnostic đủ
  missing/exited/restarting/unhealthy, exit code/error và `docker logs --tail 80` đã mask secret lẫn
  credential URL. `ExecOptions.retryOnReconnect=false` khóa retry cho build/compose/cleanup; chỉ
  inspect/curl/image-list/log-tail được reconnect retry. Sleep gỡ abort listener, cancel giữa lúc chờ
  container không rò timer/lock. Node 22 deploy+SSH+logger focused `56/56 PASS`, scoped Prettier và
  `typecheck:node PASS`.
- REVIEW-FIX 01/09 18:27 — manual rollback probe `docker image inspect` trước compose, target đã bị
  retention xóa trả `VALIDATION` rõ và không chạy side effect; `finished` chỉ phát sau cleanup. Auto
  rollback truyền target tag tường minh cho retention; test khóa app dọn pipeline nền trước teardown.
  Node 22 focused `57/57 PASS`, `typecheck:node PASS`.

Mẫu dòng tiếp theo:

```text
CP<n> dd/mm HH:mm — commit `<message>` · file <ngắn> · test `<lệnh>` = PASS/FAIL · tiếp theo <...>
REVIEW-FIX dd/mm HH:mm — finding <ID> · commit <sha> · regression <lệnh/kết quả>
HANDOFF-LOCAL dd/mm HH:mm — commits <base..head> · gate <kết quả> · handoff `tk-a15-worker-handoff.md` · CHƯA PUSH
BLOCKED dd/mm HH:mm — bước <...> · bằng chứng <...> · đã thử <...> · điều kiện gỡ <...>
```

## 10. Trạng thái remote/PR

- Branch local: `feat/m04-deploy-hardening`.
- Remote/PR: chưa có.
- Quyền hiện tại: commit cục bộ; **chưa push, chưa mở PR, chưa merge**.
