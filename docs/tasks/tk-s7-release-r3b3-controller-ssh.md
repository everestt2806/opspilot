# R3b-3 — Controller SQLite credentials to pinned SSH

START 06/11/2026 — Tiếp yêu cầu phát triển; base R3b-2 `e705e68`, branch `feat/release-audit-20261204`. Áp dụng task-discipline, CLAUDE và ADR-011; không đổi IPC/schema, không Electron hoặc credential fallback, không VPS người dùng/push/PR/merge.

| Yêu cầu | Gate / evidence | State |
|---|---|---|
| Resolver đọc profile hiện hành và credential đã bind từ controller SQLite | Fresh query mỗi lần; refuse missing/archived/invalid identity trước decrypt; SQLite + AES unit25/25 | PASS |
| Từ chối swap/tamper/legacy/revision hoặc controller mismatch | Real cipher; stable secret-free errors; không log/env fallback hoặc DB write, unit25/25 | PASS |
| CLI độc lập và real SSH/Docker qua resolver mới | Linux7/7, 7 fresh bound-credential SSH connections, cold T1/recovery, cleanup/source unchanged | PASS |
| Regression, hồ sơ và commit cục bộ | Unit25/25, full1452 PASS/2 SKIP; node/web/scripts/lab types, scoped lint, build, explicit diff/link checks | PASS |

## Phạm vi

- Đọc ciphertext từ SQLite controller độc lập; không tự chuyển DB Desktop hoặc dùng safeStorage. Factory chỉ load protected key, không tạo key/enroll khi thiếu.
- SshManager hiện hành tiếp tục kiểm tra host key trước auth; guarded session kiểm tra claim/target/fence. Resolver không thay quyền ownership hoặc bật service mặc định.
- Unit Windows chỉ thay filesystem key loader bằng cipher tổng hợp; positive protected filesystem và kết nối thật kiểm trong Linux scratch, không gọi unit là live gate.
- R3 tổng vẫn PARTIAL; production enrollment/admission/cold startup scan/service tiếp sau checkpoint này.

## Nhật ký

- START 06/11: xác nhận credential binding bao gồm controller ID và toàn bộ target/revision; resolver đọc profile trước decrypt, không cache credential/connection config. Bắt đầu implementation và safety tests.
- UPDATE 06/11: `createControllerSshResolver` query profile hiện hành và giải mã bound envelope bằng protected loader; invalid/missing/archived profile từ chối trước đọc key. Unit25/25 PASS, scoped lint/typechecks PASS sau sửa format và control-character check. Real lab đang chạy biến thể 7-case với một SshManager mới mỗi attempt từ SQLite credential; full regression/build chờ kết quả cuối.
- UPDATE 06/11: final real gate `0f3cb2ee0ee5` **7/7 PASS**, linked R1 `ceb7ed111deb`, 7 kết nối mới qua protected store + SQLite credential, 2 app HMAC keys, 6 terminal verified + 1 unknown không retry, cold pending T1 + historical-generation retention PASS. Cleanup/source_unchanged=true. Full app **1452 PASS / 2 SKIP / 0 FAIL**, types/lint/build PASS; hai skip Linux-Caddy và jsdom warnings giữ giới hạn baseline, không nhận GUI/HTTPS live PASS.

## Gates trên source cuối

Windows Node22.23.3 sau `tools/enter-node22.ps1`; Linux/WSL Node22.23.4. Commands từ root:

```text
pnpm --prefix app exec vitest run src/main/controlPlane/controllerSshResolver.test.ts --reporter=dot
pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=json --outputFile=.out-scripts/release-r3b3-vitest.json
pnpm --prefix app typecheck
pnpm --prefix app exec tsc --noEmit -p tsconfig.scripts.json
pnpm --prefix app exec tsc -p scripts/product-runtime-lab/tsconfig.json
pnpm --prefix app exec eslint src/main/controlPlane/controllerSshResolver.ts src/main/controlPlane/controllerSshResolver.test.ts scripts/product-runtime-lab --max-warnings=0
pnpm --prefix app exec electron-vite build
Linux: OPSPILOT_R1_MODULES=/var/tmp/opspilot-p3e3a-runtime/node_modules OPSPILOT_R1_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3b3-lab.cjs node app/scripts/product-runtime-lab/build.mjs
Linux: OPSPILOT_R1_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3b3-lab.cjs OPSPILOT_KEY_ROUTER_BOUND_SSH=1 node app/scripts/product-runtime-lab/key-router.mjs
git diff --check
git diff --cached --check
```

- Raw evidence: `app/.out-scripts/release-r3b3-vitest.json`; `app/.out-scripts/product-runtime-bound-ssh/0f3cb2ee0ee5/{result,router}.json`; linked runtime report `ceb7ed111deb`. Reports/scratch keys không stage. Bundle SHA256 `4f82c08ed29000fbdbbb6a7609d08e75f49a009d56d8ada128cffc19264e0b8f`.
- Resolver không sửa DB, không cache config/credential, không nhận secret qua env/argv, không import Electron. Profile/revision đọc cùng một SELECT và authenticated payload được đối chiếu exact binding; claim/fence checks vẫn do guarded session/repository hiện hành thực hiện.
- CLI matrix tái dùng verified local Git snapshot fixture, explicit scratch-only SSH credential/HMAC enrollment, generated local host/client keys và Docker thật. Không gọi fixture enrollment là production enrollment; cold T1 đọc lại repository là recovery proof, chưa là OS restart của service cài sẵn.
- Đã review request/ledger/final diff, relative links và explicit file staging; không có dependency, migration, IPC hoặc API mới. Protected key loader chỉ load, thiếu key không tự tạo. Unit không chứng minh SSH thật; Linux matrix không thay nghiệm thu VPS người dùng.

HANDOFF-LOCAL 06/11 — R3b-3 **CHỜ REVIEW**, implementation SHA: `git log -1 -- app/src/main/controlPlane/controllerSshResolver.ts`. R3b-2 local `e705e68`. Next: explicit production bootstrap/credential enrollment CLI và target enrollment có reconciliation, rồi resource admission/cold startup scan/service opt-in + OS restart gate. Không lặp key store/resolver; giữ R3 tổng PARTIAL và default polling-only. Không push/PR/merge hoặc production DB/VPS write.

No accepted exception. Live endpoint/pin/domain còn thiếu; chỉ local Linux SSH/Docker, không production DB.
