# R3c-6f — Deploy/policy và đối soát yêu cầu từ giao diện

START07/11/2026 — Backend journal `eb677f9` đã push/gates PASS; user yêu cầu tiếp tục build. Task-discipline; checkpoint push được phép, không PR/merge/production write.

| Yêu cầu | Gate | State |
|---|---|---|
| Quyền ghi do user chọn rõ khi đăng ký | Defaultread-only + checkbox opt-in; main derive exact scopes, strict boolean; unit + actual SSH admin15cases | PASS |
| Nút deploy/pause/resume dùng đúng controller app/generations/capabilities | Snapshot3HTTP identity/apps/capabilities, oldest timestamp TTL, scope/status/generation guards; exact observed SHA và current main vault checks | PASS |
| Xác nhận và pending journal | Prepare→send cùng main UUID, unknown chỉcheck-key, prepared chỉcancel khi cold screen; accepted neutral + đọc app/job DTO riêng; unit68/genuine service15/capture24 | PASS |
| Lỗi/race/locale/native layout | 4locale; app switch/out-of-order/mid-confirm SHA change/unmount-before-send/history error/no local fallback; final Electron `12627592e709`24checks/24ảnh/0renderererrors | PASS |
| Regression và bàn giao | Final full1680PASS/2Linux-onlySKIP/0FAIL, types/lint12/build/native15/fresh025; ledger/board/HANDOFF/FR và index/secret/link/diff; commitKim/push đối chiếu remote trước thông báo | PASS |

UI triển khai **SHA mong muốn đã quan sát và xác nhận**, không có arbitrary SHA input. Điều chỉnh từ giả định current_desired ban đầu: nhánh có thể đổi trong lúc hộp xác nhận mở; gửi specific_sha từ snapshot hiện hành giúp controller không thay commit mà người dùng vừa xác nhận. Backend vẫn kiểm provenance/generations. Job/deployment đọc riêng từ controller, không suy runtime success từ journal accepted.

## Nhật ký và bằng chứng

- UPDATE07/11: contract metadata thêm allow_write, scopes, app generations, capabilities và app-status trước implementation; không migration mới, giữ schema025. Default registration read-only, grant ghi chỉ khi boolean opt-in; cùng enrollment UUID nhưng đổi intent bị vault chặn. Main snapshot đọc3route song song, kiểm final binding/controller/client và TTL dùng sampled_at cũ nhất. App status whitelist, không URL/env/credential hoặc rawerror.
- ControllerCommandPanel trong Settings: chọn app remote; nút chỉ khi snapshot/status hiện hành, generations khớp, scope/capability đủ, không pending/local loaderror. Xác nhận tênapp/fullSHA/tác động pause; prepare trước send và kiểm context lần nữa. Mất prepare response giữ prepared để hủy; unmount trước prepare trả về thì khôngsend; unknown chỉcheck mãcũ. Journal vẫn hiện qua local IPC khi snapshot mạng lỗi. Hiển thị request accepted màu trung tính và job/deployment riêng, timestamp cập nhật khác thời điểm kiểm tra. Ngắt/thu hồi có giải thích hậu quả với unresolved requests.
- Focused **68PASS/4files** (`release-r3c6f-focused-final.log`):11UIcommand tests +10onboarding +9service +38IPC. Main service opt-in/projection/mismatch, checkbox default off/explicit on, SHA/pause/resume/cold prepared/lost reply/late old app/unmount/freshness/capabilities/4locale. First focused failures là fixture: pagination counter tính thêm controller:commands; helper chọnapp chờ job trong ca cố ý delay response. Sửa mock phân biệtchannel và helper cho phép deferred status; không bỏ productionguard.
- Native **101c7b8c4fd5 15PASS**, raw `.out-scripts/desktop-controller-enrollment/101c7b8c4fd5/result.json`, artifact `/var/tmp/opspilot-p3e3a-runtime/r3c6f-lab.cjs`, SHA256 **c3c2fc32a8157117ddd3e0eebdb015e4232099da98fa78cee607546549326996**. Actual pinned SSH/verified adminCLI/encrypted vault/controller API; UI service defaultread và explicitwritescope, snapshotgenerations/capabilities, exactSHA journal, jobqueued/currentdeploymentnull, check và revoke. Runtime dispatch=false/productionVPS=false/cleanup=true. Không coi queued là deployment hoàn tất.
- Electron **a5824441a604 24PASS**, actual renderer/preload/theme/modals/selection/prepare/send/lostreply GUI với metadata fixture (network=false, productionprofile=false), 1280×800/1366×768 dark/light,0renderererrors/no horizontalwindow-main, submit trongviewport, SHAhiệnđủ;24PNG tại `docs/ui-redesign/screenshots/r3c6f/`. Đã xem unknown dark1280, confirm light1366 và formfooter light1366. Capture đầu `c0408cc0dc48`fail sau7checks vì fixture resetrows nhưng giữ selection cũ; sửa close-list/unmount trước case mới và ép device scale1 để ảnh đúng pixel. Không dùng ảnh/receipt fail làm proof.
- Node/Web/scripts/lab types và scoped lint12file0/0/build đạt. Lint phát hiện unused import và cleanup-ref warnings; sửa import và dùng invalidateReads callback, không tắt rule. Full đầu **1680PASS/2Linux-onlySKIP/0FAIL**, sau đó sửa copy request-state/updated-time/deployment-recorded và hướng dẫn vị trí job; đang chạy accepted full/capture/build trên labels cuối. Các thay đổi sau native15 chỉ UI/copy/harness/tests; không đổi backend đã gate.

## Lệnh tái hiện

```text
. ./tools/enter-node22.ps1
pnpm --prefix app exec vitest run src/renderer/src/components/ControllerCommandPanel.test.tsx src/renderer/src/components/ControllerPanel.test.tsx src/main/controlPlane/desktopControllerService.test.ts src/main/ipc.test.ts --maxWorkers=2
pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=json --outputFile=.out-scripts/release-r3c6f-vitest-accepted.json
pnpm --prefix app typecheck
pnpm --prefix app exec tsc --noEmit -p tsconfig.scripts.json
pnpm --prefix app exec tsc --noEmit -p scripts/product-runtime-lab/tsconfig.json
pnpm --prefix app exec eslint <12 changed TS/TSX/MJS files, shared/ipc.ts config-ignored> --max-warnings=0
pnpm --prefix app build
Linux Node22: node app/scripts/product-runtime-lab/verify-deps.mjs
Linux: OPSPILOT_R1_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c6f-lab.cjs OPSPILOT_CONTROLLER_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c6e/control-plane.cjs node app/scripts/product-runtime-lab/desktop-controller-enrollment.mjs
Windows: app/node_modules/electron/dist/electron.exe app/scripts/product-runtime-lab/controller-ui-capture.mjs
```

Python/SQL migration không đổi trong6f;365Python vànative9journal gates của6e cùng phiên vẫn là regression nền, không nhận đó là bằng chứng UI. Tiếp theo wizard đăng ký dự án/target/source/credentials để user tạo Product app mới không cần CLI, installer/non-root/rotation/liveVPS/soak, rồi template/HTTPS/migrate/ML theo releaseboard. Checkpoint này thao tác app **đã được controller quản lý**, không tự quảng cáo Product onboarding toàn trình đã xong. Không có user action cần thay thế phần code còn thiếu; không accepted exceptions cho required gates.

- HANDOFF-LOCAL07/11: final labels full **1680PASS/2Linux-onlySKIP/0FAIL**, raw `.out-scripts/release-r3c6f-vitest-accepted.json` và `.log`; build `.out-scripts/release-r3c6f-build-accepted.log` PASS. Electron final **12627592e709 24PASS**, raw `.out-scripts/controller-ui/12627592e709/result.json`,24ảnh đúng kích thước1280×800/1366×768, dark/light,0renderererrors/nohorizontaloverflow/submitvisible; đã xem lại ảnh unknown1280dark trên labels cuối. Final scopedlint12file0/0,Node/Web/scripts/lab types, fresh025/bundle12/native15 PASS. Ledger đối chiếu, không productionVPS/DB, không PR/merge, giữ file cá nhân ngoài index. SHA tra `git log -1 -- app/src/renderer/src/components/ControllerCommandPanel.tsx`; commit Kim, normal push/remote match trước báo.
