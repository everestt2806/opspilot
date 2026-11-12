# R3c-6h4c — Nâng cấp controller và live exposure

START11/11/2026 — Base `f470a05`, product-mode/task-discipline. User yêu cầu tiếp tục; implementation/lab/normal checkpoint push được phép, không PR/merge/reset/clean/stash/rebase. Giữ demo VPS đang chạy, không thay installed pins/receipt/key/DB ngầm.

## Phạm vi và checkpoints

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
