# R3c-6h2c — Controller onboarding trong Settings

START10/11/2026 — Base `a074262`, product-mode/task-discipline. User yêu cầu tiếp tục và cấp VPS mới; được triển khai/lab/checkpoint commit/push, không PR/merge hoặc reset/clean/stash/rebase. Không secret trong source/test/report/argv/env. Pin do user cung cấp được đối chiếu trước SSH authentication; nguồn pin phải ghi đúng, TCP/banner không phải xác minh host.

| Yêu cầu | Gate nhận | State |
|---|---|---|
| Resource/catalog trước GUI | Windows staging/packaging hook PASS; actual Windows sender→Linux receiver/systemd PASS, pins bake vào Main và fixed resources; Linux owner policy không đổi, thiếu/tamper bị chặn | PASS |
| Contract/IPC |9 typed channels + Main-derived input/current authority, preflight không mutation; same-installation binding UUID reuse trong IMMEDIATE transaction, không migration; focused backend66 và IPC composition PASS | PASS |
| Settings wizard |11 tests PASS + real Electron19 checks/18 ảnh,4locale/2theme/2size; review/consent/lost reply/inspect/rebind/stopped-service/closing guards; legacy panel PASS | PASS |
| Proof | Full2047PASS/2Linux-onlySKIP/0FAIL; backend66/UI11/IPC+legacy regressions; actual Windows→VPS10 checks và Electron19; final type/lint/build/Ruff/packaging evidence bên dưới | PASS |
| VPS mới | User gửi3fingerprints sau khi chọn tự đăng nhập (đã giải thích TOFU vs console); Agent pin ED25519 trước auth, readonly SSH PASS: Ubuntu24.04/glibc2.39/2CPU/4GB/80GB/systemd,0write; chưa Docker/controller | PASS |
| Handoff | Board/HANDOFF/FR/master release cùng checkpoint; source/contract/resources/proof review, Kim co-author và normal push; SHA tra bằng `git log -1 -- app/src/renderer/src/components/ControllerInstallWizard.tsx` | PASS |

## Phạm vi và giả định

- Windows Desktop không phụ thuộc WSL/host Node/npm để gửi gói Linux. Gói prebuilt do trusted developer/CI build, catalog/pins gắn Main build; binary nằm trong packaged resources, không Git. App thiếu gói phải giải thích rõ và không cho cài với pin người dùng tự nhập.
- Receiver Python/Linux installer giữ nguyên policy owner/mode/hash/catalog độc lập. Sender verifier chỉ đọc bytes và kiểm file/path/stability/pins; Windows không giả lập Unix ownership làm quyền remote.
- Cài controller cần root/Linux-x64/glibc/Python3/systemd/util-linux hiện có. Không tự đổi OS hoặc mở API public. Supported libc phải lấy từ release đang đóng gói; không quảng cáo mọi Linux.
- Chọn cùng remote UUID sau discovery/cold unknown; rebind explicit và binding mới chỉ từ installed journal/current authority. Thực hiện mutation trong kế hoạch user đã review, recover sau unknown phải explicit.
- Nếu cần checkpoint prerequisite resource trước UI, ghi rõ evidence và phần chưa code; không dùng nút disabled để gọi wizard hoàn tất.

## Nhật ký

UI direction: modal trong Settings, palette/type kế thừa Ant Design/theme hiện hành;4bước có ý nghĩa thực, khoảng cách24/16/8, một form VPS rồi review tài nguyên/trạng thái và hành động phục hồi. Không ảnh trang trí/font/theme mới. Cửa sổ1280×800/1366×768 dùng body cuộn dọc và wrap labels, focus/keyboard mặc định AntD. Review brief: giữ sản phẩm desktop đã được user chốt, không biến wizard thành landing page/card dashboard hoặc bắt nhập technical paths.

- START10/11: tracked tree sạch tạia074262. Đọc CLAUDE/ADR011/roadmap/contracts và current install journal/admin; root bridge đã có native44/full2020 trước đó, không dùng làm gate của source mới.
- VPS10/11: TCP22 mở và trả OpenSSH9.6p1 Ubuntu banner. Đã hỏi console fingerprints qua async input; không gửi password, không tự học key hoặc tin network-only fingerprint. Local implementation độc lập tiếp tục.
- VPS UPDATE10/11: user chọn tự đăng nhập và gửi ECDSA/ED25519/RSA pins sau khi được giải thích xác minh độc lập vs trust-first-use. Dùng ED25519 user-provided pin, SSH verified trước password; readonly inventory PASS, hostname khớp panel, Ubuntu24.04.5/glibc2.39/x86_64/uid0/2CPU/RAM4106088448bytes/disk82086711296bytes, Docker/controller paths absent. Credential chỉ qua hidden prompt→stdin/RAM, không source/argv/env/report. Không gọi pin này là provider-console attestation.
- Resource UPDATE10/11: existing release/bundle verifiers đã có Windows branch, không cần nới Linux owner policy. Thêm protected build-time catalog + passive resource manager/staging CLI/packaging gate, current focused38 PASS (catalog8/release30). Đang stage Linux prebuilt assets để Windows Main gửi bằng SDK hiện hành trước IPC/UI.

- UPDATE10/11: hoàn tất typed IPC/Main preflight và Settings wizard;9 channels không nhận path/pin/UID/command. UUID binding do Main cấp và reuse nguyên tử cho cùng installation/current revision; trường hợp trùng nhiều binding hoặc đổi scope/name trả conflict. Không thêm migration, giữ029/41tables. Shared IPC DTO được copy từ canonical contract để CLI `rootDir: app` không kéo source docs ra ngoài.
- UPDATE10/11: build Linux payload current029, release998files và installer CJS; stage vào Windows assets sau passive hash/ELF check. Main bake catalog/pins lúc build, không đọc lại JSON để học pin khi chạy. Actual packaging hook đã require verifier entry và verify toàn bộ resources thành công.
- LIVE10/11: dùng VPS phát triển mới167.71.202.116 theo quyền user đã cấp. Windows sender truyền gói qua host-pinned SSH, Linux receiver verify độc lập; root installer tạo system service, runtime chạy UID997. Actual SQLite journal→transfer→install→inspect→durable binding→root/service-UID enrollment→authenticated loopback API read đều PASS. Không Docker/project deploy/public API. Controller giữ chạy; quyền đọc tạm đã revoke và private Desktop DB đã xóa, không ghi vào user profile thật.
- UI10/11:11 focused tests và real Electron19 checks PASS,18 ảnh. Đủ vi/en/cn/jp, dark/light,1280×800/1366×768; consent trước write, lost-install-reply→inspect không replay, binding đóng giữa chừng không enroll, explicit rebind, stopped service không tự start, missing assets không cho cài. No horizontal overflow; footer trong viewport; ảnh không có credential. Backend của GUI proof là IPC fixture, live transport được kiểm riêng như trên.
- Gate10/11: lỗi TypeScript ban đầu do shared type re-export ra docs vượt CLI rootDir đã sửa bằng DTO copy; các lần full ban đầu không được nhận. Final full2047PASS/2Linux-onlySKIP/0FAIL,153files (152PASS/1SKIP),179.10s; bao gồm65detector/CLI tests. Không waive failure hay tăng timeout để né lỗi.

## Kiểm chứng cuối

Khởi động Windows shell bằng `. ./tools/enter-node22.ps1` (Node22.23.3).

| Gate | Lệnh / raw evidence | Kết quả |
|---|---|---|
| Backend focused | `pnpm --prefix app exec vitest run` catalog/journal/service/vault; `.out-scripts/r3c6h2c-backend-focused.log` |66PASS |
| Wizard | `pnpm --prefix app exec vitest run src/renderer/src/components/ControllerInstallWizard.test.tsx`; `.out-scripts/r3c6h2c-wizard3.log` |11PASS; legacy panel/IPC cũng qua full |
| Full Vitest | `pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=default --reporter=json --outputFile.json=.out-scripts/r3c6h2c-full-final.json` |2047PASS/2SKIP/0FAIL; existing Linux-only Caddy cases không chạy trên Windows |
| Typecheck | `pnpm --prefix app exec tsc --noEmit -p <project> --composite false`; Node/Web/scripts +4lab projects |7PASS; `.out-scripts/r3c6h2c-type-results-final.json` |
| Lint | `pnpm --prefix app exec eslint <21 files> --max-warnings=0`; `.out-scripts/r3c6h2c-lint-accepted.log` |0errors/0warnings; shared/ipc.ts giữ contract format, không reformat toàn file |
| Build | `pnpm --prefix app build`; `.out-scripts/r3c6h2c-build-final.log` |PASS |
| Packaging resources | require `scripts/controller-installer-before-pack.cjs` với projectDir app; `.out-scripts/r3c6h2c-package-hook-final.log` |PASS; actual compiled verifier/pins, không execute candidate |
| Python | `ml-service/.venv/Scripts/python.exe -m ruff check app/control-plane-runtime/controller_ssh_bootstrap.py app/control-plane-runtime/controller_host_probe.py` và `ruff format --check` cùng2files |PASS; receiver không thay policy |
| Electron | `pnpm --prefix app exec electron scripts/product-runtime-lab/controller-installer-ui.mjs`; `.out-scripts/controller-installer-ui/185411d0e4b3/result.json` |19checks/18screenshots/0renderer errors |
| Live development VPS | Node22 `app/scripts/controller-onboarding-live.mjs --confirm-install-development-controller`, credential JSON chỉ qua hidden stdin; `.out-scripts/controller-onboarding-live/ec9e6c8e57e73555/result.json` |10checks PASS; controller running/enabled, temporary read client revoked, private local DB removed |

Public sanitized evidence: [verification](../ui-redesign/r3c6h2c-verification.json). Ảnh: [review](../ui-redesign/screenshots/r3c6h2c/installer-review-1280x800-dark-vi.png), [connected](../ui-redesign/screenshots/r3c6h2c/installer-connected-1280x800-dark-en.png); thư mục cùng tên có18ảnh. Screenshot là metadata fixture, không dùng làm bằng chứng deploy thật.

## Tái tạo resources cho developer / CI

1. Trên Linux x64 Node22, build current controller payload bằng `app/scripts/product-runtime-lab/controller-bundle.mjs`; dùng approved runtime modules/lock, không host secrets/DB. Build release bằng `app/scripts/build-controller-release.mjs`, installer bằng `app/scripts/build-controller-installer.mjs`. Build output nằm private owned directory theo verifier; builder chạy đúng UID sở hữu approved modules. Không chạy untrusted lifecycle/download script.
2. Lấy release/tool SHA từ trusted build. Trên Windows Node22 chạy `node app/scripts/stage-controller-resources.mjs --release <absolute-release-directory> --installer <absolute-installer-file> --release-pin <trusted-sha256> --installer-pin <trusted-sha256> --id <release-id>`. CLI chỉ phục vụ developer, không IPC. Refuse overwrite ID, stage copy→verify→publish; không tự lấy pin từ thư mục download để thay trusted build.
3. `pnpm --prefix app build` bake catalog vào Main và compiled packaging verifier. `electron-builder` beforePack phải verify nonempty catalog + exact payload/tool bytes; extraResources chứa Linux runtime. App development thiếu assets vẫn mở legacy flow và giải thích không có gói, nhưng không được đóng gói installer thiếu assets.
4. Current dev package `linux-x64-node22-20261110`: Node22.23.4, glibc tối thiểu2.39; release pin `96a6a5b46ebede6d8c2e6cb0141028748b98278777cdba8648a89d00d83d15cd`, installer pin `7e227868e3622a36c4de11bb3a1ac21e1e0b54915a4bc9268a97ca8e81b81ad8`; payload pin `2345f6ebee2bb83728658e3b4caa79ad76bb6af3eb45b56b862875628d45c640`. Binary resources không Git; code push không phải phát hành NSIS đã ký.

Operational live CLI cố ý chỉ nhận VPS phát triển fresh, credential từ stdin, private disposable SQLite với AES key chỉ RAM. Không chạy lại để reinstall service hiện hữu; lần sau phải đi qua discovery/inspect UI hoặc checkpoint upgrade riêng. Không log raw error/credential. Controller để lại trên VPS theo kế hoạch đã thông báo, API chỉ localhost8768 qua SSH. User profile thật chưa được thêm VPS/binding bởi smoke này.

## Handoff / còn phải làm

- Checkpoint6h2c implementation DONE, board CHỜ REVIEW cho tới PR/merge; không tuyên bố R3/PRODUCT_PASS. Không accepted exceptions, không ML/collector/model/protocol changes.
- Tiếp6h3: live enrollment target + Git source + Docker readiness/first deployment trên VPS phát triển, xác minh khi Desktop đóng và reconnect bằng hồ sơ thực; giữ controller UUID hiện hữu, không reinstall/init DB/key.
- Controller upgrade/uninstall/credential rotation và reboot/soak cần checkpoint/gate riêng. Trusted CI artifact delivery, signed NSIS và máy sạch thuộc release packaging/R11; không coi beforePack hook là đủ installer nghiệm thu.
- Các nhóm release còn lại về template parity/DB/migrate/HTTPS/ML/dataset/demo giữ ledger master, không cắt scope. Không dùng VPS đang chạy batch ML để thử deploy/migrate.
- Personal untracked files giữ ngoài index. Commit có Kim co-author, normal push vào branch hiện hành; không PR/merge/reset/clean/stash/rebase.
