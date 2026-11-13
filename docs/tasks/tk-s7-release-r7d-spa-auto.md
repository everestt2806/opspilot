# R7d — SPA Git tự deploy khi Main ngắt SSH

START 13/11/2026 — Base `d48ed07`, task-discipline. Tiếp R7c live PASS; kiểm cơ chế Vercel-like cho SPA bằng branch polling thật trên controller luôn chạy. Chỉ app3 `spa-live-6ab247675f19`/port30002 và public demo branch đã tạo; giữ old apps/keys/DB/controller pin. Không đổi runtime/schema/IPC, không deploy intent thủ công cho commit auto. User đã cho phép development VPS/push checkpoint/Kim coauthor; không PR/merge/force/reset/clean/stash/rebase.

| Yêu cầu | Gate | State |
|---|---|---|
| Auto độc lập Main | Live10be92694bb1: resume accepted rồi disconnectAll trước push2e4c991;22HTTP-only polls thấy marker, controller đúng1branch_poll job/succeeded/deployment10/current SHA | PASS |
| Trạng thái cuối an toàn | Terminal settled/cả2leases released; pause accepted, revoke/private cleanup;0active jobs/clients/experiments; old4CID/controllerPID/key/DBinode/schema/Root journals giữ nguyên, source/app khỏe | PASS |
| Hồ sơ và checkpoint | CLI guard/types/lint/syntax/diff và source/raw hashes đạt; board/FR/master/HANDOFF/runbook cập nhật; normal checkpoint commit/push được phép. R7c full2233+2skip là baseline, không rerun cho driver/docs | PASS |

UPDATE 13/11 — Driver `auto.mjs` chỉ nhận explicit development gate/source record; CLI thiếu consent từ chối exit2 trước tạo scratch/kết nối. Node22 syntax, scoped ESLint0/0, Prettier và live-lab tsc PASS. Live record10be92694bb1 đã cold-adopt/đăng ký scoped client, preflight quiescent, policy resume accepted, disconnectAll trước public Git push; đang chỉ quan sát HTTP. Credential lấy RAM từ owned encrypted recovery journal20f qua stdin child, không argv/env/file plaintext; không sửa raw lịch sử R7c.

UPDATE 13/11 — Live10be92694bb1 PASS3checks trên development VPS167.71.202.116. Demo commit `2e4c9913d6a8d01df933fd419bf3fe1a54f52dee`, parent R7c final1191914b; marker mới sau22HTTP-only polls, không Main SSH hoặc manual redeploy trong khoảng quan sát. Actual Root SQLite read-only xác nhận đúng1job `pjob_cf0cdc67-b3ec-4f8d-94d2-696ec50d5f7c`,trigger branch_poll/succeeded; deployment10/currentSHA đúng. Terminal settled06:39:33.347Z/leases released06:39:33.360Z,0unreleased app/build lease. Deep route/index200 và nội dung giống nhau, asset404, Main external observation recorded reachable. Pause/revoke/client0/jobs0/experiments0, old4CID và PID333893/key/DBinode/schema029/Root receipt+upgrade hashes không đổi. Private scratch10be xóa; encrypted recovery private-profile20f đã explicit cleanup sau same-key rollback/client revoke cũ và live mới PASS; raw20f hash giữ nguyên, cleanup record riêng.

## Gate và tái hiện

- `. ./tools/enter-node22.ps1` →Node22.23.3/pnpm11.1.0.
- `pnpm.cmd --prefix app exec prettier --check scripts/product-spa-live/auto.mjs` →PASS.
- `pnpm.cmd --prefix app exec eslint --max-warnings=0 scripts/product-spa-live/auto.mjs` →0errors/0warnings.
- `node --check app/scripts/product-spa-live/auto.mjs` →PASS.
- `node app/scripts/product-spa-live/auto.mjs` →REJECTED/exit2 trước scratch/kết nối; invalid record cũng reject.
- `pnpm.cmd --prefix app exec tsc --noEmit -p scripts/product-spa-live/tsconfig.json` →PASS.
- `Electron-as-Node app/scripts/product-spa-live/auto.mjs --confirm-development-auto 6ab247675f19` →PASS3checks; secret chỉ stdin/RAM/DPAPI. Exact initial Git state guard ngăn rerun sau thành công, không reset refs.
- `git diff --check` và staged-only secret/source/raw-hash review →PASS. [Proof](../ui-redesign/r7d-verification.json); [runbook và failure reconciliation](../../app/scripts/product-spa-live/README.md).

HANDOFF-LOCAL 13/11 — DONE scoped/CHỜ REVIEW,3ledger rows PASS, no accepted exceptions. Implementation SHA: `git log -1 -- app/scripts/product-spa-live/auto.mjs`; normal checkpoint push đã được user cho phép, không PR/merge/force/reset/clean/stash/rebase. Personal untracked không stage. Driver/docs-only, runtime/schema/IPC không đổi;2233PASS+2existingSKIP là baseline `d48ed07`, không báo rerun.

Giới hạn: HTTP-only observer process vẫn chạy; chứng minh Main SSH disconnected đến public success, không tuyên bố OS Desktop process đã thoát. Không GUI/NSIS/máy Windows độc lập/reboot/soak/ML. R7c health403 rollback là gate riêng; R7d kiểm auto healthy commit. Policies đã paused; muốn demo auto cần resume có chủ đích. R7 tổng còn Next/DB/env/full Local-Git matrix/customDockerfile; R3/R11/R4–R6/release tổng vẫn OPEN theo master, không gọi toàn sản phẩm DONE.
