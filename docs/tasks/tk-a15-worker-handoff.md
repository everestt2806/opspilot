# BIÊN BẢN BÀN GIAO WORKER — TK-A15

> Worker điền đủ trước khi dừng. Không tự tuyên bố `HOÀN THÀNH`; reviewer quyết định
> `READY_FOR_LOCAL_REVIEW`, A quyết định push/PR/merge.

| Trường       | Giá trị                     |
| ------------ | --------------------------- |
| Outcome      | `READY_FOR_LOCAL_REVIEW`    |
| Branch       | `feat/m04-deploy-hardening` |
| Baseline     | `d40afc9`                   |
| Code head    | `6fd3efd`                   |
| Handoff head | CP5 — commit chứa file này  |
| Remote/PR    | `CHƯA PUSH — CHƯA MỞ PR`    |

## 1. Commit CP1–CP4

| CP  | Commit    | Finding/invariant                 | Test tại checkpoint        |
| --- | --------- | --------------------------------- | -------------------------- |
| CP1 | `d77e4cb` | rollback truthful                 | pipeline 12/12             |
| CP2 | `cacac2f` | image retention + port            | focused 19/19              |
| CP3 | `2783771` | diagnostic + retry boundary       | focused 56/56              |
| CP4 | `c0e7bc6` | docs/gate/handoff                 | final gates bên dưới       |
| CP5 | `6fd3efd` | rollback readiness thật sau smoke | pipeline 22/22 · VM02 PASS |

Review-fix: `9f691b0` kiểm tra target image/finished sau cleanup; `9d35acf` resolve image runtime
qua chuỗi `is_rollback_of` và khóa regression rollback lồng; `6fd3efd` thay probe rollback một lần
bằng readiness hữu hạn sau khi smoke thật bắt được race Express/PostgreSQL startup.

## 2. File thay đổi và ngoài scope

- File code đổi: deploy pipeline/test, app/deployment repository + test, SSH retry option/test,
  logger mask URL + test.
- File docs đổi: truy vết, board, kế hoạch, task log và handoff TK-A15.
- Ngoài scope xác nhận không chạm: renderer, contracts, migrations, collector, ML, monitor,
  `.devflow/`, `docs/ban-giao-20-08.md`, `logo.png` và stash.

## 3. Evidence test

| Môi trường | Command                               | Exit | Kết quả                                     |
| ---------- | ------------------------------------- | ---: | ------------------------------------------- |
| Node 22    | focused deploy/repository/SSH/logger  |    0 | `58/58 PASS`                                |
| Node 22    | lint                                  |    0 | 0 error, 16 renderer warning baseline       |
| Node 22    | typecheck                             |    0 | node + web PASS                             |
| Node 22    | scoped Prettier                       |    0 | PASS                                        |
| Node 22    | CLI compile (`tsconfig.scripts.json`) |    0 | PASS, không chạm VPS                        |
| Node 22    | build                                 |    0 | 3045 modules, PASS                          |
| Node 22    | full test dot                         |    0 | `45 files · 220/220 PASS`                   |
| VM02 smoke | fallback vì VM01 timeout TCP/22       |    0 | auto/manual rollback + data + 3 image PASS  |
| VM01 smoke | TCP/22 không tới được ngày 01/09      |    — | Còn tái xác nhận public URL khi VM01 online |

## 4. Đối chiếu DoD

- [x] Rollback auto/manual chỉ success sau compose + running + healthcheck thật.
- [x] Failure không đổi current sai, đúng event/action log và luôn release lock.
- [x] Runtime image đúng cả chuỗi manual→auto rollback; target mất image báo `VALIDATION`.
- [x] Retention tối đa ba, bảo vệ current/target, không force/không đụng app khác.
- [x] Nhiều app cùng VPS nhận port khác; conflict có mã rõ.
- [x] Diagnostic đủ state/health/exit/error/log tail và không lộ secret.
- [x] Side-effect không retry; probe read-only mới được reconnect retry.
- [x] Toàn bộ local gate xanh; full suite 220/220.
- [x] Board/task/trace/handoff cập nhật; không push/PR/merge.

## 5. Rủi ro/giới hạn

- Đã có smoke thật trên VM02 và ảnh/evidence; chưa thay thế hoàn toàn gate VM01 vì VM01 timeout
  TCP/22 và public port 30000 của VM02 chưa mở.
- Không sửa 16 warning Prettier renderer baseline vì ngoài scope A15.

## 6. Lệnh tái hiện

```powershell
. .\tools\enter-node22.ps1
Set-Location app
pnpm test -- --run src/main/deploy src/main/db/appRepository.test.ts src/main/ssh/ssh.test.ts src/main/logger.test.ts
pnpm lint
pnpm typecheck
pnpm exec prettier --check src/main/deploy src/main/db/appRepository.ts src/main/db/appRepository.test.ts src/main/db/deploymentRepository.ts src/main/ssh/manager.ts src/main/ssh/errorMapping.ts src/main/ssh/ssh.test.ts src/main/logger.ts src/main/logger.test.ts scripts/try-deploy.ts
pnpm exec tsc -p tsconfig.scripts.json
pnpm build
pnpm test -- --reporter=dot
```

## 7. Lịch sử review

| Vòng | Reviewer   | Kết luận       | Finding                                                   | Commit sửa |
| ---- | ---------- | -------------- | --------------------------------------------------------- | ---------- |
| 01   | Codex/root | FIX            | rollback false-success                                    | `d77e4cb`  |
| 02   | Codex/root | FIX            | retention/port/cleanup                                    | `cacac2f`  |
| 03   | Codex/root | FIX            | diagnostic/retry/timer                                    | `2783771`  |
| 04   | Codex/root | FIX            | missing target image + early finished                     | `9f691b0`  |
| 05   | Codex/root | APPROVED LOCAL | runtime image qua rollback lồng; không còn BLOCKING/MAJOR | `9d35acf`  |
| 06   | Smoke thật | FIX → PASS     | rollback probe quá sớm khi app/DB chưa ready              | `6fd3efd`  |

## 8. Xác nhận Git

- [x] Chỉ stage file trong scope.
- [x] Không chạm untracked/stash của user.
- [x] Chưa push, chưa mở PR, chưa merge.
