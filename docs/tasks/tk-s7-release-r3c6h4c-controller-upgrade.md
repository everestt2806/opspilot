# R3c-6h4c — Nâng cấp controller và live exposure

START11/11/2026 — Base `f470a05`, product-mode/task-discipline. User yêu cầu tiếp tục; implementation/lab/normal checkpoint push được phép, không PR/merge/reset/clean/stash/rebase. Giữ demo VPS đang chạy, không thay installed pins/receipt/key/DB ngầm.

## Phạm vi và checkpoints

START12/11/2026 — Base `5ee1639`, c-3b: cold Desktop discovery/adoption cho controller đã nâng cấp, sau đó actual isolated Electron/pinned SSH onboarding/reconnect/firstdeploy demo riêng. User cho phép tiếp tục phát triển/lab/VPS/checkpoint normal push; không PR/merge/reset/clean/stash/rebase. Giữ app1/port30000/paused policy/controller hiện hành.

### Ledger c-3b1 — Cold-profile nhận lại current revision

| Yêu cầu | Gate | State |
|---|---|---|
| Contract/attestation | Readonly fixed Python discovery metadata, original source manifest/tool pins và current Root operation; protected catalog match, trusted current inspect và before/after evidence fences; không thay installed pin/binary/schema.38AST parity/native18 PASS | PASS |
| Main adoption | Review60s/consent/CAS, chỉ paired fresh verified original+current authority mới tạo journal metadata nguyên tử; giữ UUID/pins/parent, không copy app/history/secret hoặc phát lệnh install/upgrade. Atomic failure/changed observation/expiry/current SSH/no mutation regression và native actual cold profile/PID/receipt/journal preservation PASS | PASS |
| Binding/UI | Existing install wizard tự chuyển sang current revision sau preflight, xác nhận riêng trước enrollment; new API intent dùng exact upgraded paths/UID/current authority, old inspector không làm hỏng original row;4locale/error/late-result guards. Native API200/read-only enrollment/revoke và Electron5/18ảnh PASS; final regression32/2files PASS | PASS |
| Verification/handoff | Full2204PASS+2existingLinux-onlySKIP,focused138/5files,10types/ESLint16/build/Ruff/38AST/package/native18/Electron5+18ảnh PASS; proof/cleanup/board/FR/HANDOFF/master đồng bộ. Exact stage/Kim coauthor/normal checkpoint push; c-3b2 live GUI/firstdeploy còn OPEN | PASS |

Chọn mở rộng fixed Python readonly attestation + existing independently pinned Root updater inspect, không dựng updater/pin mới hoặc sửa original receipt để old inspector pass. Discovery đầu chỉ là hint; Main match protected original/current release+tool pins, receiver verify original immutable staging bytes/receipt dưới root guard, existing trusted updater kiểm current operation, discovery lại phải y hệt và current SSH authority không đổi. Review không tạo journal; consent mới ghi local metadata từ real attestation, không giả local successful deployment. Original artifact metadata được ghi là historical/stopped khi current runtime ở revision; current health lấy riêng từ verified upgrade result. Root SQLite vẫn canonical, không import application rows.

UPDATE12/11 — Native đầu fail tại cold review: Main truyền locator kèm authority metadata, strict Zod transport từ chối trước inspect SSH. Đã sửa explicit3 locator fields và thêm regression; không nới schema/verifier. Final native `7db42a44b41d`18PASS, root/unit/account cleanup=true; cold profile giữ remote UUID/current revision, separate read enrollment/API200/revoke, PID/original receipt/current journal bytes không đổi. Hai native failure trước dọn đúng fixture, không làm pass evidence. Electron harness sửa sai nhãn nút và thiếu readonly status stub, final `5ef33c23403e`5PASS/18ảnh/0renderer errors/private data removed=true; synthetic SSH ghi rõ. Production build10type projects/ESLint16/38AST/package/Ruff PASS; full Vitest cuối đang chạy. Không VPS/production DB/Productapps/targets/Docker/reboot/soak hoặc live GUI/firstdeploy claim.

## HANDOFF12/11 — c-3b1 DONE scoped / CHỜ REVIEW

- Ledger c-3b1 đạt4/4PASS, không accepted exception. [Proof/source hashes](../ui-redesign/r3c6h4c3b1-verification.json), [18ảnh Electron](../ui-redesign/screenshots/r3c6h4c3b1/), [Lab/reproduction](../../app/scripts/controller-upgrade-desktop-lab/README.md). SHA `git log -1 -- app/src/shared/controllerAdoption.ts`. Không đổi schema/dependency/installed binary/resource pins; không VPS/production DB.
- `pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=default --reporter=json --outputFile.json=.out-scripts/r3c6h4c3b1-full-final.json` →2204PASS+2existingLinux-onlySKIP/0FAIL; focused138/5files nằm trong full. Không thêm skip/đổi timeout. JSDOM có warning getComputedStyle pseudo-element đã có trước, không phải lỗi lint/runtime Electron.
- Node22: final `pnpm --prefix app build` gồm Node/Web typecheck;8project tsc bổ sung trong proof đều exit0. ESLint16files0error/0warning,38AST DTO/IPC/current-revision parity, compiled Main package gate và Ruff check/format Python PASS. Shared IPC khối lớn giữ format cũ, excluded ESLint như trước; kiểm bằng TypeScript+AST, không mass-format.
- Native `7db42a44b41d`18PASS actual private SSH/systemd/controller029/Desktop031: cold profile review không tạo journal; consent mới nhận lại same original/current UUID/CID/parent/pins. Separate read-only enrollment/API200/revoke và PID/original receipt/current journal bytes preserved. Original/current metadata inserted atomically; no Root reinstall/upgrade dispatch. Các gate rollback/cold unknown/SSH rebind/archive trước vẫn PASS. Root/unit/account cleanup=true,0Productapps/targets/Docker/OS reboot/soak.
- Electron `5ef33c23403e`5PASS/18captures: production preload/UI/typed channels/actual Main/private native SQLite/vault; synthetic discovery/SSH. Explicit adoption khác API permission, correct current runtime thay historical/stopped,4locale×2theme×2size không cuộn ngang/0renderer errors/private data removed=true. Unit UI còn kiểm primary preflight tự chuyển, verification error không fallback original install, late close không enroll. Không dùng Electron synthetic hoặc native lab thay actual VPS GUI gate.
- Chỉ cold profile chưa có installation cùng VPS identity; existing journals fail-closed thay vì overwrite. Trusted original/current staging phải còn, exact approved pins/current settled/running required. Host key không tự học, không app/history/secret/token import. Original result historical/stopped không nói máy mới đã tự upgrade.
- Tiếp **c-3b2** actual isolated Electron/pinned SSH onboarding/reconnect và firstdeploy demo riêng trên VPS đã upgrade. Giữ san-nha-live/app1/port30000/paused policy/controller hiện hành; new owned resources rõ ràng, thu hồi client/private profile đúng scope. Không PR/merge/reset/clean/stash/rebase; normal push authorized/Kim coauthor. Parent c-3/6h4/R3 còn OPEN.

START12/11/2026 — Base `54bbeb7`, c-3 product-mode/live development VPS: fresh pinned SSH preflight rồi protected controller upgrade, preserve identity/UID/key/DB/target/demo; actual installed exposure API và isolated Electron onboarding/reconnect/firstdeploy. User đã cấp VPS/credential và quyền phát triển; chỉ dùng RAM/hidden stdin/encrypted store, không argv/env/log/Git. Không PR/merge/reset/clean/stash/rebase; normal checkpoint push được phép.

### Ledger c-3 — VPS rollout và live Desktop

Chia checkpoint để có bằng chứng/push độc lập: **c-3a** fresh preflight, protected live upgrade + actual exposure/reconnect Main; **c-3b** actual isolated Electron onboarding/reconnect/firstdeploy trên runtime mới. Không dùng operational CLI/Electron Main không cửa sổ của c-3a thay cho GUI c-3b. Durable private Desktop DB dùng OS-protected key, giữ lại khi unknown/fail để phục hồi cùng UUID; chỉ dọn sau settled/revoke thành công.

### Ledger c-3a — Live upgrade và exposure

| Yêu cầu | Gate | State |
|---|---|---|
| Preflight | Actual pinned SSH/readonly snapshot record6027d7fa4d3142ed: expected original identity/UID997/schema029,0active experiment/jobs/clients, policy paused/demo HTTP200; fresh Main adoption trước transfer | PASS |
| Upgrade/reconnect | Live record6027d7fa4d3142ed8checks PASS: Main/root active current upgradeUUID37a115d5, original receipt/identity/UID997/key/DB inode/target/demo giữ nguyên; local re-add/fresh separate confirms giữ token/client/PID | PASS |
| Exposure | Main actual Windows public probe→installed authenticated API→canonical SQLite reachable + read-current same observation sau reconnect PASS; không root SQL write | PASS |
| Handoff |83tests/5files/type/lint4/Ruff2/syntax3/negativeCLI2/DPAPI3/live8 PASS; sanitized proof/source hashes/board/FR/master/HANDOFF đồng bộ; Kim coauthor/normal push, c-3b giữ OPEN | PASS |

UPDATE12/11 — readonly preflight `abc96242209f4052` PASS/controller bản6h2c/demo health200; field active_jobs ở scratch đầu đếm sai terminal succeeded, không dùng số đó để quyết định mutation. Operational source sửa predicate trước live; fresh record `6027d7fa4d3142ed` xác nhận0active jobs/experiments/clients và paused policy. Original controllerID dc586bb7/installUUID7573f0b1/UID997/receipt+key+DB inode giữ làm baseline; current deployment4 SHA bfed894 còn running. New durable upgrade UUID `37a115d5-71c6-4b87-bacb-6375a64c0c65`, đang transfer protected release093a059/tool7b19cef, chưa claim upgrade/exposure PASS.

Operational tool chuyển sang Node22 vì Electron Main Windows startup/anonymous stdin không phù hợp pipeline này. Hai lượt chưa SSH/write (48b1b1190bec7400 startup wait,159cf8176ffdbd35 empty stdin) giữ riêng, không làm bằng chứng live pass. Private journal dùng approved AES-GCM + Windows user-scoped DPAPI qua bounded anonymous child pipes, không production safeStorage format; DPAPI cold reopen/encrypted-at-rest/missing-key3checks PASS. Current scoped83tests/5files, entry typecheck/lint/Ruff/syntax/2negativeCLI đều PASS;83 không thay full2197 baseline của checkpoint trước. No GUI/OS reboot/remote key rotation claim.

UPDATE12/11 — Live c-3a `6027d7fa4d3142ed` PASS8checks: current active upgradeUUID37a115d5-71c6-4b87-bacb-6375a64c0c65/root payload4e3a163/release093a059; original install7573f0b1/controllerdc586bb7/UID997/original receipt hash/key inode+hash/DBinode265566/target credential digest/deployment4 SHA bfed894 giữ nguyên. Actual independent Windows probe→new installed API ghi canonical observation37e04ff7-980b-455a-8bf7-9d68960113aa/statusreachable; local VPS re-add→fresh SSH authority confirm→separate API refresh giữ token/client/PID và read-current cùng observation. Temporary client20feca75 đã revoke, active clients0/experiments0/jobs0/policypaused/demoHTTP200, private DB+DPAPI key removed=true. Không chạy Root recovery trên live hoặc cố ý ngắt SSH, không GUI/cold-new-profile onboarding/firstdeploy claim.

## HANDOFF12/11 — c-3a DONE scoped / CHỜ REVIEW

- Ledger c-3a4/4PASS, không accepted exception. [Live proof/source hashes](../ui-redesign/r3c6h4c3a-verification.json), [Operational commands](../../app/scripts/controller-upgrade-live/README.md); SHA `git log -1 -- app/scripts/controller-upgrade-live.mjs`. Live record6027d7fa4d3142ed8checks PASS, temporary client revoked/private DB+sealed key removed, current controller và healthy demo giữ chạy. Parent c-3/c-3b/6h4/R3 chưa đóng.
- Node22: `pnpm --prefix app exec vitest run src/main/controlPlane/desktopControllerUpgrade.test.ts src/main/controlPlane/desktopExposure.test.ts src/main/controlPlane/desktopExposureProbe.test.ts src/main/controlPlane/desktopControllerEnrollment.test.ts src/main/controlPlane/desktopControllerVault.test.ts --maxWorkers=2` →83PASS/5files. `pnpm --prefix app exec tsc --noEmit -p scripts/controller-upgrade-live/tsconfig.json --composite false` PASS; ESLint4files `--max-warnings=0`, Ruff check/format2Python files, Node syntax3files và2negativeCLI exit2 PASS. `node app/.out-scripts/check-live-journal-key.mjs` →DPAPI3checks PASS. Exact raw logs/hash trong proof; helper DPAPI tiny check là scratch ignored.
- Chỉ operational scripts/docs mới, không runtime/DB/IPC/UI/resource/dependency source change. Không chạy lại full app/build hoặc dùng full2197 của54bbeb7 như gate mới. Không fake Root SQL writer/observer hoặc thay installed original receipt/pins. Exposure reachable là observation có timestamp/TTL; không ghi là trạng thái xanh vĩnh viễn.
- Live Main re-add dùng local journal có từ trước upgrade. Cold Desktop profile chưa biết current remote revision vẫn phải audit/attach qua trusted discovery và actual GUI; không đưa cached CLI row vào DB để giả onboarding pass. C-3b tiếp theo; không cần user test thay automation. Không PR/merge; normal checkpoint push đã được user cho phép, Kim coauthor; personal untracked giữ ngoài index.

### Bước kế tiếp c-3b — actual Desktop với controller đã nâng cấp

- Runtime hiện `/opt/opspilot-controller/revisions/37a115d5-71c6-4b87-bacb-6375a64c0c65/runtime/{node,payload/control-plane.cjs}`, UID997, data `/var/lib/opspilot-controller`, protected new updater7b19cef/release093a059/payload4e3a163. Original receipt/runtime/pins vẫn nguyên; không gọi old inspector rồi sửa receipt để né mismatch.
- Gate c-3a có local upgrade journal từ trước nâng cấp rồi re-add VPS. Một Desktop profile mới hoàn toàn chưa có upgrade journal cần được audit riêng: original discovery chỉ đưa installation hint, old inspector có thể từ chối unit đã thay. Nếu UI chưa attach được current revision, bổ sung explicit trusted discovery/adoption bằng fixed Root/current pins và fresh attestation; không tự dựng SQL row hoặc lấy cached CLI proof làm GUI pass. Giữ UUID/history và require confirmation trước API enrollment.
- Sau attach/current binding đúng, dùng actual isolated Electron/preload/typed IPC/Main/native SQLite/pinned SSH cho onboarding/reconnect và một firstdeploy demo riêng. Giữ san-nha-live/app1/port30000 và paused policy; dùng ownership/port/source mới rõ ràng, dọn đúng client/privateprofile được tạo, không đụng dữ liệu người dùng. Product API/exposure phải chạy thật; không synthetic transport.

| Yêu cầu | Gate/bằng chứng | State |
|---|---|---|
| Fresh preflight | Actual c-3a record6027d7fa4d3142ed pinned SSH/readonly baseline,0active experiment/job/client,paused policy/HTTP200 PASS | PASS |
| Safe upgrade | c-3a actual Main durable journal/root active current UUID37a115d5, original receipt/identity/UID997/key/DB inode/target/demo preserved, API access PASS | PASS |
| Actual exposure | c-3a actual Windows Main public probe/authenticated API/canonical SQLite reachable/read-current/reconnect persistence PASS | PASS |
| Live Desktop | Isolated real Electron/preload/typed IPC/Main/native SQLite, actual pinned SSH onboarding/reconnect/firstdeploy; chỉ resources demo mới có ownership rõ và cleanup phù hợp | OPEN |
| Handoff | Required scoped gates, sanitized proof/hashes, board/FR/master/HANDOFF, Kim coauthor/normal checkpoint push; phân biệt gate còn chưa chạy | OPEN |

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
