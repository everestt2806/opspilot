# R3b-4 — Explicit controller key initialization and VPS credential enrollment

START 06/11/2026 — Tiếp yêu cầu phát triển, base `70dfe9e`, branch `feat/release-audit-20261204`. Task-discipline/CLAUDE/ADR-011; additive local-admin CLI contract trước runtime, không public API/IPC/schema mới, không VPS người dùng/push/PR/merge.

| Yêu cầu | Implementation / gate | State |
|---|---|---|
| Explicit secrets-init, không overwrite/recreate khi còn material | Linux protected store + standalone CLI14/14; retained VPS/runtime key records từ chối | PASS |
| Bounded stdin JSON và strict identity/profile/secret validation | Không argv/env/TTY secret; timeout/abort/byte cap; 29 unit tests trong full gate và actual CLI | PASS |
| Pinned fresh SSH auth trước lưu bound credential | Không remote command; actual SSH lab14/14 và ciphertext-only SQLite | PASS |
| Atomic enrollment/replay/concurrency; không archive restore/rotation | IMMEDIATE transaction, exact replay; hai CLI process thật một VPS, conflict/archived/abort guards | PASS |
| Gate cuối và bàn giao | Full1481 PASS/2 SKIP; types/scripts/lab/lint/build, Linux CLI14/14, explicit stage/diff/secret/link checks | PASS |

## Quyết định phạm vi

- Master key nằm trong controller data directory private hiện hành. `secrets-init` chỉ explicit, không tự chạy từ `init`/`enroll-vps`/read/run. Còn ciphertext/VPS/app ownership/h2 material mà thiếu key thì không tự tạo key thay thế.
- Input contract `product-controller-bootstrap.ts` độc lập Desktop API; local admin gửi JSON qua pipe/stdin EOF, không file secret mới hoặc argv/env. Strict pin/profile trước network, controller ID phải khớp DB hiện hành.
- VPS credential enrollment riêng với target app/helper/HMAC enrollment. Bước này chỉ xác minh SSH và lưu credential; không chạy lệnh trên target, bật service, sửa app ownership hoặc nhận whole R3 DONE.
- Exact replay trả cùng ID và không sửa DB; nếu target/profile/credential khác hoặc hồ sơ archived thì conflict, không tự ghi đè. Auth trước SQL transaction, recheck authority/conflicts trong IMMEDIATE để hai process không tạo duplicate.
- Kiểm chứng Linux scratch SSH/SQLite; không sử dụng hoặc đổi production DB/VPS. Unit Windows chỉ thay filesystem loader và SSH transport; không gọi là live proof.

## Nhật ký

- START 06/11: đọc CLI/database/resolver/schema/bootstrap contract; ghi additive CLI request/result và chọn bounded stdin + pinned authentication + IMMEDIATE commit/replay.
- UPDATE 06/11: triển khai `controllerEnrollment.ts`, bounded stdin reader, hai CLI commands, additive contract và lab Linux độc lập. Focused28/28 PASS trước khi thêm một password-path unit; preliminary CLI14/14 `b0f94f5fcabe`, source comment/format cuối14/14 `420d5398a34b`; không in secret/credential hoặc thực hiện remote command.
- UPDATE 06/11: sửa lỗi lint return-type của helper test và áp dụng ngoại lệ cú pháp cho executable JavaScript theo pattern harness hiện có. Scoped lint0/0 và contract format PASS. Lần lint include contract ngoài base path bị warning; chạy lại đúng scope app, contract kiểm bằng format + typecheck, không nhận ignored file là lint PASS. Full app/types/build đang chờ kết quả cuối; thay đổi cuối harness thêm driver hash và cleanup theo exitCode/signalCode, sẽ chạy lại trước bàn giao.

- UPDATE 06/11: gate cuối Linux CLI **14/14 PASS** `b9c3dbb6e93e`, subject_unchanged/cleanup=true, hai process thật cùng enroll hội tụ. Full app **1481 PASS / 2 SKIP / 0 FAIL**, gồm 29 B4 unit tests. Node/Web/scripts/lab types, scoped ESLint0/0, contract format và production build PASS. Hai Linux-Caddy skips/jsdom warnings giữ giới hạn baseline; không nhận GUI, password SSH live, Docker pipeline/service OS restart hoặc VPS người dùng đã pass từ gate này.

## Lệnh kiểm chứng và evidence

Windows Node22.23.3 sau `tools/enter-node22.ps1`; Linux Node22.23.4 với approved native dependencies tại `/var/tmp/opspilot-p3e3a-runtime/node_modules`.

```text
pnpm --prefix app exec vitest run src/main/controlPlane/controllerEnrollment.test.ts src/main/controlPlane/controllerBootstrapInput.test.ts --reporter=dot
pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=json --outputFile=.out-scripts/release-r3b4-vitest.json
pnpm --prefix app typecheck
pnpm --prefix app exec tsc --noEmit -p tsconfig.scripts.json
pnpm --prefix app exec tsc -p scripts/product-runtime-lab/tsconfig.json
pnpm --prefix app exec eslint src/main/controlPlane/controllerEnrollment.ts src/main/controlPlane/controllerEnrollment.test.ts src/main/controlPlane/controllerBootstrapInput.ts src/main/controlPlane/controllerBootstrapInput.test.ts src/main/controlPlane/cli.ts scripts/product-runtime-lab/controller-enrollment.mjs --max-warnings=0
pnpm --prefix app exec prettier --check ../docs/contracts/product-controller-bootstrap.ts
pnpm --prefix app exec electron-vite build
Linux: OPSPILOT_CONTROL_PLANE_MODULES=/var/tmp/opspilot-p3e3a-runtime/node_modules OPSPILOT_CONTROL_PLANE_OUTPUT=/var/tmp/opspilot-p3e3a-runtime/r3b4/control-plane.cjs node app/scripts/build-control-plane.mjs
Linux: OPSPILOT_CONTROLLER_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3b4/control-plane.cjs node app/scripts/product-runtime-lab/controller-enrollment.mjs
git diff --check
git diff --cached --check
```

- Raw reports không stage: `app/.out-scripts/release-r3b4-vitest.json`; `app/.out-scripts/controller-enrollment/b9c3dbb6e93e/result.json`. Bundle SHA256 `0fc8055c061bc7de99fbf74a1dca8786aae3bb9ef975c9107751d82f594e08c5`, driver SHA256 `aee141afc71c7f2c10689712f07b39555e5c92af7e512b225220d734284c32c2`. Comments cuối không đổi bundle executable hash; report lưu subject hashes hiện hành riêng, không gọi base SHA là source mới.
- Không schema/dependency/IPC mới, không activate controller/target app. Additive local CLI contract đã ghi trước runtime và có DECISIONS. Controller vẫn là nguồn SQLite duy nhất; không copy Desktop database hoặc safeStorage.
- Đã review lại request/ledger/final diff; relative links và staged secret patterns kiểm trước commit, chỉ stage file task, giữ nguyên personal untracked files. Lint warning do invocation ngoài base path đã sửa và chạy lại scope hợp lệ, không có accepted failure.

HANDOFF-LOCAL 06/11 — R3b-4 **CHỜ REVIEW**, implementation SHA: `git log -1 -- app/src/main/controlPlane/controllerEnrollment.ts`. R3b-3 `70dfe9e`, R3b-2 `e705e68`. Tiếp target **app/helper/HMAC** enrollment có immutable manifest/checksum/lost-response reconciliation, rồi resource admission/cold startup scan và service opt-in/OS restart. Không lặp credential bootstrap/resolver; giữ R3 tổng PARTIAL/default polling-only. Không push/PR/merge hoặc production DB/VPS write.

No accepted exception. R3 tổng PARTIAL, service polling-only; live endpoint/pin/domain vẫn chờ user.
