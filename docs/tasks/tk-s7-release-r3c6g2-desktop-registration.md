# R3c-6g2 — Tạo dự án từ Desktop qua verified SSH

START07/11/2026 — Tiếp `f94f548` register-project; áp dụng task-discipline, normal checkpoint push được phép, không PR/merge/production write.

| Yêu cầu | Gate | State |
|---|---|---|
| Controller target metadata, không lẫn local VPS ID | project-targets CLI/current controller/eligible AES-pinned profiles, bounded50scan/page; main20profile/page để vừa64KiB và monotonic paging; unit remoteid77≠localid1/nativeCLI read | PASS |
| Durable Desktop setup UUID trước mạng | Migration027/main UUID/binding+target revision/canonical body digest +DBimmutable; unit coldreopen/unknown/cancel/state/inflight +native cold replay1remoteapp | PASS |
| Verified SSH fixed operations + main service/IPC | Fixed2operations qua pinned helper/bundle/Node/controller/privateSQL; before-send bindingrevision và server target revision;5IPC mới/main safeerror/projection | PASS |
| UI tạo dự án có review và recover | 8UItests/4locale/form→review→prepare→send; lostprepare khôngsend, lostreply samekeyretry, targetchanged/unmountguards/no localVPS; Electron40checks/40ảnh/0renderererrors | PASS |
| Kiểm chứng/checkpoint | Final full1714PASS/2Linux-onlySKIP/0FAIL, focused82/native18+CLI8/Electron40/fresh027/types/lint25/build/Ruff PASS;79fileindex/secret/link/diff sạch, commitKim/normalpush đối chiếu remote trước báo | PASS |

Scope6g2 kết thúc ở app/source/paused ownership đã đăng ký; chưa tự enroll-target/auto-enable. UI phải nói rõ bước kế tiếp thay vì nút deploy giả. Remote source verification/target enrollment/start workflow là6g3. Không chuyển credential mới lên controller ở6g2; chỉ dùng target đã enroll bằng admin CLI, wizard onboarding target mới là checkpoint tiếp. SSH-admin là quyền OS riêng, write opt-in/scopes là consent cục bộ của binding, không giả bearer thay quyền admin.

## Nhật ký

- UPDATE07/11: product-project-registration contract thêm expected_target_security_revision bắt buộc. Chỉ kiểm pin/profile ở Desktop trước mạng không chặn target đổi sau await; servertransaction phải so revision trước create. CùngUUID/body giữrevision bấtbiến; fixture/README/CLI đồng bộ. `project-targets` từremoteDB, lọc unarchived/proper pin/controller cipherdecrypt; không trảcredential/cipher/unsafe profile. Main đọc20profile/page, server tốiđa50scan; cursorlastscanned, pageeligible cóthểrỗngcònmore. Không mở publicAPI mới.
- Approved Desktop SSH admin helper cho2operation metadata mới, giữ16KiBrequest/64KiBreply/fixedNodeCLI/15sprocess/45swhole/principal/pin/bundle/controller guards. Exchange kiểmbindingrevision trướcstdin; afterresponse re-resolve rồi strictZodprojection. Không truyền arbitraryCLI/SQL/URL/script từrenderer. Scopewriteoptin được mainkiểm, adminauthority thực tế vẫnSSHOSprincipal.
- SQLite027 `desktop_project_setup` không FK tớiVPS/binding, giữ intent tombstone khi xóaprofile; mainUUID trước remotecreate, revision/body/keyimmutable, controller/target/name uniqueness giữduplicateintent, CASstates +sameprocessbusy. Retry unknown/inflight dùngsamekey trên adminCLI idempotent26; không tự cấp UUID mới, không tựrebind. Targetrevision mainread vàservercheck; returnrequest/controller/target/port phải khớp. Metadata public whitelist, no env/log/secret/note/rawerror, cancel chỉprepared. List100 ưu tiênpending.
- Backend focused **116PASS/7files** `release-r3c6g2-focused-initial.log`; UI+maincombined **82PASS/5files** `release-r3c6g2-ui-initial.log`. Main11setup tests/targetlisting+newrevisiongate/IPC17routes; UI8cases +10onboarding +15registration +38IPC. Typecheck initially mock vi.fn generic suy cảconstructor nên getMockImplementation khôngcallable; sửa signature chính xác DesktopControllerEnrollment methods, không cast lỏng runtime.
- Initial native **6abf913c5741 18PASS**, raw `.out-scripts/desktop-controller-enrollment/6abf913c5741/result.json`, labSHA **cfac6f22ec17f2f5b236cb44a7ee76c99e779c878ef019d8901729bfbd97a6e4**, manifest **dc0d88ac81c647ee7491a66940e89cd4363e6874b203c00a324d92cd59fb707c**. ActualSSH/verifiedhelper/CLI/projecttarget/mainsetup: preparebeforecreate; intentionallydrop register-projectreply sauSQLitecommit→unknown; subprocesscoldDesktop replay sameUUID→1remote app/1registration/0job choappmới. CLI enroll-vps thực qua pinnedSSH thayfakevpscipher củafixturecũ. No productionVPS/runtime dispatch,cleanup=true. Final native sẽ chạy lại saumainpage20 vàreadonlyscope assertion.
- UPDATE07/11: final scopedlint25files0/0, Node/Web/scripts/labtypes PASS; fresh dependencyinstall/schema027/SQLite3.53.4/Zod4.4.3/bundle12/initstatus PASS `.out-scripts/release-r3c6g2-fresh-deps.log`. Ruff experiments/collector/ml-service/newbootstrapallowlist và formatbootstrap PASS; không đổi Python ML/collector/experiment code nên365PASS của6g1 là baseline, không dùng số đó thay gate mới. Final focused **82PASS**, `.out-scripts/release-r3c6g2-focused-final.log`; test start17:51:55, import/environment chậm trên máy hiện hành nhưng0FAIL, không hạ assertions hoặc safety limits.
- Send setup re-read current durable state trong IMMEDIATE trước claim: process khác đã registered/cancelled thì trả record, không downgrade sanginflight. Sau thay đổi nhỏ này, finalnative/full/build phải chạy source cuối. Không tự retry API deploy; chỉ register-project admincommand đã có atomicidempotency mới được retry.

## Tái hiện

```text
. ./tools/enter-node22.ps1
pnpm --prefix app exec vitest run src/renderer/src/components/ControllerProjectPanel.test.tsx src/renderer/src/components/ControllerPanel.test.tsx src/main/controlPlane/desktopProjectSetup.test.ts src/main/controlPlane/projectRegistration.test.ts src/main/ipc.test.ts --maxWorkers=2
pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=json --outputFile=.out-scripts/release-r3c6g2-vitest-final.json
pnpm --prefix app typecheck
pnpm --prefix app exec tsc --noEmit -p tsconfig.scripts.json
pnpm --prefix app exec tsc --noEmit -p scripts/product-runtime-lab/tsconfig.json
pnpm --prefix app exec eslint <25changed TS/TSX/MJS files excluding ignored shared/ipc.ts> --max-warnings=0
pnpm --prefix app build
ml-service/.venv/Scripts/python.exe -m ruff check app/src/main/controlPlane/desktop_controller_admin.py experiments collector ml-service
ml-service/.venv/Scripts/python.exe -m ruff format --check app/src/main/controlPlane/desktop_controller_admin.py
Linux Node22: node app/scripts/product-runtime-lab/verify-deps.mjs
Linux: OPSPILOT_R1_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c6g2-accepted-lab.cjs OPSPILOT_CONTROLLER_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c6g2/control-plane.cjs node app/scripts/product-runtime-lab/desktop-controller-enrollment.mjs
Windows: app/node_modules/electron/dist/electron.exe app/scripts/product-runtime-lab/controller-ui-capture.mjs
```

Linux HTTP8768labs phải kết thúc trước Windowsfullsuite/ControllerService. GUI harness dùng isolated metadata fixtures + actual built renderer/preload, không productionprofile hoặc backendnetwork; native SSHlab là bằng chứng backend độc lập. File cá nhân vẫn ngoàiindex; không hủy/reset/stash source. Final bàn giao phải đối soátindex/secret/link/diff và remote SHA, co-author Kim theo user.

- UPDATE07/11: final native **82ce92e19048 18PASS**, raw `.out-scripts/desktop-controller-enrollment/82ce92e19048/result.json`, currentlab `/var/tmp/opspilot-p3e3a-runtime/r3c6g2-accepted-lab.cjs` SHA256 **27eecf77995e1d5cf44c56b1f496904895e0142c87144818b3f90a2ef3ea62b9**; controllerCLI `/var/tmp/opspilot-p3e3a-runtime/r3c6g2/control-plane.cjs` manifest **dc0d88ac81c647ee7491a66940e89cd4363e6874b203c00a324d92cd59fb707c**. Read-only client setup listing bị chặn đúngscope; cold registration retry samekey1app/nojob;0productionwrite/cleanuptrue. CurrentCLI independent register regression **bf1a72372d53 8PASS**, bundleSHA **273cca6b897f3c99a7317318a387717bf3fa5e3224c99256ba5e70708ffcf0f2**.
- Electron **fa7e2f85ceb0 40/40PASS**, raw `.out-scripts/controller-ui/fa7e2f85ceb0/result.json`,40PNG tại `docs/ui-redesign/screenshots/r3c6g2/`. Actualrenderer/preload +isolatedIPCmetadatafixtures;0renderererrors/nohorizontaloverflow. 1280×800/1366×768 ×dark/light: existingactions/onboarding regression24cases +newprojectform/footer/review/result16cases. Verified remote target#77 và canonicalrepo trướccreate,0requesttrướcconfirm,registeredneutral/no deploymentclaim; submit trongviewport. Đã xem project-review1366light, registered1280dark vàformfooter1280light. NativeSSHproof táchriêng, khôngcoiGUIfixturelàbackendnetwork.
- Build `release-r3c6g2-build.log`PASS (renderer4279.77kB); finalfull `.out-scripts/release-r3c6g2-vitest-final.json` đang gate cuối, không sửa runtime sau native/build. Không đổi experiment/ML/collector behavior, không nâng FR/UC tổng trướcsourceverification/targetenrollment/firstdeploy/live gates.
- HANDOFF-LOCAL07/11: final full **1714PASS/2Linux-onlySKIP/0FAIL**, raw `.out-scripts/release-r3c6g2-vitest-final.json` và `.log`. Final native18/CLI8/GUI40/fresh027/Node-Web-scripts-lab/lint25/build/Ruff đạt trên source cuối. Index79file gồm40PNG đúngscope, secretpattern0/missinglinks0/diffcheckclean; co-author Kim và normal checkpoint push theo quyềnuser. KhôngPR/merge/productionVPS hoặc productionDB; giữ filecánhân ngoàiindex. Không acceptedexceptions hoặc yêu cầu user test để thay code cònthiếu; task CHỜ REVIEW vìchưamerge. SHA `git log -1 -- app/src/renderer/src/components/ControllerProjectPanel.tsx`; remote so khớp trước thôngbáo.
