# R3c-6g1 — Đăng ký dự án Product nguyên tử trong controller

START07/11/2026 — UI6f `5445e33` đã push, có thao tác trên app đã quản lý nhưng chưa có source/app creation API hoặc CLI. Wizard không được dùng SQL trực tiếp từ Desktop. Tạo primitive quản trị Linux trước, sau đó nối SSH/main/UI trong6g2. Task-discipline, normal push được phép, không PR/merge/production write.

| Yêu cầu | Gate | State |
|---|---|---|
| Contract/migration trước implementation | Admin CLI register-project/026 request controller-unix-admin-key namespace/canonicalbody+digest/immutable tombstone/cumulativeSQL parity | PASS |
| Tạo app/source/ownership cùng transaction | Controller soleactive/current target pin+AES bound credential; IMMEDIATE name/port allocation/app/source/pausedowner/history/request, storagefail rolls back tất cả | PASS |
| Không tự deploy/activate hoặc nhận hỗ trợ chưa có | Express/noDB/publicGitHubURL, pause explicit; source_verification/target_enrollment/runtime_preflight required; native0remotecommand/nojob/observation | PASS |
| Lỗi/cạnh tranh/legacy giữ nguyên | Focused66 gồm14registrationtests; upgrade026 giữbindings, target/owner/source changed replayreject,2connections/coldreopen, native2processes→1app | PASS |
| Native CLI + regression/checkpoint | Final full1694PASS/2Linux-onlySKIP/0FAIL/native8+auth13+Desktopenroll15/fresh026/types/lint12/build/Python365 đạt; docs/index22file/secret/link/diff sạch, commitKim/push đối chiếu trước thông báo | PASS |

Không cần user test thay phần code. Public/privateGit/template parity vẫn theo releaseboard; bước này nguồn public GitHub, framework Express/noDB; không nhập env/secret/free-form command vào source config. Chọn port trống trong controller DB không chứng minh listener target trống: runtime preflight kiểm riêng trước dispatch; báo rõ khi đăng ký.

## Nhật ký

- UPDATE07/11: mới `projectRegistration.ts` và CLI `register-project --data-dir`, JSONstdin theo bounded reader hiện có; uid lấy process.getuid(), không nhậnactor từpayload. Phải private initializedcontrollerdata + masterkey để mởCLI. Chỉ target đang active/pinned với controller AES credential decrypt đúngcontroller/principal/revision; khôngcopyDesktopcredential. Thiếu/tamper/legacy-safeStorage bị chặn trước mutation. Source URL GitHub canonical, branch thay vì fullSHA/refs, rootrelative/no traversal, slugname/healthpath/ports strict, không env/secret/note/buildcommand.
- Replay exactrequest/controller/unixadmin kiểm current target và app/source/owner; không updatepolicy hoặccurrentdeployment. Result auto_deploy_paused/required flags phản ánh lúcđăngký, không giả current readiness sau replay. Newkey xungđộtname/port không import/updateappcũ. Pending job/observation/target enroll không sinh trongoperationnày. Source fetch/detector vẫn là bước riêng trước firstdeploy.
- Focused **66PASS/5files**, raw `.out-scripts/release-r3c6g1-focused-final.log` (lượt trước cuối cùng14test thêmportexhaustion/callertransaction, sameproductionbehavior); migration026 + cumulativeparity/upgrade/reopen/FK giữ dữ liệu cũ. Initial tests fail2ca do dùng SAVEPOINT nhưng primitive cố ý từchối callertransaction; sửa fixture restorefields giữa calls, thêm explicit test transaction khôngbịcommit. Một fixture dùng crypto_scheme electron_safe_storage khônghợp CHECK; sửa safe_storage đúngschema. TypeScript returnliteral cần asconst; lint controlregex thay bằng charCode validation, không tắt rule.
- Final native **7d89bdf33ef4 8PASS**, raw `.out-scripts/project-registration/7d89bdf33ef4/result.json`; actual artifact `/var/tmp/opspilot-p3e3a-runtime/r3c6g1-accepted/control-plane.cjs`, SHA256 **6482b2b64e1772d6543a12d2c7d808303d72f4305329fef58147bdf92c3c88f9**, bundle manifest **91521193951b67ff48b9b3c680b4c703e4901e3f0413c5a05fe7cab6f57d6259**. Real CLIinit/secrets-init/enroll-vps qua pinnedSSH mới rồi2CLI registerconcurrently;1app/source/pausedowner/request/history; coldreplay canonicalURL, changedbody/name/port/actor/credential/source/target/revision/controller errors,2appautoallocate,0job/deployment/remoteexec/FKclean/cleanup=true. KhôngproductionVPS/runtime dispatch.
- Native CLIcredential regression **efcf4c7d193a 13PASS**; DesktopSSH/enrollment/UIservice **bb4e38e5baa1 15PASS** trên migration026 và currentCLI, artifact labSHA **aee51be7dcc3d951b8dd24092055093188c6624d3d29aa55f742b63532d63ed6**. KhôngWindowsfullsuite chạy cùng Linux8768lab. Freshnpmci/SQLite3.53.4/Zod4.4.3/migration026/bundle12/CLIinitstatus PASS `.out-scripts/release-r3c6g1-fresh-deps.log`. Node/Web/scripts/lab typechecks và scopedlint12file0/0 PASS.

## Tái hiện

```text
. ./tools/enter-node22.ps1
pnpm --prefix app exec vitest run src/main/controlPlane/projectRegistration.test.ts src/main/db/index.test.ts src/main/db/productMigration.test.ts src/main/controlPlane/desktopControllerVault.test.ts src/main/controlPlane/desktopControllerCommands.test.ts --maxWorkers=2
pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=json --outputFile=.out-scripts/release-r3c6g1-vitest-final.json
pnpm --prefix app typecheck
pnpm --prefix app exec tsc --noEmit -p tsconfig.scripts.json
pnpm --prefix app exec tsc --noEmit -p scripts/product-runtime-lab/tsconfig.json
pnpm --prefix app exec eslint <12changed TS/MJS files> --max-warnings=0
pnpm --prefix app build
ml-service/.venv/Scripts/python.exe -m pytest experiments/ collector/tests ml-service/tests -p no:cacheprovider -q
Linux Node22: node app/scripts/product-runtime-lab/verify-deps.mjs
Linux: OPSPILOT_CONTROLLER_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c6g1-accepted/control-plane.cjs node app/scripts/product-runtime-lab/project-registration.mjs
```

Tiếp6g2: verified SSH admin transport cụ thể cho metadata project list/create/enroll-target, durable Desktop setup UUID; controller target selection từcontrollerDB, không lấy localVPS ID làmremote ID. Chuyển credential target chỉmain→verifiedSSHstdin, khônglog/plainDB/report; hạ giới hạn adminreply/inputs phải xử lý cóchủđích choenroll-target. Wizard cần target/source/plan review/confirm/enroll/status và không autoenable trước proof. Giữ source/github/demo limits rõ, templateparity theoR7. Không user action cần để thay code cònthiếu, không accepted exceptions.

- HANDOFF-LOCAL07/11: final full **1694PASS/2Linux-onlySKIP/0FAIL**, raw `.out-scripts/release-r3c6g1-vitest-final.json`/`.log`; Python **365PASS/80.04s** `.out-scripts/release-r3c6g1-python.log`; build `.out-scripts/release-r3c6g1-build.log`PASS. Node/Web/scripts/lab/scopedlint12/fresh026/nativeCLI8+auth13+Desktop15 đều PASS trên source cuối, không thay runtime saugate. Index22file đúngscope/secretpattern0/missinglinks0/diffcheckclean; CLIusage và giới hạn tại `app/control-plane-runtime/README.md`. Board CHỜ REVIEW do chưaPR/merge; commitKim/normalpush theoquyềnuser, remote so khớp trước thông báo. Không acceptedexceptions, không productionVPS/DB write.
