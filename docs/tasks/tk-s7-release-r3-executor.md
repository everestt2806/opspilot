# R3 — Always-on executor integration

START 06/11/2026 — User yêu cầu làm toàn bộ release. Bắt đầu phần R3a trong lúc R2 real crash matrix chạy, không bật production service và không thay target đang kiểm chứng. Base `bc4289a`.

| Yêu cầu | Gate | State |
|---|---|---|
| R3a nối immutable snapshot → preflight → real H2 → verified T2 completion | Adapter integration **7/7 PASS** `4b54ea191167`; 6 persisted outcomes và forged reference rejection, 1 unknown không retry. Queue/cancellation/error regression 17/17; full app1414 PASS/2 SKIP | PASS |
| R3b cấu hình/provision credentials và cold recovery an toàn | Protected controller storage, target pin/enrollment, startup pending settlement scan, restart/service | OPEN |
| R3c queue/controller/desktop authority và Git push khi app tắt | Git poll đúng SHA, executor/admission có cấu hình, UI status/history đúng nguồn, live test | OPEN |
| Giữ Desktop, default polling-only và các gate R1/R2 | CLI/ControllerService không đổi composition; full app regression và types/build PASS, không IPC/API/schema mới | PASS |

## Quyết định R3a

- Thêm internal completion result tham chiếu exact attempt/commit/outcome **đã settled**. Result không tự cấp quyền; worker chỉ tiếp tục khi verifier đọc record persisted T1/T2 và exact claim, không dùng boolean từ renderer.
- Snapshot/preflight errors trước dispatch mới vào bounded retry path hiện có. Sau dispatch, thiếu proof hoặc mất ownership phải dừng reconciliation, không replay deploy.
- Khi T2 tự release lease và heartbeat đồng thời thấy released, chỉ chấp nhận completion sau verified persisted record. Không nới lỏng xử lý heartbeat loss cho mọi executor.
- Giữ CLI/service production polling-only tới đủ R2/R3b/R3c và resource admission; phần R3a này không thay enrollment/security boundary.

## Nhật ký

- START 06/11: rà queue worker hiện chỉ nhận prewrite/dispatch_marker; chưa có completion path cho pipeline đã T2. Chuẩn bị internal contract trước implementation.
- UPDATE 06/11: thêm `ProductRuntimeExecutor`, completion verifier exact claim/commit/outcome/T1/T2 và queue callback trusted. Missing/false/throw verifier → reconciliation; heartbeat-loss chỉ được vượt qua khi proof completion hợp lệ. Prewrite transient/permanent/obsolete vẫn theo contract; post-dispatch unknown không retry; snapshot cleanup đúng một lần trong lab.
- UPDATE 06/11: adapter chạy pipeline thật (immutable local Git fixture đã verified; phần fetch Git không bị giả nhận live) qua SSH/SQLite/Docker/collector. 7 cases PASS, 6 verified terminal results, 1 dispatch unknown; wrong attempt/commit đều reject. Artifacts `.out-scripts/product-runtime-executor/4b54ea191167/{result,adapter}.json`, linked R1 nonce `331505a24806`.
- UPDATE 06/11: sửa builder control plane thiếu `target_product_runtime.py` trong helper bundle. Fresh Linux npm ci + build controller + `init/status` + native SQLite migration020 + đủ **3 helper files byte-identical** PASS. Không dùng dependency cache của máy dev làm bằng chứng cho clean install.

## Gate R3a

| Gate | Lệnh | Kết quả |
|---|---|---|
| Adapter integration | Build `product-runtime-lab/build.mjs` sang `r3-lab.cjs`; `node app/scripts/product-runtime-lab/executor.mjs` | **7/7 PASS**, cleanup=true; không fake runtime, snapshot fixture rõ scope |
| Queue + adapter safety | `pnpm --prefix app exec vitest run src/main/controlPlane/queueWorker.test.ts src/main/controlPlane/productRuntimeExecutor.test.ts --reporter=dot` | **17/17 PASS**; unit verifier được stub có chủ đích, persisted verifier được kiểm riêng bằng integration thật |
| Full app | `pnpm --prefix app exec vitest run --maxWorkers=4 --reporter=json --outputFile=.out-scripts/release-r3a-vitest.json` | **1414 PASS / 2 SKIP / 0 FAIL**; jsdom warnings không được gọi native GUI PASS |
| Typecheck | `pnpm --prefix app typecheck`; scripts `--noEmit`; lab `tsc -p scripts/product-runtime-lab/tsconfig.json` | PASS |
| Lint | ESLint queue/adapter/tests + scripts/product-runtime-lab + build-control-plane, `--max-warnings=0` | PASS |
| Build | `pnpm --prefix app exec electron-vite build` | PASS |
| Fresh Linux runtime / builder | `node app/scripts/product-runtime-lab/verify-deps.mjs` | PASS: Node22.23.4, SQLite3.53.4, Zod4.4.3, CLI init/status và 3 helpers |

R3 tổng thể **PARTIAL**, R3a CHỜ REVIEW. Chưa nối service default, chưa quản trị/enroll production, chưa có Git push khi Desktop tắt trên VPS; không tự nâng PRODUCT_PASS. R3b phải chọn/provision protected controller credentials và HMAC key theo app/generation, không chia sẻ một secret vô điều kiện cho mọi VPS; cold recovery startup và resource admission phải có gate riêng. No accepted exception.

HANDOFF-LOCAL 06/11 — R3a đủ local gate, implementation là commit chứa `productRuntimeExecutor.ts` và hồ sơ này (`git log -1 -- app/src/main/controlPlane/productRuntimeExecutor.ts`). R2 local `950b7ae` đã chốt độc lập; commit R3a gồm contract/worker/adapter/builder và hồ sơ gate, không thay controller default. Next: R3b protected enrollment/credentials + per-app runtime-key routing + startup pending-settlement recovery; sau đó R3c Git push/service restart/UI authority/live và R4/R11 song song. Không push/PR/merge/VPS mutation.

START R3b 06/11 — R3a local `1e4df09`. Tiếp khảo sát controller credential/bootstrap và hồ sơ VPS hiện có bằng metadata/read-only; không log/decrypt credential vào terminal, không truy cập SQLite bằng initializer có thể migrate DB người dùng, không ghi hoặc chạy fault trên VPS. Cần key riêng theo app/generation, protected local store và explicit enrollment, không dùng chung key R1 fixture cho production. Hai Caddy tests trong full suite bị skip trên Windows là Linux integration gates; R9 vẫn OPEN, không miễn trừ live HTTPS.
