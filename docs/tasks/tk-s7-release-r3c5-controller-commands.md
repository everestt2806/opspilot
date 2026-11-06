# R3c-5 — Controller manual commands and idempotency

START06/11/2026 — Base read API `7bed110`, final evidence `b467e58` đã push. Áp dụng task-discipline. User cho phép hoàn thiện và checkpoint pushes; không PR/merge/production write.

## R3c-5a — Command persistence (chưa mở HTTP writes)

| Yêu cầu | Gate | State |
|---|---|---|
| Request lifetime tombstone/controller-client-key namespace | Migration023/cumulative parity, canonical digest/original result/UUID normalization; native2process chỉ1job, no bearer/note persistence | PASS |
| Current auth/scopes/ownership/source generations | Same IMMEDIATE auth+generation checks, revoke/scope/owner/source/caller transaction regressions | PASS |
| Manual redeploy atomically pauses auto và queues đúng SHA | Server desired/provenance, SQL failure rollback policy/queue/audit/request; nativeSQLite PASS, không SSH dispatch | PASS |
| Explicit pause/resume an toàn | Pause khi degraded, resume bị chặn manual pending/unknown/T1pending; dùng existing reconcileDesired/không clear lease | PASS |
| Lookup sau lost response | Exact client namespace + current owner, original generation metadata kể cả source đã thay đổi; derived job status | PASS |
| Gates và push |37focused/native12+auth13+readAPI10/fresh023/types/lint/build/full1575PASS/2SKIP; explicit18files/secret/link/diff; `0cbb75d` normal push/local=remote | PASS |

## Phạm vi và assumption

- 5a chỉ persistence/service primitive; read API giữ write capabilities unsupported tới 5b bounded HTTP body/shutdown integration + actual runtime/manual gate.
- Không manual rollback endpoint hoặc arbitrary source/env/shell. Specific SHA phải có provenance từ observed commit hoặc controller deployment cùng configured repository/root, không nhận 40hex bất kỳ là verified.
- Manual redeploy tự pause auto theo contract; resume là hành động riêng, không clear lease/fence hoặc unknown barrier. Pause luôn có thể yêu cầu khi service degraded (DB/authorization vẫn phải hợp lệ).
- Không lưu operator reason thô trong request/audit; canonical body hash giữ idempotency, result chỉ metadata/safe code. Không direct remote command trong transaction.

No accepted exception.

## Nhật ký / evidence R3c-5a

- UPDATE06/11: `ControllerCommands` chưa được compose vào HTTP service; schema023 giữ request namespace và result metadata, composite client/controller FK; không lưu authorization/body/note. Source/ownership/auth/scopes recheck trước lookup/mutation trong IMMEDIATE; lookup là read nên source generation thay đổi vẫn trả metadata gốc nếu app còn thuộc controller, không tự đổi request epochs.
- Current-desired resolve một lần khi accept, duplicate cùng key trả original SHA dù branch tip thay đổi. Specific SHA chỉ từ observation hoặc controller deployment có cùng repo/root. Manual enqueue + pause/reconcile + audit + tombstone cùng transaction. New key là intent riêng; cùng logical UUID chữ hoa/thường normalize về một key.
- Pause luôn có thể yêu cầu khi readiness degraded, không SSH/clear lease. Resume không qua unknown/T1 chưa settle/manual pending; canonical queue vẫn claim manual khi auto paused. Quét barrier không thay heartbeat/fence hoặc suy remote đã dừng.
- Focused **37PASS** gồm command11 + DB index17 + Product migrations9; populatedv022→v023 giữ credential digests, không tạo request tự động; v021/latest migrations idempotent và cumulative SQL parity. Historical migrations không sửa.
- Native final **44cd90b73c0f**, **12PASS**, raw `app/.out-scripts/controller-commands/44cd90b73c0f/result.json`:2Node processes/1request/1job, cold replay, changed request conflict, lookup isolation, unknown SHA, atomic rollback, degraded pause/resume barrier, exact lease preservation/revoke/FK. `runtime_dispatch_executed=false` rõ phạm vi (dispatch marker SQLite fixture, không SSH/Docker proof).
- Native regression auth13PASS **2538bdb566ec**, readAPI10PASS **42ae4e720fa2**; chạy native HTTP xong trước full Windows suite để không tranh8768. Fresh Linux npmci/Node22.23.4/SQLite3.53.4/Zod4.4.3/init/status/bundle12/schema023/grants-requests rỗng PASS. Management manifest **0c1d13a4efed5ed85564b4467ac3f3c00d0f29c48692cb96b4fe2001ec731e94**, lab `/var/tmp/opspilot-p3e3a-runtime/r3c5a-final-lab.cjs`.
- Scaffold observeTip method name và matcher thiếu-vs-undefined sửa theo repository/type, không sửa authority rules để qua test. Source final type(Node/Web/scripts/lab)/scoped lint9files/build/diff PASS, full đang chạy. Python không đổi, baseline365PASS/Ruff cùng phiên giữ phạm vi cũ.
- HANDOFF-LOCAL06/11: final full **1575PASS/2Linux-onlySKIP/0FAIL**, raw `.out-scripts/release-r3c5a-vitest-final.json`; local gates PASS, CHỜ REVIEW. SHA `git log -1 -- app/src/main/controlPlane/controllerCommands.ts`. Chỉ C5a substrate, default/execution read API vẫn writeUnsupported; tiếp5b HTTP body/auth/idempotency/lookup + lifecycle drain + real manual runtime test, không nhận manual HTTP deploy đã chạy từ nativeSQL12cases.

```text
Node22: pnpm --prefix app exec vitest run src/main/controlPlane/controllerCommands.test.ts src/main/db/index.test.ts src/main/db/productMigration.test.ts
pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=json --outputFile=.out-scripts/release-r3c5a-vitest-final.json
pnpm --prefix app typecheck
pnpm --prefix app exec tsc --noEmit -p tsconfig.scripts.json
pnpm --prefix app exec tsc -p scripts/product-runtime-lab/tsconfig.json
pnpm --prefix app exec eslint <9 changed TS/MJS files> --max-warnings=0
pnpm --prefix app exec electron-vite build
Linux: OPSPILOT_R1_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c5a-final-lab.cjs node app/scripts/product-runtime-lab/controller-commands.mjs
Linux: OPSPILOT_R1_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c5a-final-lab.cjs OPSPILOT_CONTROLLER_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c5a/control-plane.cjs node app/scripts/product-runtime-lab/controller-client-auth.mjs
Linux: OPSPILOT_CONTROLLER_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c5a/control-plane.cjs node app/scripts/product-runtime-lab/controller-read-api.mjs
Linux: node app/scripts/product-runtime-lab/verify-deps.mjs
```
