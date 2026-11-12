# R3c-6h4c — Nâng cấp controller và live exposure

START11/11/2026 — Base `f470a05`, product-mode/task-discipline. User yêu cầu tiếp tục; implementation/lab/normal checkpoint push được phép, không PR/merge/reset/clean/stash/rebase. Giữ demo VPS đang chạy, không thay installed pins/receipt/key/DB ngầm.

## Phạm vi và checkpoints

START12/11/2026 — Base `60c14ed`, c-2b3 product-mode: explicit SSH credential/VPS-ID rebind cho controller có lịch sử upgrade. Dùng task-discipline; được implementation/private lab/checkpoint normal push, không PR/merge/reset/clean/stash/rebase. Không chạm VPS/production DB trong slice này.

### Ledger c-2b3 — Nhận lại quyền SSH sau upgrade

| Yêu cầu | Điều kiện nhận / kiểm chứng | State |
|---|---|---|
| Contract/schema | Desktop-only031 append-only epochs, core intent/controller029/migration cũ giữ nguyên; cumulative schema/migration role regression và30AST DTO/IPC parity PASS | PASS |
| Main/SSH | Fresh candidate pinned SSH/Root inspect→review60s/consent/CAS; atomic authority + mid-transaction abort/late-result regression PASS, actual SSH native16/PID preserved | PASS |
| API binding | Gap fail-closed; multi-epoch/fresh separate review-confirm giữ token/client/scopes, actual native API200/Root admin và Electron confirmation PASS | PASS |
| UI | Settings4locale candidate/host/user/fingerprint review/consent và late close/reopen; UI9tests + final Electron6/19ảnh PASS, synthetic SSH ghi rõ | PASS |
| Verification/handoff | Focused/full/type/lint/build/contract/package/native SSH+SQLite và isolated Electron; source hashes/cleanup/board/FR/master/HANDOFF/proof/Kim coauthor/normal push | PASS |

Chọn audit epoch + atomic local authority update có trigger cho phép theo đúng receipt, thay vì overlay ngầm ở nhiều reader. Migration031 giữ core intent bất biến và lịch sử previous/next authority; không sửa030 hoặc bypass trigger. Rebind chỉ cùng SSH machine identity (host/port/fingerprint/username), cho phép credential/auth method và local VPS ID đổi. Hai bước local rõ ràng: SSH authority confirm trước, API binding vẫn bị chặn cho tới fresh runtime review/confirm riêng. Không tự pause apps, cài lại controller, chuyển token sang máy khác hoặc sửa canonical controller DB. Remote NOT_FOUND/không chứng minh current operation phải từ chối, không học khóa/replay để né thiếu evidence.

UPDATE12/11 — Implemented Desktop-only031 với append-only previous/next authority audit và trigger bảo toàn core intent; Main candidate SSH review60s/CAS/explicit confirm cập nhật installation + upgrade history trong một transaction. Vault kiểm audit chain cho phép API refresh riêng mà giữ token/client/scopes; current/archived/credential fences vẫn fail-closed. UI4locale chọn current VPS, review hostname/user/fingerprint và consent riêng; close/reopen bỏ phản hồi muộn. Focused đầu Main/DB/IPC68PASS, focused UI9PASS; final schema regression/type/lint/native/Electron/full đang kiểm, chưa claim checkpoint DONE.

UPDATE12/11 — Final focused8files/139tests PASS, gồm two authority epochs và API token/client preservation, wrong machine/changed credential/expiry/remote mismatch, mid-transaction abort rollback toàn bộ audit+installation+upgrade, late SSH result và UI close/reopen guards. Native `c648b03a628e`16PASS actual SSH/systemd/Main031/controller029/API200/current root admin với readded VPS ID và ciphertext mới, UUID/PID/token/client giữ nguyên, Root/unit/account cleanup=true. Native dùng cùng key SSH fixture được re-encrypt; không claim actual remote key/password rotation.30AST parity và23file ESLint0errors/0warnings PASS. Electron phát hiện test harness không remount khi mở lại cùng theme/locale (đã sửa nonce key); tiếp đó phát hiện API confirmation bị gắn vào checkbox upgrade không liên quan, đã cho fresh-review + nút confirm API riêng. Final Electron/type/build/full còn chạy; chưa DONE.

## HANDOFF12/11 — c-2b3 DONE scoped / CHỜ REVIEW

- Ledger c-2b3 đạt5/5PASS, không accepted exception. [Proof/source hashes](../ui-redesign/r3c6h4c2b3-verification.json), [19ảnh Electron](../ui-redesign/screenshots/r3c6h4c2b3/). SHA dùng `git log -1 -- app/src/main/controlPlane/desktopControllerAuthority.ts`. Không đổi VPS/production DB; parent6h4/R3 chưa đóng.
- `pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=default --reporter=json --outputFile.json=.out-scripts/r3c6h4c2b3-full-final.json` →2197PASS/2existingLinux-onlySKIP/0FAIL,163files. Focused8files/139tests PASS và nằm trong full cuối; Main kiểm multi-epoch/token/client, wrong identity/late credential/expiry/remote mismatch,7legacy entrypoints, atomic abort rollback audit+installation+history, UI consent/late response. Không thêm skip/đổi timeout.
- Node22: `pnpm --prefix app exec tsc --noEmit -p <project> --composite false` →10projects trong proof PASS; `pnpm.cmd --prefix app exec eslint --max-warnings=0 --no-warn-ignored <23files>` →0error/0warning. `pnpm --prefix app build` PASS, `node app/.out-scripts/check-authority-parity.cjs` →30AST, `node app/.out-scripts/check-upgrade-package.cjs` →compiled Main packaging gate PASS. Exact logs/hash ở proof; tiny parity/package helpers là scratch ignored, package hook tái hiện trong lab README.
- Native `c648b03a628e`16PASS: actual pinned SSH/systemd/root/admin/enrollment/Main/vault/API200; original local VPS archive→new ID/ciphertext, fresh candidate root inspect→SSH authority confirm→separate API binding confirm, same UUID/PID/token/client. Rollback và archive refusal giữ nguyên receipt/identity/key/DB inode, cleanup root/unit/account=true. Key SSH fixture được re-encrypt, không claim remote key/password rotation;0Productapps/targets/Docker/OS reboot/live VPS.
- Electron `14d88c04341b`6PASS/19captures, production preload/UI/typed IPC/actual Main/private native SQLite/encrypted vault với synthetic SSH. Reopen/remount candidate list đúng, host/user/fingerprint review và SSH consent riêng; API refresh có review/confirm riêng, không bắt chọn checkbox upgrade. Token/client/scopes giữ nguyên;4locale×2theme×2size không cuộn ngang,0renderer errors/private data removed=true.
- Desktop031/controller029, schema cumulative parity và controller-role rejection PASS; migration001–030/approved resource pins/dependencies giữ nguyên. Chỉ thay quyền local khi same-machine proof đủ; append-only audit lưu previous/next public authority/digest/result, không secret. Root NOT_FOUND/unsettled/noncurrent hoặc live in-flight bị từ chối, không chuyển sang máy khác/học khóa/replay operation. C-3 live gate vẫn bắt buộc.
- Board/FR/master/HANDOFF/parent/proof đồng bộ. Exact staging/Kim coauthor/normal checkpoint push; không PR/merge/reset/clean/stash/rebase. [Lab/reproduction commands](../../app/scripts/controller-upgrade-desktop-lab/README.md). Bước kế tiếp: fresh VPS preflight, upgrade bằng existing approved pins/UUID giữ controller identity/UID/key/DB/target/demo, rồi actual installed exposure API và isolated Electron onboarding/reconnect/firstdeploy.

START12/11/2026 — Base `640a6c9`, c-2b2: Main revision binding/vault và Desktop upgrade wizard, protected release catalog, explicit token-preserving refresh. Giữ original installation authority/pins và current SSH fences, không live VPS.

### Ledger c-2b2 — Desktop upgrade feature

| Yêu cầu | Điều kiện nhận | State |
|---|---|---|
| Contract/catalog | 8typed IDs/consent IPC, protected new release093a059/tool7b19cef entry, original pins/bytes giữ nguyên;24AST DTO/IPC parity và compiled Main package resource gate PASS | PASS |
| Main/vault | Actual Linux SSH/service/vault/enrollment/API token200/current admin; explicit fresh Main review/consent token/client/scope preserved, old/unknown epoch blocked; Main TTL/consent/replay regression PASS trong full cuối | PASS |
| UI | Settings wizard4locale, manual upgrade/inspect/recovery/rollback/refresh; final Electron5checks/17ảnh typed preload/Main/private SQLite, no horizontal overflow/errors, synthetic SSH ghi rõ | PASS |
| Verification | Full2191PASS/2existingLinux-onlySKIP/0FAIL;94focused/7files,10types/ESLint19/build/24AST/package/native15/Electron5+17ảnh PASS; cleanup/source hashes trong proof | PASS |
| Handoff | Board/FR/HANDOFF/master/parent/proof đồng bộ; exact staged files/Kim coauthor/normal checkpoint push, SHA qua `git log -1 -- app/src/renderer/src/components/ControllerUpgradeWizard.tsx`; explicit SSH authority rebind/live còn mở | PASS |

UPDATE12/11 — c-2b2 triển khai8typed IDs/consent-only IPC + Settings wizard4locale; Main compose durable upgrade, Root revision admin dispatch theo explicit binding authority. Vault chặn pending/unknown/stale, fresh root inspect→60s review→consent re-encrypt cùng token/client/scopes, revision+1; không schema/dependency change. Protected new catalog `linux-x64-node22-20261112-upgrade` pin093a059/root updater7b19cef, original resource/pins giữ nguyên. Binary resources generated/ignored, package gate verify cả2entries.

Focused73PASS/5files trước thêm Main TTL/replay review test; UI7PASS đã kiểm consent/manual actions/unknown/late reply/safe errors/4locale. Electron lượt `0f76ea534c1c`5checks/17ảnh PASS: production preload/typed IPC/actual Main/private SQLite/vault với synthetic SSH; unknown không replay, explicit refresh giữ token và rollback cần confirm riêng,4locale×2theme×2size không ngang. Private data removed=true,0renderer errors. Source cuối có guard historical badge và thêm review TTL test nên sẽ chạy lại final gates trước claim DONE.

Native lượt đầu `835c4f46f423`15PASS với actual new release093a059, SSH/systemd/vault/enrollment/API token dùng được sau upgrade/rollback và revision admin; root/unit/account dọn xong. Source cuối chuyển refresh qua DesktopControllerService fresh-review/consent, native cuối đang chạy; không dùng lượt đầu thay current Main proof.0Productapps/targets/productionDB/VPS/OS reboot/Docker claim.

UPDATE12/11 — Native source cuối `8955a8604429`15PASS/27compressed SSH commands, actual Main fresh review/consent giữ token/client và API200 sau upgrade/rollback, Root admin/parent authority và archive guard; root/unit/account removed=true.0Productapps/targets/production. Final Electron `9550b835e110`5PASS/17ảnh, production preload+component+Main service/SQLite/encrypted vault với synthetic transport; private data removed=true/renderer errors0.10types/ESLint19 (ignored giant IPC file không lint theo config)/production build/package hook/24AST PASS; full Vitest cuối đang chạy. Main API revision refresh giữ SSH principal/cipher; explicit SSH rebind vẫn OPEN, không claim c-2 tổng hoặc live rollout hoàn tất.

## HANDOFF12/11 — c-2b2 DONE scoped / CHỜ REVIEW

- Ledger c-2b2 đạt5/5PASS; không accepted exception. [Proof/source hashes](../ui-redesign/r3c6h4c2b2-verification.json), [17ảnh Electron](../ui-redesign/screenshots/r3c6h4c2b2/). SHA dùng `git log -1 -- app/src/renderer/src/components/ControllerUpgradeWizard.tsx`. Chỉ runtime refresh cùng SSH principal/cipher; explicit credential/VPS-ID rebind và live c-3 còn mở, không đóng c-2 tổng/6h4/R3.
- Final `pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=default --reporter=json --outputFile.json=.out-scripts/r3c6h4c2b2-full-final.json` →2191PASS/2existingLinux-onlySKIP/0FAIL,163files;94focused assertions/7files trong cùng lượt full. Hai lượt trước real-Git publicBranch timeout15000ms nhưng chạy riêng đạt. Test cấp query15000ms bằng toàn deadline15000ms, chưa tính fixture/kill/cleanup; giảm riêng query test xuống5000ms và nhận typed GIT_TIMEOUT/GIT_REMOTE_ERROR như thất bại mạng, vẫn bắt buộc không trả SHA của local insteadOf fixture. Không đổi timeout app/global test hoặc thêm skip; đây là sửa test budget có ghi nhận, không waiver gate.
- Node22: `pnpm --prefix app exec tsc --noEmit -p <project> --composite false` →10projects trong proof PASS. `pnpm.cmd --prefix app exec eslint --no-warn-ignored <19 exact files>` →0error/0warning; giant shared/ipc.ts theo ignore config, được typecheck/AST. `pnpm --prefix app build` PASS. Raw logs prefix `app/.out-scripts/r3c6h4c2b2-final-*`; `node app/.out-scripts/check-upgrade-parity.cjs` →24AST, `node app/.out-scripts/check-upgrade-package.cjs` →compiled Main packaging gate PASS. Scripts kiểm nhỏ là scratch ignored; packaging hook tái hiện trong README lab.
- Final native `36e76600ef48`15PASS: actual private Linux SSH/systemd/Main030/controller029/root admin/enrollment/vault/authenticated API200 sau upgrade và rollback, lostreply→cold Main inspect không replay/restart, receipt/key/DB inode/controller identity giữ nguyên. root/unit/account removed=true,27compressed SSH commands/max11142bytes;0Productapps/targets/VPS/productionDB/Docker/OS reboot claim. Final Electron `4add6ca53b7d`5PASS/17captures, production preload/UI/typed IPC/Main/private SQLite; SSH synthetic ghi rõ, private data removed=true/0renderer errors/no horizontal overflow ở4locale×2theme×2size.
- Rà soát cuối phát hiện legacy install inspect có thể ghi outcome_unknown vào original authority sau upgrade. Service chặn inspect/send/rebind/register bằng UPGRADE_INSPECT_REQUIRED trước bất kỳ mutation; regression thử7entrypoints, original row giữ nguyên và fresh upgrade binding review vẫn chạy. Pending/unknown revision fail-closed, review60s/consent/replay và cipher/session fences đều kiểm chứng.
- Additional protected descriptor `linux-x64-node22-20261112-upgrade`: release093a059/payload4e3a163/updater7b19cef,998files/145005807bytes; binary ignored/generated. Original release96a6a5b/tool7e22786 giữ nguyên. [Reproduction/native/Electron commands](../../app/scripts/controller-upgrade-desktop-lab/README.md); không migration/dependency mới, không ghi VPS hoặc production DB. Normal checkpoint push/Kim coauthor; không PR/merge/reset/clean/stash/rebase. Personal untracked giữ ngoài index.

### Giới hạn c-2b2 tại thời điểm bàn giao (same-machine rebind đã đạt c-2b3)

- Khi VPS ID/SSH credential đổi, giữ original install và upgrade UUID/history/attempted; fresh original+current revision proof dưới pinned SSH, bump local authority epoch, không đổi pin hoặc dùng old-unit inspector để né guard. Migration030 immutable authority hiện từ chối sửa fields; nếu cần epoch rebind phải contract/migration Desktop-only mới, controller giữ029.
- Liên kết review/rebind của installation, upgrade và encrypted API binding cần thiết kế nguyên tử hoặc có trạng thái recovery rõ ràng; bất kỳ gap đều fail-closed. Không tự decrypt bằng profile khác hoặc cấp client/token mới để che lỗi cũ.
- Gate same-machine rebind đã đạt ở c-2b3. Live c-3 dùng protected release/updater mới trên VPS phát triển, giữ demo/controller identity/UID/key/DB/target; actual installed exposure API và full isolated Electron onboarding/reconnect/firstdeploy. Hiện VPS/demo/pins/DB/key không bị tác động.

Phạm vi refresh c-2b2 giữ nguyên SSH principal/cipher authority đã xác minh. Credential/VPS ID thay đổi vẫn fail-closed; không dùng UI refresh revision để tự thông qua SSH authority rebind. Luồng rebind cần fresh root evidence xuyên cả original install và upgrade intent/epoch; triển khai riêng nếu không chứng minh đủ trong slice này, không claim hoàn thành.

START12/11/2026 — Base `db95d10`, tiếp c-2b bằng lát c-2b1: root admin bridge cho current upgraded revision và explicit same-key recovery khi transport mất trước root journal. Task-discipline, không production VPS/DB, không API binding/UI ngầm.

### Ledger c-2b1 — runtime authority và khôi phục trước root journal

| Yêu cầu | Điều kiện nhận | State |
|---|---|---|
| Contract/authority | Additive revision authority + original flock xuyên service-UID admin; focused69 gồm historical/unsettled/maintenance reject và native12 gồm current/rolled-back status, wrong UID/payload, stopped reject | PASS |
| Recovery | Native actual SSH close trước Python/root exec: missing journal + attempted giữ nguyên, wrong parent không tạo journal, explicit same-key recover rồi lostreply/cold inspect/PID preservation | PASS |
| SSH bridge | Native12 current source receiver/updater/Main, purpose upgrade admin/pin/runtime-derived fixed paths/safe result; original admin path unchanged, original receipt/key/DB inode preserved | PASS |
| Verification | Full2182PASS/2existingLinux-onlySKIP/0FAIL,69focused/4files,10types/ESLint11/build/builder/2negativeCLI/Ruff/native12 PASS; cleanup/source hash proof | PASS |
| Handoff | Board/FR/master/HANDOFF/parent/proof đồng bộ; Kim coauthor/normal checkpoint push, SHA qua `git log -1 -- app/src/main/controlPlane/controllerInstalledAdmin.ts`; Main revision binding/rebind/UI/Electron/live mở | PASS |

UPDATE12/11 — Implemented additive root revision authority/inspected callback under original flock; exact current settled/ready runtime rồi setpriv service UID mới chạy unchanged Python admin verifier. Original admin path unchanged. Explicit recover từ verified namespace có thể tạo missing journal sau fresh parent attestation; same key/attempt giữ nguyên. Focused4files/62tests PASS và ESLint10files PASS;10types/native đang chạy. Chưa claim root admin được Main vault/UI sử dụng hoặc VPS live đã upgrade.

UPDATE12/11 — Lượt native đầu `687e60979a48`11checks PASS/cleanup root-unit-account true, actual SSH disconnect trước Python/root exec giữ attempted, wrong parent recover không tạo journal, explicit same-key recover/lostreply→cold Main inspect/PID preservation; revision admin status trên current và restored parent, wrong UID/payload rejected. Source cuối thêm gate settled/current/ready validator + stopped-service native negative; focused69PASS/4files, final10types/ESLint11/build/builder/2negativeCLI/Ruff PASS. Native cuối và full gate chưa hoàn tất tại thời điểm nhật ký này.

UPDATE12/11 — Native source cuối `a8749884a878`12checks PASS,23compressed SSH commands/max11142bytes, root/unit/account removed=true. Same original identity/key/DB inode và root receipt; status admin read-only actual service UID trên current/rolled-back runtime, stopped controller không bị start bởi admin.0Productapps/targets/productionDB/VPS, không enrollment/rotation/Docker/reboot/UI claim. Full Vitest cuối đang chạy; root updater CLI build pin `7b19cefec8abce4d9dbba21ec234949fd4ae8783d9994cba817701e5f32a71d0`, old packaged installer/pins không đổi. Không migration/dependency/template/helper change.

## HANDOFF12/11 — c-2b1 DONE scoped / CHỜ REVIEW

- Ledger c-2b1 đạt5/5PASS, không accepted exception. [Proof/source hashes](../ui-redesign/r3c6h4c2b1-verification.json); SHA dùng `git log -1 -- app/src/main/controlPlane/controllerInstalledAdmin.ts`. Đây là root backend/SSH, chưa Main vault/current binding/UI/Electron hoặc VPS rollout. c-2b2/c-3 và parent6h4/R3 còn mở.
- `pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=default --reporter=json --outputFile.json=.out-scripts/r3c6h4c2b1-full-final.json` →161files PASS/1SKIP (162),2182tests PASS/2SKIP (2184),290.00s;69focused assertions/4files nằm trong lượt full cuối. Hai skip Caddy Linux-only có sẵn, không thêm skip/nới timeout. Logs cùng prefix trong `app/.out-scripts/`.
- `. ./tools/enter-node22.ps1`; `pnpm --prefix app exec tsc --noEmit -p <project> --composite false` →10projects trong proof PASS; logs `r3c6h4c2b1-final-type-*.log`. `pnpm.cmd --prefix app exec eslint`11file →0error/0warning; `pnpm --prefix app build` PASS, raw `r3c6h4c2b1-final-lint.log`/`r3c6h4c2b1-final-build.log`. Ruff check + format --check bootstrap Python đều PASS.
- Linux `build-controller-installer.mjs` tạo trusted root updater pin `7b19cefec8abce4d9dbba21ec234949fd4ae8783d9994cba817701e5f32a71d0`; negative recover thiếu authority và admin foreign-path đều trả safe error/expected exit1. Raw `r3c6h4c2b1-installer-final.log`, `r3c6h4c2b1-negative-{recover,admin}.log`. Original packaged resource/tool/pins không thay, không deploy updater này lên VPS.
- [Native README](../../app/scripts/controller-upgrade-desktop-lab/README.md): root Linux/systemd/Node22, modules `/var/tmp/opspilot-p3e3a-runtime/node_modules`, golden original release/pin96a6a5 và verified candidatev4/pincb70e1 từ hồ sơ c-2a. Current source receiver/root updater/Main build trong fixture nonce; `app/.out-scripts/controller-upgrade-desktop/a8749884a878/result.json`12PASS, raw `r3c6h4c2b1-native-final.log`. Actual SSH disconnect trước Python/root exec; wrong parent không tạo journal; same-key recover/lostreply/cold Main/PID preservation; admin status current/restored parent, wrong UID/payload/stopped refusal.23compressed SSH exec/max11142bytes; root/unit/account removed=true.
- Native admin positive chỉ read-only status,0Productapps/targets; không enrollment/rotation/Docker/OS reboot/production DB/VPS/UI claim. Không schema/migration/dependency/helper/template/collector change. Main binding/token không tự cập nhật; tiếp c-2b2 theo task bên dưới, sau đó live c-3. Normal checkpoint push theo quyền user, không PR/merge; personal untracked ngoài index.

### Tiếp c-2b2 — Main revision authority và UI (chưa triển khai)

- Main protected catalog phải có updater/release pin mới riêng; không đổi original catalog entry/resource bytes. `DesktopControllerUpgrades` phải được compose vào Desktop service, giữ generation/current SSH/cipher checks trước và sau mỗi await.
- Binding intent giữ original installation reference và thêm explicit current upgrade operation authority. Vault phải chặn binding cũ khi current runtime đổi; chỉ hành động review/consent mới được cập nhật encrypted binding/token envelope. Không auto-enroll token mới, nới currentInstallation verifier, bỏ generation fence hoặc lấy `is_current` cache làm remote attestation.
- Admin dispatch chọn đúng namespace/revision/root updater đã pin; root c-2b1 derive runtime/UID từ original receipt + current upgrade journal. Historical operation không là quyền admin; rollback outcome dùng parent runtime đúng payload/hash.
- Explicit authority rebind khi credential/VPS ID đổi cần fresh pinned SSH/original-install/upgrade current evidence, giữ UUID/history/attempted, bump local epoch. Không gọi old inspector lên unit mới rồi sửa pin để né lỗi. API requests và kết quả đang bay phải bị fence khi epoch đổi.
- IPC chỉ IDs/release ID/consent; UI4locale review→transfer→upgrade/inspect/explicit recovery/rollback, cảnh báo pause từng app và unknown. Thêm real isolated Electron flow trước live c-3. Scope c-2b1 backend pass không là Desktop feature đã xong.

START12/11/2026 — Base `0e61286`, tiếp c-2. Dùng task-discipline; không truy cập VPS hoặc sửa runtime đã cài trong checkpoint này.

### Ledger c-2a — Main journal và pinned SSH upgrade transport

| Yêu cầu | Điều kiện nhận | State |
|---|---|---|
| Schema boundary | Migration030 Desktop-only, role tests và current bundled Linux CLI init/secrets/check/status3PASS giữ controller029, identity/key/DB inode;001–029 nguyên vẹn | PASS |
| Contract và intent | Durable UUID/pins/parent/SSH-envelope authority trước effect; focused và native8 chứng minh lostreply→separate cold Main process→inspect không replay/PID unchanged, không API rebind | PASS |
| Transport | Namespace upgrade UUID tách original staging, receiver/tool pin reject, fixed bounded RPC và command compression đã hash-verify; native8 PASS/15compressed SSH commands, cap24KB | PASS |
| Gates | Full2172PASS/2existingLinux-onlySKIP/0FAIL,321focused assertions/20files;10types/ESLint21/Ruff/check+format/build/builder/negativeCLI/nativeSSH8/current bundle role3 PASS; cleanup/source hashes trong proof | PASS |
| Handoff | Board/FR/master/HANDOFF/parent/proof đồng bộ; coauthor Kim/normal checkpoint push, SHA qua `git log -1 -- app/src/main/controlPlane/desktopControllerUpgrade.ts`; c-2b/c-3 còn mở | PASS |

c-2 được thực hiện theo hai lát có gate độc lập: c-2a journal/transport/schema boundary; c-2b upgraded admin/current binding + IPC/UI/Electron. Root c-1 đã xong không thay thế Main authority, và c-2a không được dùng để claim Desktop upgrade UI hoặc rollout VPS.

UPDATE12/11 — Desktop030/controller029 tách role; Main lưu UUID/parent/tool/release/current SSH envelope digest trước dispatch, same-key explicit inspect/recover/rollback, không reset attempted hoặc tự rebind token. Focused20files/320tests PASS, bổ sung second-revision/history và SSH compression tests có lượt focused25PASS; full cuối vẫn cần chạy.

Linux native đã chứng minh transfer/upgrade/lostreply→separate cold Main process→inspect không restart/rollback giữ identity/key/DB inode. Lượt `154c169cdaf6` đạt7checks rồi FAIL do fixture giữ VpsRepository gắn SQLite connection đã đóng sau cold reopen; đã sửa fixture tạo repository từ connection mới, chưa dùng lượt lỗi làm PASS. Các lượt đầu exec0 vì bootstrap35KB vượt SSH packet: phép thử độc lập 30KB exec được/36KB `Bad packet length`; SshManager nén bytes đã xác minh hash bằng builtin zlib, command cap24KB, reject incompressible trước auth. Native sau sửa dùng command11078bytes thay script35250bytes.

Giới hạn c-2a: pending/history bảo toàn sau archive nhưng authority đổi bị chặn trước SSH; explicit upgrade-authority rebind khi credential/VPS ID đổi cần c-2b. Không dùng old inspector để giả chứng thực upgraded runtime; API credential/admin binding chưa được tự cập nhật. Namespace mới chỉ staging/root CLI; không public port, production DB, Docker workload, OS reboot hay live VPS claim.

UPDATE12/11 — Native cuối `80742200af53`8PASS, actual source Python/Ruff final: Desktop030/controller029, protected original staging và independent pins, lostreply/separate cold process/PID preservation/explicit rollback/archive authority.15SSH commands nén, script35670bytes/maxcommand11078bytes; Root/unit/account removed=true,0production/0Productapps/targets. Current production controller payload build có bundle manifest pin `4e3a163f077f69cd23b58ffcd26e40506489041804a9b01ea9ef006db3588510`; independent native role gate3PASS chứng minh source mới init/reopen/checker vẫn029, key/identity/inode không đổi, fixture removed. Không dùng candidatev4 cũ làm bằng chứng cho role code mới.10types/ESLint20+role1/Ruff check+format/build/builder/negativeCLI PASS; full Vitest đang chạy, chưa claim gate cuối.

## HANDOFF12/11 — c-2a DONE scoped / CHỜ REVIEW

- [Proof/source hashes](../ui-redesign/r3c6h4c2a-verification.json), ledger c-2a5/5PASS. Không accepted exception. c-2b/c-3 và parent6h4/R3 vẫn mở; không claim UI/live/PRODUCT_PASS.
- Full: `pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=default --reporter=json --outputFile.json=.out-scripts/r3c6h4c2a-full-final.json` →161files PASS/1SKIP (162),2172tests PASS/2SKIP (2174),251.73s.321focused assertions/20files đều nằm trong lượt full này; skips Caddy Linux-only có sẵn, không thêm skip/nới timeout. Raw `.json`/`.log` cùng prefix trong `app/.out-scripts/`.
- `. ./tools/enter-node22.ps1`; `pnpm --prefix app exec tsc --noEmit -p <project> --composite false` →10projects PASS: node/web/scripts +7lab projects trong proof. `pnpm.cmd --prefix app exec eslint`21file →0error/0warning; Ruff check và format --check cho `app/control-plane-runtime/controller_ssh_bootstrap.py` PASS. `pnpm --prefix app build` PASS, raw `r3c6h4c2a-build-final.log`.
- Trusted installer builder PASS/pin `93f1cff2356dafdec85d273fa4f494db25b8ffb35196737d5e10d2b7448ea7ea`, unchanged root c-1 tool; negative JSON CLI returns expected exit1/safe `CONTROLLER_INSTALL_UPGRADE_INPUT_INVALID`. Không thay original packaged installer7e2278/pins hoặc cài lên VPS.
- [Native lab README](../../app/scripts/controller-upgrade-desktop-lab/README.md): root Linux Node22/systemd, original golden release pin96a6a5/candidatev4 pincb70e1, approved modules `/var/tmp/opspilot-p3e3a-runtime/node_modules`. `app/.out-scripts/controller-upgrade-desktop/80742200af53/result.json`8PASS/15compressed SSH exec; Root/unit/account removed. Lostreply→một Main process mới mở DB030 và inspect cùng UUID/PID, explicit rollback giữ original receipt/identity/key/DB inode;0Productapps/targets, không Docker/reboot/production.
- Current Linux source bundle build pin `4e3a163f077f69cd23b58ffcd26e40506489041804a9b01ea9ef006db3588510`; chạy `role.mjs` với `OPSPILOT_CURRENT_CONTROLLER_PAYLOAD`/`OPSPILOT_CURRENT_CONTROLLER_PAYLOAD_PIN` và approved modules →3PASS. Raw `r3c6h4c2a-role-current.json`; fresh controller source vẫn029, upgrade-check/reopen không tạo030/đổi key/identity/inode, private root removed. Source assets không đổi helper/dependency/template/collector.
- Tiếp c-2b: upgraded admin/current binding, explicit epoch rebind và unknown-before-root-journal resolution có fresh parent attestation, IPC/UI4locale/isolated Electron; sau đó c-3 actual installed exposure/onboarding/reconnect/firstdeploy/live upgrade. Không xóa/reset attempted/history hoặc tự thay pin/token để vượt verifier. Normal push có quyền user; không PR/merge, personal files giữ ngoài index.

- **6h4c-1:** trusted root CLI upgrade backend + durable side-by-side revision/rollback/recovery, real Linux systemd/native crash/lostreply lab. Runtime cũ và install receipt nguyên vẹn; dùng chung kernel installation flock. Chưa rollout VPS trước Desktop authority/transport gate.
- **6h4c-2:** pinned SSH transfer/upgrader catalog và Main durable upgrade intent/explicit revision binding, typed IPC/UI consent/inspect/recovery. Không gọi tool/pin cũ để chứng thực bytes mới.
- **6h4c-3:** development VPS rollout giữ demo/identity/UID/DB/key/target; actual installed exposure API và isolated Electron onboarding/reconnect/firstdeploy/live gate.

## Ledger6h4c-1

| Yêu cầu | Điều kiện nhận | State |
|---|---|---|
| Contract/authority | Contract/DECISIONS + focused tests trong full gate; final9types và native13 bao gồm false consent/wrong parent pin/current vs history | PASS |
| Base guard và staging | Trusted callback giữ original flock/account/runtime/data attestation; final native13 chứng minh staging recovery, exact original receipt/runtime/DB/key inode/identity và cleanup | PASS |
| Upgrade/rollback | Final native13: maintenance deny, restart ở stop/switch, commit lostreply + legitimate credential, B→A→original rollback crash/restart/writes/PID preservation, faulty startup/explicit rollback | PASS |
| Verification | Full2159PASS/2existingLinux-onlySKIP/0FAIL,69focused assertions/6files trong full cuối;9types/ESLint14/build/builder/2negativeCLI/native13 PASS; fixture root/unit/account dọn xong | PASS |
| Handoff/push | Board/FR/HANDOFF/master/parent/proof đồng bộ; exact staging/Kim coauthor/normal checkpoint push, SHA qua `git log -1 -- app/src/main/controlPlane/controllerUpgrade.ts`; c-2/c-3 còn mở | PASS |

## Quyết định triển khai

- Side-by-side revision trong installation root, không rename/overwrite runtime cũ (target helper enrollment có thể còn tham chiếu đường dẫn cũ). Execution config riêng cho revision; unit switch chỉ khi verified current parent và journal phase cho phép.
- Root trusted installer mới bổ sung internal guarded installed-base callback trước unit attestation để upgrade recovery xác minh unit cũ/mới theo journal riêng. Public install/inspect/recover không được chọn callback hoặc skip guard; behavior cũ giữ nguyên.
- Original install receipt/pins là lịch sử immutable. Upgrade journal cung cấp active revision authority mới; Desktop phải dùng explicit upgrade intent/tool/pin/rebind ở c-2. Không dùng old inspector để giả xác nhận runtime mới.
- No migrations trong upgrade này: nếu old/new runtime lock/schema/helper compatibility không đáp ứng thì reject trước service stop; không rollback SQLite schema bằng copy file. Không xóa/regen controller identity hoặc runtime key.

## UPDATE11/11 — kiểm chứng đang chạy

- Node typecheck hiện tại pass (`app/.out-scripts/r3c6h4c1-node-current3.log`); focused trước slice recovery cuối: 52 pass, sau gate/strict CLI/checker: 12 pass. Chưa dùng các lượt này thay full gate trên source cuối.
- Native private systemd lab đã đi qua staging/stop/switch/start/commit crash, maintenance deny và multi-revision history; lượt `149d2d24a477` FAIL tại rollback-second (`STOP_UNCONFIRMED`), cleanup root/unit/account đều true. Giữ evidence lỗi, không claim PASS.
- Thêm ranh giới `rollback_commit_pending`: sau khi parent unit có thể chạy thì không so business hash cũ hoặc dừng parent lần nữa. Recovery candidate đang chạy phải lấy lại mutex/quiescent snapshot trước stop; restart trong switch phase được adopt khi chính xác maintenance PID/unit/gate. Đang chạy lại native với crash và service restart ở các ranh giới này.
- Chưa truy cập/thay đổi VPS thật; lab là controller native và HTTP fixture độc lập, chưa chứng minh Product deployment/Docker hoặc rollout live.

## UPDATE11/11 — native source cuối PASS

- `app/.out-scripts/controller-upgrade/0361907c9020/result.json`:13checks PASS, fixture root/unit/account removed=true; `r3c6h4c1-native-final.log`. Có7SIGKILL được kích hoạt tường minh trong một vòng (staging/stop/switch/start/commit và hai rollback boundaries), service restart, bốn client credentials xác thực lại trên bản gốc; không lưu token vào receipt.
- Final9TypeScript projects, ESLint14files, production build, trusted installer builder và2negativeCLI đều pass; full Vitest đang chạy trên source cuối, chưa claim full gate.
- Evidence của hai lượt lỗi `149d2d24a477`/`cc3bdc5c905d` giữ nguyên: explicit stop có MainPID=0 nhưng systemd giữ `Result=exit-code/ActiveState=failed`. Stop confirmation hiện nhận hai terminal states inactive/failed sau systemctl stop; vẫn yêu cầu no PID, quiescent/preserved snapshot và kiểm tra cổng trước start. Không gọi đây là graceful shutdown proof, không waive full/native failure. Final native pass bao gồm trường hợp đó.

## Task tiếp theo — không nhập nhằng với c-1

### c-2: Desktop điều khiển upgrade

- Catalog pin mới cho trusted root updater và release mới; transfer/receiver verification qua SSH đã pin. Original installer/release pins và installation receipt giữ nguyên lịch sử.
- Durable upgrade intent trước SSH, same-UUID inspect/recover/rollback tường minh; lost reply không tự tạo request khác hoặc retry effect. Historical `is_current=false` không được dùng để rebind active runtime.
- Main binding/admin phải xác minh revision bằng root journal + exact current unit/runtime/account/UID và original installation authority. Old inspector sẽ từ chối unit đã đổi; không sửa binding thành pin mới chỉ để vượt verifier.
- Chốt contract/schema strategy trước Main intent migration: controller đang ở029 và c-1 yêu cầu exact fresh schema. Migration chỉ phục vụ Desktop không được ngầm tăng schema floor của controller rồi gọi đó là upgrade không migration.
- IPC chỉ IDs/consent, không lộ credential; UI4locale xem phiên bản, yêu cầu pause rõ ràng, thể hiện maintenance/unknown và recovery/rollback. Không tự pause policy hoặc xóa job để qua quiescent gate.
- Hoàn thiện explicit authority rebind giữ UUID khi credential/VPS ID đổi. Phân biệt unknown trước remote journal: c-2a giữ `outcome_unknown/upgrade_attempted=1` khi root trả NOT_FOUND, không tự retry initial upgrade. c-2b phải bổ sung recovery khởi tạo cùng UUID sau fresh parent/unit/pin attestation hoặc trạng thái chưa bắt đầu có bằng chứng; không xóa journal/reset attempted để né gate. Historical/ancestor rollback cần fresh current-operation authority, không dùng cached is_current làm quyền.
- Native SSH transport/authority/cold local intent/lostreply + isolated Electron flow trước rollout.

### c-3: Live gate trên VPS phát triển

- Kiểm tra controller/demo/policy/job hiện tại; upgrade cùng identity/UID/DB/key/target và original history, giữ app demo đang phục vụ. Không reinstall hoặc copy DB lùi schema.
- Actual installed API exposure persistence và external probe; cold isolated Electron onboarding/reconnect/firstdeploy, không dùng synthetic runtime hoặc SSH adapter để thay live gate.
- Ghi rõ giới hạn/provider expiry/cleanup; parent6h4/R3 chưa đóng chỉ vì c-1 pass. HTTPS/rotation/OS reboot/soak/ML vẫn theo release board riêng.

## HANDOFF11/11 — c-1 DONE scoped / CHỜ REVIEW

- [Sanitized proof và source hashes](../ui-redesign/r3c6h4c1-verification.json). Không accepted exception; mọi gate yêu cầu cho c-1 đã pass trên source cuối. c-2/c-3 và parent6h4/R3 chưa hoàn tất.
- Full command: `pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=default --reporter=json --outputFile.json=.out-scripts/r3c6h4c1-full-final.json` →159files PASS/1SKIP (160),2159tests PASS/2SKIP (2161),351.45s. Hai skip Caddy Linux-only có sẵn, không thêm skip/nới timeout. Raw log cùng prefix `.log`; focused6files/69assertions đều nằm trong lượt full này.
- `. ./tools/enter-node22.ps1`; `pnpm --prefix app exec tsc --noEmit -p <project> --composite false` →9projects PASS: node/web/scripts và product-runtime/controller-bootstrap/controller-release/controller-service/controller-exposure/controller-upgrade lab. Logs `app/.out-scripts/r3c6h4c1-final-type-*.log`.
- `pnpm --prefix app exec eslint` với14file trong proof source list (trừ contract/tsconfig) →0error/0warning; `pnpm --prefix app build` →exit0. Logs `r3c6h4c1-final-lint.log`/`r3c6h4c1-build.log`.
- Linux builder `app/scripts/build-controller-installer.mjs` →trusted installer SHA256 `93f1cff2356dafdec85d273fa4f494db25b8ffb35196737d5e10d2b7448ea7ea`; invalid upgrade JSON và extra argv đều trả safe error/expected exit1, không root mutation. Logs `r3c6h4c1-installer-build.log` và `r3c6h4c1-cli-negative-{json,argv}.log`.
- Reproduce native theo [lab README](../../app/scripts/controller-upgrade-lab/README.md), root Linux Node22/systemd, modules `/var/tmp/opspilot-p3e3a-runtime/node_modules`, candidate `/var/tmp/opspilot-upgrade-20261111/release-v4`, independent release pin `cb70e137d311e35d77a0d22f95252c94ab4579d44ce4b025bd22460a5e6a1d40`. Bundle manifest pin `623b7d8ad3d851287dc9a7f0fc51ff1be5a1102c281cfc1889e42b0a1ef40c52`;998files/145001506bytes. Old/new exact schema029 và helpers/dependencies, không migration/live DB repair.
- Native cuối `0361907c9020`:13PASS/7SIGKILL, crash/restart/lostreply/both rollback boundaries/faulty startup;4client grants xác thực200 sau restore. Receipt/runtime/identity/key/DB+key inode giữ nguyên; root/unit/account removed=true.0Productapps/targets, independent HTTP fixture; không Docker/OS reboot/VPS/production Desktop DB claim.
- Original VPS controller release/pins/receipt/demo và auto-paused policy giữ nguyên. Tiếp c-2 Main/current authority/transport/UI trước c-3 live upgrade; không dùng old admin verifier hoặc sửa catalog/binding ngầm để né gate. Normal push theo quyền user; không PR/merge. Personal untracked files giữ ngoài index.
