# R11a — ML runtime Windows độc lập cho bản cài

START 12/11/2026 — Base `d302ee3`, task-discipline. User cho phép tiếp tục hoàn thiện sản phẩm và normal checkpoint push; không PR/merge/reset/clean/stash/rebase. Ưu tiên P0 R11 sau live6h4: builder cũ copy toàn bộ ml-service/venv, chưa đủ portable. Phạm vi là runtime Windows x64 có kiểm chứng; máy sạch/NSIS/full app là checkpoint R11b tiếp theo. Không dùng VPS, production Desktop DB hoặc di chuyển model của người dùng.

| Yêu cầu | Thay đổi và evidence phiên hiện tại | State |
|---|---|---|
| Runtime artifact độc lập, exact production closure | Python3.12.10/20locked deps;2679files/184108823bytes, manifest17405450…; wheel RECORD hash/license giữ lại; không venv/pip/pytest/Ruff/state. Passive verifier chung Main/beforePack kiểm exact inventory/hash/bounds/paths/no symlink; actual hook và4negative artifact checks đạt | PASS |
| Packaged launch đúng interpreter/state và vòng đời | Packaged-only verified interpreter; env whitelist/userData/ml-state. Dev path+args/default state giữ nguyên.12focused tests nằm trong full cuối: same-size tamper/no fallback/concurrent start/late exit/cancelled start/stop failure/stale health;23Python tests dùng private state đạt | PASS |
| Native portable proof trên source cuối | Recordbe380411bbf4: actual app.isPackaged/Electron production MlServiceManager/verifier/native Python/HTTP/train180/161vectors/4scores/restart persistence/absolute taskkill/stop/no fallback đạt5checks. Unicode paths, System32-only PATH/invalid PYTHONHOME-PYTHONPATH, resource bytes giữ nguyên và private_fixture_removed=true | PASS |
| Gates và handoff | Full2216PASS+2existingLinux-onlySKIP/0FAIL/165files; typesNode-Web-Scripts/ESLint8/Ruff3/build/actual beforePack/negativeCLI/negative existing-output/diff check đạt. Board/FR/master/HANDOFF/ADR010/env/README/proof đã đồng bộ. Commit dùng Kim coauthor và normal checkpoint push theo quyền hiện hành | PASS |

## Các file và hành vi đã thay đổi

- `app/scripts/build-ml-runtime.py`, `ml-service/runtime-lock.json`: tạo resource từ approved local Python base và installed production wheels; kiểm exact dependency versions/RECORD, không tải dependency lúc mở app. Output mới phải ở resources hoặc ignored .out-scripts, không overwrite artifact đang dùng.
- `app/src/main/mlRuntime.ts`, contract artifact, Vite define và beforePack: pin manifest được bake vào Main, không nhận từ renderer/env; không execute Python để verify. `electron-builder.yml` chỉ copy generated ML resource, bỏ copy cả cây ml-service.
- `mlClient.ts`: start đồng thời dùng cùng promise; pending start/exit/health có fence theo process; dừng Windows bằng absolute taskkill và giữ lỗi khi kill thất bại. Missing/tamper trả ML_SERVICE_DOWN trước spawn/state; không fallback. API/model/ngưỡng/protocol/schema/IPC giữ nguyên.
- `ml-service/config.py`: packaged override absolute userData, từ chối relative/empty; development default không đổi. Unit tests mới kiểm cả hai đường, không tự tạo/migrate state khi import config.
- Native lab/README và tài liệu bàn giao: actual packaged Electron host dùng production class; chỉ logger no-op để không ghi log người dùng. Artifact/bin/model/private fixtures ignored, không commit.

## Lệnh tái hiện và kết quả

Chạy từ repo root sau `. ./tools/enter-node22.ps1` (Node22.23.3):

1. `ml-service/.venv/Scripts/python.exe app/scripts/build-ml-runtime.py` → PASS2679files/184108823bytes,20productiondeps/Python3.12.10. Chỉ chạy khi output chưa tồn tại; lần sau `--output app/.out-scripts/<new-runtime-directory>` theo README. Runtime hiện có bị từ chối với ML_RUNTIME_NEW_SCOPED_OUTPUT_REQUIRED, exit1, không overwrite.
2. `pnpm.cmd --prefix app build` → PASS Node/Web typecheck và production main/preload/renderer; có compiled mlResourceVerifier. `pnpm.cmd --prefix app exec tsc -p tsconfig.scripts.json --noEmit` → PASS.
3. `node app/scripts/ml-runtime-lab.mjs --run` → recordbe380411bbf4,5native checks PASS/exit0/cleanuptrue. Thiếu `--run` → REJECTED/exit2 trước fixture.
4. `pnpm.cmd --prefix app exec vitest run --maxWorkers=4 --reporter=default --reporter=json --outputFile.json=.out-scripts/r11a-full-final.json` → 2216PASS/2existingLinux-onlySKIP/0FAIL/165files. Focused `mlClient.test.ts` + `mlRuntime.test.ts`12PASS cũng nằm trong full cuối.
5. Đặt `OPSPILOT_ML_STATE_DIRECTORY` tới absolute ignored `app/.out-scripts/r11a-final-pytest-state`, chạy `ml-service/.venv/Scripts/python.exe -m pytest ml-service/tests -q -p no:cacheprovider` →23PASS. Không trỏ tới model/state của người dùng.
6. `pnpm.cmd --prefix app exec eslint src/main/mlClient.ts src/main/mlRuntime.ts src/main/mlClient.test.ts src/main/mlRuntime.test.ts scripts/ml-runtime-lab.mjs scripts/ml-runtime-lab/entry.mjs electron.vite.config.ts scripts/controller-installer-before-pack.cjs` →0errors/0warnings.
7. `ml-service/.venv/Scripts/python.exe -m ruff check app/scripts/build-ml-runtime.py ml-service/config.py ml-service/tests/test_state_location.py` và cùng3files `ruff format --check` → PASS.
8. Actual `controller-installer-before-pack.cjs` qua helper ignored `app/.out-scripts/check-upgrade-package.cjs` → PACKAGING_GATE_PASS cả protected controller và ML resources. Compiled verifier helper `check-r11a-negative.cjs` kiểm pin đúng với artifact, empty pin/missing root bị chặn và inventory không có venv/state/devtools →4checks PASS. `git diff --check`/staged review trước commit phải sạch.

Proof được lưu [r11a-verification.json](../ui-redesign/r11a-verification.json), có source/runtime/raw evidence hashes. Raw logs tại `app/.out-scripts/r11a-*`; native result/process log `app/.out-scripts/ml-runtime-native/be380411bbf4/`. Binaries và raw logs không đưa vào Git.

## Giới hạn, lỗi đã xử lý và checkpoint sau

- Đây là synthetic delivery test, không pilot75phút hoặc50run nghiên cứu; không khẳng định độ chính xác ML từ180mẫu này. Native Python, scientific libraries và HTTP/model đều thật; host không chạy full OpsPilot App.tsx hoặc NSIS trên máy sạch.
- Node22 fs.cpSync làm sai Unicode destination trên host, đã xác minh bằng minimal probe và thay bằng mkdir/copyFile không symlink trong lab. Những record fail ban đầu không được tính PASS. Rerun a44af9d8a85f có5MLchecks đạt nhưng cleanupEBUSY, không chốt PASS; source cuối chuyển cwd ra ngoài fixture, chờ close và bounded cleanup retries, recordbe380 đạt cleanuptrue. Không thay model/algorithm để né lỗi.
- Hai skip là gate Linux-only hiện có, danh sách trong proof; không có failing gate được tự miễn. Accepted exceptions: không có. Contract/API/schema/dependencies không đổi ngoài contract artifact đóng gói mới đã ghi DECISIONS trước code.
- R11b: build full Windows unpacked/NSIS, kiểm SQLite native ABI, first launch với tài khoản Windows khác/môi trường không có Python/Node, full Settings/ML health và restart; drill upgrade/uninstall cùng preservation Desktop DB/model. Bổ sung migration model của installer cũ nếu có release thực dùng state trong resources. Không đánh dấu R11/release hoàn thiện từ native host này; R3/R4/R5/R7 và các gate master còn nguyên.

HANDOFF-LOCAL 12/11/2026 — DONE scoped R11a, CHỜ REVIEW repository; implementation SHA tra `git log -1 -- app/src/main/mlRuntime.ts`. Staging đúng file checkpoint, không binary/secret hoặc personal untracked; Kim coauthor, normal checkpoint push được user cho phép, không PR/merge. Kiểm remote SHA sau push; chưa ký hoặc phát hành installer.
