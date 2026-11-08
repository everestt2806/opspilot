# R3c-6h2b1 — Chuyển release và bootstrap controller qua pinned SSH

START08/11/2026 — Base `729f809`, product-mode/task-discipline. User cho phép phát triển, private Linux lab và normal checkpoint commit/push; không production VPS/DB/PR/merge.

| Yêu cầu | Kiểm chứng | State |
|---|---|---|
| Contract trước code | `product-controller-ssh-bootstrap.ts` + DECISIONS; framed header/manifest/raw file/one-byte ACK, consent/immutable UUID/pins và strict metadata; client17 tests PASS | PASS |
| Chuyển gói an toàn | Main local verify + expected/current identity, immutable root staging/file-level resume; native25 actual145MB, giữ committed Node inode, repeat không gửi file bodies; foreign UUID/file/lock/corrupt metadata bị từ chối | PASS |
| Fresh-host bootstrap | Python independent verifier + packaged Node/fixed trusted installer; native25 Python-only SSH PATH chạy systemd/non-root/schema028/0VPS/app/job; tamper Node/tool bị chặn trước execution | PASS |
| Recovery và giới hạn | Lost install reply→only1exec→new SSH inspect installed/running, interrupted transfer và SIGKILL trước namespace rename→same-key resume; readonly inspect không restart stopped service;17 client tests +native25 | PASS |
| Gate | Final full1972PASS/2Linux-onlySKIP/0FAIL (148filesPASS/1SKIP,208.19s); focused114/client17/native25/typecheck7/lint4/build/Ruff PASS; không production | PASS |
| Handoff | Board/HANDOFF/FR/master release cùng checkpoint,14files review/diff sạch/0sensitive patterns/4relative links hợp lệ. Kim co-author và normal checkpoint push được user cho phép; chưa PR/merge, GUI còn phải code | PASS |

## Phạm vi

6h2b tách transport/bootstrap CLI backend trước (6h2b1), sau đó Main durable installation journal + root-admin bridge/binding authority, rồi wizard. Checkpoint này không đưa nút Install chưa có journal vào GUI. API chỉ nhận artifact catalog tin cậy và UUID của caller; không public renderer IPC/generic command. Không đổi canonical controller DB, không thêm dependency/migration.

Chọn gửi raw bytes sau từng file header/ack để dùng SSH backpressure, tránh tar extraction và hàng nghìn round-trip nhỏ cho Node binary. Root namespace singleton giữ UUID/pins; file đã commit chỉ được reuse khi hash đúng, file tạm riêng được bỏ khi resume; không chạm DB/key/service khi chỉ transfer. Python verify độc lập trước Node, không execute candidate để tự chứng minh an toàn. Lab inject fixed paths/pinned script/trusted fixture installer bằng harness, không có JSON override trong production.

## Nhật ký

- START08/11: tracked tree sạch tại729f809. Đọc installer/release gates và SshManager expected-identity/no-reconnect channel. Chưa dùng production hoặc sửa runtime khác.
- UPDATE08/11: fixed Python/client + raw stream đã chạy actual SSH/service qua lab `06b3139d8c8b`,13checks PASS; staging-only transfer không tạo DB/unit, Node file resume giữ inode và không gửi lại125MB. Client14 tests/type/lint và Python Ruff đạt. Đang mở rộng ca fault/strict replies rồi chốt gate cuối; không nâng thành Desktop installer.
- HANDOFF-LOCAL08/11 — **DONE checkpoint / CHỜ REVIEW** (chưa merge main), ledger6/6 PASS. Final native25 `e91f77437dd9`, client17/focused114/full1972/2skip/0fail/typecheck7/lint4/build/Ruff PASS. Source và constraints đã đối chiếu lại; không có accepted exception. SHA `git log -1 -- app/src/main/controlPlane/controllerSshBootstrap.ts`; normal push receipt trong ignored `app/.out-scripts/r3c6h2b1-push-receipt.json` sau khi push/đối chiếu remote.

## Bằng chứng và lệnh tái hiện

- Bắt đầu tại `729f809`; giữ nguyên controller SQLite/schema028, dependencies, IPC và UI. Root bootstrap intent chỉ chứa key/pins/sizes của installation trước DB, tương tự approved6h2a; không nguồn sự thật app/job/credential khác.
- Windows gates: `. ./tools/enter-node22.ps1` (Node22.23.3). Linux lab: Node22.23.4 `/home/everestt2806/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin/node`; approved modules `/var/tmp/opspilot-p3e3a-runtime/node_modules`.
- Release nguồn `/home/everestt2806/.cache/opspilot-r3c6h2a/release`, independent pin `be4b729aab82eedaec2fe713a14fe423012cd2eee0e1bb6b80b9a128aea757be`,998manifest files/144950794bytes/17production packages; payload pin `719b3c3f95d2f4d3256b58814f04f884d5d5e96b0bbb700f5fbf72c18e737461`. Không đưa Node/node_modules vào Git.
- `OPSPILOT_CONTROL_PLANE_MODULES=<modules> OPSPILOT_CONTROLLER_RELEASE_OUTPUT=<release> OPSPILOT_CONTROLLER_RELEASE_PIN=<pin> <LinuxNode22-root> app/scripts/controller-bootstrap-lab/run.mjs`: **25 PASS**, receipt `app/.out-scripts/controller-bootstrap/e91f77437dd9/result.json`, log `app/.out-scripts/r3c6h2b1-native-accepted.log`.
- Native thật: pinned SSH2 channel, raw145MB upload, Python-only PATH (Python từ hệ thống, không có node trong PATH), no apt/npm/curl; packaged Node được Python xác minh trước chạy trusted fixture installer. Actual systemd unit/account riêng và root-owned staging nằm trong nonce fixture,0productionVPS/DB. Đây không phải chứng minh OS đã gỡ Node toàn máy; helper dùng absolute packaged Node, không lookup host Node.
- Fault cases: wrong local tool pin0auth/exec; wrong SSH pin0auth; authority đổi sau channel-open0header/file; receiver không-root bị từ chối; raw malformed manifests (traversal/quota/dev package) bị chặn dù supplied digest khớp. Real SIGKILL sau intent trước atomic rename rồi resume; abort giữa upload rồi giữ Node inode, payload gửi lại<20MiB; repeat chỉ gửi manifest payload. Metadata bool-version sai, concurrent flock, missing lock path và unknown staging file đều không được adopt/repair/xóa.
- Node/tool hash tamper bị từ chối trước installer, không data/unit mới. Inspect trước install trả definite NOT_FOUND, không tạo installer state. Mất installation response sau systemd ready chỉ1exec; client mới chỉinspect thấy installed/running/enabled/non-root, canonical DB0VPS/app/deployment/job/version28. Stop rồiinspect không tựstart.
- Fixture account/private group/unit/root và preparation directory đã được kiểm nonce/owner rồi dọn; ephemeral SSH keys chỉ trong memory, không commit/log. Native driver có fixed path/script/test installer composition seam, không có runtime JSON override trong production protocol.
- Focused: `pnpm --prefix app exec vitest run src/main/controlPlane/controllerSshBootstrap.test.ts src/main/controlPlane/controllerInstallation.test.ts src/main/controlPlane/controllerBundle.test.ts src/main/controlPlane/controllerRelease.test.ts src/main/controlPlane/controllerHostPreflight.test.ts`: final114 tests (17 client +97 regression), log `app/.out-scripts/r3c6h2b1-focused-final.log`.
- Typecheck7: Node/Web (`--composite false`), scripts, product-runtime-lab, controller-release-lab, controller-service-lab, controller-bootstrap-lab; `pnpm --prefix app exec tsc --noEmit -p <project>`. Build `pnpm --prefix app build`, log `app/.out-scripts/r3c6h2b1-build-accepted.log`.
- ESLint4files (client/client.test/lab entry.ts/run.mjs)0errors/0warnings: `app/.out-scripts/r3c6h2b1-eslint-accepted.json`. Ruff lint/format cho `app/control-plane-runtime/controller_ssh_bootstrap.py` PASS.
- Full `pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=default --reporter=json --outputFile=.out-scripts/release-r3c6h2b1-vitest-accepted.json`: **1972 PASS/2 SKIP/0 FAIL**,148filesPASS/1SKIP,208.19s; report/log cùng tên. Hai Windows skip là các case Linux-only Caddy cũ, không tự tính là live PASS.
- Electron screenshots **N/A**: không UI/preload/IPC change, không nút giả. Backend mới được gọi bằng trusted CLI lab; Main journal/admin bridge/wizard chưa nối.

## Các chỉnh sửa qua kiểm chứng

- Per-file ACK byte giữ một outstanding response cả khi reuse, tránh server đẩy hàng nghìn ACK cùng lúc; large file stream dùng SSH backpressure, không round-trip mỗi64KiB.
- Client xử lý close-before-wait, unknown sau dispatch, strict frame/key/count/installation-state và immutable locator snapshot; không echo raw remote data/stderr. Overall deadline có fake-clock test, timer/abort listeners được dọn.
- Root namespace dùng renameat2 NOREPLACE và fsync, bounded same-key preparation recovery; committed file không overwrite, partial riêng chỉ bỏ sau owner/nlink/size check. Không tạo lại missing lock. Python format phải int1, không chấp nhận boolTrue bị so bằng1.
- Lỗi installer chỉ map exact stable NOT_FOUND/BUSY/CONFLICT; các lỗi khác trả INSTALLER_FAILED, không chuyển raw CLI stderr. Không auto reconnect/replay, không regenerate DB/key.

## Phần còn phải code

1. **6h2b2:** Main durable installation journal trong Desktop SQLite: UUID/pins/artifact catalog và current VPS/cipher/security revision trước SSH, intent/dispatch/unknown/tombstone/cold recovery. Không đưa API ghi này qua IPC/UI trước khi journal xong. Metadata inspection/discovery cần nhận diện installation đã tồn tại khi người dùng đăng ký lại VPS, không tạo UUID mới để né namespace cũ.
2. Root-admin bridge kiểm root-owned transfer/install receipts + Unix account/unit rồi drop UID trước existing admin CLI; vault/binding ghi rõ installation authority. Form binding cũ chưa admin được service mới; không nới default owner policy hoặc inferUID từ arbitrary path.
3. Wizard Settings: VPS → requirements/preflight → review/consent → transfer/install/status/recover → bind → source/target/firstdeploy. Một review có thể cấp consent cho toàn kế hoạch đã xem; không hỏi lặp vô ích, nhưng recover sau unknown phải explicit.
4. Trusted distribution/CI/packaged Desktop assets + supported libc baseline, upgrade/uninstall/rotation/user-mode service và live VPS/reboot/soak cần checkpoint/gate riêng. SSH ban đầu và Python3 stdlib/util-linux/systemd/root quyền phải có; helper không cài OS packages hoặc mở firewall public.

Không có accepted exception. R3 tổng/PRODUCT_PASS chưa đóng; checkpoint này hoàn thiện transport/bootstrap backend, không tuyên bố Desktop one-click install hoặc deployment đã chạy trên VPS thật.
