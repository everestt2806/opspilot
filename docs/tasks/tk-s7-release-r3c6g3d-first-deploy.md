# R3c-6g3d — Readiness và deployment đầu tiên từ Desktop

START 08/11/2026 — Tiếp `1163c1d`, product-mode; task-discipline. User cho phép phát triển/commit/push checkpoint; không PR/merge/production write.

| Yêu cầu | Gate | State |
|---|---|---|
| Contract-first/readiness current authority | Source fullSHA/shared preflight, current target/HMAC inspect, controller/target resources; 10 focused tests và native readiness PASS | PASS |
| First-deploy atomic precondition | ExactSHA + require_first_deployment, transaction chặn current deployment/active job và giữ legacy API tương thích; actual SQLite tests và native duplicate→1job PASS | PASS |
| Main receipt và durable command | Main derive setup authority, bounded60s readiness receipt, prepare→review→send bằng existing journal; native lostHTTP→coldlookupoldkey; generic send không bypass receipt | PASS |
| GUI4locale/trạng thái trung thực | Readiness/checks/expiry/review, queued khác runtimehealthy, cold recovery/cancelprepared/stale guards; 14 focused tests và Electron68checks/ảnh cuối PASS | PASS |
| Kiểm chứng thực | Full1845PASS/2Linux-onlySKIP/0FAIL, focused125/native29/Electron68/probe13/4types/lint26/build/Ruff đạt trên relevant source cuối | PASS |
| Gate và hồ sơ bàn giao | Board/HANDOFF/FR/release đồng bộ;108files/40text/68PNG,0secretpattern,5newrelative links đủ/diff sạch; co-author Kim và quyền normal checkpoint push xác nhận | PASS |

## Phạm vi

Chỉ first activation của registered Product project Express/noDB/no required env theo runtime hiện hành. Không migration mới, template mới, public management API, auto-enable, reinstall target hoặc Desktop pipeline fallback. Readiness hết hạn sau60s trong main; runtime luôn kiểm lại tài nguyên/authority, không dùng snapshot thay admission.

## Nhật ký

- START08/11: tracked tree sạch, HEAD `1163c1d`. Chọn fixed readiness admin CLI + main-only receipt và existing deploy journal. Thêm optional require_first_deployment=true vào redeploy contract để transaction từ chối stale first-deploy race; không đổi intent của request legacy. Không delegate hoặc dùng VPS/DB production.
- UPDATE08/11: 115 focused tests (7 files) và 10 readiness tests PASS. Native đầu xác nhận report ready nhưng execution bị chặn bởi dummy app fixture `demo/app.git` từ gate HTTP cũ; giữ fail-closed của sản phẩm, chuyển riêng dummy app lab về desktop trước khi bật runtime thật. Không sửa điều kiện readiness để cho gate qua. Docker Desktop được khởi động, đã có app/collector nonce riêng chạy; chờ kết quả finalization/HTTP và cleanup. Chưa coi checkpoint DONE.
- UPDATE08/11: native `fdf06c679a37` **28PASS**, sau đó mở rộng mất HTTP reply `9d6e715d7493` **29PASS**: actual pinnedSSH/verifiedadmin/publicGit/privateSQLite/HMAC/resources/Docker. Readiness và prepare chưa tạo deployment/job; generic send bị chặn; send nhận unknown sau khi server commit, cold Desktop lookup đúng UUID, vẫn chỉ1job; build→activate→health→publish→finalization, deployment1 running/HTTP200, auto-deploy vẫn paused. Không Desktop runtime fallback; `run-product` là tiến trình Linux độc lập. Cleanup=true và không còn container namespace wizard-api lab.
- UPDATE08/11: CLI `/var/tmp/opspilot-p3e3a-runtime/r3c6g3d/control-plane.cjs`, manifest `b34b72d96853f6e8ce22a3002e58865c69b134abf2020804c5c1dfe32f8c5099`; lab `/var/tmp/opspilot-p3e3a-runtime/r3c6g3d-lab.cjs`, SHA256 `4532609a1c8d50677a0c015da998f26adc4d6facf62a11dd54d934acadb4ea23`. Native raw `.out-scripts/desktop-controller-enrollment/9d6e715d7493/result.json`, `r3c6g3d-native-final.log`. App source là public branch HEAD `1163c1d`, root `demo-apps/san-nha-booking`; CLI/lab dùng code checkpoint hiện hành chưa commit. Không gọi HTTP200 lab là publicVPS reachability/production gate.
- UPDATE08/11: Electron fixture `42fc74dc52ba`68PASS, visual review phát hiện review summary bị đẩy xuống vùng cuộn. Đưa exactSHA/source/target/port vào summary gọn; final capture **760eaeeebbdb 68/68PASS**,0renderererrors,4cấu hình1280×800/1366×768 dark/light. `docs/ui-redesign/screenshots/r3c6g3d/`68PNG, xem trực tiếp finalreview1280dark: đủ thông tin và nút confirm trong viewport; healthy1366light có SHA và thời điểm status. Đây là actual renderer/preload với IPC fixtures, không backendnetwork; native gate trên chứng minh phần kết nối/runtime riêng.
- UPDATE08/11: helper whole210s/process180s/CLI165s, bounded stdout64KiB/stderr1024bytes, chỉ safe allowlist source/target/readiness; không đưa rawstderr ra renderer. Actual Node subprocess probe **13PASS**, `r3c6g3d-admin-errors.log`; Ruffcheck/format2filesPASS. TypechecksNode/Web/scripts/lab và finalbuild PASS (`r3c6g3d-build-accepted-final.log`, renderer index-BtS3kPkh.js4339.70kB); scopedlint26files0errors/0warnings (`r3c6g3d-eslint-final.json`).
- UPDATE08/11: full đầu1844PASS/1FAIL/2Linux-onlySKIP, lỗi duy nhất là exactcopy contract bị root formatter đổi quotes/semicolons khác cấu hình app. Đồng bộ docs theo shared formatting, không sửa định nghĩa/type hoặc nới assertion. Focusedparity12PASS `r3c6g3d-contract-accepted.log`; full nghiệm thu là `release-r3c6g3d-vitest-accepted.json` đang chạy trên source cuối, không dùng gate lỗi làm PASS. Schema027/dependencies/protocolML không đổi; không chạm ml-service/collector/experiments hoặc chạy thí nghiệm.
- HANDOFF-LOCAL08/11: full nghiệm thu **1845PASS/2Linux-onlySKIP/0FAIL**,142filesPASS/1fileSKIP,262.27s; raw `.out-scripts/release-r3c6g3d-vitest-accepted.json`/`.log`.40tests mới không skip;14UI/12mainreceipt/10readiness/3atomicAPI/1journal. Source cuối đã qua4typechecks,lint26files0errors/0warnings,build,Ruff2files,subprocess13,native29vàElectron68. Đối soát108files40text+68PNG,không filecá nhân trongindex,0secretpattern/5newrelative links đầy đủ, cached diff sạch (`r3c6g3d-stage-review.json`). Không accepted exceptions. Task **CHỜ REVIEW**, chưa merge; chuẩn bị local commit co-author Kim và normal checkpoint push theo quyền user, bắt buộc đối soát remote trước khi báo DONE. SHA tra `git log -1 -- app/src/main/controlPlane/desktopFirstDeployment.ts`. R3 tổng chưa đóng; không production VPS/DB/PR/merge/reset/clean/stash/rebase.

## Tái hiện và điểm nối

```text
. ./tools/enter-node22.ps1
pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=default --reporter=json --outputFile=.out-scripts/release-r3c6g3d-vitest-accepted.json
pnpm --prefix app build
pnpm --prefix app exec tsc --noEmit -p tsconfig.scripts.json
pnpm --prefix app exec tsc --noEmit -p scripts/product-runtime-lab/tsconfig.json
pnpm --prefix app exec eslint <26 changed TS/TSX/MJS files, excluding ignored shared/ipc.ts> --max-warnings=0
ml-service/.venv/Scripts/python.exe -m ruff check app/src/main/controlPlane/desktop_controller_admin.py app/scripts/product-runtime-lab/desktop-admin-source-errors.py
ml-service/.venv/Scripts/python.exe -m ruff format --check app/src/main/controlPlane/desktop_controller_admin.py app/scripts/product-runtime-lab/desktop-admin-source-errors.py
Linux: python3 app/scripts/product-runtime-lab/desktop-admin-source-errors.py <approved Node22 absolute path>
Linux: OPSPILOT_R1_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c6g3d-lab.cjs OPSPILOT_CONTROLLER_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c6g3d/control-plane.cjs node app/scripts/product-runtime-lab/desktop-controller-enrollment.mjs --first-deploy
Windows: app/node_modules/electron/dist/electron.exe app/scripts/product-runtime-lab/controller-ui-capture.mjs
git diff --check
```

Linux lab bind8768 phải kết thúc trước Windows fullsuite. Lab mặc định không có `--first-deploy` vẫn chỉ source/enrollment/HTTP metadata; option mới yêu cầu Docker Linux thật, tạo và chỉ dọn tài nguyên nonce có đúng Product labels/private paths. Không dùng lab để tác động DB/VPS thật.

Điểm nối tiếp theo: target credential onboarding từ Desktop để người dùng không phải chạy `enroll-vps` CLI trước khi tạo project; triển khai theo contract-first, verified SSH admin, encrypted controller credentials, same-key recovery và explicit consent. Installer/rotation/non-root/live/soak còn gate riêng. First deployment hiện chỉ Express/noDB/no required env, không tự bật auto-deploy; R3 tổng và PRODUCT_PASS chưa đóng. Chưa cần user test thay phần code còn thiếu.
