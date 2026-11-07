# R3c-6g3c — Chuẩn bị target từ Desktop

START 07/11/2026 — Tiếp `989957e`, product-mode; áp dụng task-discipline. User cho phép phát triển/commit/push checkpoint, không PR/merge/production write.

Phạm vi: hoàn tất xem trạng thái và enroll target từ GUI bằng installer/proof hiện hữu. Source check đã có; readiness tài nguyên/remote runtime và first deploy GUI là6g3d, không coi enrolled là deployment hoặc ready.

| Yêu cầu | Gate | State |
|---|---|---|
| Contract và current authority |2fixedCLI/2typedIPC/main registeredsetup authority/strictreply +explicitroot; focusedmain100/native25 PASS | PASS |
| Reuse installer, không replay unknown | Internalfence trong prepare/begin/complete +beforestdin/expectedSSHidentity; native lostreply→coldinspect giữ file inode/hash/mtime PASS | PASS |
| Trạng thái/proof an toàn | Read-only state0key/targetwrites; persistedHMACproof không ready; native25/SQLfocused PASS | PASS |
| GUI4locale/review/recovery | FocusedUI+main110PASS/6files; target12tests/4locale/unknownrootlock/lateclose/conflict/errors; finalElectron52checks/52PNG/0errors/no overflow | PASS |
| Gates và hồ sơ review | Full1805PASS/2Linux-onlySKIP/0FAIL, native25/probe7/Electron52/4types/lint21/build/Ruff PASS;85files/52PNG/secretpattern0/links đủ/diff sạch, docs/board/FR/release đồng bộ | PASS |

## Nhật ký

- START07/11: tracked tree sạch, HEAD `989957e`; giữ mọi file cá nhân ngoàiindex. Chọn wrapper enroll-project-target và read project-target-state thay installer mới. Thêm internal authority callback ở repository transaction để chặn source/target thay đổi sau review; base enroll-target CLI giữ tương thích. Source/quiescence checker dùng chung, không migration mới.
- UPDATE07/11: contract/DECISIONS trướccode, sharedDTOexactcopy, IPC20routes không genericcall. Main chỉregistered/writable/currentbinding, derivegens/confighash/targetrev từjournal; artifact/pin từbinding. Admin root strictLinuxpath là explicituserreview, khôngsource/repo. Wrapper dùng shared source authority/quiescence/canonicalconfigcheck, không fetch source hoặc run Docker; read-state không first-install/keycreation.
- UPDATE07/11: repository optional internal assertAuthority callback chạy trong IMMEDIATE prepare/begin/complete; source/target đổi thì transactionkhông advance. enrollProductTarget gọi guard trướcdispatch vàstdin; openProductBootstrapChannel có expectedIdentity để chặn changedprincipal trướcauth. Base CLI không callback giữ tươngthích, guard không serialized từrenderer. Target firstprepare/replay semanticsgiữ nguyên: unknown/enrolled chỉinspect oldroot/proof, không reinstall/rotate/rearm.
- UPDATE07/11: sourcecheck helper90/105/120 không đổi. New enrolltarget admin whole90/helper75; innerSSHopen20/exchange20, readstateadmin default45/process15. Bounded stderr1024bytes chỉfullmatch allowlist source/target codes, không rawcontent; stdout64KiB/request16KiB vẫngiữ. Ruffbootstrap+stderrprobe2files và actualsubprocessprobe7PASS `release-r3c6g3c-admin-errors.log`; khôngđổi ML/collector/experiments/dependencies/schema.
- UPDATE07/11: initial backend **88PASS/4files**, expandedmain **100PASS/5files**, combinedUI/main **110PASS/6files**, raw `.out-scripts/release-r3c6g3c-backend-initial.log`, `focused-main.log`, `focused-ui.log`. Target UI12cases, source fences/proof/unknown/quiescence/stale/responseidentity/readonly/bindingdisable/callertransaction; thêm riêng enrollment90sdeadlinecase cho fullgate. Typecheck initial báo unusedverifyBundle import trongnewtest: thêm assertion verifyBundlepin thực; lint phát hiện destructuredunusedroot, sửa testhelperlọc field. Fullsuite trước thaytesthelper chủđộngdừng, final proof là `release-r3c6g3c-vitest-accepted.json`, khôngcoigate cũ làPASS.
- UPDATE07/11: native **4815f4c5fa3b 25PASS**, `.out-scripts/desktop-controller-enrollment/4815f4c5fa3b/result.json` +`release-r3c6g3c-native.log`. CurrentCLI `/var/tmp/opspilot-p3e3a-runtime/r3c6g3c/control-plane.cjs`, manifest **8a459eda452f73290bca3e6a87c7e89248ae0f29b0a6a4e7363f9091e8d4ccd8**; lab `/var/tmp/opspilot-p3e3a-runtime/r3c6g3c-lab.cjs` SHA256 **e9f87e2c0d92c4333636b1f77ee8b5ca69ba2f6b59284f37bd617fbfc3fd129d**. Actual pinnedSSH/admin/CLI/privateSQLite targetinstaller→deliberatelydrop INNERbootstrapreply sau files publish→controllerunknown; coldDesktopprocesssameapp/root inspect→HMACproof enrolled. So sánh mọi targetfile inode/mtime/hash giữ nguyên,0job/deployment choappmới, khácrootconflict khôngtạopathmới. Existing21regressiongồmpublicGit/coldvault/API vẫnđạt;0productionVPS/runtime dispatch, cleanuptrue. Không claim Docker/runtime/livegate từtargetinstall.
- UPDATE07/11: build PASS `release-r3c6g3c-build.log`, renderer index-mcZB8kgY.js4314.08kB; Node/Web/scripts/labtypechecksPASS. Scopedlint21files0/0 sau sửaunusedtestroot; captureharness sauđó thêm paintwait riêng và lint2affectedfilesPASS. Khôngthay runtime sau native/build; chỉtest/helpercapture/docs thayđổi.
- UPDATE07/11: Electron initial `1332c4cb88c1`52DOMchecksPASS nhưng ảnh target-review1280dark chụp trướcpaintmodal; khôngdùng làm visualproof. Bổ sungdelay+2animationframes và kiểmvisiblereviewmodal/overflow/footer, rerunharnesskhôngđổiruntime. Final **cd0eb404277b 52/52PASS**, `.out-scripts/controller-ui/cd0eb404277b/result.json`,52PNG tại `docs/ui-redesign/screenshots/r3c6g3c/`. Actual built renderer/preload +isolatedIPCfixtures; nativeSSH25 độc lậpchứngminhbackend.1280×800/1366×768 ×dark/light:44regression +8targetreview/enrolledviews,0renderererrors/0horizontaloverflow/footerinsideviewport/no installbeforeconfirm. Đã xem finalreview1280dark vàenrolled1366light: đủhost/pin/root, không deploy/runtimehealthy claim. Khôngproductionprofile/VPS hoặc khóa thật trongảnh.
- HANDOFF-LOCAL07/11: final full **1805PASS/2Linux-onlySKIP/0FAIL**,139filesPASS/1fileSKIP,268.19s; raw `.out-scripts/release-r3c6g3c-vitest-accepted.json` và `.log`.28test mới đều chạy, không skipcase checkpoint. Native25/probe7/Electron52/Node-Web-scripts-lab/lint21/build/Ruff đạt trên relevant source cuối; callback/refactor source vẫnđược source29tests/fullgate cover.85file review gồm33text+52PNG,0secretpattern/6newrelative links đủ/diff sạch. Schema027/deps/protocolMLgiữ; không accepted exceptions. Task **CHỜ REVIEW**, chưamerge; chuẩn bị commit co-author Kim vànormal checkpointpush, đốisoát remote trước báoDONE. SHA `git log -1 -- app/src/main/controlPlane/projectTarget.ts`. Không productionVPS/DB/PR/merge/reset/clean/stash/rebase; filecánhân ngoàiindex.

Điểm nối6g3d: dùng `observeProductTarget`/shared resource assessment cho per-app snapshot (current source/config/target +stored enrollmentproof +remote Docker/port/RAM/disk vàcontroller resources). Enrolled metadata không tự thay readiness. First deploy deriveapp/generations từsetup, exactobservedfullSHA, dùng existingDesktop command journal prepare→review→send một lần; unknown chỉlookupoldkey, không tự gửi POST lại hoặc auto-resume. Theo dõi job/deployment riêng qua API, không đổi accepted thành runtime success. Cần actual SSH/Docker runtime gate, không chỉ GUIfixture hoặcunit.

## Tái hiện

```text
. ./tools/enter-node22.ps1
pnpm --prefix app exec vitest run src/renderer/src/components/ControllerProjectTargetPreparation.test.tsx src/renderer/src/components/ControllerProjectPanel.test.tsx src/main/controlPlane/projectTarget.test.ts src/main/controlPlane/targetEnrollment.test.ts src/main/controlPlane/desktopProjectSetup.test.ts src/main/ipc.test.ts --maxWorkers=2
pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=default --reporter=json --outputFile=.out-scripts/release-r3c6g3c-vitest-accepted.json
pnpm --prefix app build
pnpm --prefix app exec tsc --noEmit -p tsconfig.scripts.json
pnpm --prefix app exec tsc --noEmit -p scripts/product-runtime-lab/tsconfig.json
pnpm --prefix app exec eslint <21 changed TS/TSX/MJS files, excluding ignored shared/ipc.ts> --max-warnings=0
ml-service/.venv/Scripts/python.exe -m ruff check app/src/main/controlPlane/desktop_controller_admin.py app/scripts/product-runtime-lab/desktop-admin-source-errors.py
Linux: python3 app/scripts/product-runtime-lab/desktop-admin-source-errors.py <approved Node22 absolute path>
Linux: OPSPILOT_R1_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c6g3c-lab.cjs OPSPILOT_CONTROLLER_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c6g3c/control-plane.cjs node app/scripts/product-runtime-lab/desktop-controller-enrollment.mjs
Windows: app/node_modules/electron/dist/electron.exe app/scripts/product-runtime-lab/controller-ui-capture.mjs
git diff --check
```

Linux native lab bind8768 phải kết thúc trướcWindows fullsuite. Electron capture isolated actualrenderer/preload +IPCmetadatafixtures, không productionprofile/backendnetwork; nativeSSH gate độc lập. Tiếp6g3d per-app readiness/sourceSHA→explicit firstdeploy bằng commandjournal; chưa cần usertest thaycode thiếu.
