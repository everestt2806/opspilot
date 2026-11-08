# R3c-6h2a — Cài controller thành Linux system service

START08/11/2026 — Base `0fc9e73`, product-mode/task-discipline. Tiếp bước6h2 từ release đã verify; user cho phép phát triển, Linux lab, normal checkpoint commit/push; không production VPS/DB/PR/merge.

| Yêu cầu | Kiểm chứng | State |
|---|---|---|
| Contract trước code | `product-controller-installation.ts` + DECISIONS; strict install/inspect/recover, consent/UUID/pin; focused97 PASS, không IPC/public API | PASS |
| Installer không ghi đè | Passive verified root-owned release, fixed paths/owner markers, fsync receipt/phase/file, kernel flock; native22 gồm symlink/unit lạ/wrong UUID/pin, concurrent BUSY và missing lock path không tạo inode mới | PASS |
| Service không root | Fresh nologin account, setpriv clear-groups + inherited-lock cold smoke, private DB/key, sandboxed enabled systemd service; UID/argv/socket inode/loopback health attestation;0VPS/app/deployment/job, schema028 | PASS |
| Recovery | Real SIGKILL sau DB/key/unit/start rồi cold inspect + explicit same-key recover; giữ DB/key inode/identity, missing key/partial DB không regen; stopped service không restart ngầm. Native22 PASS | PASS |
| Gate | Final full1955PASS/2Linux-onlySKIP/0FAIL,147filesPASS/1SKIP,173.05s; focused97/native22/release regression17/typecheck6/lint8/build/Ruff PASS. Không production VPS/DB | PASS |
| Handoff | Board/HANDOFF/FR/master release cùng checkpoint;19files review/diff sạch/0sensitive patterns/5relative links hợp lệ. Commit body có Kim co-author, normal checkpoint push đã được user cho phép; không PR/merge | PASS |

## Chọn phạm vi

6h2 được chia thành service transaction trước (6h2a), rồi transport + bridge admin/root → runtime UID và wizard. Bước này cung cấp CLI installer cho release đã có trên máy Linux, không hứa Desktop đã cài bằng một nút. Chọn system service/account riêng thay vì chạy root hoặc bật linger ngầm cho SSH user. User-mode service chưa nằm trong installer đầu tiên; preflight cũ vẫn báo khả năng host, không đồng nghĩa installer đã hỗ trợ cả hai mode.

Production paths do trusted installer code chốt; JSON không nhận command, service name, UID hoặc đường dẫn output. Lab inject platform paths/account/service nonce từ trusted harness để không thay cấu hình production; không có test bypass trong IPC/CLI. Không thêm dependency hoặc migration. Không đăng ký target/project hoặc mở port public.

## Nhật ký

- START08/11: tracked tree sạch tại0fc9e73. Đã đọc runtime release/secret/DB/CLI/service example và root admin owner checks. WSL systemd `running`; useradd có sẵn. Chưa ghi hệ thống hoặc dùng production.
- UPDATE08/11: Installer CLI/module/lab đã chạy systemd thật, account riêng và cleanup; native20 `23a1235e53c7` PASS. Sửa Linux path validation dùng posix (Windows test), dangling symlink dùng lstat thay existsSync; metadata/HTTP probe bounded, inspect kiểm private data và không chữa key/DB bị thiếu. Owner override chỉ từ root receipt/account, default verifier vẫn từ chối foreign UID. Chưa nối Desktop.
- HANDOFF-LOCAL08/11: **DONE checkpoint / CHỜ REVIEW** (chưa merge main),6/6 ledger PASS. Native cuối22 `ee362d752046`, full cuối1955/2skip/0fail. Bổ sung missing-lock guard và fchmod dưới umask077, chạy lại focused/native/type/lint/build/full trên source cuối. Fixture root/account/private group/unit đã dọn, không productionwrite. SHA `git log -1 -- app/src/main/controlPlane/controllerInstallation.ts`; push receipt ở ignored `app/.out-scripts/r3c6h2a-push-receipt.json` sau normal push.

CLI hiện cần **trusted host Node22** để chạy verifier/installer; fresh VPS chưa có Node sẽ cần Python bootstrap tin cậy ở transport checkpoint, verify bytes/pin trước khi dùng packaged Node. Không hướng user chạy candidate để tự verify hoặc dùng curl/npm/apt bằng root. `enable` đã chứng minh; reboot/soak của VPS cô lập và live rollout còn NOT_RUN, không reboot WSL/Docker host dùng chung trong gate này.

## Evidence và lệnh tái hiện

- Windows `. ./tools/enter-node22.ps1`: Node22.23.3. Linux build/lab Node22.23.4 tại `/home/everestt2806/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin/node`, modules approved `/var/tmp/opspilot-p3e3a-runtime/node_modules`. Linux cần `systemctl`, `flock`, `setpriv`, `getent`, `useradd`; không cài package trong runtime installer. Đã kiểm trên Ubuntu/WSL/glibc2.39; không hứa mọi distro hoặc glibc cũ.
- Payload hiện hành `/home/everestt2806/.cache/opspilot-r3c6h2a/payload/control-plane.cjs`, pin `719b3c3f95d2f4d3256b58814f04f884d5d5e96b0bbb700f5fbf72c18e737461`. Release `/home/everestt2806/.cache/opspilot-r3c6h2a/release`, pin `be4b729aab82eedaec2fe713a14fe423012cd2eee0e1bb6b80b9a128aea757be`,998files/144950794bytes/17approved production packages. Build bằng các script/biến môi trường tại [runtime README](../../app/control-plane-runtime/README.md).
- `OPSPILOT_CONTROL_PLANE_MODULES=<modules> OPSPILOT_CONTROLLER_RELEASE_OUTPUT=<release> OPSPILOT_CONTROLLER_RELEASE_PIN=<pin> <node22-root> app/scripts/controller-service-lab/run.mjs`: **22 PASS**. Receipt `app/.out-scripts/controller-service/ee362d752046/result.json`, log `app/.out-scripts/r3c6h2a-native-accepted.log`. Fixture `/opt/opspilot-controller-service-lab-<nonce>`/unit/account/private group đã xóa sau kiểm nonce/owner;0productionVPS/DB.
- Native có actual systemd start/enable/restart/stop, non-root UID/canonical argv/socket inode/health, data/key0700/0600, unit0644 dưới umask077; four real SIGKILL boundaries, cold inspect/recover, không đổi DB/key inode/identity,0VPS/app/deployment/job/schema028. Synthetic partial identity và missing key từ chối regen. Stopped service không tự start. Có inherited open-file-description lock, concurrent BUSY và held old inode +missing path từ chối tạo khóa mới.
- `pnpm --prefix app exec vitest run src/main/controlPlane/controllerInstallation.test.ts src/main/controlPlane/controllerBundle.test.ts src/main/controlPlane/controllerRelease.test.ts src/main/controlPlane/controllerHostPreflight.test.ts`: **97 PASS**; `app/.out-scripts/r3c6h2a-focused-final.log`.
- `NODE_PATH=<modules> OPSPILOT_CONTROL_PLANE_MODULES=<modules> OPSPILOT_CONTROLLER_RELEASE_OUTPUT=<release> OPSPILOT_CONTROLLER_RELEASE_PIN=<pin> <node22-nonroot> app/scripts/controller-release-lab/run.mjs`: **17 PASS**, `app/.out-scripts/controller-release/aed7a5749bf2/result.json` và `app/.out-scripts/r3c6h2a-release-regression.log`. Default owner policy/pinned SSH/cold packaged Node/native SQLite giữ nguyên.
- `OPSPILOT_CONTROL_PLANE_MODULES=<modules> OPSPILOT_CONTROLLER_INSTALLER_OUTPUT=<trusted-output.cjs> <node22> app/scripts/build-controller-installer.mjs`: standalone trusted installer không require external native modules. Final SHA256 `fe8d5095ad27801a9bda4805990c8cc82bdc4e427d5b5d089b83e04dafe1d3be`; build receipt `app/.out-scripts/r3c6h2a-installer-build.log`. Root CLI invalid JSON shape trả đúng `CONTROLLER_INSTALL_INPUT_INVALID`, không raw stderr hoặc technical traceback.
- Typecheck6: Node/Web (`--composite false`), scripts, product-runtime-lab, controller-release-lab, controller-service-lab; commands `pnpm --prefix app exec tsc --noEmit -p <tsconfig>`; Node/Web còn chạy trong `pnpm --prefix app build`. Build log `app/.out-scripts/r3c6h2a-build-accepted.log`.
- ESLint8files (installation/installation.test/installerCli/bundle/release TS, builder.mjs, lab entry.ts/run.mjs),0errors/0warnings: `app/.out-scripts/r3c6h2a-eslint-accepted.json`.
- `ml-service/.venv/Scripts/python.exe -m ruff check app/control-plane-runtime/controller_host_probe.py` và `-m ruff format --check ...`: **PASS**, Python source không thay đổi.
- Full `pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=default --reporter=json --outputFile=.out-scripts/release-r3c6h2a-vitest-accepted.json`: **1955 PASS/2 SKIP/0 FAIL**,147filesPASS/1SKIP,173.05s; report/log cùng tên. Hai Windows skip giữ nguyên Linux-only Caddy install transaction/real runtime. Không coi test count là PRODUCT_PASS.
- Electron screenshots **N/A**: không sửa UI/preload/IPC; mới nối Linux CLI installer, không dùng ảnh cũ làm bằng chứng one-click install.

## Các lỗi đã sửa trong phiên

- POSIX path phải được kiểm bằng `path.posix`, không dùng Windows resolve. GECOS account dùng prefix hyphen, không dùng dấu colon phân cách passwd.
- Tồn tại directory entry dùng lstat: symlink dangling không được coi là path trống để rename đè. Không tạo lại lock inode sau durable intent.
- Parent stdin deadline dừng ngay khi đọc xong, không cắt installation đang chạy; child env loại inherited config/credential. HTTP/proc/stdout/stderr bounded, chỉ stable errors.
- Umask077 với atomic file phải fchmod mode tường minh: unit0644, config/key0600. Real unit-reply-loss gate chứng minh recover không conflict nhầm mode.
- Cập nhật cleanup harness/lint; kernel lock/user/group/unit/private fixture đều dọn theo nonce, không có destructive operation trên production.

## Phần còn phải code

1. **6h2b:** typed SSH transfer có quota riêng cho gói145MB; fixed Python bootstrap xác minh Node/release/trusted-installer từ pin độc lập trước exec, không cần Node/npm sẵn trên fresh VPS. Main local journal giữ UUID/pin trước gửi, mất phản hồi inspect cùng key, không replay install mù.
2. Root-admin bridge kiểm root-owned install receipt/account/unit rồi drop UID tường minh trước existing verified admin CLI. Binding/vault ghi installation authority, không nới default owner policy hoặc tự suy UID từ arbitrary artifact. Service6h2a chưa quản trị được bằng form binding cũ.
3. Wizard Settings chọn VPS → preflight → review/consent → install/inspect/recover → bind → source/target/first deploy đã có; không bắt user nhập đường dẫn và pin artifact thủ công. User-mode service còn thiết kế/gate riêng.
4. Distribution/CI/build baseline/compatible libc và packaged Desktop assets; service sau reboot/soak trên host cô lập và live VPS nghiệm thu riêng. Không reboot môi trường dùng chung. Upgrade/uninstall/rebinding/rotation không được giả thành reinstall hoặc xóa DB/key.

R3 tổng/PRODUCT_PASS chưa đóng. Đây là service-install backend checkpoint, không phải toàn bộ luồng Desktop hoặc deployment đã hoàn tất. Không có accepted exception hoặc yêu cầu user test thay code chưa viết.
