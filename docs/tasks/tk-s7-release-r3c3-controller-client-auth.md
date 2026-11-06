# R3c-3 — Controller desktop-client credentials

START 06/11/2026 — R3c-2 systemd/public Git gate tiếp tục trên frozen R3c-1 bundle. Phần tiếp độc lập: credential substrate cho Desktop→controller authenticated API; không mở `/v1` trước auth gate. User cho phép phát triển/push checkpoint, không PR/merge.

| Yêu cầu | Gate | State |
|---|---|---|
| Persistent client identity/scopes, token chỉ cấp1lần | Migration022 cumulative parity/native fresh/v021 populated upgrade/idempotence; random32bytes/SHA256-only/TTL30ngày | PASS |
| Admin idempotency không lộ lại secret | Namespace controller/OSuid/request, immutable canonical body/operation, actual2process cùng request chỉ1token, replay delivery_unknown | PASS |
| Authenticate/revoke fail closed | 16auth cases + native CLI13, current controller/client/credential/scopes/expiry, transaction guard, revoke/replay không reactivate | PASS |
| CLI admin bootstrap không argv secret | Actual Linux CLI stdin metadata/stdout cấp1lần; request body actor rejected; no token trong raw report/DB/history | PASS |
| Gates và push |41focused/full1554PASS/2SKIP/finalLinux13/fresh022/VPSCLI14/types/lint/build; explicit18files/secret/link/diff clean; `079cffe` normal push/local=remote | PASS |

## Ranh giới

- Chưa implement rotation/HTTP routes/Desktop tunnel trong checkpoint này; capability tương ứng chưa được quảng cáo available.
- Admin identity lấy từ trusted OS uid của controller process (không request/env actor). Remote caller sau này phải qua verified pinned SSH; CLI không tự xác thực network peer hoặc nhận admin identity từ renderer.
- CLI một lần xuất token là cơ chế cấp credential có chủ đích, không phải log. Không đưa stdout token vào báo cáo/artifact; test chỉ random/synthetic, không credential người dùng.
- Schema không auto-create user/grant. Private controller directory không thay thế authentication cho API.

No accepted exception.

## Nhật ký / evidence

- UPDATE 06/11: thêm migration022/client/credential/admin-request tombstone và `ControllerClientAuth`; Linux CLI enroll/revoke dùng protected controller DB/marker, OS uid lấy trong process; không HTTP endpoint. Chỉ SHA256 bearer lưu DB, mỗi random token32bytes, hạn30ngày; request replay không regenerate/token disclosure. Mutations IMMEDIATE và không nhận transaction của caller.
- Migration tests cũ downgrade tới v8/v9/v15 phải bỏ cả3bảng022 và schema marker022; cập nhật latest22/33tables, không sửa historical migrations. Có explicit populated v021→v022 giữ legacy rows/grants rỗng và rerun idempotent, cumulative SQL byte parity.
- Focused `controllerClientAuth.test.ts`, `db/index.test.ts`, `db/productMigration.test.ts`: **41 PASS**. Native final13case PASS **6a7b1234e86d** (hai CLI processes thật, issue/replay/conflict/revoke/current-controller/digest-only/FK). Raw không stage `app/.out-scripts/controller-client-auth/6a7b1234e86d/result.json`, không chứa token.
- Final bundle manifest **53f83392f0a4f83af8e639c815a4a5efed6fba4f743d38545ceb1a145d725ec1** (`r3c3-final/control-plane.cjs`); payload12files. Fresh `npm ci` runtime Node22.23.4/nativeSQLite3.53.4/Zod4.4.3/init/status/verified bundle + schema022/no implicit grant PASS (`verify-deps.mjs`). Existing VPS enrollment CLI14/14 PASS **27f8b3316e3b**; no production access.
- Lần full unbounded đầu `release-r3c3-vitest-final.json`:1552PASS/2FAIL/2SKIP, hai renderer tests Dashboard locale/SharedIngress chưa thấy dữ liệu/render lúc assertion. Không sửa renderer; focused hai files + auth38PASS. Chưa khẳng định nguyên nhân; final full dùng `--maxWorkers=4` để giới hạn cạnh tranh tài nguyên, vẫn chạy toàn bộ suite. Giữ lỗi đầu làm evidence, không nhận pre-existing exception.
- Test scaffold ban đầu bind mất `this`, regex lint, migration latest expectation/downgrade và native revoked-controller expected code đã sửa theo source; không runtime secret được dùng trong fixtures.
- HANDOFF-LOCAL 06/11: **full bounded1554 PASS/2SKIP/0FAIL**, raw `.out-scripts/release-r3c3-vitest-final-bounded.json`; toàn bộ checks nêu trên PASS, CHỜ REVIEW. Implementation SHA `git log -1 -- app/src/main/controlPlane/controllerClientAuth.ts`. Không miễn lỗi, không sửa renderer trong checkpoint; chỉ đổi execution concurrency cho full suite, focused renderer38PASS. Tiếp authenticated read API/controller read-model/capability truth rồi SSH tunnel/Desktop authority; rotation/manual write policies task riêng.

## Lệnh tái hiện

```text
Node22: pnpm --prefix app exec vitest run src/main/controlPlane/controllerClientAuth.test.ts src/main/db/index.test.ts src/main/db/productMigration.test.ts
pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=json --outputFile=.out-scripts/release-r3c3-vitest-final-bounded.json
pnpm --prefix app typecheck
pnpm --prefix app exec tsc --noEmit -p tsconfig.scripts.json
pnpm --prefix app exec tsc -p scripts/product-runtime-lab/tsconfig.json
pnpm --prefix app exec eslint <9 changed TS/MJS files> --max-warnings=0
pnpm --prefix app exec electron-vite build
Linux: OPSPILOT_R1_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c3-final-lab.cjs OPSPILOT_CONTROLLER_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c3-final/control-plane.cjs node app/scripts/product-runtime-lab/controller-client-auth.mjs
Linux: node app/scripts/product-runtime-lab/verify-deps.mjs
```
