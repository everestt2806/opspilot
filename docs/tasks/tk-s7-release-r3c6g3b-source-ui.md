# R3c-6g3b — Xác minh source từ Desktop

START 07/11/2026 — Tiếp `a31c80a`, product-mode, task-discipline. User cho phép tiếp tục phát triển và push checkpoint; không PR/merge/production write.

Giả định phạm vi: đưa CLI source verification đã đạt gate vào luồng dự án mới trên Desktop. Checkpoint này hoàn tất nút kiểm tra source và full SHA qua SSH; target enrollment/readiness/first deploy là6g3c, chưa coi source verified là đã deploy.

| Yêu cầu | Thay đổi / gate | State |
|---|---|---|
| Contract và main derive authority |1IPC setup key, registered journal/result + current binding, response identities đối chiếu; backend76/native21 PASS | PASS |
| Fixed SSH operation và timeout riêng | CLI90s/helper105s/whole120s, other admin15/default45/max60 giữ nguyên; timeout unit + nativeSSH actual Git PASS | PASS |
| Response/current authority/redaction | Strict schema/current binding/row/races; source stderr1024bytes chỉallowlist, stdout64KiB; native21/probe7 PASS | PASS |
| UI kiểm tra và kết quả trung thực | Focused combined99PASS/5files, sourceUI15tests/4locale/retry/late reply/no deploy; Electron44checks/44PNG/0errors/no overflow | PASS |
| Kiểm chứng và hồ sơ | Full1777PASS/2Linux-onlySKIP/0FAIL, focused99/native21/probe7/Electron44/type/lint15/build/Ruff PASS;72file review/44PNG/secretpattern0/links đủ/diff sạch, board/HANDOFF/FR/release đồng bộ | PASS |

## Nhật ký

- START07/11: tracked tree sạch, HEAD `a31c80a`. Không thêm ready flag/schema; source result là snapshot hiển thị trong phiên UI, refresh/đổi binding/unmount bỏ kết quả. Setup cũ với source/target đổi phải fail closed và review, không tự rebind. Dùng lại verified admin transport, không mở generic CLI/SQL hoặc API công khai.
- UPDATE07/11: contract-first +DECISIONS, shared DTO exact copy; `controller:verify-project-source(key)` là route cụ thể thứ18, không genericcall. Main chỉregistered setup/current writable binding, lấy app/generation/config/target từ immutable result; artifact/pin từbinding. Source result strictschema/identity/body đối chiếu, timestamp tốiđa120s cũ/5s tươnglai theo Desktop clock. Busy lock, reject caller transaction; kiểm binding/row sau await. Không lưu source result vào SQLite ready flag, không deployment hoặc policy mutation.
- UPDATE07/11: fixed SSH wrapper chỉ source operation có120s deadline (open channel timeout vẫn30s, không giới hạn lifetime channel ở30s), CLI90s/helperprocess105s; lệnhghi khácgiữ15s/default45s/max60s. Pythonselectors drain stdout/stderr song song, stdout64KiB/stderr1024byte, chỉ fullmatch CONTROL_PLANE_ERROR +stablecode allowlist, khôngsuffix/unknown/overlimit/rawcontent. Probe stdlib với Node subprocess thật **7PASS**, `.out-scripts/release-r3c6g3b-admin-errors.log`; Ruffcheck/format2PythonfilesPASS. Không đổi Python ML/collector/experiments.
- UPDATE07/11: backend focused **76PASS**, combined **99PASS/5files** `.out-scripts/release-r3c6g3b-focused-accepted.log` (sourceUI15 +projectpanel8 +mainsetup28 +enrollment10 +IPC38). Test UI initial dùng role name không khớp accessible loading button và `ByRoleOptions.exact` không được typings hỗ trợ; sửa tìm đúng button bằng nội dung, không hạ assertion/timeout hoặc đổi runtime để né test. React exhaustive-deps warning counter trong cleanup: cleanup chỉ alive=false; close dùngepoch vàauthority đổi remount, testlate resultPASS. SourceUI không claim ready/deployed, báo portoverride khác detector,4locale, refreshtạo phiênmới bỏreceiptcũ.
- UPDATE07/11: native SSH/admin/public Git **e66cda2266ad 21PASS**, `.out-scripts/desktop-controller-enrollment/e66cda2266ad/result.json` và `release-r3c6g3b-native.log`. CLI `/var/tmp/opspilot-p3e3a-runtime/r3c6g3b/control-plane.cjs`; manifest **53a3a02c8a0882374941acf7ba46c0bacf20319a22f84fa9fe9a40b27cb9bc16**, labartifact `/var/tmp/opspilot-p3e3a-runtime/r3c6g3b-lab.cjs` SHA256 **30c5ee1accbd6cda7ca61793ddf58993ae43cb30b4d15db1eafba32d0e067c5e**. Desktop registered setup→actual helper→CLI fetch `everestt2806/opspilot` branch `feat/release-audit-20261204`, root `demo-apps/san-nha-booking`; recheck sameSHA/sequence, unsupported DB root trả đúng SOURCE_UNSUPPORTED.0job/deployment choappmới,0runtime dispatch/productionVPS,cleanuptrue. Native coldvault/API/registration18casesgiữregression. Final native source của main/helper không đổi sau gate; chỉ sửa UItest/effectcleanup và tài liệu.
- UPDATE07/11: final Node/Web/scripts/lab typechecks và build PASS, `.out-scripts/release-r3c6g3b-build-accepted.log`/`types-accepted.log`; renderer index-Ai3Rc2Ct.js4295.68kB. Scoped lint15TS/TSX/MJSfiles0errors/0warnings, `release-r3c6g3b-eslint-accepted.json`; Ruffcheck/format bootstrap+stderrprobe2filesPASS. Không đổi schema/dependency/protocolML; không dùng Python365test baseline thay gate hiện tại vì không đổi ML/collector/experiments.
- UPDATE07/11: Electron thật **d204f0168baa 44/44 PASS**, raw `.out-scripts/controller-ui/d204f0168baa/result.json`,44PNG tại `docs/ui-redesign/screenshots/r3c6g3b/`. Actual built renderer/preload +isolated IPC metadata fixtures, không productionprofile hoặc backendnetwork; nativeSSH gate độc lập chứng minh network.1280×800/1366×768 ×dark/light:40regression +4source-result layouts;0renderererrors,0modalhorizontaloverflow/footerinsideviewport,0sourcecommand trướcconfirm/fullSHA/no deploymentclaim. Đã xem source-verified1280dark và1366light, nội dung đầy đủ. Không biến GUIfixture thành liveVPS proof.
- HANDOFF-LOCAL07/11: full cuối **1777PASS/2Linux-onlySKIP/0FAIL**,137filesPASS/1fileSKIP,233.66s; raw `.out-scripts/release-r3c6g3b-vitest-final.json` và `.log`.34test mới đều chạy, không skip test của checkpoint. Focused99/native21/probe7/Electron44/Node-Web-scripts-lab/lint15/build/Ruff đều đạt; schema vẫn027, không dependency mới.72file review gồm28text +44PNG,0secretpattern/5newrelative links đủ/diff sạch. Task **CHỜ REVIEW**, không accepted exceptions; chuẩn bị commit co-author Kim/normal checkpoint push, đối soát remote trước báo DONE. SHA `git log -1 -- app/src/renderer/src/components/ControllerProjectSourceCheck.tsx`. Không productionVPS/productionDB/PR/merge/reset/clean/stash/rebase; file cá nhân ngoàiindex. Tiếp6g3c target enrollment/readiness/firstdeploy GUI; chưa cần user test thay phần chưa viết.

## Tái hiện

```text
. ./tools/enter-node22.ps1
pnpm --prefix app exec vitest run src/renderer/src/components/ControllerProjectSourceCheck.test.tsx src/renderer/src/components/ControllerProjectPanel.test.tsx src/main/controlPlane/desktopControllerEnrollment.test.ts src/main/controlPlane/desktopProjectSetup.test.ts src/main/ipc.test.ts --maxWorkers=2
pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=default --reporter=json --outputFile=.out-scripts/release-r3c6g3b-vitest-final.json
pnpm --prefix app build
pnpm --prefix app exec tsc --noEmit -p tsconfig.scripts.json
pnpm --prefix app exec tsc --noEmit -p scripts/product-runtime-lab/tsconfig.json
pnpm --prefix app exec eslint <15 changed TS/TSX/MJS files, excluding ignored shared/ipc.ts> --max-warnings=0
ml-service/.venv/Scripts/python.exe -m ruff check app/src/main/controlPlane/desktop_controller_admin.py app/scripts/product-runtime-lab/desktop-admin-source-errors.py
ml-service/.venv/Scripts/python.exe -m ruff format --check app/src/main/controlPlane/desktop_controller_admin.py app/scripts/product-runtime-lab/desktop-admin-source-errors.py
Linux: python3 app/scripts/product-runtime-lab/desktop-admin-source-errors.py <approved Node22 absolute path>
Linux: OPSPILOT_R1_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c6g3b-lab.cjs OPSPILOT_CONTROLLER_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c6g3b/control-plane.cjs node app/scripts/product-runtime-lab/desktop-controller-enrollment.mjs
Windows: app/node_modules/electron/dist/electron.exe app/scripts/product-runtime-lab/controller-ui-capture.mjs
git diff --check
```

Linux enrollment lab dùng HTTP8768, phải kết thúc trước Windows full suite/ControllerService. Electron capture không dùng8768. Chỉ test/lab credentials tự sinh, không user VPS credential. Chưa enroll target hoặc deploy từ GUI ở6g3b; tiếp6g3c dùng installer/proof/readiness và durable deploy journal hiện có, không viết đường thực thi thứ hai.
