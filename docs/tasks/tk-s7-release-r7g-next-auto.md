# R7g — Next.js tự deploy từ Git khi Main ngắt SSH

START 13/11/2026 — Base `3cc00e2`, product-mode/task-discipline. Tiếp R7f live PASS: chỉ Next app4 `next-live-ba8a98aed302`/port30003/public demo branch riêng. Resume policy qua Main với consent, đóng toàn bộ Main SSH trước push rồi chỉ quan sát HTTP tới marker mới; không manual redeploy hoặc SSH poll trong khoảng này. Không runtime/schema/IPC/pins/dependency change, không production Desktop profile. User đã cho phép development VPS/normal push/Kim coauthor; không PR/merge/force/reset/clean/stash/rebase.

| Yêu cầu | Gate | State |
|---|---|---|
| Auto độc lập Main SSH | Livecb79a3a15cd9 PASS:33HTTP-only polls sau disconnectAll/pushb50f625, đúng1branch_poll/succeeded/deployment15/currentSHA, không manual redeploy/SSH trong khoảng quan sát | PASS |
| Final state và bảo toàn |1terminal settled/cả2leases released; SSR/deep/Nextasset200/missing404/exposure recorded reachable; pause/revoke/private cleanup, old3app/6CID/controllerPID401620/key/DB/schema029/Root journals giữ,0active clients/jobs/experiments | PASS |
| Handoff/checkpoint | Scoped CLI guard/types/lint0/0/prettier/syntax/diff/source+raw hashes; board/FR/master/HANDOFF/runbook, normal checkpoint commit/push. R7e full2244+2skip/R7f live baseline, không full runtime rerun cho driver/docs | PASS |

Giới hạn: observer process vẫn chạy, chứng minh không có Main SSH trong khoảng nhận Git/build/public success, không tự gọi đó là Desktop process đã thoát. R7f manual health503 rollback là proof riêng; R7g kiểm auto healthy commit. Nếu lỗi sau resume giữ encrypted journal/requestkey để checkCommand/reconcile và explicit pause/revoke, không replay hoặc sửa SQL/branch để tạo PASS. Source fixture R7f final phải trùng local+remote HEAD, không reset refs để chạy lại.

UPDATE 13/11 — Driver `auto.mjs --nextjs` kiểm exact R7f record/app4/port30003/framework và local/remote HEADab115722 trước SSH. CLI thiếu consent hoặc recordSPA bị rejectexit2 trước scratch; syntax/Prettier/scopedESLint0/0/live-lab tsc PASS. Livecb79a3a15cd9 preflight0active clients/jobs/experiments/allpaused, coldadoption/scopedclient/policyresume accepted; disconnectAll trước commit/push2sourcefiles (SSR page+public marker), chỉ HTTPobserver đang chạy. Không newcontrollerrelease/runtime/schema/IPC/deps hoặc sourceverification replay; secret qua raw TTY→pipe→RAM/DPAPI, không env/argv/plaintext file/production profile.

UPDATE 13/11 — Livecb79a3a15cd9 PASS3checks. Public demo branch Next sourceb50f625dd7bc3e087ef84bbd767392b83f7f2cab,parentab115722;33HTTP-only polls tới static marker mới, MainSSH vẫn đóng. Reconnect sau public success: actual Root read-only SQLite xác nhận đúng1job `pjob_21d92d01-094a-405d-8025-180b6c0f422a`,triggerbranch_poll/succeeded/targetSHA đúng; APIcurrentdeployment15/currentSHA đúng. H2terminalsettled12:04:06.077Z/leasesreleased12:04:06.089Z,0unreleasedapp/build leases. SSRindex+deeproute chứa marker mới, Nextasset200/missing404, Main externalobservation recorded reachable. Pause accepted/revokeclient/privateDB+key cleanup;0active clients/jobs/experiments và4policiespaused; old3apps/currentdeployment4/5/10/6CID,PID401620/key/DBinode/schema029/Root receipt+upgrade hashes giữ nguyên. R7f raw hashes giữ, không sửa record lịch sử.

## Gates và tái hiện

- `. ./tools/enter-node22.ps1` →Node22.23.3/pnpm11.1.0.
- `pnpm.cmd --prefix app exec prettier --check scripts/product-spa-live/auto.mjs` →PASS.
- `pnpm.cmd --prefix app exec eslint --max-warnings=0 scripts/product-spa-live/auto.mjs` →0errors/0warnings.
- `pnpm.cmd --prefix app exec tsc --noEmit -p scripts/product-spa-live/tsconfig.json` →PASS; `node --check app/scripts/product-spa-live/auto.mjs` →PASS.
- `node app/scripts/product-spa-live/auto.mjs --nextjs` và `... --nextjs --confirm-development-auto 6ab247675f19` →REJECTED/exit2 trước tạo scratch hoặc kết nối. Không mock secret/VPS, không tự tạo test chỉ lặp implementation.
- `Electron-as-Node app/scripts/product-spa-live/auto.mjs --nextjs --confirm-development-auto ba8a98aed302` →PASS3checks; secretstdin/RAM/DPAPI. Gate dùng exact initial sourceguard, không resetrefs hoặc fresh rerun sau thành công; failure reconciliation theo [runbook](../../app/scripts/product-spa-live/README.md#r7g--nextjs-auto-git-khi-main-ngắt-ssh).
- `git diff --check`, staged-only secret/relative-link/source+raw-hash review →PASS; [proof](../ui-redesign/r7g-verification.json). Driver/docs-only, không runtime/schema/pins/deps changes; full2244+2existingSKIP ở R7e là baseline, không rerun claim.

HANDOFF-LOCAL 13/11 — DONE scoped R7g/CHỜ REVIEW,3ledger rows PASS, no accepted exceptions. Implementation SHA: `git log -1 -- app/scripts/product-spa-live/auto.mjs`. Normal checkpoint push có user authorization/Kim coauthor; không PR/merge/force/reset/clean/stash/rebase, personal untracked giữ nguyên. R7 tổng còn DB/env/full Local-Git matrix/customDockerfile; R3/R4–R6/R11/reboot/soak/GUI/release tổng OPEN theo master. Không lấy auto healthy commit thay automatic healthrollback hoặc OS Desktop termination gate.
