# R3c-6h2b2 — Desktop durable installation journal và discovery

START08/11/2026 — Base `5a6e611`, product-mode/task-discipline. User cho phép development/private lab/normal checkpoint commit/push; không production VPS/DB/PR/merge.

| Yêu cầu | Gate | State |
|---|---|---|
| Contract/schema trước code | Migration029 + cumulative schema + DTO/DECISIONS; fresh/upgrade028/parity/constraints trong journal23 + DB regression100 PASS; immutable UUID/catalog pins/authority, không secret/path từ renderer | PASS |
| Discovery/prepare | SDK20 + native32 PASS: readonly pinned discovery không exec candidate/tạo state, manual/pre-rename residue conflict, match cả hai catalog pins, giữ existing UUID; plan60s/current-profile fences | PASS |
| Dispatch/recovery | Journal23 + native32 PASS: IMMEDIATE operation/session claim trước SSH; same-process contention/foreign-session cold unknown/stale actor fence; actual lost reply→cold process inspect cùngUUID, không auto replay | PASS |
| Profile lifecycle | Journal23 + native32 PASS: archive/re-add current SSH review/explicit rebind tăng authority generation, giữ request key/controller ID/service/DB; cipher/revision/pin/principal/archive edits chặn actor, không token binding rotation | PASS |
| Proof | Full1998PASS/2Linux-onlySKIP/0FAIL (149filesPASS/1SKIP,170.67s); focused69/migration regression100/typecheck7/ESLint16/build/Ruff/native32 PASS; fresh029/upgrade/parity và cleanup đúng | PASS |
| Handoff | Main service methods (chưa IPC/UI), Board/HANDOFF/FR/master release cùng checkpoint;27files UTF8/diff/secret-pattern review,4handoff links; Kim co-author/normal checkpoint push, chưa PR/merge | PASS |

## Phạm vi

Checkpoint hoàn thiện Main installation journal/discovery trước root-admin bridge/vault authority (6h2b3), rồi wizard. Không đưa nút ghi lên renderer trước khi có journal. Readonly discovery được phép trước local intent; mọi SSH mutation chỉ sau durable claim. Plan60s chỉ là review snapshot, không token bền hoặc authorization thay current DB.

Catalog inject từ protected Main configuration, không nhận đường dẫn/pin tùy ý từ IPC. Remote discovery chỉ là hint: match cả release/tool pin với catalog trước khi dùng. Installation/manual state không nhận diện được phải conflict, không tự overwrite. Controller SQLite vẫn canonical; journal Desktop chỉ điều phối cùng remote UUID, không clone controller DB/key. Không thêm dependency. Không init/rotate/rebind access-token binding cũ ngầm; bridge và vault installation authority tiếp6h2b3.

## Nhật ký

- START08/11: tracked tree sạch tại5a6e611. Đọc target setup/vault/admin owner policy/migration patterns. Chọn forward migration + Main journal có authority generation, discovery trước prepare và explicit recovery/rebind. Không sửa migration cũ hoặc production.
- UPDATE08/11: contract/DECISIONS/migration029 trước Main implementation; readonly discovery giữ remote UUID, fresh plan60s và durable claim/current ciphertext/security fences. Focused68 + migration regression100 PASS trên source tương ứng; native32 `e65429fe8377` actualSSH/Python-only PATH/systemd/lost reply/cold MainSQLite029/re-add explicit rebind PASS và cleanup. Đang chốt final source (bổ sung strict journal metadata/late-result fences/Main facade) và chạy lại required gates; không lấy run sớm thay final evidence.
- UPDATE08/11 final native **32/32 PASS**, receipt `app/.out-scripts/controller-bootstrap/dc895eb36d65/result.json`, log `app/.out-scripts/r3c6h2b2-native-accepted.log`. Cold Main process mở DesktopSQLite029 và inspect service schema028, không replay install; archive/re-add/rebind giữ cùngUUID/CID. Fixture/account/group/unit đã dọn; không production. Focused69/migration regression100/typecheck7/ESLint16/build/Ruff/format PASS; full gate đang chạy. Một assertion facade lúc phát triển đọc nhầm `AppError.cause` thay vì `AppError.context.cause`; sửa test theo contract hiện hành, rerun69 PASS, không đổi runtime để né gate.
- HANDOFF-LOCAL09/11 — **DONE checkpoint / CHỜ REVIEW**: xác nhận full report trên final source **1998PASS/2Linux-onlySKIP/0FAIL**,149filesPASS/1SKIP,170.67s. Ledger6/6 PASS, không accepted exception; source/contract/callers/cleanup đối chiếu lại, không code ngoài scope. SHA dùng `git log -1 -- app/src/main/controlPlane/desktopControllerInstallation.ts`; push/remote exact-SHA receipt sau commit tại ignored `app/.out-scripts/r3c6h2b2-push-receipt.json`. Tiếp6h2b3 cần code, không yêu cầu user test thay implementation thiếu.

## Luồng đã triển khai

- Protected Main catalog chứa release ID, hai independent pin và local artifact paths; không có đường nhận paths/pins từ renderer. Native/production dùng cùng journal class và SDK; lab chỉ thay fixed fixture paths và executable đã pin.
- `plan` khám phá metadata qua pinned SSH, chỉ chấp nhận remote UUID khi cả hai pin khớp catalog. Plan tồn tại60s trong Main memory và kiểm lại current profile trước `prepare`; không dùng plan làm quyền SSH bền.
- `prepare` ghi local intent nguyên tử, không cài gì trên VPS. `send` claim operation/session bằng IMMEDIATE trước network write. UUID, pin, identity và known controller ID không đổi; không tự replay install sau timeout/đóng app.
- `inspect` đọc staging rồi installer receipt. Chỉ definite NOT_FOUND với verified staging và chưa biết controller ID mới cho phép explicit install cùng UUID. Missing staging/partial state không được hiểu là đã mất controller: giữ evidence, chuyển unknown. `installed` tách khỏi service đang running/stopped, inspect không restart.
- Gỡ VPS không cascade journal. Thêm lại cùng host/port/host-key/principal nhưng security revision/cipher envelope đổi thì phải review và explicit `rebind`; authority generation tăng, giữ UUID/controller ID rồi inspect. Không rotate/rebind API access-token binding ngầm.
- `DesktopControllerService` có typed plan/prepare/list/cancel/send/inspect/rebind; catalog mặc định rỗng nên không mở luồng cài khi chưa cấu hình trusted artifact distribution. Không IPC/preload/UI change hoặc dependency mới.

## Gates và cách chạy

- Node Windows: `. ./tools/enter-node22.ps1`; không dùng default Node24.
- Focused final: `pnpm --prefix app exec vitest run src/main/controlPlane/desktopControllerInstallation.test.ts src/main/controlPlane/controllerSshBootstrap.test.ts src/main/db/index.test.ts src/main/controlPlane/desktopControllerService.test.ts --maxWorkers=3` — **69 PASS**, gồm23journal/20SDK/26DB+Main facade hiện hành. Log `app/.out-scripts/r3c6h2b2-focused-final.log`.
- Migration regression: six suites `productMigration`, `desktopControllerCommands`, `desktopControllerVault`, `desktopProjectSetup`, `desktopTargetSetup`, `projectRegistration` — **100 PASS**; log `app/.out-scripts/r3c6h2b2-migration-regression.log`. Fresh029/41tables, upgrade028 giữ VPS, schema/table/trigger parity và security constraints được kiểm tra. Chỉ cập nhật rollback fixtures/expected latest version; không sửa migration001–028.
- Typecheck7: `pnpm --prefix app exec tsc --noEmit -p <project>` với Node/Web `--composite false`, scripts, product-runtime-lab, controller-release-lab, controller-service-lab và controller-bootstrap-lab — **7/7 PASS**, receipt `app/.out-scripts/r3c6h2b2-types-accepted.json`.
- ESLint16files0errors/0warnings: `app/.out-scripts/r3c6h2b2-eslint-accepted.json`; Python `ruff check` và `ruff format --check app/control-plane-runtime/controller_ssh_bootstrap.py` PASS. Build `pnpm --prefix app build` PASS, log `app/.out-scripts/r3c6h2b2-build-accepted.log`.
- Native: chạy root Linux Node22 `app/scripts/controller-bootstrap-lab/run.mjs`, env `OPSPILOT_CONTROL_PLANE_MODULES=/var/tmp/opspilot-p3e3a-runtime/node_modules`, `OPSPILOT_CONTROLLER_RELEASE_OUTPUT=/home/everestt2806/.cache/opspilot-r3c6h2a/release`, `OPSPILOT_CONTROLLER_RELEASE_PIN=be4b729aab82eedaec2fe713a14fe423012cd2eee0e1bb6b80b9a128aea757be`. Host Node binary `/home/everestt2806/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin/node`; SSH PATH chỉ Python3.
- Native dùng **Main DB029** từ current source nhưng pinned controller payload vẫn **schema028** từ approved6h2a release; không tuyên bố đã upgrade remote runtime. Fixture encrypted SSH key/AES key chỉ trong private temp DB/RAM/stdin pipe, không secret argv/env/log. Account/group/unit/root được owner/nonce/path kiểm trước cleanup. Không production DB/VPS hoặc host reboot.
- Final native32 receipt `app/.out-scripts/controller-bootstrap/dc895eb36d65/result.json`, log `app/.out-scripts/r3c6h2b2-native-accepted.log`: readonly absent/manual-conflict/pre-rename-crash/discovery,145MB interrupted transfer/resume, independent Python tamper/lock guards, durable Main install/lostreply→oneinstall→cold Main inspect/running, archive/re-add/rebind, stoppedservice inspect không restart. All cleanup flags true;0production.
- Full: `pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=default --reporter=json --outputFile=.out-scripts/release-r3c6h2b2-vitest-accepted.json` — **1998PASS/2SKIP/0FAIL**,149filesPASS/1SKIP,170.67s; `.json` và `.log` cùng tên. Hai Linux-only Caddy cases skip trên Windows như baseline, không tính là live PASS.
- Review27files: `app/.out-scripts/r3c6h2b2-review-accepted.json`; UTF8 hợp lệ,0private-key/GitHub-token/AWS-key pattern findings; diff check sạch. File cá nhân/tooling giữ ngoài index, không commit binary/runtime hoặc credential.
- Electron visual check **N/A** vì không UI/IPC/preload thay đổi; ML pytest **N/A** vì không ML/collector/experiment change. Không dùng counts thay PRODUCT_PASS. Accepted exceptions: không có.

## Tiếp theo

1. **6h2b3 — cần code:** fixed root-admin bridge xác minh root transfer/install receipts, predefined paths, service account/unit/UID rồi drop UID/clear groups trước existing admin CLI. Vault binding phải chứa installation request/authority revision và bị invalidated khi rebind; không nới default same-UID owner policy hoặc nhận UID/path tùy ý từ IPC.
2. **6h2c — cần code:** Settings wizard chọn VPS → preflight → review/consent → transfer/install/status/recover → bind; dùng journal trước mọi mutation, hiển thị unknown và recovery rõ ràng. Token binding chỉ sau bridge xong.
3. Trusted distribution/builder/packaged assets, supported libc baseline, upgrade/uninstall/rotation, live VPS/reboot/soak và acceptance demo vẫn có checkpoint riêng. Không yêu cầu user test thay phần code chưa viết.
