# R3b-5a — Complete verifiable controller release bundle

START 06/11/2026 — Tiếp yêu cầu phát triển; base R3b-4 `564ca9c`. Prerequisite của target app/helper enrollment: controller artifact hiện chỉ có 3 helpers, chưa đóng gói templates/collector. Product-mode theo CLAUDE/ADR-011; task-discipline, không production VPS/DB write/push/PR/merge.

| Yêu cầu | Implementation / gate | State |
|---|---|---|
| Gói độc lập đủ entrypoint, 3 helpers, 4 templates, 3 collector files | Shared fixed catalog, 11 payload files byte-identical; fresh Linux dependency install PASS | PASS |
| Manifest bound bằng explicit trusted digest và exact file set | Unit21/21, real CLI/FS14/14: SHA256/size/cap/path/permissions/link validation, fail closed | PASS |
| Không phụ thuộc repo cwd khi kiểm gói, không activate/enroll | Fresh Linux bundle riêng, CLI đổi cwd, chỉ trả verified paths/digest; candidate không execute | PASS |
| Regression và bàn giao | Unit21/21, full1502 PASS/2 SKIP, types/lint/build; Linux bundle14/14 + enrollment14/14, fresh native install, diff/stage/link checks | PASS |

## Phạm vi

- Đây là gói runtime đầu vào cho enrollment, chưa ghi marker/key trên target. Không bỏ nhãn lab-only của Python initializers để gọi là production enrollment.
- Catalog approved dùng chung builder/verifier, không glob cả repo và không copy tests/venv/node_modules/.env. Dependencies native vẫn theo isolated package-lock, không thêm dependency.
- Build tạo gói offline; không rebuild đè vào directory của service đang chạy. Phân phối/activation phải dùng release directory riêng, pin manifest digest qua kênh tin cậy. SHA256 không chứng minh authenticity nếu attacker có thể đổi cả hash tin cậy.
- CLI verify không tạo/migrate DB, không dùng Electron/safeStorage hoặc mở API/SSH. Chưa whole R3/auto deploy production PASS.

## Nhật ký

- START 06/11: xác nhận 3 helpers hiện được copy, templates/collector vẫn lấy source repo trong lab. Chốt additive bundle contract + catalog + builder + independent verifier trước bước target installation.
- UPDATE 06/11: shared approved catalog10 assets, builder đóng gói11 files + fsynced atomic manifest, explicit expected digest verifier và local CLI. Unit21/21 PASS; verifier chỉ đọc candidate, trusted CLI độc lập không import/execute candidate. Refuse relative artifact path, malformed/oversized manifest, missing/unknown/duplicate/traversal files, bad permissions/owner và symlink/hardlink; bounded fd reads.
- UPDATE 06/11: Linux CLI/filesystem gate `af594a46127b`14/14 PASS, cleanup=true; actual fresh `npm ci` + native SQLite/Zod + CLI init/status/verify11files PASS. Manifest digest `1dc375f3070f20589116c77b61841872bf3df6337beff92613575c0aab1d0bf3`; driver/builder hashes trong raw report. Typechecks/lint PASS, full suite/build/enrollment regression chờ final result.
- UPDATE 06/11: source cuối thêm explicit control-character rejection và builder lstat guard trước overwrite asset để không dựa riêng O_NOFOLLOW trên Windows. Final bundle/FS `af016d431d7a` **14/14 PASS**, manifest `1301b0b2d938cd10ec623d8cc441b549f98acaf950e2c7efcaaa9681ac938492`, cleanup=true. Payload không đổi ở lần thêm builder guard cuối; fresh install đã chạy lại. Enrollment regression `ae3f5ae8c4db`14/14 PASS. Full source TS cuối **1502 PASS/2 SKIP/0 FAIL**, Node/Web/scripts/lab types, scoped lint0/0 và build PASS; Caddy skips/jsdom warnings giữ giới hạn baseline.

## Lệnh và evidence

Windows Node22.23.3 sau `tools/enter-node22.ps1`; Linux Node22.23.4. Scoped commands:

```text
pnpm --prefix app exec vitest run src/main/controlPlane/controllerBundle.test.ts --reporter=dot
pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=json --outputFile=.out-scripts/release-r3b5a-vitest.json
pnpm --prefix app typecheck
pnpm --prefix app exec tsc --noEmit -p tsconfig.scripts.json
pnpm --prefix app exec tsc -p scripts/product-runtime-lab/tsconfig.json
pnpm --prefix app exec eslint src/main/controlPlane/controllerBundle.ts src/main/controlPlane/controllerBundle.test.ts src/main/controlPlane/cli.ts scripts/build-control-plane.mjs scripts/product-runtime-lab/controller-bundle.mjs scripts/product-runtime-lab/verify-deps.mjs --max-warnings=0
pnpm --prefix app exec prettier --check ../docs/contracts/product-controller-bundle.ts control-plane-runtime/bundle-files.json
pnpm --prefix app exec electron-vite build
Linux: OPSPILOT_CONTROL_PLANE_MODULES=/var/tmp/opspilot-p3e3a-runtime/node_modules node app/scripts/product-runtime-lab/controller-bundle.mjs
Linux: node app/scripts/product-runtime-lab/verify-deps.mjs
Linux: OPSPILOT_CONTROL_PLANE_MODULES=/var/tmp/opspilot-p3e3a-runtime/node_modules OPSPILOT_CONTROL_PLANE_OUTPUT=/var/tmp/opspilot-p3e3a-runtime/r3b5a/control-plane.cjs node app/scripts/build-control-plane.mjs
Linux: OPSPILOT_CONTROLLER_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3b5a/control-plane.cjs node app/scripts/product-runtime-lab/controller-enrollment.mjs
git diff --check
git diff --cached --check
```

- Reports không stage: `app/.out-scripts/release-r3b5a-vitest.json`, `app/.out-scripts/controller-bundle/af016d431d7a/result.json`, `app/.out-scripts/controller-enrollment/ae3f5ae8c4db/result.json`. Fresh-install summary stdout: Node22.23.4, native SQLite3.53.4, Zod4.4.3, migration020, CLI init/status/verified bundle11files PASS.
- Final manifest SHA256 ở trên; driver `0aad604be5f75eacb2a19bca428436b5f9f1d3abb896972a0a1a7f35e93f00c0`, builder `d6754948ba2cce451e050d765b37476451651b3c06c51d76984093b0872a2767`. Bundle payload SHA256 `ffabfe42f259b9a78b68b559e24088870e9c821f41b434752831eeeaab177285` không đổi sau builder lstat guard cuối; raw manifest binds đủ11file.
- Verified paths là **nguồn local** của gói management, không phải đường dẫn helper đã cài trên VPS. Target enrollment phải cài/đối chiếu manifest và trả installed target paths riêng. Chưa gọi lab initializer hoặc bật Product executor từ bước này.
- Đã đối chiếu request/ledger/final diff; relative links/staged secrets/diff check trước commit. Không dependency/migration/IPC mới, không node_modules/SQLite/key/secret/report artifact trong index. Không accepted exception.

HANDOFF-LOCAL 06/11 — R3b-5a **CHỜ REVIEW**, SHA `git log -1 -- app/src/main/controlPlane/controllerBundle.ts`. Base R3b-4 `564ca9c`. Tiếp **R3b-5b target installation/enrollment**: protected remote layout + immutable manifest, controller/app/generation binding, exact HMAC provisioning, mất response thì đọc/reconcile exact receipt; không tự adopt/overwrite state hiện hữu hoặc bỏ lab-only label. Sau đó admission/cold startup scan/service opt-in và process restart. R3 tổng PARTIAL, default polling-only; không push/PR/merge hoặc VPS người dùng/production DB write.

No accepted exception. Default service polling-only; tiếp target app/helper/HMAC enrollment/reconciliation, admission/startup/service.
