# R3c-6e — Nhật ký yêu cầu Product bền trên Desktop

START 07/11/2026 — Tiếp R3c-6d `6347481`; user yêu cầu tiếp tục build. Áp dụng task-discipline, cho phép normal checkpoint push, không PR/merge/production VPS write.

Phạm vi: main-process command journal + forward migration + service/IPC cụ thể. Giữ nguyên controller API và quyền read-only của form hiện tại; UI quyền ghi/nút thao tác được nối sau backend journal đã có gate. Không tự cấp quyền rộng hơn hoặc fallback Desktop pipeline.

| Yêu cầu | Bằng chứng cần đạt | State |
|---|---|---|
| Contract trước code, migration mới không đổi dữ liệu cũ | Schema025/binding-client namespace/immutable key-body/upgrade025 tests; lịch sử025 không FK tới profile nên xóa VPS không mất request | PASS |
| Ghi intent trước mạng, không dispatch lại sau mất phản hồi/crash | Final native `e4d20468996c`9PASS: thậtSSH/HTTP drop sau commit→1POST/1job, process mới chỉlookup; crash-before-send notfound vẫnunknown | PASS |
| Quyền và binding kiểm lại | Native read-only grant không chuẩn bị write, VPS revision đổi chặn POST; unit late response sau disable không success; không tăng scope UI6d | PASS |
| Service/IPC cụ thể, không lộ secret | Main service +5route commands; metadata whitelist, không bearer/body/env/note/raw lỗi; focused97PASS gồm IPC bridge11route | PASS |
| Kiểm chứng hiện hành | Final focused97/full1667PASS/2Linux-onlySKIP/0FAIL; native9+13/fresh025/Node-Web-scripts-lab types/lint14/build/Python365 đạt | PASS |
| Hồ sơ/checkpoint | Board/HANDOFF/FR/ledger cập nhật;25file stage đúng scope, secret/link/diff sạch, commit Kim; normal push và đối chiếu remote trước thông báo | PASS |

Giả định sản phẩm: mỗi controller/app chỉ có một yêu cầu chưa biết kết quả đang chờ; prepared chưa gửi có thể hủy rõ ràng. Đã đánh dấu in_flight thì chỉ tra cứu, không tự replay POST, kể cả lookup chưa thấy request. Thao tác mới cần request UUID mới và người dùng xác nhận riêng. Server vẫn là nguồn sự thật về job/runtime; Desktop journal chỉ chứng minh ý định và phản hồi đã nhận.

## Nhật ký

- UPDATE07/11: migration025 + command contract trước code; main tự tạo UUID, Zod strict rejects caller key/secret/note, canonical body digest, DB immutable/state-transition triggers, pending uniqueness/controller/app xuyên binding. List100 gần nhất ưu tiên pending, không tự xóa tombstone theo VPS. Một lần claim IMMEDIATE trước await; mọi send sau chỉ trả record. Check dùng read currentbinding/client và lookup key cũ, kiểm app/action/generations/job; completed không bị response cũ hạ vềaccepted.
- Native initial `e7296e264a73` qua3ca rồi fail do Node assert.rejects deep match Error object với plain object ở context.cause; sửa predicate so safe code + cause.message, không nới runtime; native `7c333d203893`9PASS/cleanup=true. First focused có3fixture failures: expected vault code BINDING_CHANGED trong khi resolve intentionally maps BINDING_UNAVAILABLE, policy fixture spread còntarget bị strict schema chặn, và latest schema expected24 thay25. Sửa fixture rồi95PASS, không thay safety check.
- Native9 dùng2fileSQLite độc lập, pinnedSSH thật, actual ControllerReadApi/Commands + main service, subprocess decrypt/check stdin-only fixturekey; runtime_dispatch_executed=false, production_vps_used=false. Đây là acceptance của command intent, không coi1queuedjob là deployment thành công.
- UPDATE07/11: final focused **97PASS**, gồm16journal tests + migration/cipher/service/IPC. Final native **e4d20468996c 9PASS**, artifact `/var/tmp/opspilot-p3e3a-runtime/r3c6e-final-lab.cjs`, SHA256 **0e38e54e60eedd03dec5788de52435b7a100c1a6e5d0e940caeb52ae63b09467**. Enrollment regression **3cd7f36207f2 13PASS**, current CLI manifest **7229c3e52ab65b583da6e28f45128a5eba8bae07853066d11e500a4ef362cbdf**, cleanup=true cả hai. Raw `.out-scripts/desktop-controller-commands/e4d20468996c/result.json` và `.out-scripts/desktop-controller-enrollment/3cd7f36207f2/result.json`.
- Fresh npm ci/SQLite3.53.4/Zod4.4.3/migration025/bundle12/standalone templates PASS (`release-r3c6e-fresh-deps.log`). Python **365PASS/98.79s** (`release-r3c6e-python.log`); build PASS (`release-r3c6e-build.log`). Scoped lint14 file đạt0error/0warning sau sửa2unused destructured fields thành explicit whitelist DTO, chuẩn hóaLF cácfileđang sửa và wrap1SQLtestline. Không tắt lint rules hoặc format cả repo; đã rebuild/rerun native sau đổi DTO whitelist.

## Lệnh tái hiện

```text
. ./tools/enter-node22.ps1
pnpm --prefix app exec vitest run src/main/controlPlane/desktopControllerCommands.test.ts src/main/controlPlane/desktopControllerService.test.ts src/main/db/index.test.ts src/main/db/productMigration.test.ts src/main/controlPlane/desktopControllerVault.test.ts src/main/ipc.test.ts --maxWorkers=2
pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=json --outputFile=.out-scripts/release-r3c6e-vitest-final.json
pnpm --prefix app typecheck
pnpm --prefix app exec tsc --noEmit -p tsconfig.scripts.json
pnpm --prefix app exec tsc --noEmit -p scripts/product-runtime-lab/tsconfig.json
pnpm --prefix app exec eslint <14 changed TS/MJS files excluding ignored shared/ipc.ts> --max-warnings=0
pnpm --prefix app build
ml-service/.venv/Scripts/python.exe -m pytest experiments/ collector/tests ml-service/tests -p no:cacheprovider -q
Linux Node22: node app/scripts/product-runtime-lab/verify-deps.mjs
Linux: OPSPILOT_R1_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c6e-final-lab.cjs node app/scripts/product-runtime-lab/desktop-controller-commands.mjs
Linux: OPSPILOT_R1_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c6e-final-lab.cjs OPSPILOT_CONTROLLER_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c6e/control-plane.cjs node app/scripts/product-runtime-lab/desktop-controller-enrollment.mjs
```

Không chạy Linux labs dùng8768 cùng Windows full Vitest/ControllerService tests. Không thay migration001–024. Chưa sửa UI ở checkpoint này; next6f cần quyền ghi được người dùng chọn rõ ràng, snapshot app/generations/capabilities, xác nhận deploy/policy và journal UI; pending prepared chỉ hủy hoặc gửi sau xác nhận đúng ý định. Unknown không có auto replay; nếu xóa/revoke credential khi chưa rõ kết quả, binding mới không được giả làm namespace client cũ: giữ journal/chặn gửi trùng và cần đối soát có quyền phù hợp. UI phải cảnh báo giới hạn này trước thao tác ngắt/thu hồi. Không nhận user test để thay phần UI còn phải viết.

- HANDOFF-LOCAL07/11: final full **1667PASS/2Linux-onlySKIP/0FAIL**, `.out-scripts/release-r3c6e-vitest-final.json`/`.log`. Final Node/Web/scripts/lab typechecks PASS;14file lint0/0/build/fresh025/Python365/native9+13 đạt trên source cuối. Không accepted exceptions hoặc user action để gỡ chặn backend slice; board CHỜ REVIEW vì chưa PR/merge. Giữ nguyên file cá nhân ngoài index; co-author Kim. SHA `git log -1 -- app/src/main/controlPlane/desktopControllerCommands.ts`; push theo user authorization, không force push/PR/merge/production DB/VPS.
