# R3c-5b — Bounded command HTTP and runtime acceptance

START06/11/2026 — Base command persistence `0cbb75d` đã push; read API/systemd/publicGit gate ở7bed110/b467e58. User cho phép làm tiếp và checkpoint pushes; không PR/merge/production write. Áp dụng task-discipline.

| Yêu cầu | Gate | State |
|---|---|---|
| Bounded POST body/media/timeout/current auth/generations | HTTP10tests: declared/chunked413, fatalUTF8/media/JSON400, timeout/disconnect, revoke/epoch sau body, no raw input | PASS |
| Idempotency-Key và request lookup | HTTP duplicate/changed409/client namespace và command11 regressions PASS; actual runtime còn row5 | PASS |
| Capability trung thực | Scope/readiness/status và pause degraded tested; native read scope blocked/FEATURE_DISABLED, default run404 | PASS |
| Shutdown drain không ghi sau DB close | Native final `5806d866a249`11PASS: SIGTERM sau HTTP100Continue với body chưa đủ →503, exit0,0request/0job; HTTP close/disconnect regressions | PASS |
| Actual manual runtime và policy acceptance | Final `869ed020b29d` PASS, linked R1 `ce880c8871b1`:2settled deploy/sameSHA, discarded response lookup/replay1job, policy pause/resume satisfied, restart giữ CID/image/StartedAt, revoke401, cleanup/deadlinefalse | PASS |
| Gates và checkpoint push | Focused30/native11+12+13/fresh023/types/scopedlint9/build/full1585PASS/2SKIP; exact17files staged/diffcheck/0secret-pattern/0missing-link; normal checkpoint push theo quyền user, đối chiếu remote SHA trước bàn giao | PASS |

Không mở public bind/admin endpoint, không manual rollback route, không tự đổi source/env, không Desktop fallback. HTTP code202 chỉ nhận intent; chỉ verified T1/T2 mới là runtime terminal. No accepted exception.

## Nhật ký

- UPDATE06/11: bounded body/POST + lookup/capability + service shutdown drain đã triển khai; focused30PASS (writeHTTP10/readAPI9/commands11), native readAPI10PASS `125bc37a35ac`, types Node/Web/scripts/lab và scoped lint/build PASS. Native fresh npmci/schema023/bundle12 PASS. Chưa nhận actual manual runtime PASS.
- First real gate `d00cc76ea60a` FAIL, cleanup=true: first public Git deploy `0cbb75d` + systemd restart/no duplicate PASS, manual request đã tạo job; assertion count đếm cả manual fixture source_generation1 vốn được chốt failed trước service. Sửa lab query giới hạn app1/source_generation2, không sửa runtime hoặc bỏ assertion. Chạy lại gate từ đầu; failure giữ trong evidence, chưa miễn trừ.
- UPDATE06/11: `237f430ca15f`/`8c0c4ae12614`/`988cc22e7f1e` đều cleanup=true, hai deployment đã succeeded/T1/T2 nhưng resume503. Evidence cuối chỉ rõ `runtime_completion_unverified` dù remote_outcome=applied; source audit xác nhận production `createControllerExecutionRuntime` thiếu callback `verifyRuntimeCompletion` mà queue bắt buộc. Nối router.verifyCompletion (đọc receipt/authority thật, không tin executor state); thêm ready-after-first/second trước restart để không che lỗi bằng restart. Đây là lỗi composition R3c-1, sửa trong scope acceptance5b; chạy lại final artifact và mọi gate bị ảnh hưởng.
- Final real gate **869ed020b29d PASS**, raw `app/.out-scripts/public-git-systemd/869ed020b29d/result.json`, linked R1 **ce880c8871b1** (subject_unchanged/cleanup/deadline_expired=false). Actual public GitHub HTTPS clone không adapter, installed systemd/root lab,2settled deployments trên cùng SHA `0cbb75d`; HTTP manual request bị bỏ response sau headers rồi lookup/replay trả cùng job, không tạo intent khác. Policy pause replay original result; explicit resume trả satisfied, restart35s giữ nguyên app/collector CID,image,StartedAt,restarts và chỉ2jobs. Live CLI revoke→401, service stop/cleanup đúng nonce. Đây không phải new Git push stimulus (flag actual_github_push_observed=false), non-root installer/production VPS/HTTPS/ML chưa kiểm.
- Final native HTTP **5806d866a249 11PASS** có SIGTERM khi body chưa đủ; native command SQL **77eef2f4e164 12PASS**, auth CLI **2767903b65bc 13PASS**; native HTTP hoàn tất trước Windows full suite tránh port8768. Fresh Linux npmci/Node22.23.4/SQLite3.53.4/Zod4.4.3/schema023/empty grants+requests/bundle12/init/status PASS.
- Final CLI `/var/tmp/opspilot-p3e3a-runtime/r3c5b-final/control-plane.cjs`, manifest **cdcb8987665de6d40b230a26690b6fb198354aa3f359f55c7851c1bfb40add6b**; lab `/var/tmp/opspilot-p3e3a-runtime/r3c5b-final-lab.cjs`, SHA256 **812dec93f057820b6e7d32974ae66ad00ee29825a260ef618252b08c9f07a92e**. Final Node/Web/scripts/lab types, scoped9 lint0errors/0warnings, electron-vite build PASS. Python không đổi; không nhận365baseline là test mới của5b.

```text
Node22: pnpm --prefix app exec vitest run src/main/controlPlane/controllerWriteApi.test.ts src/main/controlPlane/controllerReadApi.test.ts src/main/controlPlane/controllerCommands.test.ts --maxWorkers=2
pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=json --outputFile=.out-scripts/release-r3c5b-vitest-final.json
pnpm --prefix app typecheck
pnpm --prefix app exec tsc --noEmit -p tsconfig.scripts.json
pnpm --prefix app exec tsc -p scripts/product-runtime-lab/tsconfig.json
pnpm --prefix app exec eslint <9 changed TS/MJS files> --max-warnings=0
pnpm --prefix app exec electron-vite build
Linux: OPSPILOT_CONTROLLER_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c5b-final/control-plane.cjs node app/scripts/product-runtime-lab/controller-read-api.mjs
Linux: OPSPILOT_R1_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c5b-final-lab.cjs node app/scripts/product-runtime-lab/controller-commands.mjs
Linux: OPSPILOT_R1_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c5b-final-lab.cjs OPSPILOT_CONTROLLER_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c5b-final/control-plane.cjs node app/scripts/product-runtime-lab/controller-client-auth.mjs
Linux: OPSPILOT_R1_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c5b-final-lab.cjs OPSPILOT_CONTROLLER_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3b5b/control-plane.cjs OPSPILOT_PUBLIC_SERVICE_ARTIFACT=/var/tmp/opspilot-p3e3a-runtime/r3c5b-final/control-plane.cjs OPSPILOT_PUBLIC_READ_API=1 OPSPILOT_MANUAL_HTTP=1 node app/scripts/product-runtime-lab/public-git-systemd.mjs
Linux: node app/scripts/product-runtime-lab/verify-deps.mjs
```

Assumptions: loopback/auth/explicit composition theo ADR011; no raw body/stderr/token trong DB/result/evidence. No accepted exceptions. Tiếp rotation/pinned SSH Desktop transport và UI controller authority; R3 tổng PARTIAL. Không PR/merge hoặc production write.

- HANDOFF-LOCAL06/11: full **1585PASS/2Linux-onlySKIP/0FAIL**, raw `.out-scripts/release-r3c5b-vitest-final.json`; Node/Web/scripts/lab/lint9/build/fresh runtime đều PASS trên source cuối. JSDOM pseudo-element/canvas notices có trong baseline; không sửa renderer hoặc che skip để nhận production GUI proof. Docs/FR/board/handoff đã đối soát, exact17files staged/diffcheck/0secret-pattern/0missing-link; user đã cho phép normal checkpoint push; SHA xem git log file controllerWriteApi.ts, remote đối chiếu trước bàn giao. Không PR/merge.
