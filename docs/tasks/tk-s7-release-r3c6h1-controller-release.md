# R3c-6h1 — Gói runtime Linux và kiểm tra máy cài controller

START08/11/2026 — Tiếp `956ff2b`, product-mode/task-discipline. User cho phép phát triển và normal checkpoint commit/push; không productionwrite/PR/merge. Rà source xác nhận chưa có installer: chỉ offline CLI bundle và systemd examples. Không nối nút Install vào lệnh chưa triển khai.

| Yêu cầu | Gate | State |
|---|---|---|
| Contract-first | `product-controller-release.ts` + DECISIONS; không public API, dependency mới, migration hoặc IPC/UI. Kiểm đối chiếu builder/verifier/probe và focused52 PASS | PASS |
| Gói Linux độc lập | Linux x64/Node22.23.4/glibc2.39, approved17 production packages, 998 files/144950541 bytes. Ba build cùng pin; cold Node/native SQLite/CLI init/status chạy bằng UID1000, không NODE_PATH/global modules | PASS |
| Kiểm tra release | Passive exact file/hash/size/mode/ELF/platform/lock/catalog/bounds; native17 và focused52 gồm sai pin, Windows/ARM bytes, symlink/hardlink, group/world write, không overwrite và dependency version drift | PASS |
| Host preflight | Real localhost pinned SSH dùng SshManager và fixed readonly Python; OS/arch/libc/RAM/disk/UID/systemd/conflicts; pin sai không tăng auth/exec. WSL user báo blocked SYSTEMD đúng thực tế, không enable linger hoặc sửa máy | PASS |
| Kiểm chứng thực | Final full1931PASS/2Linux-onlySKIP/0FAIL (146filesPASS/1SKIP,188.48s); focused52/native17/5types/lint8/build/Ruff PASS. Không production DB/VPS | PASS |
| Gate và hồ sơ | Board/HANDOFF/FR/release cùng checkpoint;18file review/diff sạch/0sensitive patterns/5relative links hợp lệ. Commit body co-author Kim, normal checkpoint push được user cho phép; không PR/merge | PASS |

## Quyết định phạm vi

Chọn gói offline có Node/native dependencies được kiểm trên Linux, thay vì curl/npm/apt bằng root từ Desktop hoặc copy node_modules Windows. Gói là directory có manifest và independent SHA; transport/extract/service transaction/UI activation là6h2 tiếp theo, không gọi6h1 là đã cài controller. Build artifact không commit binary Node hoặc node_modules vào Git; developer/CI dựng gói bằng CLI có cùng lock đã duyệt. Chưa thêm dependency/migration/IPC/UI.

## Nhật ký

- START08/11: tracked tree sạch tại956ff2b. Đọc ADR011/roadmap/bundle verifier/runtime lock/service examples. Chia installer thành release+preflight trước, rồi owned install/recovery/systemd và wizard. Không yêu cầu user test thay code còn thiếu.
- UPDATE08/11: Build Linux đầu tiên bắt gặp hardlink do node-gyp trong trusted modules tree. Builder đọc snapshot nguồn đã tin và copy bytes sang inode mới; verifier release vẫn bắt buộc nlink1. Không thay dependencies hoặc nới verifier candidate. Build thành công998files, independent pin9f387f46ea5d53d8b0dff65cd27c74ee6d2a7cfb79b1a43e606b024fc2675325; cold-process proof tiếp theo.

## Evidence và lệnh tái hiện

Hướng dẫn build và giới hạn: [runtime README](../../app/control-plane-runtime/README.md).

- Windows gates dùng `. ./tools/enter-node22.ps1` (Node22.23.3). Linux builder/lab dùng Node22.23.4 tại `/home/everestt2806/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin/node`, approved modules `/var/tmp/opspilot-p3e3a-runtime/node_modules`.
- Payload: `OPSPILOT_CONTROL_PLANE_MODULES=... OPSPILOT_CONTROL_PLANE_OUTPUT=/home/everestt2806/.cache/opspilot-r3c6h1/payload/control-plane.cjs <node22> app/scripts/build-control-plane.mjs`. Payload pin `a57c3323613b90d6b48a0616b2f99ccf0c38da97f5335f70b413e9397e5b610a` (CLI runtime không đổi).
- Release: `OPSPILOT_CONTROL_PLANE_MODULES=... OPSPILOT_CONTROLLER_RELEASE_ARTIFACT=<payload.cjs> OPSPILOT_CONTROLLER_RELEASE_PAYLOAD_PIN=<payload-pin> OPSPILOT_CONTROLLER_RELEASE_OUTPUT=<fresh-private-parent>/release <node22> app/scripts/build-controller-release.mjs`. Artifact cuối `/home/everestt2806/.cache/opspilot-r3c6h1/release-accepted`; manifest pin `9f387f46ea5d53d8b0dff65cd27c74ee6d2a7cfb79b1a43e606b024fc2675325`. Không commit binary hoặc node_modules.
- `NODE_PATH=<approved modules> OPSPILOT_CONTROL_PLANE_MODULES=<approved modules> OPSPILOT_CONTROLLER_RELEASE_OUTPUT=<release-accepted> OPSPILOT_CONTROLLER_RELEASE_PIN=<release-pin> <node22> app/scripts/controller-release-lab/run.mjs`: **17 PASS**, receipt `app/.out-scripts/controller-release/f19a4f5af76e/result.json`, log `app/.out-scripts/r3c6h1-native-accepted.log`.
- Cold child dùng chính `<release>/node`, cwd `/`, env chỉ PATH/HOME; native SQLite CREATE/INSERT/SELECT, ssh2/tar/zod, init/status và từ chối re-init. Fixture có migrations1..28,40 bảng ứng dụng (+sqlite_sequence),0VPS/0app/0deployment/0Product job; không key/credential được nạp vào DB.
- Unit: `pnpm --prefix app exec vitest run src/main/controlPlane/controllerRelease.test.ts src/main/controlPlane/controllerHostPreflight.test.ts`: **52 PASS**, `app/.out-scripts/r3c6h1-focused-final.log`.
- Typecheck: `pnpm --prefix app exec tsc --noEmit -p <project>` với `tsconfig.node.json --composite false`, `tsconfig.web.json --composite false`, `tsconfig.scripts.json`, `scripts/product-runtime-lab/tsconfig.json`, `scripts/controller-release-lab/tsconfig.json`: **5 PASS** (Node/Web còn chạy lại trong build).
- ESLint8files: `controllerRelease{,.test}.ts`, `controllerReleaseBuilder.ts`, `controllerHostPreflight{,.test}.ts`, builder.mjs, lab entry.ts/run.mjs; **0 errors/0 warnings**, `app/.out-scripts/r3c6h1-eslint-accepted.json`.
- `ml-service/.venv/Scripts/python.exe -m ruff check app/control-plane-runtime/controller_host_probe.py` và `-m ruff format --check ...`: **PASS**.
- `pnpm --prefix app build`: **PASS**, `app/.out-scripts/r3c6h1-build-accepted.log`.
- Full `pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=default --reporter=json --outputFile=.out-scripts/release-r3c6h1-vitest-accepted.json`: **1931 PASS/2 SKIP/0 FAIL**,146filesPASS/1SKIP,188.48s. Hai skip là Linux-only Caddy install-transaction và real-runtime cases trên Windows, không đổi gate thành live proof. Log `app/.out-scripts/release-r3c6h1-vitest-accepted.log`.
- Electron screenshots **N/A**: không sửa UI/preload/IPC hoặc packaged Desktop resources; kiểm chứng native mới là cold Linux/SSH. Không tái dùng ảnh fixture làm bằng chứng installer.

## Các gate lỗi đã sửa, không miễn trừ

- Builder từ chối node-gyp source hardlink ban đầu; chỉ trusted build read cho phép snapshot hardlink, output inode mới bắt buộc nlink1. Hai build cuối có cùng manifest pin.
- Test mock typing và một ca race emit stderr trước gắn listener đã sửa; focused52 và Node typecheck cuối PASS. Lab dùng `disconnectAll`/await cleanup; không dùng API dispose không tồn tại.
- SQLite có41 bảng nếu tính sqlite_sequence,40 bảng ứng dụng; lab kiểm rõ migrations1..28 và0VPS/app/deployment/job, không nới schema.
- Ruff từ chối catch-all và format Python; đổi sang các exception cụ thể và format chuẩn, gate cuối PASS. Không có accepted exception.
- Review cuối bổ sung strict string cho ABI/glibc/version/payload pin, tránh JSON number/array được RegExp ép kiểu. Focused52, native17 và toàn suite1931 đều chạy lại trên final source. Không sửa runtime/dependency/schema ngoài phạm vi.

HANDOFF-LOCAL08/11 — **DONE checkpoint / CHỜ REVIEW** (chưa merge main). Ledger6/6 PASS;
18files/0secret patterns/5links hợp lệ. Trusted build cần Linux x64/glibc + Node22 và modules cài từ approved lock; không coi đây là bộ cài cross-platform hoặc service đã được kích hoạt. Không có lỗi kế thừa được miễn trừ. Gate/push receipt giữ trong ignored `app/.out-scripts/r3c6h1-*.json`; SHA dùng `git log -1 -- app/src/main/controlPlane/controllerRelease.ts` để không tạo self-reference trong commit.

## Điểm nối R3c-6h2 (code còn phải làm)

1. Transport release có giới hạn riêng (gói khoảng145MB vượt quota64MiB của source upload), pin phải từ trusted distribution. Không dùng candidate để tự xác nhận; copy/verify staging riêng, journal/receipt/recovery cùng UUID, không ghi đè installation lạ.
2. Chốt quyền admin/runtime UID: root install phải chạy controller bằng account riêng; fixed SSH admin hiện kiểm cùng UID nên cần thiết kế explicit privilege drop/owner verification, không nới owner checks hoặc chạy service root để né. Non-root cần user bus/linger thật; không bật tự động từ probe.
3. Transaction cài service/init key/DB chỉ sau user xác nhận; private paths, no overwrite/rotation, crash/lost reply chỉ inspect receipt, service start/status/restart/reboot và cleanup owned resources trong Linux systemd lab.
4. Wizard Desktop chọn VPS → probe/giải thích blocker → review/consent → install/status → đăng ký binding bằng vault/journal hiện có. Không bắt user nhập artifact/data/node/pin thủ công trong happy path; lỗi không tự fallback CLI hoặc báo running khi chưa kiểm.
5. Nối đóng gói asset vào Desktop/CI sau khi distribution/installer qua gate; live VPS, rotation/rebinding, soak, các template khác/HTTPS/migrate/ML vẫn có checkpoint riêng. R3 tổng/PRODUCT_PASS chưa đóng.
