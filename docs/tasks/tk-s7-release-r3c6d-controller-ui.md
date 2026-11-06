# R3c-6d — Đăng ký controller và đọc ứng dụng từ giao diện

START06/11/2026 — Backend6c02401a7 đã push; chuyển sang UI/IPC có chức năng sử dụng được. Áp dụng task-discipline. Không cần user test thay code; tự kiểm bằng unit/native/Electron trước handoff.

| Yêu cầu | Gate | State |
|---|---|---|
| IPC metadata-only, service compose vào main | 6specific IPC routes/current VPS/main-cipher-SshManager wiring; shared contract exact parity/service7/IPC bridge test PASS;no raw secrets/genericcall | PASS |
| Settings đăng ký/list/retry/thu hồi/disconnect | UI valid form + pending UUID +4locale +confirm/permission/local-disconnect distinction tested; native actual service register read-only grant/snapshot/revoke PASS | PASS |
| Đọc app từ controller, không local fallback | Main fresh binding/status/whitelist snapshot; React staleTTL/error≠empty/late previous controller/paging-revision guard tested; read-only UI | PASS |
| Tương tác thật và regression | Focused55; native13 `ff04679a80c1`; Electron12checks/12ảnh `87e087cf24e2`; full1651PASS/2Linux-onlySKIP/0FAIL, Python365, fresh024/bundle12, types/lint/build/Ruff đạt | PASS |
| Docs/checkpoint | Ledger/board/handoff/FR đã đối chiếu; staged38file/secret/link/diff sạch; push checkpoint theo quyền user, đối chiếu remote sau commit | PASS |

UI bước này đọc Product apps; chưa thêm nút manual redeploy/policy trước local durable request journal (để không mất unknown key khi UI đóng). Backend HTTP manual đã qua runtime gate5b; không nhầm slice UI-read với Product pipeline đã dùng trọn từ wizard. No accepted exceptions, không PR/merge/production VPS/DB write.

## Nhật ký

- UPDATE06/11: service hiện đã compose vào app main với actual DB/profile cipher/SshManager. ControllerPanel trong Settings có4locale, register form dùngcurrent VPS đãpin và installation ID/paths/manifest metadata; không nhập bearer/password/key. UI dùngsame binding UUID khi retry; state active là Registered màu trung tính, không tự nhận health online; Apps snapshot lấyloopbackHTTP qua pinned SSH, lastchecked/TTL30s/stale/unknown rõ, no local app merge/fallback.
- `controller:list/register/retry-enrollment/revoke/disconnect/apps` là6routecụthể; strict schemas, metadata/whitelist output; stable technical codes dưới hướng dẫn lỗi được dịch. UI registration grant chỉread, không cấp manual/policy vô cớ. Local disconnect xóa token cục bộ và nói rõ remote grant còn; revoke adminSSH thực sự cấp fixedCLIoperation sau verifybundle/controller/private SQL. Revoke UUIDderive ổn định từbinding/client; response loss→retry samekey, không tự khai success.
- Initial tests phát hiện AntD5 Alert.message/maskClosable khácAPI mới; sửa theo local installedtypes. React clock lazy init/asynchronous load/callback deps đúng hook rules. Shared contract format mismatch đã copy lạiexactfile, không bỏ parity check. Unit animation tests dùng motion=false trongtestConfigProvider; nativecapture dùng actual CSS animations. TTL fake clock đặt trước render; confirmtitle2DOMnodes dùng scoped/assertall đúngAntD, không suy bugproduction từtestselector. Valid form submits metadata-only UUID.
- Native **ff04679a80c1 13PASS**, raw `.out-scripts/desktop-controller-enrollment/ff04679a80c1/result.json`:actualSSH/verified CLI/coldvaultHTTP như6c + lostrevoke reply retry1adminrecord + actual UIservice registerreadscope/snapshot/revoke. Lab `/var/tmp/opspilot-p3e3a-runtime/r3c6d-final-lab.cjs`, SHA256 **22ba27f38a91b5e873e833fbc6533a2f97de78e5917f6bfb5c0c5838ccec941c**. Runtime dispatch=false/productionVPS=false; không nhầm GUI fixture là networkproof.
- Electron capture cuối **87e087cf24e2: 12/12 PASS**, không lỗi renderer. Đây là giao diện Electron thật với metadata fixture, không dùng profile production và không gọi mạng. 1280×800/1366×768, dark/light không tràn ngang; form cuộn được, nút xác nhận hiện đủ trong viewport; không ô nhập secret. 12 PNG tại `docs/ui-redesign/screenshots/r3c6d/`; đã xem ảnh Apps, form và cuối form. Bằng chứng backend SSH riêng ở native13 phía trên. Capture đầu dùng cửa sổ ẩn có ảnh compositor cũ; đã sửa showInactive + chờ frame rồi chạy lại, không sử dụng ảnh cũ làm nghiệm thu.

## Lệnh tái hiện

```text
. ./tools/enter-node22.ps1
pnpm --prefix app typecheck
pnpm --prefix app exec tsc -p tsconfig.scripts.json --noEmit
pnpm --prefix app exec tsc -p scripts/product-runtime-lab/tsconfig.json --noEmit
pnpm --prefix app exec vitest run src/renderer/src/components/ControllerPanel.test.tsx src/main/controlPlane/desktopControllerService.test.ts src/main/ipc.test.ts --maxWorkers=2
pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=json --outputFile=.out-scripts/release-r3c6d-vitest-accepted-v2.json
pnpm --prefix app exec eslint <15 changed TS/MJS files; shared/ipc.ts is config-ignored> --max-warnings=0
pnpm --prefix app build
ml-service/.venv/Scripts/python.exe -m pytest experiments/ collector/tests ml-service/tests -p no:cacheprovider -q
ml-service/.venv/Scripts/python.exe -m ruff check experiments collector ml-service app/src/main/controlPlane/desktop_controller_admin.py
ml-service/.venv/Scripts/python.exe -m ruff format --check app/src/main/controlPlane/desktop_controller_admin.py
Linux Node22: node app/scripts/product-runtime-lab/verify-deps.mjs
Linux: OPSPILOT_R1_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c6d-final-lab.cjs OPSPILOT_CONTROLLER_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c6c/control-plane.cjs node app/scripts/product-runtime-lab/desktop-controller-enrollment.mjs
Windows: app/node_modules/electron/dist/electron.exe app/scripts/product-runtime-lab/controller-ui-capture.mjs
```

Giao diện dùng credential read-only. Việc tiếp theo là lưu yêu cầu thao tác bền ở Desktop trước khi nối nút deploy/pause/resume; đóng app hoặc mất phản hồi phải giữ nguyên UUID để tra cứu, không tự gửi lại deployment. Installer/controller trên VPS thật, HTTPS, migrate và ML vẫn cần checkpoint nghiệm thu riêng; không có yêu cầu user test để thay thế phần code còn thiếu.

- UPDATE06/11: focused cuối55PASS (`release-r3c6d-focused-accepted.log`); Python365PASS/117.61s, fresh dependency install/schema024/bundle12PASS, Node/Web/scripts/lab typechecks/scoped lint15/Ruff+format/build PASS. Lượt full đầu sau paging bổ sung có1650PASS/2SKIP/1FAIL: test tìm exact accessible name của nút Load more trong khi AntD còn loading icon (`loadingTải thêm`). Dữ liệu page2 đã hiện; sửa test chờ accessible button về trạng thái sẵn sàng bằng findByRole, focused55PASS rồi chạy lại full. Không bỏ test hoặc nới production behavior. Lượt lint đầu liệt kê shared/ipc.ts vốn nằm trong ignore config nên có warning; bỏ đường dẫn ignored khỏi lệnh,15file thực sự lint0error/0warning. Chưa dùng lượt full fail làm nghiệm thu.
- HANDOFF-LOCAL06/11: lượt full cuối **1651PASS/2Linux-onlySKIP/0FAIL**, raw `.out-scripts/release-r3c6d-vitest-accepted-v2.json` và `.log`. Typecheck/lint chạy lại sau sửa test đạt; không đổi production source hoặc ảnh sau native/build gates. Đủ gate cho slice đăng ký/đọc/thu hồi quyền; board giữ CHỜ REVIEW do chưa PR/merge. Không accepted exceptions, không user action cần để gỡ chặn slice này. Co-author Kim theo yêu cầu user; giữ nguyên file cá nhân ngoài index. SHA tra `git log -1 -- app/src/renderer/src/components/ControllerPanel.tsx`; normal push và remote đối chiếu trước thông báo.
