# R3c-6g4 — Đăng ký kết nối VPS đích từ Desktop

START08/11/2026 — Tiếp `1d51035`, product-mode/task-discipline. User cho phép phát triển và normal checkpoint commit/push; không PR/merge/production write. Giả định từ điểm nối6g3d: dùng local VPS đã lưu/pinned và explicit consent để controller có thể kết nối, không bắt nhập lại secret trong renderer.

| Yêu cầu | Gate | State |
|---|---|---|
| Contract-first/journal | Metadata-only4IPC và migration028/40tables; populated v025/v027 upgrade/schema parity và freshLinux CLI PASS | PASS |
| Controller registration nguyên tử | Reuse pinned SSH enrollment + synchronous onPersist cùng IMMEDIATE transaction, Unix admin/UUID/profile-only receipt; unit và native34PASS trên bundle cuối | PASS |
| Main quản lý secret và authority | Derive local VPS/current binding/security revision/cipher digest;18focusedPASS, native cold replay/ciphertext proof, wrongpin trước auth | PASS |
| GUI4locale | Select localVPS + profile/pin/controller review và consent; unknown retryoldkey/cancelprepared/late reply guards;11unit và Electron80PASS | PASS |
| Kiểm chứng | Full1879PASS/2Linux-onlySKIP/0FAIL; native34/Electron80/probe18/fresh028/4types/lint26/build/Ruff trên relevant source cuối | PASS |
| Gate và hồ sơ | Board/HANDOFF/FR/release đồng bộ;121files/41text/80PNG,0secretpattern/5newrelative links đủ/diff sạch; co-author Kim và quyền normal push xác nhận | PASS |

## Phạm vi

Chỉ tạo kết nối VPS trên controller đã khởi tạo kho khóa và Desktop binding hợp lệ có quyền ghi. Không init/rotate khóa ngầm, cài Docker/helper/service, deploy, đổi credentials VPS cũ hoặc public management endpoint. `enroll-vps` CLI cũ giữ tương thích. Registration là stored credential metadata, không runtime readiness; các bước source/target/readiness/deploy6g3 vẫn tách rõ.

## Nhật ký

- START08/11: tracked tree sạch tại `1d51035`. Base `enrollControllerVps` đã pin SSH trước lưu AES-GCM; replay profile/secret đúng trả cùng ID, conflict không overwrite. Chọn wrapper admin `register-vps` + transactional receipt và local durable intent để mất response có thể explicit retry cùng UUID. Không delegate hoặc dùng VPS/DB production.
- UPDATE08/11: base CLI enrollment giữ tương thích; optional synchronous onPersist callback cho server receipt nguyên tử, không lưu password hash. Migration028 thêm2tables/tombstone/immutability/state triggers; fresh40tables. Focused backend110PASS/6files, main16PASS/1file. Native initial `5bb59272112f`33PASS gồm rollback cả VPS/receipt khi INSERT lỗi, lostreply→coldretryoldUUID→1VPS/ciphertextunchanged, rồi source/target/readiness/deploy pipeline vẫnrunning/HTTP200/1job/cleanup. Không productionVPS/DB. Đang mở rộng native wrongtargetpin trướcauth và kiểm conflict riêng credential cùngprofile, không dùng test unit thay proof kết nối.
- UPDATE08/11: main mở rộng18cases (injection/scope/caller transaction), UI11cases4locale; focused29PASS/2files `r3c6g4-focused-final.log`. IPC/controller panel59PASS/3files `r3c6g4-ui-v2.log`. UI test phát hiện key outcome_unknown khác copy unknown, sửa mapping; paging fixture chỉ đếm controller:apps thay vì bị request readonly mới tiêu thụ. Không nới assertions. Effect đọc journal chuyển sang microtask có cleanup để tránh synchronous state update trên mount; không tắt rule set-state-in-effect. Lab typecheck thêm base enrollment vào strict graph phát hiện row[field] thiếu kiểu: sửa keyof, không đổi behavior.
- UPDATE08/11: subprocess probe18PASS `r3c6g4-admin-errors-v2.log`: registration known/suffix/unknown errors, Unicode stdin128KiB lớn hơn pipe, hard limit512KiB; legacy/source/target/readiness13cases giữ. Helper dùng nonblocking selector cho stdin của register-vps, timeout60s, adminwhole90s; operations khác giữ16KiB/deadline cũ. Fake Node probe cần setEncoding('utf8') để không cắt multibyte ở ranh giới chunk; CLI thật vốn Buffer.concat+fatalUTF8. Không log rawstderr hoặc đưa secret vào argv/env/file.
- UPDATE08/11: native final **379bfbf5889a 34PASS**, raw `.out-scripts/desktop-controller-enrollment/379bfbf5889a/result.json` và `r3c6g4-native-accepted.log`. Current CLI `/var/tmp/opspilot-p3e3a-runtime/r3c6g4/control-plane.cjs`, manifest **a57c3323613b90d6b48a0616b2f99ccf0c38da97f5335f70b413e9397e5b610a**; lab `/var/tmp/opspilot-p3e3a-runtime/r3c6g4-lab.cjs` SHA256 **c53b04967cc93dbf82bcadc1205303d26336324c06238e483254505e456e77dd**. Actual SSH/admin/CLI/SQLite/crypto: no consent→0VPS, receipt INSERT failure→rollback VPS/ciphertext, lost reply→cold retry sameUUID→1VPS/sameciphertext, cùng profile khác secret→conflict/nooverwrite, wrong target fingerprint→0auth/0newVPS. Sau đăng ký, source/target/readiness/firstdeploy regression vẫn1job/running/HTTP200, auto-deploy paused và cleanup=true. App source publicHEAD `1d51035`; CLI/lab là code checkpoint hiện hành chưa commit. Không gọi loopback HTTP200 là VPS public reachability.
- UPDATE08/11: Electron final **4019500cd9a4 80/80PASS**, `.out-scripts/controller-ui/4019500cd9a4/result.json`,0renderererrors/0passwordfields,1280×800/1366×768 dark/light. `docs/ui-redesign/screenshots/r3c6g4/`80PNG =68regression+12registration review/unknown/registered. Review đủhost/user/pin/controller/UUID/consent, confirm disabled trước consent; unknown retry giữUUID; registered không installed/deployed claim. Đã xem review1280dark vàregistered1366light. Actual renderer/preload dùng IPC fixtures; native gate độc lập chứng minh network/runtime.
- UPDATE08/11: freshLinux Node22.23.4/SQLite3.53.4/Zod4.4.3/migration028/init+status/12verifiedassets PASS `r3c6g4-fresh-install-accepted.log`,0implicit registrations. Node/Web/scripts/lab typechecks và build PASS; finalrenderer index-DKiaLQ3f.js4364.43kB `r3c6g4-build-accepted.log`. Lint0errors/0warnings và Ruff2filesPASS; số filelint cuối trongjson. Không đổi dependency, ML/collector/experiments hoặc protocol50runs.
- UPDATE08/11: full đầu1878PASS/1FAIL/2Linux-onlySKIP, lỗi duy nhất projectRegistration upgrade test còn expected27 và thiếu bước tháo028 khi dựng fixturev025. Sửa fixture để đúng v025 và expected latest28; focused15PASS `r3c6g4-upgrade-v025.log`. Full nghiệm thu `release-r3c6g4-vitest-accepted.json` đang chạy trên source cuối, không tự waive gate lỗi.
- HANDOFF-LOCAL08/11: full cuối **1879PASS/2Linux-onlySKIP/0FAIL**,144filesPASS/1fileSKIP,211.64s; `.out-scripts/release-r3c6g4-vitest-accepted.json`/`.log`.34tests mới khôngskip (5controller receipt/18main/11UI). Native34/Electron80/probe18/fresh028/Node-Web-scripts-lab/lint26files0errors0warnings/build/Ruff2files đều PASS; `r3c6g4-eslint-accepted-final.json` và `r3c6g4-stage-review.json` giữ bằng chứng.121files41text+80PNG đúng phạm vi,0secretpattern/5newrelative links đủ,cached diff sạch; filecá nhân ngoàiindex nguyên trạng. Không accepted exceptions. Task **CHỜ REVIEW**, chưa merge; chuẩn bị localcommit co-author Kim/normal checkpointpush và đối soát remote trước báo DONE. SHA `git log -1 -- app/src/main/controlPlane/desktopTargetSetup.ts`. R3 tổng chưa đóng; không productionVPS/DB/PR/merge/reset/clean/stash/rebase.

## Tái hiện

```text
. ./tools/enter-node22.ps1
pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=default --reporter=json --outputFile=.out-scripts/release-r3c6g4-vitest-accepted.json
pnpm --prefix app build
pnpm --prefix app exec tsc --noEmit -p tsconfig.scripts.json
pnpm --prefix app exec tsc --noEmit -p scripts/product-runtime-lab/tsconfig.json
pnpm --prefix app exec eslint <changed TS/TSX/MJS files, excluding ignored shared/ipc.ts> --max-warnings=0
ml-service/.venv/Scripts/python.exe -m ruff check app/src/main/controlPlane/desktop_controller_admin.py app/scripts/product-runtime-lab/desktop-admin-source-errors.py
ml-service/.venv/Scripts/python.exe -m ruff format --check app/src/main/controlPlane/desktop_controller_admin.py app/scripts/product-runtime-lab/desktop-admin-source-errors.py
Linux: python3 app/scripts/product-runtime-lab/desktop-admin-source-errors.py <approved Node22 absolute path>
Linux: OPSPILOT_R1_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c6g4-lab.cjs OPSPILOT_CONTROLLER_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c6g4/control-plane.cjs node app/scripts/product-runtime-lab/verify-deps.mjs
Linux: OPSPILOT_R1_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c6g4-lab.cjs OPSPILOT_CONTROLLER_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c6g4/control-plane.cjs node app/scripts/product-runtime-lab/desktop-controller-enrollment.mjs --first-deploy
Windows: app/node_modules/electron/dist/electron.exe app/scripts/product-runtime-lab/controller-ui-capture.mjs
git diff --check
```

Linux SSH/Docker lab dùngport8768 phải kết thúc trước Windows fullsuite. Chỉ dọn nonce resources có đúnglabels/privatepaths; không Docker prune hoặc dùng productionprofile/DB. File cá nhân ngoàiindex giữ nguyên.

## Điểm nối

Controller phải được khởi tạo bundle/private data/key và Desktop binding trước; checkpoint này bỏ bước CLI enroll-vps cho target, chưa thay installer/setup controller. Tiếp installer/setup service trên controller, quản lý revision/credential rotation/rebinding có explicit consent và quiescence, non-root/live/soak. Unknown với local credential/profile đã thay đổi tiếp tục fail-closed; không tự overwrite hoặc đổi UUID để lách conflict. R3 tổng/PRODUCT_PASS chưa đóng; chưa cần user test thay code còn thiếu.
