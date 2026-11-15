# R7h-3d3 — Release đã duyệt và env rollout trên development VPS

START15/11/2026 — Base257d2cf, product-mode/task-discipline. User cho phép triển khai/phát triển trên VPS167.71.202.116 và normal checkpoint push/Kim coauthor. Không PR/merge/force/reset/clean/stash/rebase; giữ personal untracked. Credential chỉ stdin/RAM/DPAPI private recovery, không argv/env/plaintext file/log/Git. Pin ED25519 lấy độc lập giữ nguyên; không TOFU hoặc đổi old catalog/target pins để đi tắt.

UPDATE15/11 — Chia checkpoint trước mutation: **R7h-3d3a = onboarding env + final candidate/local acceptance + readonly VPS attestation**; **R7h-3d3b = protected upgrade trên VPS + actual env app acceptance**. Phát hiện gap dọc nên không đưa candidate ban đầu1a8a lên VPS. Giữ artifact ban đầu trong ignored archive, refreeze candidatev2 từ code sửa. Chưa coi whole3d3 hoặc whole release DONE; các dòng protected/live dưới đây vẫn OPEN cho3b.

| Yêu cầu | Gate | State |
|---|---|---|
| Freeze và approved packaging | Build Linux Node22.23.4/approved lock từ source checkpoint3a (base257d2cf; file hashes trong proof), độc lập release/payload/tool SHA. Root systemd upgrade18checks với exact candidate, giữ old resources; Main catalog6entries, missing/tamper/resource verifier/build/type gates | PASS |
| Fresh VPS authority trước mutation | Pinned SSH, đúng controller dc586bb7/installation7573f0b1/current parent releaseb680/upgrade4c90a650, schema29/UID997;4app/8CID, key/DB inode, paused policies/0active jobs-experiments-leases-unsettled terminals/clients. Ghi attestation metadata không credential | PASS |
| Protected Main upgrade | Private DPAPI Main profile, adopt existing authority, temporary scoped client, same-UUID transfer/upgrade/inspect/recovery; backup Root seal +29→35 trước candidate activation, binding refresh giữ client/token. Old app/collector/key/DB/receipt/target material giữ nguyên | OPEN |
| Actual env application rollout | New env-capable target, stage/select qua Main, actual first/update/build-health failure/exact-CID rollback và public verification; runtime values không vào build context/image/log/report. Không tự sửa helper cũ, không overwrite app cũ; pause/revoke/private cleanup | OPEN |
| Handoff và checkpoint | Raw/source hashes, scoped/full/types/lint/build/native proof; board/FR/master/HANDOFF cùng commit, normal push và remote SHA verify. Existing-target helper updater/PG/whole release còn OPEN | OPEN |
| Nối desired env với onboarding/first deploy | Phát hiện khi audit: source authority chỉ nhận config gốc, source preflight thiếu metadata resolver, Main dùng registration generation cũ. Giữ receipt gốc bất biến; derive current source qua review neo basis, recheck sau await; preflight chỉ nhận authenticated metadata, runtime vẫn cần claim. Test source2, binding sai và consent/CAS race trước refreeze release | PASS |

Trình tự: freeze → Root lab (không chạy song song Windows ControllerService/full suite vì cùng8768) → Main packaging/tamper → fresh readonly VPS attestation → protected upgrade → new app env gate → cleanup/handoff. Không lấy local gates làm proof VPS. Nếu mất reply, inspect cùng UUID, không tự replay write hoặc restore backup lên live DB. Dừng mutation khi authority/quiescence lệch; tiếp tục điều tra/read-only hoặc xử lý trong phạm vi được phép.

## Phạm vi 3a và điểm tiếp nối 3b

- `ProductEnvironmentPreflight` chỉ trả authenticated metadata; kiểm source/hash/controller/owner/revision/target và AES envelope. Preflight dùng key names, không trả values, không tạo signed runtime env-file hoặc execution claim. Required/public keys vẫn được kiểm; dự trù160KiB cho env/public render, runtime vẫn kiểm quota thật.
- Source authority chấp nhận đúng canonical environment reference, không chấp nhận thêm plan field tùy ý. Verify sau Git wait vẫn kiểm authority/transaction/quiescence và observation CAS; giữ nguyên mã lỗi khi queued work hoặc caller transaction đến giữa chừng.
- Main giữ registration generation1 bất biến. Khi có durable selection journal, lấy current source qua review neo basis cho verify/enroll/readiness, kiểm lại sau await và trước send. Không có local selection journal thì giữ đường retained/env-free; thay đổi nguồn từ bên ngoài vẫn bị server CAS từ chối, không tự adopt.
- Main upgrade fixture sửa expected Desktop031 lịch sử thành036, giữ initial controller029; không nới production schema guard. Không claim GUI tương tác hoặc VPS upgrade từ lab này.
- Readonly CLI nhận credential qua stdin không echo, dùng SshManager pin sẵn và command cố định, không truyền credential qua argv/env/file. Chạy trực tiếp Node22 cho inspect; wrapper Electron-as-Node không cung cấp TTY stdin trên môi trường này, không dùng nó để nhập password.
- **3b bắt đầu bằng attestation mới**, không dùng lại snapshot cũ làm quyền mutation. Adopt current installation bằng review/confirm; client tạm scoped, durable UUID, backup29 Root seal trước apply35; inspect khi mất reply. Rebind giữ token/client, kiểm old4app/8CID/key/DB inode/receipt/target material. Sau đó mới tạo app env-capable riêng, stage/select qua Main, first/update/build-health failure/exact-CID rollback, kiểm runtime values không lọt image/build/log; pause/revoke/cleanup. Không nâng helper cũ hoặc đổi enrollment pins ngầm.

## Artifact và cách tái hiện

Candidate `linux-x64-node22-20261115-environment-v2`: payload manifest `c1106b10eee233e5802aa8fc141b4acccafe2c0e924ed3a984d43fe03b7a9392`, release `db1e58c83badef0c7efca42b78fff483d71cc38bdd711a635924d0849b41bdb8`, installer `e02bc14aa115423441eceb789405a7c5d6ce3a43d50d5d6ffd5102acbc74b336`. Linux Node22.23.4/glibc2.39/approved dependency lock,998files/145121805bytes. Không đổi năm approved entries cũ; catalog Main có6entries.

Build Linux bằng `app/scripts/build-control-plane.mjs`, `build-controller-release.mjs`, `build-controller-installer.mjs` với approved modules như các checkpoint trước. Stage đúng pins bằng `stage-controller-resources.mjs --release <release> --installer <installer.cjs> --release-pin <release SHA> --installer-pin <tool SHA> --id linux-x64-node22-20261115-environment-v2`; entry generated thêm `upgrade_supported:true` đúng descriptor mới. Resources/binary145MB vẫn ignored, không đưa vào Git hoặc bỏ verifier khi máy khác chưa có artifact. Final packaging/distribution thuộc release gate riêng.

Readonly: Node22 `node app/scripts/product-environment-live/inspect.mjs --inspect-only`, chờ `PRIVATE_INPUT_READY_NO_ECHO`, nhập JSON qua stdin đã tắt echo. Không ghi JSON credential vào shell history hoặc file. Snapshot chỉ metadata/hash, không Docker Config.Env/credential/ciphertext; chưa thực hiện upgrade/deployment.

## HANDOFF-LOCAL15/11 — R7h-3d3a

Status: DONE cho **3a**; whole3d3/3b vẫn OPEN. Push checkpoint bình thường được user cho phép; không PR/merge. SHA lấy bằng `git log -1 -- app/src/main/controlPlane/productEnvironmentPreflight.ts` để tránh self-reference trong commit.

| Ledger 3a | Check cuối trên source hiện hành | State |
|---|---|---|
| Source verification với desired env, không cấp execution capability |5 onboarding tests +2 first-deploy/CAS tests mới; production CLI/public Git5checks, source SHA257d2cf, không job/deployment/values trong kết quả | PASS |
| Main lấy selected generation, giữ receipt và kiểm consent/race | Full2447PASS/2existing Linux-only SKIP; cold reopen, target/repo drift, source đổi trong readiness hoặc trước send đều từ chối | PASS |
| Runtime cũ và env vẫn hoạt động sau refactor preflight |43 Docker cases: Express10, SPA13, Next13, env-free7; image không có runtime values, rollback giữ đúng CID app/collector/config, cleanup namespace PASS | PASS |
| Final candidate an toàn để tiếp tục thử protected upgrade | Root18/Main19 native Linux systemd/SSH/SQLite với candidate db1e58c; cleanup unit/account/root. Main catalog6, thiếu/tamper từ chối và khôi phục file gốc; types/scripts/3lab types/lint0warnings/Prettier/Ruff/build PASS | PASS |
| Fresh readonly VPS baseline và handoff | Snapshot1ab81bf2d2de giống hệt f6fb3e50b295: controller/install/current4c90/b680, UID997, schema29,4apps/8CIDs/0active jobs-experiments-clients-leases; HTTP200 ở30000–30003. Không mutation. Proof/source/raw hashes và board/FR/master/HANDOFF cùng checkpoint | PASS |

Commands và actual exit code: `app/.out-scripts/r7h3d3-quality/results.json` (8gates), `r7h3d3-extra-quality/results.json` (6gates); bản portable trong `docs/ui-redesign/r7h3d3a-verification.json`. Reproduce unit gate: Node22, `pnpm --prefix app exec vitest run --maxWorkers=3`; typecheck/scripts/lab configs và build như proof. Full177files PASS/1Linux-only file SKIP,2447tests PASS/2SKIP. JSDOM canvas/computedStyle diagnostics có sẵn, không che test failure.

Native records: `controller-upgrade/d3bbddf03619` (18checks); `controller-upgrade-desktop/9b36bae85bd0` (19checks); `environment-target-capability/ed9fb19fff51` (5checks). Runtime reports được liệt kê cùng SHA trong proof. Setup đầu của native capability thất bại do artifact owner/dependency path; sửa riêng wrapper ignored để copy vào Root namespace có approved dependencies, không nới production verifier hoặc Python env sanitization. Style gate ban đầu báo test file, đã format và chạy lại final gates PASS; không có accepted exception.

**Việc tiếp theo R7h-3d3b:** chưa có deployment env thật qua Main/VPS, chưa upgrade VPS. Fresh attestation lại trước mutation; không dựa vào catalog/local Docker để đánh dấu live DONE. Dùng protected upgrade và durable UUID hiện hành, giữ old4apps/8CIDs, Root backup29 sealed, migrate35, explicit binding refresh giữ token/client. Chỉ app mới với helper env-capable; thực hiện first/update/build-health failure/exact-CID rollback, xác minh public/runtime/image rồi pause/revoke/cleanup. Khi unknown chỉ inspect cùng UUID; không tự replay, sửa pin, restore backup lên live DB hoặc hạ schema sau khi đã có env data.
