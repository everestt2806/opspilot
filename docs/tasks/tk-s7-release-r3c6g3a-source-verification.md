# R3c-6g3a — Xác minh source trước lần deploy Product đầu tiên

START 07/11/2026 — Tiếp `f0fba0b`, product-mode; user cho phép phát triển/commit/push checkpoint, không PR/merge/production write. Áp dụng task-discipline.

Giả định phạm vi: hoàn tất backend/CLI xác minh source trước khi nối wizard. Không gọi đăng ký dự án là đã deploy. Chỉ Express/noDB/no required env theo khả năng runtime hiện tại; không mở thêm template hoặc chạy script từ repo ở bước xác minh.

| Yêu cầu | Thay đổi / gate | State |
|---|---|---|
| Contract-first, current controller/app/generations/config/target revision | Fixed admin CLI/strict Zod; source lấy từ SQLite, trusted bundle pin; focused/native reject extra fields | PASS |
| Snapshot Git full SHA và preflight dùng chung runtime | Shared detector/render/quota; whole90s/512MiB Git cap; native public branch + exact SHA, no target exec | PASS |
| Recheck authority sau await, atomic paused observation | Focused race/current confighash/policy/profile/observation + audit rollback/quiescence/caller transaction/cleanup | PASS |
| Unit + native CLI/public Git chứng minh luồng và lỗi | Final focused50PASS/3files, native12PASS/currentCLI/publicGit/coldreplay/0job/0targetexec | PASS |
| Sửa thứ tự chờ terminal ở gate DeployPage | Giữ convertEol=true, waitFor constructor; UI54PASS, webtype/lint6 sạch; full cuối1743PASS/0FAIL | PASS |
| Gates và hồ sơ review | Full1743PASS/2Linux-onlySKIP/0FAIL; build/4typechecks/lint6/native12 PASS;14file checkpoint/secretpattern0/newlinks0missing/diff sạch; board/HANDOFF/FR/release đồng bộ | PASS |

## Ranh giới và việc tiếp

6g3a chưa nối IPC/UI xác minh, chưa enroll-target từ GUI hay first-deploy readiness wizard. Các phần đó vẫn cần code ở6g3b; không yêu cầu user test thay code thiếu. Snapshot được xác minh tại một thời điểm, không chứng minh Docker/health/public URL và không dự đoán branch tip tương lai. Observation hiện hữu được dùng để manual specific-SHA có provenance; không thêm cờ ready giả hoặc sửa migration cũ.

Điểm nối cho6g3b:

- Verified SSH-admin helper hiện giới hạn process15s/whole45s. Source CLI có deadline90s nên cần timeout riêng có trần cho đúng operation, không tăng mọi lệnh ghi. Artifact/manifest lấy từ current binding, không lấy từ renderer hoặc repo. Kiểm binding/controller/generations sau response và bỏ kết quả cũ khi đổi app.
- Nối `enroll-target` hiện hữu với target_root cấu hình quản trị đã kiểm duyệt. Không viết installer thứ hai, không replay install khi unknown; cơ chế remote prepared/unknown/enrolled chỉ inspect proof khi khôi phục.
- Readiness trước nút deploy phải bao gồm source/current SHA, app target enrollment, resources và blockers; global controller ready không tự chứng minh app mới đã sẵn sàng. First deploy dùng journal UUID + specific_SHA đã quan sát, xác nhận rõ, không tự resume auto-deploy.

## Nhật ký

- START07/11: baseline sạch tracked, HEAD/upstream `f0fba0b`. Shared preflight và SQLite IMMEDIATE recheck trước observeTip; giữ expected observation sequence trước fetch để không ghi đè poll mới. Caller transaction bị từ chối. Native lab riêng, không production DB/VPS.
- UPDATE07/11: contract/DECISIONS trước code, không schema mới. `verify-project-source` Linux adminCLI/bounded stdin; expected generations/config/target revision, trusted artifact/manifest, SQLite source không renderer URL/ref. Tách `validateProductSourceAndPlan` dùng chung onboarding/executor, giữ wrapper claim cũ; không dependency mới. Only Express/noDB/no required env, không source execution. Source_file_count/source_bytes gồm source và collector theo transfer preflight hiện hành.
- UPDATE07/11: focused49PASS/3files, raw `.out-scripts/release-r3c6g3a-focused-final.log`;28test mới gồm wrong namespace/gens/profile/policy/confighash, midfetch changes/job/poll, quota, unsupported/env/DB, abort/deadline, rawerror redaction, callertransaction và rollback audit. Initial failures ở fixture: thiếu encrypted_secret bắt buộc và toggle paused nhưng còn pause_reason; sửa fixture theo schema, không sửa guard/migration để né test.
- UPDATE07/11: native **d546621f1541 12PASS**, `.out-scripts/project-registration/d546621f1541/result.json`, raw log `release-r3c6g3a-native.log`. Actual Linux CLI init/private AES/secrets, pinned SSH profile +2concurrent registrations regression; publicGitHub `everestt2806/opspilot` branch `feat/release-audit-20261204`, root `demo-apps/san-nha-booking`, SHA **f0fba0b3847e0501cfd73f2a444fa8d72dbdda71**. Cold second process verifies sameSHA,1observation/0job/0deployment/0targetenrollment/0remotecommands, cleanuptrue. Source12files/66454bytes gồmcollector. Controllerartifact `/var/tmp/opspilot-p3e3a-runtime/r3c6g3a/control-plane.cjs` SHA256 **3b30920d9953b4c081247ecee850756aa0a544e42d722b3552c09e1265775b8c**, manifest **08d160c76d5176c1a79b280873371d9bb944fe584127aa3cd2ed0fa554e6e61e**. Khôngruntime dispatch/productionVPS/productionDB.
- UPDATE07/11: lint phát hiện `no-unsafe-finally`; chuyển xử lý kết quả/lỗi ra khỏi finally để cleanup không thay lỗi xác minh gốc, lỗi cleanup được ánh xạ mã an toàn. Thêm ca cleanup lỗi sau commit và khi đã có lỗi source. Final focused **50 PASS/3files**, gồm **29 test mới**; `.out-scripts/release-r3c6g3a-focused-accepted.log`. Lint **5files/0errors/0warnings**, `.out-scripts/release-r3c6g3a-eslint-final.json`. Full suite trước bản sửa bị chủ động dừng vì source thay đổi, không dùng làm bằng chứng; gate source cuối dùng `release-r3c6g3a-vitest-accepted.json`.
- UPDATE07/11: final native **91d2b885408a 12 PASS**, raw `.out-scripts/project-registration/91d2b885408a/result.json` và `release-r3c6g3a-native-final.log`; artifact `/var/tmp/opspilot-p3e3a-runtime/r3c6g3a-final/control-plane.cjs` SHA256 **5cc322b1901b232b9191d7ae7b175912335b61b3ecf580ae23fe99f7984abf6f**, manifest **5da207f5186c8f57f2f07ddeed62931c6e57047c93b9cb712693732628a1f1c6**. Same public Git SHA/root và 12files/66454bytes như initial gate, cold replay1observation/0job/0deployment/0targetexec, cleanuptrue. Final source chỉ đổi error/cleanup handling sau initialnative; gate mới chạy lại trên artifact cuối.
- UPDATE07/11: full `release-r3c6g3a-vitest-accepted.json` **1742PASS/1FAIL/2SKIP**, 247.91s. Failure ở test DeployPage.tsx:704 đọc terminalOptions ngay sau DOM label, chưa có constructor. `DeployTerminal.tsx` dùng static import và new Terminal trong useEffect; phát biểu ban đầu về dynamic import là sai và đã đính chính. UI/test nguyên bản khớp HEAD f0fba0b, chưa có bằng chứng quy lỗi cho runtime Product. Mở rộng đúng1assertion test sang waitFor cùng điều kiện convertEol=true, không tăng timeout, không skip/hạ assertion hoặc đổi UI; phải chạy UI/full lại. Không coi failed gate là PASS, không accepted exception. Production code/CLI sau native giữ nguyên nên native proof còn hiệu lực; web typecheck/lint/full bị ảnh hưởng phải chạy lại.
- UPDATE07/11: sau sửa waitFor, DeployPage **54PASS**,74.42s, `.out-scripts/release-r3c6g3a-ui-regression.log`. Final scoped lint **6files/0errors/0warnings**, `.out-scripts/release-r3c6g3a-eslint-accepted.json`; formatter chỉ wrap thêm1expression có warning cũ trong cùng test file. Web typecheck chạy lại PASS `release-r3c6g3a-web-accepted.log`. Node/Web/scripts/lab đã PASS `release-r3c6g3a-types.log`/`types-accepted.log`, production build cuối PASS `release-r3c6g3a-build-accepted.log` (renderer index-DYZwfvmd.js4279.77kB, không đổi renderer runtime). Final full sau sửa test: `release-r3c6g3a-vitest-final-accepted.json` + `.log`, không dùng failed gate trước làm proof.
- HANDOFF-LOCAL07/11: full cuối **1743 PASS/2 Linux-only SKIP/0 FAIL**,136files pass/1file skipped,239.91s; raw `.out-scripts/release-r3c6g3a-vitest-final-accepted.json` và `.log`. 29test mới đều chạy; Linux-only Caddy skips giữ nguyên nền Windows, không skip test của checkpoint. Focused50/UI54/native12/4typechecks/lint6/build đạt trên relevant source cuối.14file review gồm contract/CLI/shared preflight/tests/native driver và hồ sơ;0secretpattern/6newrelative links đủ/diff sạch. Không sửa runtime UI hoặc migration, không Python/ML/collector code thay đổi; chưa cần GUI/live gate để thay phần chưa viết. Không accepted exceptions. Task **CHỜ REVIEW**, chưa merge; chuẩn bị commit co-author Kim/normal checkpoint push và phải đối chiếu remote trước báo DONE. SHA tra `git log -1 -- app/src/main/controlPlane/projectSourceVerification.ts`. Không productionVPS/productionDB/PR/merge hoặc reset/clean/stash/rebase; file cá nhân ngoàiindex.

## Tái hiện

```text
. ./tools/enter-node22.ps1
pnpm --prefix app exec vitest run src/main/controlPlane/projectSourceVerification.test.ts src/main/controlPlane/projectRegistration.test.ts src/main/controlPlane/productRuntimeExecutor.test.ts --maxWorkers=2
pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=default --reporter=json --outputFile=.out-scripts/release-r3c6g3a-vitest-accepted.json
pnpm --prefix app exec tsc --noEmit -p tsconfig.node.json --composite false
pnpm --prefix app exec tsc --noEmit -p tsconfig.web.json --composite false
pnpm --prefix app exec tsc --noEmit -p tsconfig.scripts.json
pnpm --prefix app exec tsc --noEmit -p scripts/product-runtime-lab/tsconfig.json
pnpm --prefix app exec eslint src/main/controlPlane/projectSourceVerification.ts src/main/controlPlane/projectSourceVerification.test.ts src/main/controlPlane/productPipelineSourceRender.ts src/main/controlPlane/cli.ts scripts/product-runtime-lab/project-registration.mjs --max-warnings=0
pnpm --prefix app build
Linux Node22: OPSPILOT_CONTROL_PLANE_MODULES=<approved modules> OPSPILOT_CONTROL_PLANE_OUTPUT=<private bundle>/control-plane.cjs node app/scripts/build-control-plane.mjs
Linux Node22: OPSPILOT_VERIFY_PROJECT_SOURCE=1 OPSPILOT_CONTROLLER_ARTIFACT=<private bundle>/control-plane.cjs node app/scripts/product-runtime-lab/project-registration.mjs
git diff --check
```

Native lab không bind HTTP8768, có thể chạy cùng Windows Vitest. `OPSPILOT_VERIFY_PROJECT_SOURCE=1` thêm public HTTPS source checks vào registration lab; bỏ biến này giữ 8 case regression không Git network. Không mock Git/fetch/detector/render trong native gate. Unit mock transport để chủ động đổi authority giữa await, không thay sản phẩm bằng transport fixture.
