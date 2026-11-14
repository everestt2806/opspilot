# HANDOFF — Bàn giao phiên làm việc với AI

> **14/11 — R7h-3a CHỜ REVIEW, DONE scoped desired-source selection:** Chọn retained encrypted env revision bằng source generation mới/non-secret identity và immutable binding035/receipt; same-UID CLI, current source/owner/target/latest-revision CAS, paused/quiescence và replay guards. Giữ deployment/pause, không tạo job/runtime. Pipeline từ chối environment reference trước SSH tới R7h-3b; chưa deploy config. Focused160PASS/27newtests; native6checks/cold retry/two-process race/cleanup; full2369PASS+2existingLinux-onlySKIP/0FAIL/types/lint/build/parity/negativeCLI đạt. Source Desktop/controller035 (controller bỏ030/031/034), VPS029/releaseb680 giữ nguyên. Chưa Main/UI selection/claim decrypt/render/rollout/PG hoặc wholeR7. SHA `git log -1 -- app/src/main/controlPlane/productEnvironmentSelection.ts`; normal push/Kim coauthor, không PR/merge. [Proof](docs/ui-redesign/r7h3a-verification.json); [task](docs/tasks/tk-s7-release-r7h3a-environment-selection.md).

> **14/11 — R7h-2b CHỜ REVIEW, DONE local staged config:** Nối derived controller context/fixed stdin admin→Main encrypted intent034→6typedIPC→UI write-only4locale, runtime password/public warning/whole-snapshot consent/form clear. Unknown chỉ check/same-UUID replay, CAS/binding/write scope guards trước/sau await, metadata-only. Focused298PASS, full2342PASS+2existingLinux-onlySKIP/0FAIL; native admin7+vault5checks/cleanup; Electron4checks/13captures/private cleanup với production preload/Main/SQLite và synthetic SSH. Types/lint/Ruff/build/parity/negativeCLI đạt. Desktop034/controller033, VPS vẫn029/releaseb680; chưa protected release/schema upgrade/backup/real SSH/live rollout hoặc env activation/execution/PG. Không whole R7 claim. SHA `git log -1 -- app/src/main/controlPlane/desktopProductEnvironment.ts`; normal push/Kim coauthor, không PR/merge. [Proof](docs/ui-redesign/r7h2b-verification.json); [task](docs/tasks/tk-s7-release-r7h2b-environment-desktop.md).

> **14/11 — R7h-2a CHỜ REVIEW, DONE scoped CLI:** Hai command stage-project-environment/project-environment-state nhận stdin cùng UID, chỉ trả metadata. Migration033 receipt mã hóa bind purpose/admin/request/app/owner/revision/time/body, không plaintext body/digest secret; atomic vault+receipt/current source-target-owner guards và authenticate trước success. Retry cùng UUID/body giữ revision, khác body từ chối; metadata lookup khi lost reply. Focused99PASS/24newtests; native CLI6checks (có hai process cạnh tranh cùng UUID)+vault5checks/cleanup; full2315PASS+2existingLinux-onlySKIP/0FAIL, types/lint/build/format/parity/negativeCLI đạt. Desktop/controller source max33, VPS vẫn029/releaseb680. Chưa root bridge/Main/IPC/UI (2b), activation/executor/PG (3/4); không whole env/DB/R7 claim hoặc đổi VPS/pins. SHA `git log -1 -- app/src/main/db/migrations/033_product_environment_request.sql`; normal push/Kim coauthor, không PR/merge. [Proof](docs/ui-redesign/r7h2a-verification.json); [task](docs/tasks/tk-s7-release-r7h2a-environment-admin.md).

> **14/11 — R7h-1 CHỜ REVIEW, DONE scoped foundation:** Thêm kho revision cấu hình Product mã hóa/bất biến qua migration032/contract; AES-GCM ràng buộc purpose/controller/app/owner/target/revision/basis/framework/keys, CAS2connections/quotas/runtime-public scopes, chỉ metadata không values. Staging không activate source/policy/job hoặc tự init/rotate key.47vault+28migration focused75PASS, native Linux key/SQLite3e24f3b756f4 PASS5checks/cleanup, full2291PASS+2existingLinux-onlySKIP/0FAIL/167files/types/lint/build/parity/CLI đạt. Desktop/controller source mới max32, controller bỏ030/031; VPS vẫn029/releaseb680 vì không rollout. Chưa env editor/source activation/executor decrypt/PG, pipeline giữ no-user-env/noDB cho tới R7h-2..4/native/live; không gọi whole env/DB/R7 feature DONE. Schema rollout phải qua backup/upgrade guard riêng, không đổi pins/deps/helpers/templates. SHA `git log -1 -- app/src/main/db/productEnvironmentRepository.ts`; normal push/Kim coauthor, không PR/merge. [Proof](docs/ui-redesign/r7h1-verification.json); [task](docs/tasks/tk-s7-release-r7h-product-config.md).

> **13/11 — R7g CHỜ REVIEW, DONE scoped:** Next app4/port30003 tự nhận commitb50f625 khi Main đã disconnectAll trước push;33HTTP-only polls thấy marker mới, không manual redeploy/SSH trong khoảng quan sát. Root readonly xác nhận đúng1branch_poll job/succeeded/currentSHA,1terminal settled/cả2lease released; SSR/deep route/Nextasset200/missing404 và exposure recorded reachable PASS. Pause/revoke/privatecleanup/0active jobs-clients-experiments,3oldapps/6CID/controllerPID/key/DB/schema029/Root journals giữ nguyên. Driver/docs-only CLIguard/types/lint/syntax/source+raw hashes đạt; full2244+2existingSKIP là R7e baseline, không rerun hoặc suy OS Desktop process exit/GUI/reboot/ML/wholeR7. SHA `git log -1 -- app/scripts/product-spa-live/auto.mjs`; normal push/Kim coauthor, không PR/merge. [Proof](docs/ui-redesign/r7g-verification.json); [task](docs/tasks/tk-s7-release-r7g-next-auto.md).

> **13/11 — R7f CHỜ REVIEW, DONE scoped:** Next releaseb6803bc/payload93abe6e/tool8ac74cd đã nâng development VPS qua Main/pinned SSH; upgradeUUID4c90a650-dbae-4694-9c2b-5eb2e8b9fdd4,giữ UID/key/DB/schema029/original receipt/6CID của3app cũ và client/token qua binding refresh. App4 `next-live-ba8a98aed302`,port30003, public Git branch riêng; first/update/SSR503 health rollback exactCID/finalhealthy và SSR/deep route/Nextasset200/missing404/exposure recorded reachable PASS. Native upgrade19+retained10+live7checks;29focused/types/lint/build/catalog5entries/missing/tamper/syntax/negativeCLI đạt. R7e full2244+2existingSKIP là baseline, runtime/schema/deps/helpers/templates không đổi. Client revoke/privatecleanup/0active jobs-clients-experiments/policiespaused; không GUI/Next-auto/NSIS/Windows độc lập/reboot/soak/ML hoặc wholeR7 claim. SHA `git log -1 -- app/control-plane-runtime/desktop-next-release.json`; normal push/Kim coauthor, không PR/merge. [Proof](docs/ui-redesign/r7f-verification.json); [task](docs/tasks/tk-s7-release-r7f-nextjs-rollout.md).

> **13/11 — R7e CHỜ REVIEW, DONE scoped local:** Product Next.js chuẩn không DB/user env đã nối contract/shared/registration/source/canonical hash/H2/Desktop, default3000 và `/`; NODE_ENV=production từ template, mismatched framework/port/DB/env/public build args/custom server bị chặn trước SSH. Native frozen56c01f5: Next10/Express7/SPA10checks actual SSH/SQLite/Docker/collector/SSR/assets/buildfail/health503 rollback/first failures/collector-failure barrier và cleanup PASS. Electronac2b83c7c353 production widget/preload/Main/privateSQLite với synthetic controller đạt4checks/10captures/4locale/layout, đã xem ảnh dark/light. Final full2244PASS+2existingLinux-onlySKIP/0FAIL/166files, focused161/types/lint/build/parity/syntax/diff đạt. Không đổi schema/helper/template/release pins hoặc VPS; cần trusted release/upgrade/live Next gate riêng, DB/env/customDockerfile/full matrix và ML/soak/Windows vẫn mở. Demo next-blog có NEXT_PUBLIC_SITE_NAME, chưa thuộc no-user-env scope. SHA `git log -1 -- app/src/main/controlPlane/productPipelineSourceRender.ts`; normal checkpoint push/Kim coauthor, không PR/merge. [Proof](docs/ui-redesign/r7e-verification.json); [task](docs/tasks/tk-s7-release-r7e-product-nextjs.md).

> **13/11 — R7d CHỜ REVIEW, DONE scoped:** SPA app3/port30002 tự nhận commit public Git `2e4c991` khi Main đã đóng toàn bộ SSH; chỉ HTTP observer (22polls), không manual redeploy. Controller tạo đúng1job `branch_poll`/succeeded, deployment10/current SHA đúng, terminal settled và cả2lease released; deep route/index, missingassets404, exposure recorded reachable đạt. Pause/revoke/private cleanup xong,0active jobs/clients/experiments;4CID app cũ/controller PID/key/DB/schema029/Root journals giữ nguyên. Driver-only CLI guard/types/lint/syntax/diff đạt; full2233+2existingSKIP là baseline `d48ed07`, không rerun hoặc suy physical Desktop exit/GUI/reboot/ML/wholeR7. Giữ rawR7c, xóa riêng encrypted recovery scratch cũ sau reconcile. Normal checkpoint push/Kim coauthor; không PR/merge. SHA `git log -1 -- app/scripts/product-spa-live/auto.mjs`; [proof](docs/ui-redesign/r7d-verification.json); [task](docs/tasks/tk-s7-release-r7d-spa-auto.md).

> **13/11 — R7c CHỜ REVIEW, DONE scoped:** SPA releasea81ed72/payload4fbe332/upgrader8ac74cd đã nâng development VPS167.71.202.116 qua Main/pinned SSH; UUIDa5a702ff/UID997/schema029, giữ key/DB/original receipt và4CID app/collector cũ. App3 `spa-live-6ab247675f19`,port30002, public Git branch riêng; firstdeploy/update/health403 auto rollback exact CID/finalhealthy đều PASS, exposure recorded reachable qua authenticated API. Native upgrade19 +retained-helper10 +live7checks, full2233PASS+2existingLinux-onlySKIP/0FAIL/166files/types/lint/build/packaging4entries/tamper/missing đạt. Candidate6b failed/commit_pending đã explicit rollback cùng UUIDa556ed89 và revoke client; giữ historical pins, không gọi lần lỗi PASS. Sửa legacy Express helper inspection exact hashes, SPA/tamper vẫn reject; historical catalog được inspect/adopt nhưng không chọn lại upgrade. Không production Desktop profile/GUI/NSIS/reboot/soak/ML claim. R7 tổng OPEN; tiếp SPA auto Git khi ngắt Main rồi Next/DB/env/full matrix. SHA `git log -1 -- app/src/main/controlPlane/controllerTargetHelperCompatibility.ts`; normal push/Kim coauthor. [Proof](docs/ui-redesign/r7c-verification.json); [task](docs/tasks/tk-s7-release-r7c-spa-rollout.md).

> **13/11 — R7b CHỜ REVIEW, DONE scoped:** Product Git deploy thêm Vite SPA không DB/required env. Registration/source detector/journal/review/H2 settlement giữ đúng framework; nginx80, exact-CID Node hoặc wget health probe. Native pinned SSH/SQLite/Docker/collector: SPA10checks, Express7checks; deep routes/missingassets404, failed build và health rollback giữ đúng previous CID/collector/boundary, collector failure chặn finalization. Electron production widgets/preload/Main/private SQLite với synthetic controller đạt4checks/10ảnh/4locale/layout. Full2227PASS+2existingLinux-onlySKIP/0FAIL,150focused/6files/types/lint/build/Ruff/contract parity đạt. Không VPS/productionDB/installed-controller/installer rollout; cần trusted release+upgrade+live SPA acceptance, Next/DB/env/customDockerfile còn mở. R7 tổng OPEN. SHA `git log -1 -- app/src/main/controlPlane/productPipelineSourceRender.ts`; normal push/Kim coauthor, không PR/merge. [Proof/source hashes](docs/ui-redesign/r7b-verification.json); [task/runbook](docs/tasks/tk-s7-release-r7b-product-spa.md).

> **12/11 — R7a CHỜ REVIEW, DONE scoped:** Sửa static SPA template: direct/reload client routes fallback index, missingassets404/indexno-cache và build thiếu dist/index bị chặn trước nginx welcome giả healthy. Baseline actual Docker tái hiện2lỗi; final local folder/localGit fullSHA→production detect/render→Docker/HTTP/Chromium đạt5checks, HTML/JS hashes trùng, owned cleanup đạt. 135focused/3files/typesNode-Web-Scripts/lab/ESLint3/Prettier4/build/syntax/negativeCLI/source+raw hashes đạt. Browserdriver ESMready lỗi đã sửa sau minimal probe, không bỏ browser gate. Không VPS/productionDB/installed-controller/installer rollout; Product vẫn Express-only, R7 còn parity/DB/env/customDockerfile/live, R11b clean Windows giữ nguyên. SHA `git log -1 -- templates/static-spa.Dockerfile`; Kim coauthor/normal checkpoint push, không PR/merge. [Proof/source hashes](docs/ui-redesign/r7a-verification.json); [task/runbook](docs/tasks/tk-s7-release-r7a-spa-routing.md).

> **12/11 — R11c CHỜ REVIEW, DONE scoped:** App0.2.0 thêm NSIS pre-uninstall legacy ML preservation: fixed embedded helper/source pins/scientific versions/bounds/no links/no overwrite/atomic promote;14native helper checks đạt. Actual full source predecessor d302ee3/0.1.0 train180→NSIS abort state thiếu giữ bản cũ→nâng actual0.2.0→restore model/trained_at/4scores và History note/DB/key/localStorage,5checks PASS; ordinary asynchronous uninstall self-delete cả folder/registry fixture, private data dọn xong. 29focused/3files/typesNode-Web-Scripts/build/productionNSIS/ESLint2/Ruff2/syntax/artifact/negative gates đạt. Baseline0.1 cold-first-launch ML30s fail được giữ riêng; native import probe + explicit source-fenced resume thành công, không sửa timeout/oldcode hoặc gọi first run PASS. R11b còn PARTIAL/clean Windows và default production identity/shortcuts chưa nghiệm thu; installer NotSigned, không formal ML pilot hoặc toàn release DONE. SHA `git log -1 -- app/scripts/legacy-ml-upgrade.ps1`; Kim coauthor/normal checkpoint push, không PR/merge. [Proof/source hashes](docs/ui-redesign/r11c-verification.json); [task/runbook](docs/tasks/tk-s7-release-r11c-upgrade-compatibility.md).

> **12/11 — R11b PARTIAL / CHỜ REVIEW:** Đã build actual production NSIS241537755bytes và kiểm full Main/preload/App.tsx/SQLite031/safeStorage/bundled ML. Unpacked full app5checks, installed full app7checks; actual isolated NSIS install→same-version repair→cold reopen→synchronous uninstall đạt, payload hash đúng production, registry riêng xóa xong, DB/key/model/UI giữ và private profile dọn xong. Không mock hoặc đổi product runtime/API/schema/deps. Current typesNode-Web-Scripts/ESLint3/Prettier3/syntax3/negativeCLI2+traversal1/artifact audit đạt;2216+2skip là baseline833db7d, không full rerun. Còn Windows độc lập/default profile/production identity/normal standalone uninstall và upgrade từ older release; user đã được hỏi về máy khác, chưa có trả lời. Fixture `_?=` còn uninstaller file, không claim whole-folder self-delete; production installer NotSigned. R11/release vẫn OPEN. SHA `git log -1 -- app/scripts/windows-release-lab.mjs`; normal checkpoint push/Kim coauthor, không PR/merge. [Proof/source hashes](docs/ui-redesign/r11b-verification.json); [checklist/task](docs/tasks/tk-s7-release-r11b-windows-installer.md).

> **12/11 — R11a CHỜ REVIEW:** Windows ML runtime độc lập đã đạt phạm vi checkpoint: Python3.12.10/20 production dependencies theo lock, kiểm manifest/hash trước spawn và beforePack, model ở userData/ml-state; không fallback Python global/venv. Native packaged Electron host 5checks đạt (train180/inference4method/restart giữ model/stop/tamper+missing refusal), Unicode/System32-only PATH và cleanup đạt. Full2216PASS+2existingLinux-onlySKIP/0FAIL/165files,23Python/12focused/typeNode-Web-Scripts/ESLint8/Ruff3/build/package/negative gates đạt. Không VPS/productionDB/formal ML experiment; native host không thay full NSIS hoặc máy sạch. R11 còn OPEN, tiếp R11b full installer/first launch/SQLite ABI/upgrade/uninstall trên Windows độc lập. SHA `git log -1 -- app/src/main/mlRuntime.ts`; normal checkpoint push/Kim coauthor, không PR/merge. [Proof/source hashes](docs/ui-redesign/r11a-verification.json).

> **12/11 — R3c-6h4c-3b2 /6h4 CHỜ REVIEW:** Actual live Desktop flow DONE scoped7checks/18ảnh, [proof/source hashes](docs/ui-redesign/r3c6h4c3b2-verification.json). Isolated production widgets/preload/typed IPC/Main/Desktop031/DPAPI/actual pinned SSH/controller029: cold adoption/separate permission/enrollment, separate Electron process reconnect giữ UUID/token/client và thấy app1; Product Git project/source/target/readiness/review/firstdeploy chạy thật. New app2 desktop-live-69eeeb78/deployment5/fullSHA bfed894/port30001 HTTP200, paused; actual independent Windows exposure observation c67dc785 persisted via authenticated API (TTL60s). Original app1/port30000/controller/PID/key/DBinode/target/Root journals giữ nguyên. Temporary client revoked/active clients-jobs-experiments0/private DB+sealed key removed. Final count harness sửa bằng readonly finalization sau revoke, không reenroll/job replay/whole GUI rerun claim.126tests/8files/type/lint5/build/Ruff/routing6/negativeCLI3/syntax4/DPAPI3 PASS; previous full2204+2skip chỉ baseline. Không product runtime/schema/pin change/NSIS/reboot/soak/rotation/other templates/ML batch claim. ParentR3 và release tổng còn OPEN; rà remaining R3/R4/R7/R11 theo master. SHA `git log -1 -- app/scripts/controller-desktop-live.mjs`; normal push authorized/Kim coauthor, không PR/merge.


> **12/11 — R3c-6h4c-3b1 CHỜ REVIEW:** Cold Desktop nhận lại controller đã nâng cấp, DONE scoped. Fixed readonly discovery + protected original/current pins + paired fresh Root inspect/repeat SSH fences; review60s/consent và atomic original/current metadata giữ remote UUID/parent/CID, không import app/secret/token/reinstall/replay. Wizard4locale tự chuyển từ preflight, current runtime khác historical result và separate API permission. Full2204PASS+2existingLinux-onlySKIP/0FAIL,focused138/5files,10types/ESLint16/build/38AST/package/Ruff/native18/Electron5+18ảnh PASS; [proof/source hashes](docs/ui-redesign/r3c6h4c3b1-verification.json). Native actual SSH/systemd/Main031/controller029/cold DB/read-only enrollment/API200/revoke/PID/receipt/journal preservation; Electron synthetic SSH/actual Main/private SQLite/production preload,cleanup đạt. Không VPS/productionDB/Productapps/targets/Docker/reboot/soak/live GUI claim. Scope chỉ cold profile, không overwrite journal đã biết; phải còn trusted original/current staging. Tiếp **c-3b2 actual isolated Electron/pinned SSH onboarding/reconnect/firstdeploy**, parent6h4/R3 mở. SHA `git log -1 -- app/src/shared/controllerAdoption.ts`; normal push được phép, không PR/merge.


> **12/11 — R3c-6h4c-3a CHỜ REVIEW:** [Live controller upgrade/exposure/Main reconnect](docs/tasks/tk-s7-release-r3c6h4c-controller-upgrade.md) DONE scoped8checks actual VPS167.71.202.116: protected release093a059/tool7b19cef/current upgradeUUID37a115d5, payload4e3a163. Original install7573f0b1/controllerdc586bb7/UID997/receipt/key/DBinode265566/target/demo deployment4 SHA bfed894 giữ nguyên. Actual Windows Main public probe→new installed API/canonical SQLite reachable, local VPS re-add/fresh SSH/API confirms giữ token/client/PID/read-current. Client thử đã revoke, active clients/jobs/experiments0/policypaused, demoHTTP200/privateDB+DPAPIkey removed.83tests/5files/type/lint4/Ruff2/syntax3/negativeCLI2/DPAPI3 PASS; [proof/hashes](docs/ui-redesign/r3c6h4c3a-verification.json). Operational Node/Main không cửa sổ, không GUI/firstdeploy/reboot/soak/recovery/rotation claim; full2197/build trước54bbeb7 là baseline. Tiếp **c-3b trusted current-revision discovery/adoption cho cold Desktop nếu cần, actual isolated Electron onboarding/reconnect/firstdeploy**. Parent6h4/R3 mở; normal push được phép, không PR/merge. SHA `git log -1 -- app/scripts/controller-upgrade-live.mjs`.


> **12/11 — R3c-6h4c-2b3 CHỜ REVIEW:** [Kết nối lại VPS sau upgrade](docs/tasks/tk-s7-release-r3c6h4c-controller-upgrade.md) DONE scoped: Desktop-only031 append-only authority epochs, fresh candidate pinned SSH/Root inspect→review60s→consent/CAS cập nhật installation và upgrade history nguyên tử. Cùng host/port/fingerprint/username; credential/auth method/local VPS ID có thể đổi, UUID/parent/pins/attempted giữ nguyên. API vẫn bị chặn đến fresh review/confirm riêng; giữ token/client/scopes và tăng revision. Full2197PASS+2existingLinux-onlySKIP/0FAIL,139focused/8files,10types/ESLint23/build/30AST/package/native16/Electron6+19ảnh đạt; [proof/source hashes](docs/ui-redesign/r3c6h4c2b3-verification.json). Native actual SSH/systemd/Main031/controller029/API200/Root admin với readded ID/ciphertext, PID giữ nguyên; key fixture chỉ re-encrypt, không claim remote key rotation. Electron synthetic SSH/actual Main/private SQLite,0VPS/productionDB/Productapps/targets, cleanup đạt. SHA `git log -1 -- app/src/main/controlPlane/desktopControllerAuthority.ts`. Tiếp **c-3 live VPS upgrade/exposure/onboarding/reconnect/firstdeploy**; fingerprint/machine khác, root journal thiếu/unsettled hoặc active in-flight vẫn fail-closed. Parent6h4/R3 còn mở; normal push được phép, không PR/merge.


> **12/11 — R3c-6h4c-2b2 CHỜ REVIEW:** [Desktop controller upgrade](docs/tasks/tk-s7-release-r3c6h4c-controller-upgrade.md) DONE scoped: Settings4locale/manual consent/unknown/inspect/recover/rollback,8typed IPC và protected additional release093a059/updater7b19cef. Fresh Main review→confirm giữ token/client/scopes, revision+1; stale/unknown binding và old install inspector bị chặn trước mutation. Full2191PASS+2existingLinux-onlySKIP/0FAIL,94focused/7files,10types/ESLint19/build/24AST/package/native15/Electron5+17ảnh đạt; [proof/source hashes](docs/ui-redesign/r3c6h4c2b2-verification.json). Native actual SSH/systemd/Main vault/enrollment/API200; Electron actual Main/private SQLite với synthetic SSH. Fixtures dọn xong,0VPS/productionDB/Productapps/targets. SHA `git log -1 -- app/src/renderer/src/components/ControllerUpgradeWizard.tsx`. Tiếp **explicit SSH credential/VPS-ID authority rebind**, rồi c-3 actual VPS upgrade/exposure/onboarding/reconnect/firstdeploy. Original pins/receipt/key/DB giữ nguyên; c-2/6h4/R3 còn mở, không nâng FR/UC thành hoàn thiện. Normal checkpoint push được phép, không PR/merge.


> **12/11 — R3c-6h4c-2b1 CHỜ REVIEW:** [Root revision admin/recovery](docs/tasks/tk-s7-release-r3c6h4c-controller-upgrade.md) DONE scoped: original installation flock giữ xuyên current settled/ready runtime/UID/payload attestation tới service-UID admin; historical/maintenance/stopped/wrong UID/payload bị chặn. Explicit same-key recover tạo missing root journal chỉ sau fresh parent/pin/unit/runtime/health + verified staging, no blind replay/reset attempted. Full2182PASS+2existingLinux-onlySKIP/0FAIL,69focused/4files,10types/ESLint11/build/builder/2negativeCLI/Ruff/native12 PASS; [proof/source hashes](docs/ui-redesign/r3c6h4c2b1-verification.json). Native actual SSH disconnect trước root exec, cold Main/PID preservation, current/restored-parent admin status/rollback/archive guard; root/unit/account removed,0production/0Productapps/targets. Không enrollment/rotation/Docker/reboot/UI/live claim. SHA `git log -1 -- app/src/main/controlPlane/controllerInstalledAdmin.ts`. Tiếp **c-2b2 Main revision binding/vault/current authority, explicit credential/VPS rebind, protected new catalog và IPC/UI4locale/Electron**, rồi c-3 live upgrade/API/onboarding/reconnect/firstdeploy. Main binding/token và original packaged pins chưa thay; parent6h4/R3 mở, normal push được phép, không PR/merge.

> **12/11 — R3c-6h4c-2a CHỜ REVIEW:** [Main upgrade journal/SSH](docs/tasks/tk-s7-release-r3c6h4c-controller-upgrade.md) DONE scoped: Desktop-only030/controller029 role boundary, immutable intent/current SSH authority, distinct root UUID staging/fixed upgrade RPC và bounded compressed command (35KB→11KB). Full2172PASS+2existingLinux-onlySKIP/0FAIL,321focused/20files,10types/ESLint21/Ruff/build/builder/negativeCLI/nativeSSH8/current-source bundle role3 PASS. Separate cold Main process khôi phục lostreply cùng UUID/PID, rollback giữ receipt/identity/key/DB inode; archive VPS chặn SSH, không tự rebind token. [Proof/source hashes](docs/ui-redesign/r3c6h4c2a-verification.json); fixtures root/unit/account đã dọn,0production/0Productapps/targets. SHA `git log -1 -- app/src/main/controlPlane/desktopControllerUpgrade.ts`. Tiếp **c-2b upgraded admin/current binding, explicit authority epoch rebind, unknown-before-root-journal resolution bằng fresh parent attestation, IPC/UI4locale/Electron**, rồi c-3 live installed API/onboarding/reconnect/firstdeploy/upgrade. c-2a giữ unknown/attempted khi root NOT_FOUND, không auto replay; historical cache không là current authority. VPS/old pins/key/DB giữ nguyên; parent6h4/R3 mở, normal checkpoint push được phép, không PR/merge.

> **11/11 — R3c-6h4c-1 CHỜ REVIEW:** [Trusted controller upgrade backend](docs/tasks/tk-s7-release-r3c6h4c-controller-upgrade.md) DONE scoped: root CLI/side-by-side revisions/immutable original receipt+runtime, shared flock/quiescent mutex, exact schema/dependency/helper compatibility, maintenance activation gate và explicit recovery/rollback. Full2159PASS+2existingLinux-onlySKIP/0FAIL;69focused assertions/6files,9types/ESLint14/build/builder/2negativeCLI/native13 PASS. Native có7SIGKILL, service restart, commit/rollback lostreply +4legitimate credentials, B→A→original restore; root/unit/account đã dọn. [Proof/source hashes](docs/ui-redesign/r3c6h4c1-verification.json). Lab0Productapps/targets, HTTP fixture độc lập; chưa Docker deployment/OS reboot/VPS rollout/Desktop upgrade UI. Source SHA `git log -1 -- app/src/main/controlPlane/controllerUpgrade.ts`. Tiếp **c-2 pinned SSH/Main durable intent/current revision authority/admin bridge/IPC/UI**, lưu ý Main schema không ngầm nâng controller029; rồi **c-3 actual installed exposure API và isolated Electron onboarding/reconnect/firstdeploy/live upgrade**. VPS/demo/pins/key/DB giữ nguyên. Parent6h4/R3 mở; normal push được phép, không PR/merge.

> **10/11 — R3c-6h4b CHỜ REVIEW:** [Desktop exposure feature](docs/tasks/tk-s7-release-r3c6h4-product-exposure.md) đã nối fixed typed client/strict correlation → Main derived public probe → canonical authenticated observation API → IDs-only IPC/UI4locale. Không redirect/credential/body, timeout8s, current binding/generation/TTL guards và unknown chỉ read-current, không retry/command lookup. Full2136PASS+2Linux-onlySKIP/0FAIL,180focused assertions trong10files,8types/lint21/build/2AST/native8/Electron5checks+12ảnh đạt. [Proof/hash manifest](docs/ui-redesign/r3c6h4b-verification.json). Electron production preload/typed IPC/Main service/native private SQLite cold profile và Internet HTTP thật, nhưng SSH transport là loopback adapter và runtime/controller DB là synthetic lab; private DB/root dọn xong. Source SHA `git log -1 -- app/src/main/controlPlane/desktopExposure.ts`. Installed VPS/demo/pins/key/DB giữ nguyên, old server báo unsupported. Tiếp6h4c **trusted upgrade/recovery** với old/new pins và parent intent riêng, preserve identity/UID/DB/key/target/HMAC/demo, Linux crash/cold/lostreply gate trước VPS rollout; sau đó actual installed API + isolated Electron onboarding/reconnect/firstdeploy/live exposure. Không root SQL-writer/reinstall/overwrite old pin để né upgrade. Parent6h4/R3 còn mở; normal push được phép, không PR/merge.

> **10/11 — R3c-6h4a CHỜ REVIEW:** [Exposure backend](docs/tasks/tk-s7-release-r3c6h4-product-exposure.md) thêm GET context/POST authorized observation hậu settlement vào canonical controller SQLite; strict H2/runtime/target/source/config fences, client-scope re-auth, latest-only CAS và lostreply→GETcurrent, không command tombstone fallback hoặc đổi signed receipt. Focused29/full2076PASS+2Linux-onlySKIP/8types/lint11/build và native HTTP/SQLite5checks PASS/root removed. Native runtime/observer synthetic, không public network probe. SHA `git log -1 -- app/src/main/controlPlane/controllerExposure.ts`; [sanitized proof](docs/ui-redesign/r3c6h4a-verification.json). VPS/demo/controller/pins/key/DB giữ nguyên ở bản6h2c, exposure live vẫn chưa được bổ sung. Tiếp6h4b typed client (unknown→read-current), trusted Main derived public probe/IPC/UI4locale và real isolated Electron/native-profile flow;6h4c safe installed-controller upgrade/rollback trước live API rollout. Không nới H2/SQL bypass/reinstall để né upgrade. Normal checkpoint push được phép, không PR/merge; parent6h4/R3 vẫn mở.

> **10/11 — R3c-6h3 CHỜ REVIEW:** [Live Product Git gate](docs/tasks/tk-s7-release-r3c6h3-live-git.md) đã chạy trên VPS phát triển mới: Docker/Compose, target encrypted registration/HMAC, fullSHA source, first deployment và3Git polling cases success→health503 rollback→healthy restore. Live12checks/4jobs/4deployments PASS,164focused tests/type/lint/syntax/2negativeCLI và public Electron web capture PASS. Electron không chạy trong auto gate, watcher chỉ read DB/HTTP; không gọi Desktop executor. Demo app1 `san-nha-live`, deployment4/SHA bfed894/marker demo-v3, HTTP200 tại http://167.71.202.116:30000/; auto policy tạm pause, active temporary clients0 và local private DB đã dọn. Không sửa controller runtime/pins/DB/IPC; initial source FAIL giữ nguyên evidence, diagnostic/explicit continuation PASS qua trusted CLI/server atomic first-deploy check, không giả Main GUI readiness receipt. Tiếp6h4: Product exposure vẫn not_checked cần persist independent evidence, actual Electron isolated-profile flow/reconnect; HTTPS/rotation/reboot/soak/ML còn task riêng. SHA `git log -1 -- app/scripts/controller-git-live.mjs`; normal push được phép, không PR/merge.

> **10/11 — R3c-6h2c CHỜ REVIEW:** [Settings controller installer](docs/tasks/tk-s7-release-r3c6h2c-install-wizard.md) nối packaged Linux resources được pin vào Main,9typedIPC và wizard4locale. Full2047PASS/2Linux-onlySKIP/0FAIL; backend66/UI11/type7/lint21/build/Ruff/package hook PASS, Electron19checks/18ảnh. Windows sender đã cài controller thành công trên VPS phát triển mới167.71.202.116, systemd running/enabled với UID997; authenticated localhost API qua SSH PASS, quyền đọc tạm đã revoke, private local DB đã dọn. Không Docker/app deploy; không dùng production Desktop profile. User-provided ED25519 pin được kiểm trước password, không gọi nguồn pin là provider-console attestation. SHA `git log -1 -- app/src/renderer/src/components/ControllerInstallWizard.tsx`. Tiếp6h3 live target/Git/readiness/firstdeploy/Desktop-off trên controller hiện hữu; upgrade/uninstall/rotation/reboot/soak và signed distribution còn gate riêng. Không PR/merge; normal checkpoint push được phép.

> **10/11 — R3c-6h2b3 CHỜ REVIEW:** [Installed controller admin/binding](docs/tasks/tk-s7-release-r3c6h2b3-installed-admin.md) nối independently pinned SSH → trusted installer/root receipt/account/unit/runtime attestation → setpriv service UID → unchanged same-UID admin verifier. Full2020PASS/2Linux-onlySKIP/0FAIL,focused119/native44/type7/ESLint17/build/Ruff/builder PASS; lost delivery/samekey/revoke/re-add và cleanup đã chứng minh. SHA `git log -1 -- app/src/main/controlPlane/controllerInstalledAdmin.ts`. Main binding gắn journal/current SSH/cipher/generation; không rotate token ngầm. Tiếp6h2c IPC/Settings wizard và distribution/live/reboot/soak; form cũ legacy same-UID, chưa Desktop one-click/PRODUCT_PASS. VPS cũ160.191.243.89 TCP timeout22/80/443,0auth/0write; user đã được báo hạn lịch sử08/11, chưa xác nhận gia hạn. Không PR/merge; normal checkpoint push được phép.

> **09/11 — R3c-6h2b2 CHỜ REVIEW:** [Desktop installation journal/discovery](docs/tasks/tk-s7-release-r3c6h2b2-install-journal.md), migration029 giữ UUID/catalog pins và authority generation trước SSH; unknown chỉ explicit inspect/recover, explicit rebind khi gỡ/thêm lại VPS hoặc đổi credential. Full1998PASS/2Linux-onlySKIP/0FAIL,focused69/migration regression100/typecheck7/ESLint16/build/Ruff/native32 PASS; actual cold MainSQLite029 giữ controller sau lostreply/re-add,0production/cleanup hoàn tất. SHA `git log -1 -- app/src/main/controlPlane/desktopControllerInstallation.ts`. Main facade typed, chưa IPC/UI. Tiếp **6h2b3 root-admin UID bridge + vault installation authority**, rồi Settings wizard/distribution/live/reboot/soak. Form binding cũ chưa quản trị được service installer mới; chưa Desktop one-click/PRODUCT_PASS. Không productionwrite/PR/merge; checkpointpush được phép.

> **08/11 — R3c-6h2b1 CHỜ REVIEW:** [Pinned SSH transfer/bootstrap](docs/tasks/tk-s7-release-r3c6h2b1-ssh-bootstrap.md), bounded raw stream/ACK + local/receiver independent pins/hash/ELF/lock/catalog checks; Python xác minh trước packaged Node, không cần host Node trong SSH PATH. Native25 actual145MB/resume/tamper/namespace crash/kernel lock/lost install reply→cold inspect actual non-root systemd,0production và fixture đã dọn. Client17/focused114/full/types/lint/build/Ruff trong hồ sơ. SHA `git log -1 -- app/src/main/controlPlane/controllerSshBootstrap.ts`. Tiếp6h2b2 Main durable install journal + explicit root-admin UID bridge/binding, rồi wizard/distribution/live/reboot/soak; form cũ chưa admin service này. Không IPC/UI/schema/dependency/PR/merge; checkpointpush được phép, R3 tổng chưa đóng.

> **08/11 — R3c-6h2a CHỜ REVIEW:** [Controller system service](docs/tasks/tk-s7-release-r3c6h2a-controller-service.md) có trusted CLI installer, root-owned UUID/pin/phase/flock, account nologin riêng, setpriv clear-groups, private DB/key và systemd sandbox. Native22 actual start/enable/restart/stop +4SIGKILL/cold same-key recover, no regen/overwrite/lock bypass; fixture/account/group/unit đã dọn,0production. Focused97/release regression17/full/types/lint/build theo hồ sơ. SHA `git log -1 -- app/src/main/controlPlane/controllerInstallation.ts`. Còn code6h2b SSH transfer/Python bootstrap (fresh VPS không có Node) + explicit root-admin UID bridge, rồi wizard; form binding cũ chưa admin service này. Reboot/live/soak/upgrade/rotation còn gate riêng. Không migration/dependency/IPC/UI/PR/merge; checkpointpush được phép, R3 tổng chưa đóng.

> **08/11 — R3c-6h1 CHỜ REVIEW:** [Linux release + readonly preflight](docs/tasks/tk-s7-release-r3c6h1-controller-release.md). Node22.23.4/glibc2.39, approved17 packages/998files/144950541bytes; independent pin, passive exact file/lock/hash/ELF verifier, trusted builder không download hoặc copy Windows modules. Native17 chứng minh cold non-root SQLite/CLI/schema028/0VPS/0job, tamper/version drift/no overwrite và actual pinned SSH; WSL user báo blocked SYSTEMD đúng, không tự enable. Focused52/5types/lint8/build/Ruff đạt, full cuối trong hồ sơ. SHA `git log -1 -- app/src/main/controlPlane/controllerRelease.ts`. Tiếp6h2 cần code transport/journal/install transaction/privilege separation/systemd + wizard; không yêu cầu user test phần chưa viết. Không migration/dependency/IPC/UI/productionwrite/PR/merge; checkpointpush được phép, R3 tổng/PRODUCT_PASS chưa đóng.

> **08/11 — R3c-6g4 CHỜ REVIEW, gates PASS:** [VPS target credentials từ Desktop](docs/tasks/tk-s7-release-r3c6g4-target-credentials.md), migration028/40tables, local review+consent/main-only decrypt/currentprofile+binding+cipher fences/verifiedSSH register-vps/atomic receipt. Full1879PASS/2Linux-onlySKIP/0FAIL,native34(lostreply→coldretryoldUUID→1VPS/sameciphertext,wrongpin trướcauth,pipeline running/HTTP200),Electron80/probe18/fresh028/4types/lint26/build/Ruff đạt;121files41text+80PNG. SHA `git log -1 -- app/src/main/controlPlane/desktopTargetSetup.ts`. Đăng ký không tự cài Docker/deploy. Tiếp controller installer/setup và rotation/rebinding/non-root/live/soak; không yêu cầu user test thay code còn thiếu. R3 tổng chưa đóng; checkpointpushđượcphép, khôngproductionwrite/PR/merge.

> **08/11 — R3c-6g3d CHỜ REVIEW, gates PASS:** [Readiness/first deploy](docs/tasks/tk-s7-release-r3c6g3d-first-deploy.md) nối từ registered project tới runtime thật trong private SSH/Docker lab: exactSHA/source/target/resources, receipt60s, explicit prepare→review→send và atomic first-deploy precondition. Full1845PASS/2Linux-onlySKIP/0FAIL,native29(lostHTTP→coldlookup→1job→running/HTTP200/cleanup),Electron68/probe13/4types/lint26/build/Ruff đạt;108files40text+68PNG. SHA `git log -1 -- app/src/main/controlPlane/desktopFirstDeployment.ts`. Tiếp target credential onboarding từ Desktop (remote VPS hiện vẫn cần enroll-vps CLI), installer/rotation rồi live/soak; không yêu cầu user test thay phần code chưa có. Schema027/dependencies giữ nguyên, R3 tổng chưa đóng. Checkpoint push được phép; không productionwrite/PR/merge.

> **R3c-6g3c final / CHỜ REVIEW:** full1805PASS/2Linux-onlySKIP/0FAIL, native25/probe7/Electron52/4typechecks/lint21/build/Ruff PASS;85file review/52ảnh. [Ledger/evidence/next6g3d](docs/tasks/tk-s7-release-r3c6g3c-target-ui.md). Unknown target khôi phục bằngcoldinspect, giữ inode/hash/mtime files vàkeys, khôngreinstall/0deployment. Enrolled chỉstoredproof, resources/Docker/runtime readiness vàfirstdeployGUI vẫn6g3d; khôngcầnuser test thaycode. SHA `git log -1 -- app/src/main/controlPlane/projectTarget.ts`; checkpointpushđượcphép, khôngPR/merge/productionwrite.

> **R3c-6g3c 07/11 — target preparation từ Desktop:** [Hồ sơ](docs/tasks/tk-s7-release-r3c6g3c-target-ui.md). Mainderiveauthority/fixed2CLI+2IPC/currentbinding/sourcefences trong transaction +expectedSSHidentity; reuseinstaller/proof, unknown chỉinspect oldroot. GUI4locale/hostname/pin/rootreview/explicitconfirm/unknownrecovery, không ready/deployed claim. Focusedmain100/UIcombined110/native25/probe7/types/build/Ruff đạt; final full/Electron tronghồsơ. Tiếp6g3d resources/Docker/remote readiness +firstdeploy GUI bằng existingjournal; chưa cần usertest thaycode. Checkpointpushđượcphép, khôngproductionwrite/PR/merge. SHA `git log -1 -- app/src/main/controlPlane/projectTarget.ts`.

> **R3c-6g3b final — CHỜ REVIEW:** full1777PASS/2Linux-onlySKIP/0FAIL, focused99/nativeSSH+Git21/stderrprobe7/Electron44/4typechecks/lint15/build/Ruff PASS.72file review/44PNG, source-only snapshot phân biệt với deployment. [Ledger/bằng chứng](docs/tasks/tk-s7-release-r3c6g3b-source-ui.md); SHA `git log -1 -- app/src/renderer/src/components/ControllerProjectSourceCheck.tsx`. Tiếp6g3c enroll-target/readiness/firstdeploy GUI; checkpointpush đượcphép, khôngPR/merge/productionwrite.

> **R3c-6g3b 07/11 — kiểm tra source từ Desktop:** [Hồ sơ](docs/tasks/tk-s7-release-r3c6g3b-source-ui.md). Fixed IPC chỉsetupkey/main deriveauthority/verifiedSSH+timeoutriêng, strictmetadata/currentbinding/safeerrorcodes. Source dialog4locale/review→explicitverify/fullSHA/time/counts/error/retry/late-resultguards, không ready/deployed flag. Focused99/nativeSSH+actualGit21/stderrprobe7/Electron44checks+44ảnh/types/lint15/build/Ruff đạt; fullcuối tại hồsơ. Tiếp6g3c targetenrollment/readiness/firstdeploy GUI, rồitargetcredentialonboarding/installer/rotation/live/ML/HTTPS/migrate. Khôngcầnuser test thaycode thiếu; checkpointpush đượcphép, khôngproductionwrite/PR/merge. SHA `git log -1 -- app/src/renderer/src/components/ControllerProjectSourceCheck.tsx`.

> **R3c-6g3a gate cuối / CHỜ REVIEW:** full1743PASS/2Linux-onlySKIP/0FAIL, focused50/UI54/native12/4typechecks/lint6/build PASS. Native `91d2b885408a` actual public GitHub/fullSHA/coldCLI,0targetexec/0job/0deployment. Đã sửa assertion chờ terminal useEffect, không đổi UI runtime; failed gate trước được giữ và thay bằng final pass, không waiver. [Ledger/evidence/điểm nối6g3b](docs/tasks/tk-s7-release-r3c6g3a-source-verification.md); SHA `git log -1 -- app/src/main/controlPlane/projectSourceVerification.ts`. Normal checkpoint push được phép, đối soát remote trước báo; chưa PR/merge/production write.

> **R3c-6g3a 07/11 — backend xác minh source:** [Hồ sơ](docs/tasks/tk-s7-release-r3c6g3a-source-verification.md). Fixed `verify-project-source` Linux adminCLI lấy current SQLite repo/ref/root, trusted bundle/90s snapshot/fullSHA/shared detector-render-quota; recheck owner/source/config/target/pause/observation sau await rồi ghi observation + audit nguyên tử. Không install/build/SSH target/job/deployment/auto-enable. PublicGit CLI/cold sameSHA12cases đã đạt; final gates trong hồ sơ. Chưa nối source verification IPC/UI/enroll-target/readiness/firstdeploy; đó là code tiếp6g3b, không yêu cầu user test thay phần chưa viết. Không productionDB/VPS/PR/merge; checkpoint push được phép.

> **R3c-6g2 07/11 — tạo dự án từ Desktop:** [Hồ sơ](docs/tasks/tk-s7-release-r3c6g2-desktop-registration.md). Remote controller target list/expectedtargetrevision +fixed verifiedSSH operations, SQLite027 durable setup UUID/body/bindingrevision trướccreate; retrymãcũ quaCLI26idempotent,0duplicateapp. UI2bước form/review/confirm,4locale/pending/retry/cancel; project registered vẫnpaused/chưadeploy. Backend116/UIcombined82focused/native18+CLI8/Electron40checks+40ảnh/fresh027/types/lint25/build/Ruff PASS; fullcuối tại hồsơ. Tiếp6g3 sourceverification +targetenrollment +readiness/firstdeploy từUI, rồitargetcredentialonboarding/installer/rotation/live/soak; khôngcầnuser test thaycode cònthiếu. Checkpoint push được phép, khôngPR/merge/productionwrite. SHA `git log -1 -- app/src/renderer/src/components/ControllerProjectPanel.tsx`.

> **R3c-6g1 07/11 — nền tạo dự án Product:** [Hồ sơ](docs/tasks/tk-s7-release-r3c6g1-project-registration.md). `register-project` Linux SSH-admin CLI + migration026 tạo app/source/paused ownership/history/request nguyên tử; current target pin/AES credential và controller kiểm lại cả replay, không import Desktop app hoặc autoenable. PublicGitHubURL/Express-noDB theo runtime, source verification/target enrollment/runtime preflight còn required,0remotecommand/job/deployment. Focused66/nativeCLI8/auth13/Desktopenroll15/fresh026/types/lint12/build/Python365 PASS; full cuối tại hồ sơ. Tiếp6g2 pinned SSH metadata admin operations/target list và durable setup UUID→wizard review/source/target/enroll/status. Không cần user test thay code; checkpoint push được phép, không PR/merge/production write. SHA `git log -1 -- app/src/main/controlPlane/projectRegistration.ts`.

> **R3c-6f07/11 — gates PASS/CHỜ REVIEW:** [Deploy/policy UI](docs/tasks/tk-s7-release-r3c6f-command-ui.md) ghi quyền opt-in khi đăng ký mới, app remote/generations/capabilities/status, xác nhận fullSHA trước prepare→send; Pause/Resume và journal có unknown→samekeylookup/no replay, prepared chỉcancel khi cold screen. Accepted không đồng nghĩa runtime thành công; job/deployment đọc riêng. Focused68/full1680PASS/2Linux-onlySKIP/0FAIL/native15/Electron24checks+24ảnh/fresh025/types/lint12/build PASS. Next: wizard tạo app Product mới/target/source/credentials, installer/non-root/rotation/liveVPS/soak; đây là UI thao tác app đã do controller quản lý. Không cần user test thay code còn thiếu; checkpoint push được phép, không PR/merge/production write. SHA `git log -1 -- app/src/renderer/src/components/ControllerCommandPanel.tsx`.

> **R3c-6e07/11 — journal/service/IPC:** [Hồ sơ](docs/tasks/tk-s7-release-r3c6e-desktop-commands.md), migration025 lưu main UUID + body/generations/client binding bất biến trước mạng; IMMEDIATE claim trước POST, mất phản hồi/cold process chỉ lookup cùng key, không gửi lại khi notfound. Five concrete IPC routes đã nối actual main service, whitelist metadata/no secret/note/env; cancel chỉ prepared. Focused97/nativeSSH-HTTP-cold9/enrollment13/fresh025/Python365/types/lint14/build PASS; full cuối theo hồ sơ. Tiếp R3c-6f UI quyền ghi opt-in + app generations/capabilities + Deploy/Pause/Resume và pending journal; quyền form6d vẫnread-only. Không cần user test thay code UI còn thiếu; installer/live rollout/HTTPS/migrate/ML gates riêng. SHA `git log -1 -- app/src/main/controlPlane/desktopControllerCommands.ts`. Checkpoint push được phép, không PR/merge/production write.

> **R3c-6d06/11 — gates PASS/CHỜ REVIEW:** [Hồ sơ UI/IPC](docs/tasks/tk-s7-release-r3c6d-controller-ui.md). Settings có đăng ký bằng VPS đã pin, danh sách/retry cùng UUID, thu hồi quyền qua SSH và ngắt cục bộ; xem Product apps từ controller với phân trang, TTL và lỗi rõ ràng, không lấy dữ liệu local thay thế. Sáu IPC chỉ nhận/trả metadata; credential giữ main. Focused55/native SSH+CLI+service13/Electron12 ảnh và kiểm tra layout/full1651PASS/2Linux-onlySKIP/0FAIL/Python365/fresh024/types/scoped lint15/build PASS. Tiếp local durable request journal rồi nút deploy/pause/resume có xác nhận; installer/live rollout/HTTPS/migrate/ML là gates riêng. Không cần user test để thay phần code chưa viết. Checkpoint push được phép; không PR/merge hoặc production VPS/DB write. SHA tra `git log -1 -- app/src/renderer/src/components/ControllerPanel.tsx`.

> **R3c-6c06/11 backend gates PASS/CHỜ REVIEW:** [Desktop encrypted vault/SSH enrollment](docs/tasks/tk-s7-release-r3c6c-desktop-enrollment.md) SQLite024/context-bound cipher/current VPS-security revision/same enrollment UUID/lost credential delivery/CAS disable; approved inline Python independently verifies bundle+Node+private marker/read-only controller SQL trước CLI. Native **aa9a2c48875b 11PASS** actual SSH/CLI/cold process→HTTP/revoke; Windows2Electron processes safeStorage create/cold decrypt PASS; full **1633PASS/2Linux-onlySKIP/0FAIL**, Python365/native auth13/HTTP11/fresh024/types/scopedlint15/build/Ruff PASS. SHA `git log -1 -- app/src/main/controlPlane/desktopControllerVault.ts`. Chưa cần user test; tiếp IPC/UI onboarding và controller-backed list/actions, không xem backend đang thiếu UI là lỗi cần user test. Live installer/HTTPS/ML/production rollout chưa nghiệm thu riêng. Checkpoint pushes được phép, không PR/merge/VPS write. Windows Temp cipher fixture cleanup bị automatic review reject, giữ encrypted files ngoài repo (path trong ignored .out-scripts); đã thông báo user, không vòng shell vượt block.

> **R3c-6b06/11 CHỜ REVIEW:** [Main HTTP client](docs/tasks/tk-s7-release-r3c6b-desktop-http-client.md) fixed typed11routes/pinned SSH/fresh binding/strict bounded DTO/freshness/safe errors; lost write response→outcome_unknown/same-key lookup/no retry. Native SSH→actual ControllerReadApi/Commands/SQLite **3d01dde2bf7a 13PASS** (dropped response after commit→1job/replay/lookup/revoke/current binding); channel7PASS. Sửa pooled handshake concurrency có unit red2clients→green1 + real parallel reads1SSH; service regression **de14e9cdd672** Git/Docker/systemd2settled deploy/restart/pause-resume/cleanup PASS. Final focused87/full **1614PASS/2Linux-onlySKIP/0FAIL**/types/scopedlint7/build/fresh023 PASS. SHA `git log -1 -- app/src/main/controlPlane/controllerHttpClient.ts`. Tiếp6c contract/migration protected local credential binding + SSH-admin enrollment, rồi IPC/UI authority/rotation; chưa durable vault/UI, không token generic settings hoặc renderer, không Product Desktop hoàn chỉnh. R3 tổng PARTIAL; user cho phép checkpoint pushes, không PR/merge/production VPS write.

> **R3c-6a06/11 CHỜ REVIEW:** [Pinned API SSH channel](docs/tasks/tk-s7-release-r3c6a-pinned-api-channel.md) main-only SshManager.openControllerApiChannel: destination127.0.0.1:8768 cố định, expected/current/actual principal, whole deadline/default15s/max30s, cancellation/disconnect/late close/re-resolve. Focused40/nativeSSHHTTP7 **207ed0ebe45f**/fresh023/full **1597PASS/2Linux-onlySKIP/0FAIL**/types/scopedlint/build PASS. SHA `git log -1 -- app/src/main/ssh/controllerApiChannel.test.ts`. C5b **baabc06** đã push/remote match. Tiếp6b bounded DTO HTTP client + protected local client credentials/enrollment, rồi UI controller authority/rotation; không coi channel echo lab là authenticated Desktop service/UI đã xong. R3 tổng PARTIAL, không PR/merge/VPS production write; checkpoint push được phép.

> **R3c-5b06/11 CHỜ REVIEW:** [Command HTTP/runtime](docs/tasks/tk-s7-release-r3c5b-command-http.md) bounded POST/re-auth/Idempotency-Key/request lookup/capabilities/drain đã qua full **1585PASS/2Linux-onlySKIP/0FAIL**, nativeHTTP11/SQL12/auth13/fresh023/types/scopedlint/build. Actual publicGit/systemd **869ed020b29d PASS**: manual redeploy sameSHA đúng1job, bỏ response→lookup/replay, pause/resume satisfied,2deployT1T2, restart giữ container/no duplicate,revoke401,cleanup/deadlinefalse. Real gate phát hiện production service thiếu completion-verifier callback; đã nối router persisted receipt/current authority và kiểm ready trước restart (không nới safety). SHA `git log -1 -- app/src/main/controlPlane/controllerWriteApi.ts`. Tiếp rotation/pinned SSH Desktop transport/UI controller authority, rồi gates release khác; R3 tổng PARTIAL. Checkpoint pushes được phép, không PR/merge/production VPS write. Python không đổi; installer/non-root/liveVPS/ML/HTTPS/soak chưa nghiệm thu.

> **R3c-5a06/11:** [Command persistence](docs/tasks/tk-s7-release-r3c5-controller-commands.md) local gates PASS: schema023, client/key namespace/auth/generation/atomic manual+pause/resume barriers/lookup;37focused/nativeSQL12two-process/auth13/readAPI10/fresh023/full1575PASS/2SKIP/types/lint/build. SHA `git log -1 -- app/src/main/controlPlane/controllerCommands.ts`. Tiếp **R3c-5b HTTP writes + bounded body/current reauth/Idempotency-Key/request lookup + shutdown/drain + actual manual runtime**. Read API vẫn writeUnsupported, không nhầm nativeSQL marker test là remote deploy; Desktop tunnel/rotation/UI authority sau. User cho phép checkpoint push, chưa PR/merge/production write; R3 tổng PARTIAL.

> **R3c-4 final06/11:** implementation **7bed110** đã push; [read API gate](docs/tasks/tk-s7-release-r3c4-controller-read-api.md) **ed1dbc15d458** PASS(actual publicGit079cffe→7bed110,2deploy/2read snapshots,cursor/live revoke/systemd restart/cleanup/deadlinefalse), full1563PASS/2SKIP/types/lint/build/native10PASS. Tiếp **R3c-5 command persistence/idempotency rồi HTTP writes**, rotation và pinnedSSH Desktop transport/UI authority. Root isolated lab, R3 tổng PARTIAL; không VPS production/PR/merge. Notes pending ở dưới là lịch sử.

> **Điểm tiếp06/11 — R3c-4:** [Authenticated read API](docs/tasks/tk-s7-release-r3c4-controller-read-api.md) code/native10/HTTP9/full1563PASS/2SKIP/types/lint/build PASS. Explicit run-product loopback bearer, ownership/DTO/cursor guards; unsupported write/log capabilities, default run health-only. Source SHA `git log -1 -- app/src/main/controlPlane/controllerReadApi.ts`. Fresh publicGit/systemd API regression `ed1dbc15d458` đang chạy, cần meaningful checkpoint push rồi chốt second snapshot/live revoke/cleanup. Không chạy Windows ControllerService tests song song Linux port8768. Tiếp manual write/idempotency, rotation và pinned SSH Desktop tunnel/UI authority; R3 tổng PARTIAL. User cho phép checkpoint pushes, chưa PR/merge/production write.

> **Điểm tiếp 06/11 — R3c-3:** [Client credentials](docs/tasks/tk-s7-release-r3c3-controller-client-auth.md) migration022 + one-time/digest-only/scopes/TTL/revoke/admin idempotency,41focused/LinuxCLI13concurrent/fresh022/VPSCLI14/full1554 PASS/2SKIP/types/lint/build. SHA `git log -1 -- app/src/main/controlPlane/controllerClientAuth.ts`. Tiếp **authenticated read API**/capability/read-model, rồi pinned SSH Desktop tunnel/ownership/history, manual writes/rotation. Không mở `/v1` trong credential checkpoint; R3c-2 actualGitHub/systemd gate PASS tại `9ef18f9`. R3 tổng PARTIAL, checkpoint pushes được phép; không PR/merge/production write.

> **Điểm tiếp 06/11 — R3c-2:** [GitHub/systemd](docs/tasks/tk-s7-release-r3c2-public-git-systemd.md) final `da0b2dd098e8` PASS: actual publicHTTPS push9dc3525→8f5b0c5,2settled deployments,installed systemd restart/no duplicate/graceful stop/cleanup, không adapter/Desktop. Root isolated Linux lab, chưa non-root installer/liveVPS/HTTPS/ML/soak. Tiếp **R3c-3 desktop-client credentials**, authenticated API rồi pinned SSH tunnel/Desktop ownership/status/history. R3 tổng PARTIAL; user cho phép checkpoint pushes, chưa PR/merge.

> **Điểm tiếp 06/11 — R3c-1:** [Execution service opt-in](docs/tasks/tk-s7-release-r3c1-execution-service.md) code + gates PASS: explicit Linux `run-product`, startup recovery trước claim, router/admission, packaged paths; 3realCLI processes/2deployments/restart-no-duplicate, R1/R3b7/7, full1537 PASS/2 SKIP/types/lint/build. SHA `git log -1 -- app/src/main/controlPlane/controllerExecutionService.ts`. Lab Git transport dùng file adapter rõ phạm vi; tiếp R3c-2 **GitHub HTTPS không adapter + installed systemd restart**, rồi authenticated API/Desktop authority. Default run vẫn polling-only/health maintenance; R3 tổng PARTIAL. User cho phép checkpoint pushes; chưa PR/merge hoặc production write.

> **Điểm tiếp 06/11 — R3b-6:** [Admission/cold startup recovery](docs/tasks/tk-s7-release-r3b6-readiness-recovery.md) local gates PASS: real7/7/full app1534 PASS/2 SKIP/Python365/types/lint/build; cold CLI T1→T2 giữ container/collector, historical proof giữ nguyên, pre-T1 unknown không replay. SHA `git log -1 -- app/src/main/controlPlane/controllerStartupRecovery.ts`. Tiếp **R3c service opt-in** nối bundle/config/target provider/router/admission/startup/shutdown + health truth, Git/OS restart rồi Desktop API/UI authority. Default service polling-only, R3 tổng PARTIAL; live/ML/HTTPS/migrate/installer còn gate riêng. User cho phép checkpoint pushes trên `feat/release-audit-20261204`; không PR/merge/force push; notices cũ là lịch sử.

> **Điểm tiếp mới nhất 06/11 — R3b-5b:** [Production target installation/enrollment](docs/tasks/tk-s7-release-r3b5b-target-enrollment.md) có schema021/state machine, installed helpers/2apps/7real cases, process exit73 + independent CLI inspect không overwrite; Linux11/11, bundle14/14/fresh install/VPS CLI14/14 PASS; full **1519 PASS/2 SKIP**, Python365PASS, types/lint/build PASS. SHA `git log -1 -- app/src/main/controlPlane/targetEnrollment.ts`. Tiếp R3b-6 resource admission/cold startup recovery (enrollment unknown vs pending H2 T1/pre-T1 unknown, exact historical key/fence/profile), service opt-in/Git push/OS restart và Desktop API/UI authority R3c. CLI enrollment yêu cầu Product-owned paused/quiescent app, chưa tự promote/source setup/enable policy. Bundle hiện12files (3runtime Python + bootstrap), default service polling-only; R3 tổng PARTIAL, không production write/push/PR/merge. Notices dưới giữ lịch sử.

> **Điểm tiếp mới nhất 06/11 — R3b-5a:** [Gói controller/verifier](docs/tasks/tk-s7-release-r3b5a-controller-bundle.md) đã có entrypoint +10 approved assets/manifest, trusted CLI đọc candidate không execute, unit21/21 + Linux FS14/14 + fresh install/init/status/verify + enrollment regression14/14 PASS; full app **1502 PASS/2 SKIP**, types/lint/build PASS. SHA `git log -1 -- app/src/main/controlPlane/controllerBundle.ts`. R3b-4 `564ca9c`, R3b-3 `70dfe9e`, R3b-2 `e705e68`. Tiếp R3b-5b protected remote installation/app-generation enrollment + exact HMAC/receipt reconciliation, rồi admission/cold startup/service opt-in/restart. Verified paths hiện là local source, chưa installed target paths. R3 tổng PARTIAL, default polling-only; không push/PR/merge hoặc production VPS/DB write. Notice dưới giữ lịch sử.

> **Điểm tiếp hiện hành 06/11:** [R3b-4 explicit key/VPS credential enrollment CLI](docs/tasks/tk-s7-release-r3b4-controller-enrollment.md) đã code: Linux CLI14/14 (hai process thật/replay), 29 unit tests, full app **1481 PASS/2 SKIP**, types/lint/build PASS. SHA `git log -1 -- app/src/main/controlPlane/controllerEnrollment.ts`; R3b-3 resolver `70dfe9e`, R3b-2 key/router `e705e68`. Tiếp target **app/helper/HMAC** enrollment có manifest/checksum/lost-response reconciliation, admission/cold startup scan rồi service opt-in/OS restart. Không lặp key/credential/bootstrap work; default polling-only, R3 tổng PARTIAL. Live endpoint/pin/domain còn thiếu, chưa whole-product/ML/HTTPS/migrate/installer PASS, không push/PR/merge hoặc VPS write.

> **Điểm tiếp 06/11:** bắt đầu code [R3b bootstrap](docs/tasks/tk-s7-release-r3b-controller-bootstrap.md): protected controller store trước, rồi per-app/generation keys, enrollment/admission/cold recovery và service restart. Không lặp audit hoặc bật default executor. Metadata read-only của profile hiện chỉ có hai VPS cũ chưa fingerprint và không có domain; đã hỏi user endpoint/pin/domain, không đọc secret hoặc kết nối VPS. R3a `1e4df09`, R2 `950b7ae`, R1 `bc4289a`; full app1414 PASS/2 Linux-Caddy SKIP, chưa thay live/installer/ML gates.

> **06/11 — R3a local gate PASS:** [Executor adapter](docs/tasks/tk-s7-release-r3-executor.md) đã nối immutable snapshot/preflight/H2/verified T2 completion, queue bắt buộc persisted verifier; lab 7/7, full app **1414 PASS/2 SKIP**, types/lint/build/fresh Linux CLI và 3 helpers PASS. R2 `950b7ae`, R1 `bc4289a`, R0 `ad37403`. R3a CHỜ REVIEW; R3 tổng PARTIAL, default polling-only. Tiếp protected enrollment/credential + per-app generation keys/admission/cold startup recovery (R3b), service/Git push/UI authority/live (R3c); không nhận luôn chạy production đã xong. SHA R3a: `git log -1 -- app/src/main/controlPlane/productRuntimeExecutor.ts`.

> **06/11 — R2 local gate PASS:** [Crash matrix](docs/tasks/tk-s7-release-r2-recovery-lab.md) `64a137977fe3` **9/9 PASS**, cold SQLite, CID/image/StartedAt app+collector giữ nguyên, stale pin/fence reject, cleanup/source_unchanged=true. R2 CHỜ REVIEW; tiếp R3 bootstrap/executor/service. Pre-T1 unknown vẫn cần reconciliation, chưa có OS restart/production enrollment/VPS rollout. Implementation SHA: `git log -1 -- app/scripts/product-runtime-lab/recovery.mjs`.

> **06/11 — triển khai release tiếp:** R0 local `ad37403`; [R1 runtime lab](docs/tasks/tk-s7-release-r1-runtime-lab.md) có gate thật 7-case normal + 4-case restore-failure PASS; sửa mount-order config hash, collector build ordering và thiếu Zod runtime dependency. 286 Vitest/typechecks/lint/build/fresh Linux install PASS; CHỜ REVIEW trên `feat/release-audit-20261204`, implementation SHA: `git log -1 -- app/src/main/controlPlane/target_product_runtime.py`. Tiếp R2 crash/lease/fence recovery, chưa bật executor hoặc nhận VPS/PRODUCT_PASS. User yêu cầu tự làm tiếp, không chờ chuyển prompt. Các phần ML/installer/HTTPS/migrate vẫn theo ma trận release và cần evidence riêng.

> **Điểm vào hiện hành 06/11/2026 — hạn 04/12:** [Audit và kế hoạch release R0–R14](docs/tasks/tk-s7-release-2026-12-04.md) thay lịch 20/11. Branch `feat/release-audit-20261204` từ `main b2cd50a`; R0 ownership monitor/Product đã sửa, **135 focused tests + typecheck/scripts/lint/build PASS**, CHỜ REVIEW; implementation SHA: `git log -1 -- app/src/main/monitor/service.ts`. Tiếp theo R1 full runtime integration rồi R2 recovery, không bật executor trước gate. ML pilot/batch và installer là hai nhánh song song; chưa có Worker/Kim nhận task trong phiên này, cần xác nhận tài nguyên và tránh sửa chung file. Các notice bên dưới là lịch sử. Chưa có live deployment hoặc truy cập production DB trong đợt này.

> **Điểm vào hiện hành 05/11/2026:** [Review/merge #33 và #34](docs/tasks/tk-s7-pr33-pr34-integration-2026-11-05.md) đã xong; main có #33 `2679153`, #34 `2a06a97`, không còn PR mở. [Task tiếp theo N1–N10](docs/tasks/tk-s7-next-checkpoints-2026-11-05.md). H2 vẫn PARTIAL, CLI polling-only, chưa auto deploy production. Runtime/ML pilot làm song song; không merge lại nhánh H1 local cũ. Notice 25/10 bên dưới giữ lịch sử, không phải trạng thái hiện hành.

> **Điểm vào mới nhất — 25/10/2026:** [Task và hồ sơ tiếp nhận cho partner](docs/tasks/tk-s7-partner-handoff-2026-10-25.md).
> H0/source-render đã sửa hai finding và qua regression filesystem/localhost SSH; P3e-3b tổng thể vẫn PARTIAL/BLOCKED. Handoff mới có task H1 build, L0 Docker lab chạy song song và checkpoint H2 deployment. Các mục bên dưới là hồ sơ lịch sử 30/09, không đại diện trạng thái hiện hành.

> Người nhận: A (chủ dự án OpsPilot / Leader).
> Người viết: Worker (phiên làm việc tự động hóa pipeline, domain, Doctor, ML và detector).
> Thời điểm: 2026-09-30.
> Mục đích: Ghi nhận trung thực toàn bộ công việc đã thực hiện từ Checkpoint L1a đến L8, lịch sử commit thực tế trên nhánh `feat/deploy-reachability`, kết quả kiểm chứng thực tế và các lưu ý kỹ thuật để Leader tự kiểm tra và quyết định merge.

---

## 0. Lưu ý trung thực và các mức độ kiểm chứng

Tài liệu này phản ánh trung thực trạng thái mã nguồn trên nhánh làm việc `feat/deploy-reachability`. Mọi kết quả kiểm chứng đều dựa trên việc chạy lệnh thực tế trên máy, không suy đoán.

Các mức phân loại:
- **[XÁC MINH — ĐÃ CHẠY VÀ THẤY KẾT QUẢ THỰC TẾ]**: Đã chạy lệnh trực tiếp trong môi trường local, có log và exit code 0.
- **[ĐÃ COMMIT LOCAL TRÊN NHÁNH feat/deploy-reachability — CHỜ REVIEW CỦA LEADER]**: Đã hoàn tất các vòng lặp kiểm thử hồi quy và đã tạo các commit local cho L2 (`e2959f7`), L1a (`d86a319`), fix test (`ae029c5`), backend L3+L4+L5 (`13591ba`), L6 (`ad86736`), L7 (`82a5d5d`), và L8 (`f870b6f`). Toàn bộ ở trạng thái `CHỜ REVIEW` (chưa merge vào `main`, không tự ý push/PR/merge).
- **[NOT_RUN — NGOÀI PHẠM VI WORKER HOẶC MÔI TRƯỜNG HEADLESS]**:
  - **GUI thực tế [NOT_RUN]**: Môi trường agent chạy không có màn hình đồ họa tương tác (headless), không mở cửa sổ Electron để test tay; kiểm chứng qua 63 file / 479 Vitest jsdom tests, typecheck, lint và production build.
  - **VPS thật / Ingress Cloudflare thật / DNS thật [NOT_RUN]**: Phụ thuộc hạ tầng VPS live và API token ngoài phạm vi worker local (đã kiểm chứng qua fake SSH, mock probe và unit/integration tests).
  - **50 run ML chính thức [NOT_RUN]**: Cần môi trường VPS live để thu thập dữ liệu thật (harness offline đã pass 106 tests).

Cách Leader tự kiểm chứng khách quan trong terminal:

```bash
# 1. Kiểm tra trạng thái git và diff
git status --short
git diff --check

# 2. Chạy toàn bộ test của ứng dụng Electron (Vitest: 63 file, 479 test)
pnpm --dir app test

# 3. Typecheck và Lint ứng dụng
pnpm --dir app run typecheck
pnpm --dir app exec tsc --noEmit -p tsconfig.scripts.json
pnpm --dir app lint
pnpm --dir app run build

# 4. Chạy kiểm thử detector suite và CLI try-detect (Vitest: 65 test)
pnpm --dir app test src/main/detectors/detectors.test.ts

# 5. Chạy toàn bộ test ML thí nghiệm & collector (Pytest: 106 test)
ml-service/.venv/Scripts/python.exe -m pytest experiments collector/tests -q

# 6. Chạy test ML-service độc lập (Pytest: 19 test)
ml-service/.venv/Scripts/python.exe -m pytest ml-service/tests -q
```

---

## 1. Yêu cầu và phạm vi công việc

Theo kế hoạch tại `docs/27-ke-hoach-tu-dong-hoa-pipeline-domain-doctor-ml-detector.md`, Worker đã thực hiện toàn bộ các checkpoint từ L1a đến L8 và tạo các commit local tương ứng trên nhánh `feat/deploy-reachability`:
1. **L2**: Commit `e2959f7` — Tích hợp bộ thí nghiệm ML TK-S6 offline (106 tests pytest pass, Ruff pass).
2. **L1a**: Commit `d86a319` — Đồng bộ contract IPC, DeployEvent, Doctor, Domain, DB schema contract (`docs/contracts/schema.sql`; migration 004 thực thi thuộc commit backend `13591ba`). Lưu ý: typecheck tại riêng commit này đã FAILED do lỗi test kế thừa và chỉ PASS sau commit `ae029c5`.
3. **Fix test reachability (Ngoại lệ kế thừa 29ed4d3)**: Commit `ae029c5` — Sửa cú pháp mock `vi.fn<(url: string) => Promise<boolean>>()` cho `reachability.test.ts` (15 tests pass).
4. **L3+L4+L5 (Gộp Backend)**: Commit `13591ba` — Backend Publish, Reachability, Firewall, Doctor Rule Engine, Safe Fix fail-closed, Domain DNS assistant, migration 004 thực thi và IPC dispatch (418 Vitest pass, build pass).
5. **L6**: Commit `ad86736` — Detector Tier 1 (Next.js, Express, Vite) và CLI `try-detect` (detector 65 test tổng pass, CLI 3 demo apps pass, build pass).
6. **L7**: Commit `82a5d5d` — UI Exposure, Doctor drawer, cô lập state giữa các app, Đa ngôn ngữ 4 locales, guard named_tunnel (479 Vitest pass, build pass; GUI thực `NOT_RUN`).
7. **L8**: Commit `f870b6f` — Vệ sinh repo (.gitignore công cụ AI cục bộ), cập nhật bảng task `board.md` và `HANDOFF.md`.

### Ràng buộc xuyên suốt
- **Không tự ý push, mở PR hoặc merge** khi chưa có lệnh từ Leader. Toàn bộ thay đổi giữ trạng thái `CHỜ REVIEW`.
- **Không phá vỡ contract** khi chưa có sự đồng thuận và cập nhật đồng bộ trong `docs/contracts/` cùng `DECISIONS.md`.
- **Không tạo dữ liệu giả hoặc rollback giả** trên UI.
- Giữ nguyên các thay đổi hợp lệ khác trên workspace.

---

## 2. Chi tiết kết quả đã thực hiện (L1a – L8)

### 2.1. L1a — Đồng bộ Contract và Schema DB
- **Trạng thái**: Đã commit local `d86a319` (`feat(contracts): dong bo IPC contract, schema database va ke hoach pipeline (L1a)`). Trạng thái `CHỜ REVIEW` (chưa merge vào `main`).
- **Tệp triển khai**:
  - `docs/contracts/ipc-contract.ts`: Đồng bộ `Deployment.exposure_status`, `Deployment.exposure_evidence_json`, channels `doctor:*` (`doctor:diagnose`, `doctor:fix`, `doctor:history`) và `domain:*` (`domain:plan`, `domain:upsert`, `domain:delete`, `domain:check-propagation`, `domain:list`).
  - `docs/contracts/deploy-events.md`: Cập nhật đặc tả event `finished` với `exposure_status` (`reachable`, `degraded`, `tunnel_only`, `not_checked`) và `exposure_evidence`. Làm rõ hành vi UFW có điều kiện và external probe; ghi nhận `PORT_BLOCKED_EXTERNAL` là diagnosis trong evidence.
  - `docs/contracts/schema.sql`: Bổ sung định nghĩa schema contract cho các bảng `doctor_run`, `doctor_action`, `domain_binding` và các cột `exposure_status`, `exposure_evidence_json` trong bảng `deployment` (file migration 004 thực thi trong codebase Electron `app/src/main/db/migrations/004_publish_doctor_domain.sql` thuộc commit backend `13591ba`).
  - `DECISIONS.md`: Ghi nhận quyết định kiến trúc cho exposure state, Doctor rule engine và Domain DNS assistant.
  - `app/src/shared/ipc.ts`: TypeScript mirror các types contract dùng chung trong Electron app.
  - `docs/27-ke-hoach-tu-dong-hoa-pipeline-domain-doctor-ml-detector.md` & `docs/README.md`: Kế hoạch chi tiết và liên kết tài liệu.
- **Xác minh sau commit**: Trên checkout độc lập tại riêng commit L1a `d86a319`, typecheck (`pnpm --dir app run typecheck:node`) đã **FAILED** do lỗi cú pháp mock Vitest trong `reachability.test.ts` kế thừa từ commit `29ed4d3`; lỗi này chỉ được khắc phục và typecheck chính thức PASS sau commit sửa test `ae029c5`.

### 2.2. L2 — Tích hợp Bộ thí nghiệm ML TK-S6 Offline
- **Trạng thái**: Đã commit local `e2959f7` (`feat(experiments): loadgen harness, fault injection scheduler va protocol thi nghiem (L2 / TK-S6)`). Trạng thái `CHỜ REVIEW` (chưa merge vào `main`).
- **Tệp triển khai**:
  - `experiments/load_gen/loadgen.py`: Thêm kiểm tra target bắt buộc trước khi chạy, giới hạn thời gian tối đa 30 phút, kill-switch qua file tín hiệu.
  - `experiments/faults/scheduler.py`: Điều phối fault injection theo kịch bản (CPU burn, memory leak, packet drop, process kill, latency creep).
  - `experiments/protocol.py`: Định nghĩa quy trình 5 kịch bản chuẩn với các pha baseline, holdout, fault, recovery.
  - `experiments/analyze.py`: Xử lý phân tích CSV với timestamp UTC ISO, tính toán metric PR-AUC, F1, detection delay và false alert rate.
  - `experiments/export_results.py`: Xuất kết quả không đụng chạm bảng `vps` nhạy cảm.
  - `experiments/manifest.py`, `experiments/metrics.py`, `experiments/labeling.py`: Đảm bảo tính toàn vẹn dữ liệu, gắn nhãn ground truth không leakage.
  - `collector/collect.py` & `collector/tests/test_loadgen_error_rate.py`: Đọc error rate từ file loadgen, fallback probe, linter fixes.
- **Xác minh qua test thực tế**:
  - Đã stage toàn bộ 9 file MM/AM theo đúng phiên bản Working Tree mới nhất.
  - `experiments/tests/` (**59 tests**): `test_analyze.py` (11), `test_export_results.py` (5), `test_labeling.py` (11), `test_manifest.py` (2), `test_metrics.py` (9), `test_protocol.py` (12), `test_scheduler.py` (9).
  - `experiments/load_gen/tests/test_loadgen.py` (**12 tests**).
  - `collector/tests/` (**35 tests**): `test_collect.py` (26), `test_loadgen_error_rate.py` (9).
  - Tổng cộng lệnh `pytest experiments collector/tests`: **106/106 tests pass**. Ruff lint pass.
  - *(Lưu ý: `ml-service/tests/` có 19 tests pass độc lập, thuộc TK-A6 trước đây, không tính gộp vào TK-S6).*

### 2.3. Sửa test reachability (Ngoại lệ kế thừa 29ed4d3)
- **Trạng thái**: Đã commit local `ae029c5` (`fix(test): sua kieu vi.fn mock cho probeExternalReachable trong reachability.test.ts`). Trạng thái `CHỜ REVIEW` (chưa merge vào `main`).
- **Tệp sửa đổi**: `app/src/main/deploy/reachability.test.ts`.
- **Nội dung sửa đổi**: Sửa cú pháp mock Vitest sang `vi.fn<(url: string) => Promise<boolean>>()` tại 3 vị trí, giải quyết triệt để lỗi TypeScript typing khi gọi mock.
- **Xác minh sau commit**: `typecheck:node` pass, 15/15 tests reachability pass.

### 2.4. L3+L4+L5 — Backend Publish, Doctor Engine, Safe Fix, Domain & DNS
- **Trạng thái**: Đã commit local gộp `13591ba` (`feat(backend): publish exposure pipeline, doctor rule engine va domain dns assistant (L3+L4+L5)`). Trạng thái `CHỜ REVIEW` (chưa merge vào `main`).
- **Lý do gộp**: `app/src/main/ipc.ts` và `app/src/main/ipc.test.ts` nhập khẩu đồng thời các module Doctor (L4) và Domain (L5). Gộp L3+L4+L5 thành một commit backend nguyên tử nhằm đảm bảo tính toàn vẹn của các phụ thuộc giữa các module backend và loại bỏ bóc tách hunk thủ công.
- **Tệp triển khai (đúng 25 files theo đối chiếu `git show --format= --name-only 13591ba`)**:
  - *(Lưu ý về `reachability.ts`: Module thuần `app/src/main/deploy/reachability.ts` đã có từ commit `29ed4d3`, backend L3 tái sử dụng module này cho kiểm tra UFW và external probe mà không sửa đổi file trong commit `13591ba`).*
  - **L3 (Publish/Reachability/Firewall — 12 files)**:
    - `app/src/main/db/migrations/004_publish_doctor_domain.sql`: Migration tạo bảng `doctor_run`, `doctor_action`, `domain_binding` và cập nhật cột bảng `deployment`.
    - `app/src/main/db/index.ts` & `app/src/main/db/index.test.ts`: Thực thi migration 004 khi khởi tạo DB và test tích hợp.
    - `app/src/main/db/deploymentRepository.ts`: CRUD `exposure_status` và `exposure_evidence_json`.
    - `app/src/main/deploy/exposure.ts` & `app/src/main/deploy/exposure.test.ts`: `ExposureManager` điều phối subphase publish sau khi loopback healthcheck pass (7 tests pass). Không rollback ứng dụng đang healthy khi publish thất bại (ghi nhận `degraded`). Khi thiếu manager, ghi nhận `not_checked`.
    - `app/src/main/deploy/firewall.ts` & `app/src/main/deploy/firewall.test.ts`: Idempotent UFW rule manager, hỗ trợ comment tag và dọn dẹp an toàn (6 tests pass).
    - `app/src/main/deploy/pipeline.ts` & `app/src/main/deploy/pipeline.test.ts`: Tích hợp publish subphase trước `RECORD` trong DeployPipeline (37 tests pass).
    - `app/src/main/deploy/service.ts`: Khởi tạo ExposureManager.
    - `app/src/main/migrate/service.ts`: Đảm bảo type hygiene cho migrate service.
  - **L4 (Doctor Engine & Safe Fix)**:
    - `app/src/main/doctor/engine.ts`: Nhận diện 12 failure classes (UFW blocked, wrong port, OOM, crash loop, build failure, etc.) với confidence và abstention khi dữ liệu mơ hồ.
    - `app/src/main/doctor/fix.ts`: Cơ chế Safe Fix chỉ mở firewall khi thỏa mãn đủ điều kiện (run pending, deployment-app-VPS khớp, app healthy nội bộ nhưng external unreachable). Preflight fail-closed nếu mất kết nối SSH. Verify kết quả sau khi sửa và cập nhật bảng `doctor_run`, `doctor_action`.
    - `app/src/main/doctor/repository.ts`: Lưu trữ lịch sử Doctor run và action.
    - Che/xóa thông tin nhạy cảm (Bearer tokens, URL passwords) bằng `maskSecrets` và `redactText` trước khi lưu DB hoặc trả qua IPC.
  - **L5 (Domain & Cloudflare DNS Assistant)**:
    - `app/src/main/domain/assistant.ts`: Lập kế hoạch bản ghi DNS cho direct-port, shared-ingress và named-tunnel. Chặn named-tunnel khi chưa có CNAME target hợp lệ.
    - `app/src/main/domain/dns.ts`: Upsert/delete bản ghi idempotent với điều kiện kiểm tra ownership fingerprint; báo conflict nếu trùng bản ghi không do OpsPilot sở hữu. Scoped token chỉ dùng trong phiên IPC, không lưu vào DB hay log. Che token/password khi xảy ra lỗi. Hỗ trợ kiểm tra lan truyền DNS đa resolver.
    - `app/src/main/domain/repository.ts`: Lưu trữ cấu hình vào bảng `domain_binding` với guard chống ghi đè khi race condition.
  - **IPC Dispatch**:
    - `app/src/main/ipc.ts` & `app/src/main/ipc.test.ts`: Đăng ký đầy đủ các kênh `doctor:*` và `domain:*`.
- **Xác minh qua test thực tế**:
  - `reachability.test.ts`: **15 tests pass** (module reachability.ts có từ 29ed4d3, test sửa cú pháp mock ở ae029c5).
  - `exposure.test.ts`: **7 tests pass**.
  - `firewall.test.ts`: **6 tests pass**.
  - `pipeline.test.ts`: **37 tests pass**.
  - `engine.test.ts`: **17 tests pass**.
  - `fix.test.ts`: **21 tests pass**.
  - `assistant.test.ts`: **12 tests pass**.
  - `dns.test.ts`: **11 tests pass**.
  - `repository.test.ts` (Domain): **2 tests pass**.
  - `ipc.test.ts`: tests pass.
  - Tổng số test của app tại commit này: **418 tests pass**; `typecheck:node`, `typecheck:web` pass; electron-vite build pass.

### 2.5. L6 — Detector Tier 1 & try-detect CLI
- **Trạng thái**: Đã commit local `ad86736` (`feat(detectors): framework detectors nextjs express static-spa va try-detect cli (L6)`). Trạng thái `CHỜ REVIEW` (chưa merge vào `main`).
- **Tệp triển khai (9 files)**:
  - `app/src/main/detectors/index.ts`, `nextjs.ts`, `express.ts`, `static-spa.ts`, `helpers.ts`: Cải tiến engine nhận diện framework chính xác, tự động nhận diện package manager (npm, pnpm, yarn, bun), trích xuất start command và suy luận port theo regex có ngữ nghĩa port đã biết (`--port`, `-p`, `PORT=`).
  - Xử lý các tình huống mơ hồ (ambiguous) hoặc mâu thuẫn giữa code / env / start script bằng cách cảnh báo hoặc dừng thay vì đoán mò.
  - `app/scripts/try-detect.ts`: CLI kiểm tra độc lập, in thông tin phát hiện, alternatives, signals, BuildPlan và validation errors.
  - `app/package.json` & `app/tsconfig.scripts.json`: Khai báo script `try:detect` và cấu hình build tsconfig.
- **Xác minh qua test thực tế**:
  - `app/src/main/detectors/detectors.test.ts`: **65 test tổng pass** (gồm 57 unit tests bao phủ toàn bộ detector suite và 8 test CLI integration tests qua lệnh thực tế với cơ chế tự build từ source).
  - CLI `try-detect` chạy kiểm tra thành công với cả 3 demo app: Express, Next.js và Vite.
  - `typecheck:node`, `typecheck:web`, scripts typecheck pass; electron-vite build pass.

### 2.6. L7 — UI Exposure, Doctor, Đa ngôn ngữ & Deploy Guard
- **Trạng thái**: Đã commit local `82a5d5d` (`feat(ui): desktop ui, da ngon ngu 4 thu tieng, exposure badge va doctor drawer (L7)`). Trạng thái `CHỜ REVIEW` (chưa merge vào `main`).
- **Tệp triển khai (20 files)**:
  - `app/src/renderer/src/pages/DeployPage.tsx` & `DeployPage.test.tsx` (9 tests):
    - Vô hiệu hóa hoặc ẩn lựa chọn `named_tunnel` khi chưa có CNAME target/tunnel hợp lệ, tránh đưa người dùng vào luồng chắc chắn lỗi.
    - Đồng bộ `runRef.current` ngay lập tức để không bỏ lỡ event `finished` hay deploy:event.
  - `app/src/renderer/src/pages/AppsPage.tsx` & `AppsPage.test.tsx` (7 tests):
    - Nối trực tiếp với dữ liệu thật từ `app:list` và `app:versions`.
    - Hiển thị badge Exposure từ deployment thật (`reachable`, `degraded`, `tunnel_only`, `not_checked`).
    - Thao tác Doctor dựa trên dữ liệu thật.
    - **Cô lập trạng thái giữa các ứng dụng**: Khi chuyển đổi từ App A sang App B, xóa toàn bộ trạng thái Doctor/rollback cũ, hiển thị loading và vô hiệu hóa thao tác cho tới khi dữ liệu App B tải xong. Bỏ qua các response của App A đến muộn (out-of-order race response) để không hiển thị fix ID hoặc thông báo nhầm sang App B.
  - `app/src/renderer/src/pages/SettingsPage.tsx` & `SettingsPage.test.tsx` (2 tests): Tích hợp chuyển đổi theme và locale.
  - `app/src/renderer/src/App.tsx` & `App.test.tsx` (1 test): Navigation và chuyển đổi ngôn ngữ menu.
  - `app/src/renderer/src/strings.ts` & `utils/locales.ts`: Chuẩn hóa toàn bộ nhãn giao diện sang hệ thống chuỗi đa ngôn ngữ hỗ trợ 4 ngôn ngữ: Tiếng Việt (`vi`), English (`en`), 日本語 (`ja`), 简体中文 (`zh`).
  - `app/src/main/index.ts`: Window management, focus và log renderer errors.
  - `app/src/main/windowOptions.ts`, `app/src/renderer/src/assets/main.css`, `app/src/renderer/src/utils/themeTokens.ts`, `app/src/renderer/src/store/uiState.ts`, `app/src/renderer/src/pages/deployRun.ts`, `app/src/renderer/index.html`.
  - `app/vitest.config.ts`, `app/scripts/clean-demo-vms.ts`, `app/scripts/e2e-demo-test.ts`.
- **Xác minh qua test thực tế**:
  - Toàn bộ Vitest app: **63 file, 479/479 tests pass**.
  - `typecheck:node`, `typecheck:web`, scripts typecheck pass; ESLint pass (0 errors, 0 warnings); electron-vite build pass.
  - **Ghi nhận kiểm chứng GUI thực tế**: **NOT_RUN** (do môi trường agent headless, không có màn hình đồ họa; các hành vi UI và tương tác state đã được kiểm chứng qua các suite jsdom unit/integration tests với 479 Vitest tests pass).
  - **Ghi nhận kiểm chứng VPS thật**: **NOT_RUN** (phụ thuộc hạ tầng live ngoài phạm vi worker local).

### 2.7. L8 — Vệ sinh Repo, Cập nhật Board và Handoff
- **Trạng thái**: Đã commit local `f870b6f` (`docs(handoff): cap nhat ho so ban giao, tien do board.md va bo sung gitignore (L8)`). Trạng thái `CHỜ REVIEW` (chờ Leader review, chưa merge vào `main`).
- **Tệp triển khai**:
  - `.gitignore`: Bổ sung bỏ qua đúng các thư mục công cụ cục bộ của AI sandbox (`.autoclaw/`, `.claude/`, `.clinerules`, `.clinerules/`), bảo đảm không bỏ sót mã nguồn cần lưu trong repository.
  - `docs/tasks/board.md`: Cập nhật bảng task Checkpoint L1a–L8 phản ánh chính xác các SHA commit thực tế, ghi nhận trạng thái `CHỜ REVIEW` (chưa merge `main`), bổ sung mục cập nhật chi tiết ngày 30/09/2026.
  - `HANDOFF.md`: Cập nhật tài liệu bàn giao đầy đủ, trung thực, đối chiếu chính xác mọi tên bảng, file test, lệnh, số lượng test và commit SHA thực tế trong repo.
- **Xác minh git**:
  - `git diff --check`: Sạch, 0 lỗi whitespace / conflict markers.
  - Danh sách commit sạch: Không đưa các file công cụ cá nhân (`.agents/`, `SKILL.md`, `run.ps1`, `start-opspilot.bat`) vào git.

---

## 3. Tổng hợp Bằng chứng Kiểm chứng Thực tế

| Nhóm kiểm chứng | Lệnh thực hiện | Kết quả thực tế |
|---|---|---|
| **Vitest (Toàn bộ ứng dụng Electron)** | `pnpm --dir app test` | **63/63 files passed**, **479/479 tests passed** |
| **Detector Suite & try-detect CLI** | `pnpm --dir app test src/main/detectors/detectors.test.ts` | **65/65 tests passed** (57 unit + 8 CLI integration) |
| **Pytest (Harness Thí nghiệm & Collector)** | `ml-service/.venv/Scripts/python.exe -m pytest experiments collector/tests -q` | **106/106 tests passed** (71 experiments + 35 collector) |
| **Pytest (ML-Service Model & Feature)** | `ml-service/.venv/Scripts/python.exe -m pytest ml-service/tests -q` | **19/19 tests passed** |
| **TypeScript Typecheck** | `pnpm --dir app run typecheck` & `pnpm --dir app exec tsc --noEmit -p tsconfig.scripts.json` | **PASS**, 0 lỗi |
| **ESLint** | `pnpm --dir app lint` | **PASS**, 0 lỗi, 0 cảnh báo |
| **Electron Production Build** | `pnpm --dir app run build` | **PASS**, electron-vite build thành công |
| **GUI thực tế (Tương tác Desktop trực tiếp)** | Không thực hiện trong môi trường agent headless | **NOT_RUN** (kiểm chứng tự động qua 479 tests jsdom) |
| **VPS thật / Cloudflare API live** | Phụ thuộc hạ tầng live ngoài phạm vi local | **NOT_RUN** (kiểm chứng tự động qua mock SSH/DNS/probe) |
| **Git Hygiene** | `git diff --check` | **PASS**, 0 lỗi whitespace / conflict marker |

---

## 4. Những phần CHƯA LÀM / Chờ Leader quyết định

1. **Push / PR / Merge vào `main`**: Các commit local L2 (`e2959f7`), L1a (`d86a319`), fix test (`ae029c5`), backend L3+L4+L5 (`13591ba`), L6 (`ad86736`), L7 (`82a5d5d`) và L8 (`f870b6f`) đã được tạo trên nhánh `feat/deploy-reachability`. Worker tuân thủ tuyệt đối chỉ thị không push, không mở PR, không merge vào `main`. Toàn bộ đều ở trạng thái `CHỜ REVIEW` chờ Leader nghiệm thu.
2. **Review và nghiệm thu của Leader**: Leader tự kiểm chứng theo hướng dẫn ở Mục 5 và quyết định merge.
3. **Thử nghiệm trên VPS thật [NOT_RUN]**:
   - Chạy 50 run ML chính thức (hiện đã hoàn tất code harness, test và pilot dry-run).
   - Thử nghiệm DNS với domain thật và Cloudflare API token thật.
   - Thử nghiệm safe-fix UFW trên môi trường VPS thật (mới kiểm chứng qua fake SSH executor và unit/integration test).
4. **Kiểm tra tương tác GUI trên desktop thật [NOT_RUN]**: Leader có thể mở giao diện Electron thực tế trên máy có màn hình để trải nghiệm tương tác Apps/Deploy/Settings.
5. **Quyết định kiến trúc tương lai (P2/P3)**:
   - Shared ingress (Caddy reverse proxy trên cổng 80/443): Cần ADR duyệt trước khi triển khai để tránh xung đột với kiến trúc no-reverse-proxy hiện tại.

---

## 5. Hướng dẫn cho Leader / Reviewer

Để kiểm tra nhanh và tiếp quản nhánh làm việc:
1. Chạy `git log -n 8 --oneline` để xem toàn bộ chuỗi commit local đã tạo trên nhánh `feat/deploy-reachability`:
   - `82a5d5d`: L7 UI Exposure, Doctor, Đa ngôn ngữ, Deploy Guard
   - `ad86736`: L6 Detector Tier 1 & CLI try-detect
   - `13591ba`: L3+L4+L5 Backend Publish, Doctor Engine, Safe Fix, Domain DNS
   - `ae029c5`: Fix test mock reachability.test.ts (ngoại lệ 29ed4d3)
   - `d86a319`: L1a Contract IPC, DB schema, DeployEvent
   - `e2959f7`: L2 ML experiment harness TK-S6 offline
   - `f870b6f`: L8 .gitignore, board.md, HANDOFF.md
2. Chạy `git status --short` để xác nhận worktree sạch.
3. Chạy `git diff --check` để xác nhận chất lượng định dạng.
4. Chạy `pnpm --dir app test` để xác nhận 479 unit/integration test của app Electron.
5. Chạy `ml-service/.venv/Scripts/python.exe -m pytest experiments collector/tests -q` để xác nhận 106 test của bộ thí nghiệm và collector.
6. Chạy `ml-service/.venv/Scripts/python.exe -m pytest ml-service/tests -q` để xác nhận 19 test của ml-service.
7. Thực hiện review và quyết định merge vào `main` theo quy trình.

---

## 6. Bản đối chiếu kiểm kê mã nguồn và lịch sử commit thực tế trên nhánh `feat/deploy-reachability`

Mục này cung cấp bảng đối chiếu chi tiết toàn bộ các file đã triển khai trên nhánh `feat/deploy-reachability` tương ứng với từng commit SHA thực tế trong lịch sử git.

### 6.1. Đối chiếu danh sách file theo từng commit thực tế

| Nhóm commit | Tệp tin | Trạng thái Commit | Mục đích / Nội dung commit |
|---|---|---|---|
| **L2** | `collector/collect.py` | **Đã commit trong `e2959f7`** | Đọc error rate từ file loadgen, fallback probe, linter fixes |
| | `collector/tests/test_loadgen_error_rate.py` | **Đã commit trong `e2959f7`** | Test đo error rate tích hợp với loadgen counter |
| | `docs/07-giao-thuc-thi-nghiem.md` | **Đã commit trong `e2959f7`** | Cập nhật tài liệu giao thức thí nghiệm 5 kịch bản |
| | `docs/tasks/tk-s6-load-gen-experiment-harness.md` | **Đã commit trong `e2959f7`** | Hồ sơ task TK-S6 bộ khung thí nghiệm |
| | `experiments/load_gen/Dockerfile` | **Đã commit trong `e2959f7`** | Dockerfile container hóa load generator |
| | `experiments/load_gen/__init__.py` | **Đã commit trong `e2959f7`** | Package init cho loadgen |
| | `experiments/load_gen/loadgen.py` | **Đã commit trong `e2959f7`** | Engine sinh tải có cap 30 phút, kill-switch, target safety check |
| | `experiments/load_gen/tests/test_loadgen.py` | **Đã commit trong `e2959f7`** | 12 tests cho load generator, target allowlist và kill-switch |
| | `experiments/faults/scheduler.py` | **Đã commit trong `e2959f7`** | Điều phối fault injection 5 kịch bản |
| | `experiments/protocol.py` | **Đã commit trong `e2959f7`** | Logic tính pha, độ trễ đồng hồ, kiểm tra tính toàn vẹn 450 mẫu |
| | `experiments/run_experiment.py` | **Đã commit trong `e2959f7`** | Runner điều phối một lượt chạy thí nghiệm |
| | `experiments/analyze.py` | **Đã commit trong `e2959f7`** | Phân tích CSV, tính PR-AUC, F1, detection delay, false alerts |
| | `experiments/export_results.py` | **Đã commit trong `e2959f7`** | Xuất kết quả DB ra CSV (loại trừ bảng vps) |
| | `experiments/manifest.py` | **Đã commit trong `e2959f7`** | Khởi tạo và xác minh manifest tính toàn vẹn |
| | `experiments/metrics.py` | **Đã commit trong `e2959f7`** | Tính các độ đo thống kê cho chuỗi metric |
| | `experiments/labeling.py` | **Đã commit trong `e2959f7`** | Gắn nhãn ground truth không rò rỉ dữ liệu |
| | `experiments/README.md` | **Đã commit trong `e2959f7`** | Hướng dẫn vận hành bộ thí nghiệm và kill-switch |
| | `experiments/tests/__init__.py` | **Đã commit trong `e2959f7`** | Package init cho test suite |
| | `experiments/tests/test_manifest.py` | **Đã commit trong `e2959f7`** | 2 tests xác minh manifest |
| | `experiments/tests/test_analyze.py` | **Đã commit trong `e2959f7`** | 11 tests phân tích và test roundtrip export -> analyze ISO UTC |
| | `experiments/tests/test_export_results.py` | **Đã commit trong `e2959f7`** | 5 tests xuất kết quả |
| | `experiments/tests/test_labeling.py` | **Đã commit trong `e2959f7`** | 11 tests gắn nhãn |
| | `experiments/tests/test_metrics.py` | **Đã commit trong `e2959f7`** | 9 tests tính độ đo |
| | `experiments/tests/test_protocol.py` | **Đã commit trong `e2959f7`** | 12 tests giao thức và mốc pha |
| | `experiments/tests/test_scheduler.py` | **Đã commit trong `e2959f7`** | 9 tests scheduler fault injection |
| **L1a** | `docs/contracts/ipc-contract.ts` | **Đã commit trong `d86a319`** | Đồng bộ kiểu IPC cho exposure, Doctor, Domain |
| | `docs/contracts/deploy-events.md` | **Đã commit trong `d86a319`** | Đặc tả event finished và các trạng thái exposure |
| | `docs/contracts/schema.sql` | **Đã commit trong `d86a319`** | Schema contract cho bảng doctor_run, doctor_action, domain_binding và cột exposure (migration thực thi thuộc commit 13591ba) |
| | `DECISIONS.md` | **Đã commit trong `d86a319`** | Ghi nhận quyết định kiến trúc exposure, Doctor, Domain |
| | `app/src/shared/ipc.ts` | **Đã commit trong `d86a319`** | Mirror TypeScript types dùng chung renderer và main process |
| | `docs/27-ke-hoach-tu-dong-hoa-pipeline-domain-doctor-ml-detector.md` | **Đã commit trong `d86a319`** | Kế hoạch tổng thể hợp nhất sau demo |
| | `docs/README.md` | **Đã commit trong `d86a319`** | Cập nhật mục lục liên kết tới tài liệu 27 |
| *(Tiền đề L3)* | `app/src/main/deploy/reachability.ts` | **Đã có từ `29ed4d3`** | Logic thuần parse UFW và probe HTTP external; backend L3 sử dụng trực tiếp, không commit lại trong `13591ba` |
| **Fix test** | `app/src/main/deploy/reachability.test.ts` | **Đã commit trong `ae029c5`** | Sửa cú pháp mock vi.fn<(url: string) => Promise<boolean>>(), 15/15 tests pass (sửa lỗi kế thừa từ `29ed4d3`) |
| **L3+L4+L5** | `app/src/main/db/migrations/004_publish_doctor_domain.sql` | **Đã commit trong `13591ba`** | DDL migration tạo bảng doctor_run, doctor_action, domain_binding (đúng 25 files theo `git show --format= --name-only 13591ba`) |
| | `app/src/main/db/index.ts` | **Đã commit trong `13591ba`** | Thực thi migration 004 khi khởi tạo DB |
| | `app/src/main/db/index.test.ts` | **Đã commit trong `13591ba`** | Test migration 004 và khởi tạo DB |
| | `app/src/main/db/deploymentRepository.ts` | **Đã commit trong `13591ba`** | CRUD exposure_status và exposure_evidence_json |
| | `app/src/main/deploy/exposure.ts` | **Đã commit trong `13591ba`** | ExposureManager điều phối publish subphase |
| | `app/src/main/deploy/exposure.test.ts` | **Đã commit trong `13591ba`** | 7 tests cho ExposureManager và 4 trạng thái exposure |
| | `app/src/main/deploy/firewall.ts` | **Đã commit trong `13591ba`** | Quản lý rule UFW idempotent có comment tag |
| | `app/src/main/deploy/firewall.test.ts` | **Đã commit trong `13591ba`** | 6 tests cho firewall manager |
| | `app/src/main/deploy/pipeline.ts` | **Đã commit trong `13591ba`** | Nối phase publish sau loopback healthcheck trong DeployPipeline |
| | `app/src/main/deploy/pipeline.test.ts` | **Đã commit trong `13591ba`** | 37 tests deploy pipeline bao gồm publish integration |
| | `app/src/main/deploy/service.ts` | **Đã commit trong `13591ba`** | Deploy service khởi tạo ExposureManager |
| | `app/src/main/migrate/service.ts` | **Đã commit trong `13591ba`** | Cập nhật migrate service đảm bảo type hygiene |
| | `app/src/main/doctor/engine.ts` | **Đã commit trong `13591ba`** | DoctorRuleEngine chẩn đoán 12 failure classes |
| | `app/src/main/doctor/engine.test.ts` | **Đã commit trong `13591ba`** | 17 tests cho Doctor engine |
| | `app/src/main/doctor/fix.ts` | **Đã commit trong `13591ba`** | DoctorFixService thực hiện safe-fix mở UFW fail-closed |
| | `app/src/main/doctor/fix.test.ts` | **Đã commit trong `13591ba`** | 21 tests cho doctor fix service và che secret |
| | `app/src/main/doctor/repository.ts` | **Đã commit trong `13591ba`** | Repository lưu trữ bảng doctor_run và doctor_action |
| | `app/src/main/domain/assistant.ts` | **Đã commit trong `13591ba`** | Kế hoạch bản ghi DNS direct-port, shared-ingress, named-tunnel |
| | `app/src/main/domain/assistant.test.ts` | **Đã commit trong `13591ba`** | 12 tests cho DNS assistant |
| | `app/src/main/domain/dns.ts` | **Đã commit trong `13591ba`** | Cloudflare adapter scoped token, propagation check đa resolver |
| | `app/src/main/domain/dns.test.ts` | **Đã commit trong `13591ba`** | 11 tests cho Cloudflare DNS và propagation check |
| | `app/src/main/domain/repository.ts` | **Đã commit trong `13591ba`** | DomainRepository quản lý bảng domain_binding với SQL guard |
| | `app/src/main/domain/repository.test.ts` | **Đã commit trong `13591ba`** | 2 tests cho domain repository |
| | `app/src/main/ipc.ts` | **Đã commit trong `13591ba`** | Đăng ký toàn bộ các kênh `doctor:*` và `domain:*` |
| | `app/src/main/ipc.test.ts` | **Đã commit trong `13591ba`** | Test các kênh `doctor:*` và `domain:*` |
| **L6** | `app/src/main/detectors/index.ts` | **Đã commit trong `ad86736`** | Đăng ký Next.js, Express, Static SPA detectors |
| | `app/src/main/detectors/nextjs.ts` | **Đã commit trong `ad86736`** | Detector Next.js kèm start script inference |
| | `app/src/main/detectors/express.ts` | **Đã commit trong `ad86736`** | Detector Express kèm port flag semantics |
| | `app/src/main/detectors/static-spa.ts` | **Đã commit trong `ad86736`** | Detector Vite SPA và static apps |
| | `app/src/main/detectors/helpers.ts` | **Đã commit trong `ad86736`** | Helpers phát hiện package manager, parse port regex, validate script |
| | `app/src/main/detectors/detectors.test.ts` | **Đã commit trong `ad86736`** | 65 test tổng detector suite và CLI try-detect qua lệnh thực tế |
| | `app/scripts/try-detect.ts` | **Đã commit trong `ad86736`** | CLI độc lập kiểm tra nhận diện framework |
| | `app/package.json` | **Đã commit trong `ad86736`** | Khai báo script npm `try:detect` |
| | `app/tsconfig.scripts.json` | **Đã commit trong `ad86736`** | Include `scripts/try-detect.ts` cho biên dịch |
| **L7** | `app/src/renderer/index.html` | **Đã commit trong `82a5d5d`** | HTML shell ứng dụng Electron |
| | `app/src/renderer/src/App.tsx` | **Đã commit trong `82a5d5d`** | Navigation và chuyển đổi ngôn ngữ menu |
| | `app/src/renderer/src/App.test.tsx` | **Đã commit trong `82a5d5d`** | 1 test chuyển đổi ngôn ngữ menu sidebar |
| | `app/src/renderer/src/assets/main.css` | **Đã commit trong `82a5d5d`** | CSS styles cho Exposure badge và Doctor drawer |
| | `app/src/renderer/src/pages/AppsPage.tsx` | **Đã commit trong `82a5d5d`** | Quản lý app, deployment versions thật, cô lập state Doctor giữa các app |
| | `app/src/renderer/src/pages/AppsPage.test.tsx` | **Đã commit trong `82a5d5d`** | 7 tests cho AppsPage, race condition response, doctor state cleanup |
| | `app/src/renderer/src/pages/DeployPage.tsx` | **Đã commit trong `82a5d5d`** | Deploy wizard, disable named_tunnel khi chưa hợp lệ, exposure feedback |
| | `app/src/renderer/src/pages/DeployPage.test.tsx` | **Đã commit trong `82a5d5d`** | 9 tests cho DeployPage bao gồm named_tunnel guard |
| | `app/src/renderer/src/pages/SettingsPage.tsx` | **Đã commit trong `82a5d5d`** | Trang cài đặt chuyển đổi theme và locale |
| | `app/src/renderer/src/pages/SettingsPage.test.tsx` | **Đã commit trong `82a5d5d`** | 2 tests chuyển đổi theme và 4 ngôn ngữ |
| | `app/src/renderer/src/pages/deployRun.ts` | **Đã commit trong `82a5d5d`** | Quản lý trạng thái deployment run trong renderer |
| | `app/src/renderer/src/store/uiState.ts` | **Đã commit trong `82a5d5d`** | Persistent UI state (theme, locale) |
| | `app/src/renderer/src/strings.ts` | **Đã commit trong `82a5d5d`** | Từ điển đa ngôn ngữ 4 thứ tiếng (vi, en, ja, zh) |
| | `app/src/renderer/src/utils/locales.ts` | **Đã commit trong `82a5d5d`** | Định nghĩa danh sách ngôn ngữ hỗ trợ |
| | `app/src/renderer/src/utils/themeTokens.ts` | **Đã commit trong `82a5d5d`** | Bảng màu theme Fluent dark/light |
| | `app/src/main/windowOptions.ts` | **Đã commit trong `82a5d5d`** | Cấu hình window options hiển thị |
| | `app/src/main/index.ts` | **Đã commit trong `82a5d5d`** | createWindow(): thêm focus() khi ready-to-show, bắt sự kiện did-fail-load ghi log lỗi renderer, gọi show() và focus() khi khởi động |
| | `app/vitest.config.ts` | **Đã commit trong `82a5d5d`** | Tăng hook timeout cho test suite |
| | `app/scripts/clean-demo-vms.ts` | **Đã commit trong `82a5d5d`** | Type annotation và formatting script dọn dẹp |
| | `app/scripts/e2e-demo-test.ts` | **Đã commit trong `82a5d5d`** | Type annotation và formatting script e2e demo |
| **L8** | `.gitignore` | **Đã commit trong `f870b6f`** | Bỏ qua thư mục công cụ AI sandbox (`.autoclaw/`, `.claude/`, `.clinerules`, `.clinerules/`) |
| | `docs/tasks/board.md` | **Đã commit trong `f870b6f`** | Cập nhật tiến độ bảng task L1a–L8, phản ánh các SHA commit thực tế |
| | `HANDOFF.md` | **Đã commit trong `f870b6f`** | Hồ sơ bàn giao chi tiết và bản đối chiếu kiểm kê tích hợp |

---

### 6.2. Kiểm chứng 9 file MM/AM trong commit L2 (`e2959f7`)

Trong phiên tích hợp L2, toàn bộ 9 file ở trạng thái MM/AM đã được stage đúng phiên bản **Working Tree mới nhất** và commit an toàn vào commit `e2959f7`:
1. `collector/collect.py` — Chú thích ngoại lệ `# noqa: BLE001` và cú pháp context manager chuẩn.
2. `docs/tasks/tk-s6-load-gen-experiment-harness.md` — Hồ sơ task TK-S6 đồng bộ.
3. `experiments/faults/scheduler.py` — Scheduler fault injection 5 kịch bản.
4. `experiments/load_gen/tests/test_loadgen.py` — Bổ sung các test an toàn target allowlist, kill-switch tức thì và cap thời gian tối đa 30 phút.
5. `experiments/protocol.py` — Đồng bộ số mẫu lý thuyết 450 mẫu (75 phút ở 10s) khớp với `manifest.py` và tối ưu `itertools.pairwise`.
6. `experiments/run_experiment.py` — Runner hoàn thiện.
7. `experiments/tests/test_analyze.py` — Bổ sung test roundtrip `test_export_results_to_analyze_roundtrip_iso_utc`.
8. `experiments/tests/test_labeling.py` — Gắn nhãn ground truth không leakage.
9. `experiments/tests/test_scheduler.py` — 9 tests scheduler fault injection.

> **Kết quả kiểm chứng**: Trên checkout riêng tại commit `e2959f7`, toàn bộ 106 tests Pytest (`experiments/` và `collector/tests/`) cùng Ruff lint đều **PASS** (106/106 tests pass).

---

### 6.3. Kiểm chứng tính nguyên tử của các commit backend

Lịch sử commit thực tế đã phản ánh trung thực quá trình giải quyết các phụ thuộc chéo:
1. **Lỗi test kế thừa tại L1a và ngoại lệ sửa test `ae029c5`**: Trên checkout độc lập tại riêng commit L1a `d86a319`, typecheck `pnpm --dir app run typecheck:node` đã FAILED do lỗi cú pháp mock Vitest trong `reachability.test.ts` kế thừa từ commit `29ed4d3`. Commit ngoại lệ `ae029c5` đã sửa dứt điểm lỗi cú pháp mock Vitest này, đưa 15/15 tests reachability và typecheck về trạng thái PASS trước khi chuyển sang các module backend tiếp theo.
2. **Gộp nguyên tử L3+L4+L5 (`13591ba`)**:
   - `app/src/main/ipc.ts` và `app/src/main/ipc.test.ts` nhập khẩu đồng thời các module của Doctor (`./doctor/*`) và Domain (`./domain/*`).
   - Việc gộp L3, L4, L5 thành một commit backend duy nhất đã loại bỏ nguy cơ đứt gãy phụ thuộc giữa các commit lẻ.
   - File migration 004 thực thi (`app/src/main/db/migrations/004_publish_doctor_domain.sql`) được đưa vào commit backend này để đồng bộ với `app/src/main/db/index.ts`.
   - File module thuần `app/src/main/deploy/reachability.ts` đã có sẵn từ commit `29ed4d3` và được backend L3 sử dụng trực tiếp trong `DeployPipeline` / `ExposureManager` (không nằm trong danh sách 25 files của commit `13591ba`, đã đối chiếu chính xác qua `git show --format= --name-only 13591ba`).
   - **Xác minh cổng chất lượng (Gate)**: Trên checkout riêng tại SHA `13591ba`, toàn bộ 418 Vitest tests, typecheck Node/Web và electron-vite build đều **PASS** (418/418 tests pass).

---

### 6.4. Phân loại các file công cụ và tiện ích cục bộ (Exclude vs Include)

| Tệp tin / Thư mục | Trạng thái | Đưa vào hay Loại trừ | Lý do cụ thể |
|---|---|---|---|
| **`.agents/`** | **Untracked** | **LOẠI TRỪ (Exclude)** | Thư mục chứa kỹ năng và chỉ dẫn của AI agent framework (`.agents/skills/task-discipline/`), là công cụ hỗ trợ dev của agent, không thuộc mã nguồn hay sản phẩm OpsPilot. |
| **`SKILL.md`** | **Untracked** | **LOẠI TRỪ (Exclude)** | File hướng dẫn kỹ năng nội bộ cho agent ở thư mục gốc, không phải tài liệu kỹ thuật hay code của dự án. |
| **`run.ps1`** | **Untracked** | **LOẠI TRỪ (Exclude)** | Script PowerShell tiện ích cá nhân, chứa đường dẫn tuyệt đối hardcoded máy dev (`D:\Developing\DuAnCNTT\app`). Không phù hợp đưa vào repo chung của nhóm. |
| **`start-opspilot.bat`** | **Untracked** | **LOẠI TRỪ (Exclude)** | Script batch khởi động cục bộ của môi trường dev cá nhân với đường dẫn tuyệt đối, không thuộc bộ cài hay build script của ứng dụng. |
| **Dữ liệu nhạy cảm** | **Cần kiểm tra trước khi stage** | **LOẠI TRỪ (Exclude)** | File `.db`, private keys, file `.env` đã được `.gitignore` chặn. **Lưu ý đặc biệt**: Quy tắc `.dump` hiện chỉ được ignore trong phạm vi `experiments/results/` (`experiments/results/**/*.dump`), **KHÔNG ignore trên toàn repo**. Do đó, nếu có dump DB hoặc dump mạng ở thư mục khác, Git sẽ coi là file Untracked. Bắt buộc dev/Leader phải kiểm tra kỹ qua `git status` trước khi stage, tuyệt đối không dùng `git add .` hay `git add -f` cẩu thả. |

> [!WARNING] Cảnh báo về phạm vi bỏ qua của `.dump`:
> Trong `.gitignore`, dòng 46 chỉ khai báo `experiments/results/**/*.dump`. Điều này có nghĩa là các file có đuôi `.dump` ở ngoài thư mục `experiments/results/` (ví dụ ở thư mục gốc, trong `app/`, `collector/` hay `ml-service/`) **KHÔNG** được tự động bỏ qua. Khi thực hiện commit L8 và các commit tiếp theo, người tích hợp cần kiểm tra kỹ danh sách `git status` để bảo đảm không vô tình stage bất kỳ file `.dump`, cache hay dữ liệu nhạy cảm nào vào git history.
