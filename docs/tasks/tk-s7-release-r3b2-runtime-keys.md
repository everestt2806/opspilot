# R3b-2 — Runtime keys per app/generation and executor routing

START 06/11/2026 — User yêu cầu tiếp tục phát triển, base `350e2d2` trên `feat/release-audit-20261204`. Dùng task-discipline; scope product-mode theo ADR-011. Giữ Desktop và default polling-only; không SSH/VPS write, push/PR/merge.

| Yêu cầu | Implementation / gate | State |
|---|---|---|
| Khóa HMAC 32 byte riêng theo controller/app/ownership generation | Protected encrypted files với purpose/identity authenticated; 4 scope keys khác nhau trong Linux gate, 2 app keys khác nhau ở real pipeline | PASS |
| Create-once/load-only; giữ key cũ cho pending settlement | O_EXCL, không overwrite kể cả record hỏng; 2 child processes một winner; generation mới không xóa key cũ | PASS |
| Từ chối record bị swap/tamper và filesystem không an toàn | Linux13/13 actual FS/crypto, input/control-character tests, mode/owner/link/encoding/cap checks; stable errors | PASS |
| Executor/router chọn đúng key của claim, verifier đọc persisted proof | Real7/7, cold pending T1 bằng key cũ trong khi key generation mới tồn tại; no replay, unknown không retry | PASS |
| Independent CLI và regression | Full1427 PASS/2 SKIP, types/scripts/lab/lint/build PASS, old master10/10, explicit file list và local handoff | PASS |

## Quyết định phạm vi

- Reuse master key/AES-GCM của R3b-1. Runtime-key record có purpose riêng và identity controller/app/generation trong ciphertext; không dùng SSH credential payload thay HMAC key.
- Tên record dẫn từ app ID/generation đã validate; SQLite vẫn là authority cho claim/ownership/history. File chỉ giữ encrypted key material, không tự thay mode hoặc generation trong DB.
- Chỉ explicit create mới sinh key; lookup và recovery không tạo key khi thiếu. Giữ generation trước để xử lý terminal pending; không thêm rotation/delete endpoint.
- Router tạo runtime repository/executor theo exact claim. Enroll target, service activation, cold startup scan và resource admission vẫn là task tiếp theo, chưa bật tự deploy mặc định.
- Không thêm dependency/migration/IPC hoặc management API công khai. Dữ liệu kiểm thử tổng hợp và scratch; gate live còn thiếu endpoint/pin độc lập/domain.

## Nhật ký

- START 06/11: đọc lại key store, executor, R3b ledger và contract claim; bắt đầu encrypted per-app key store và router.
- UPDATE 06/11: implement `controllerRuntimeKeys.ts` và `ControllerRuntimeExecutorRouter`; filesystem lookup chỉ load exact identity, constructor repository copy key rồi zero temporary Buffer, không global key cache. Export shared directory guard, giữ behavior master key cũ.
- UPDATE 06/11: Linux material gate13/13 và master key regression10/10 PASS; input/router/credential unit13/13 PASS. Từ chối controller ID có trailing newline, không chỉ path traversal/unsafe integer. Concurrent child create có một success, một failure; damaged record không bị create ghi đè.
- UPDATE 06/11: baseline real router7/7 `477aef14c068`; tăng cường cold T1/generation retention7/7 `c05a32da66fd`, linked R1 `63a22eb49b18`, cleanup/source_unchanged=true. Fixture enroll hai target app bằng key khác nhau; tạo thêm generation material mà không đổi SQL ownership, ngắt sau T1 rồi adapter thật settle bằng key cũ, CID/StartedAt giữ nguyên. Đây không phải production enrollment hoặc installed-service OS restart.

## Gate commands và artifact

Node22.23.3 Windows, Node22.23.4 Linux/WSL. Từ root, pnpm sau `tools/enter-node22.ps1`; Linux bundle `r3b2-lab.cjs` build như README.

| Gate | Lệnh / artifact | Kết quả |
|---|---|---|
| Key store / concurrency | Linux `node app/scripts/product-runtime-lab/runtime-keys-check.mjs` | **13/13 PASS**, private scratch cleanup |
| Master store compatibility | Linux `node app/scripts/product-runtime-lab/secrets-check.mjs` | **10/10 PASS** |
| Real key routing/recovery | Linux `node app/scripts/product-runtime-lab/key-router.mjs`; `.out-scripts/product-runtime-key-router/c05a32da66fd/{result,router}.json` | **7/7 PASS**: 6 verified terminal outcomes, 1 unknown without retry, cold pending T1 + retained generation verified |
| Focused safety | `pnpm --prefix app exec vitest run src/main/controlPlane/controllerRuntimeKeys.test.ts src/main/controlPlane/controllerRuntimeExecutor.test.ts src/main/controlPlane/controllerSecrets.test.ts --reporter=dot` | **13/13 PASS** |
| Full app | `pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=json --outputFile=.out-scripts/release-r3b2-vitest.json` | **1427 PASS / 2 SKIP / 0 FAIL**; Linux Caddy skips và jsdom warnings giữ giới hạn cũ |
| Types | `pnpm --prefix app typecheck`; scripts `tsc --noEmit -p tsconfig.scripts.json`; lab `tsc -p scripts/product-runtime-lab/tsconfig.json` | PASS |
| Lint | Scoped ESLint key store/router/tests và `scripts/product-runtime-lab`, `--max-warnings=0` | PASS |
| Build | `pnpm --prefix app exec electron-vite build` | PASS |
| Review | `git diff --check`, explicit staged file list/check; relative links | PASS |

## Ranh giới bằng chứng

- Runtime key file chỉ là encrypted material; không thay app mode/source/generation/history trong SQLite. Không migration/IPC/API mới, không xóa/rotate các record cũ.
- Real lab dùng immutable local Git fixture đã verified. Helpers/SSH/Docker/collector/SQLite/signatures thật; fixture cấp target key qua local Linux console, chưa phải enrollment production.
- R1 fixture assertion reader vốn dùng một key được điều chỉnh trong lab để đọc key của app đang xét; router production tự load repository riêng theo claim. Không sửa hoặc fake receipt/response/runtime phase. Cold-T1 test inject exception sau commit thật rồi dùng recovery thật, chưa nhận là process restart của service cài sẵn.
- Key/credential plaintext không in hoặc commit; scratch master/runtime keys xóa sau lab. Report ghi base commit + subject/bundle hashes cho working-tree evidence, không gọi base SHA là toàn bộ source đã sửa.
- Default service còn polling-only; production enrollment, credential resolver, admission/cold startup scan và service/UI integration còn tiếp. Live endpoint/pin/domain vẫn thiếu; không SSH vào VPS người dùng. No accepted exception.

HANDOFF-LOCAL 06/11 — R3b-2 **CHỜ REVIEW**, implementation SHA là commit chứa `controllerRuntimeKeys.ts` và hồ sơ này (`git log -1 -- app/src/main/controlPlane/controllerRuntimeKeys.ts`). Giữ R3 tổng PARTIAL. Next: đọc bound encrypted credential từ controller SQLite để tạo SSH resolver độc lập Electron, rồi explicit enrollment/service activation. Không push/PR/merge, không VPS write.
