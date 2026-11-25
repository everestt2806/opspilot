# Bàn giao Sơn — core tests và kiểm thử sau tích hợp

Ngày 25/11/2026. Theo yêu cầu user: Kim phải hoàn tất các tests thuộc Windows delivery; các ca core/tích hợp do Sơn xử lý và chạy lại sau khi kéo code. Packet này để user/Sơn nhận qua Git, chưa có việc gửi tin nhắn hoặc tự tích hợp nhánh.

**SON_INTEGRATION_PENDING.** Không coi các ca dưới đây đã được miễn hoặc PASS. Kim vẫn phải sửa lỗi legacy installer trong [review-f8da4b2.md](review-f8da4b2.md); không đẩy lỗi đó sang Sơn. Phân công gốc: [tk-s7-parallel-2026-11-16.md](../../tasks/tk-s7-parallel-2026-11-16.md).

## Nguồn evidence và giới hạn

Evidence mới nhất chạy trên candidate hiện tại:
- `app/.out-scripts/windows-delivery/source-runs/run-1795601232149-16952-f45ccb/source-check-report.json`
- SHA256: `f879a7fb6a0f60932ce3df933f0074cd641cfd432ef59ee392938bc6888fe594`
- Thời điểm chạy: **25/11/2026 17:16:00 GMT+7**.

Số liệu xác nhận: **2,621 PASS / 21 failed assertions / 11 SKIP**, **8 failed files** (Vitest đếm 14 failed suites do nested suites). Toàn bộ 21 lỗi đều thuộc phạm vi của Sơn; **0 lỗi thuộc phạm vi delivery của Kim** (`delivery_failures_count: 0`, REGRESSION: NONE). File `externalHttpsProbe.test.ts` fail lúc setup môi trường (thiếu WSL/Linux + OpenSSL), không có failed assertion riêng trong 21.

Raw JSON/log có thể chứa đường dẫn máy và thông tin môi trường: giữ ignored, không commit/upload. Packet tracked chỉ ghi tên tests và thông tin lỗi đã lọc.

## Danh mục lỗi thuộc owner Sơn

Các đường dẫn trong bảng tính từ `app/`.

| File | Failed assertions | Actual và việc cần Sơn kiểm tra |
|---|---:|---|
| `src/main/controlPlane/productEnvironmentOnboarding.test.ts` | 1 | EPERM khi scan `collector/.pytest_cache`; source-render preflight chưa đến postconditions. Phân biệt traversal/ignore policy với permission của môi trường |
| `src/main/controlPlane/productEnvironmentRuntime.test.ts` | 1 | Cùng EPERM; kiểm separation private runtime/public Dockerfile sau khi giải quyết traversal |
| `src/main/controlPlane/productRuntimePipeline.test.ts` | 6 | Cùng EPERM; hai ca expected SSH_RUNTIME_REJECTED/SSH_SESSION_ABORTED bị lỗi scan che mất. Rerun đủ happy/failure/rollback/abort paths |
| `src/main/controlPlane/projectSourceVerification.test.ts` | 10 | Actual PROJECT_SOURCE_UNSUPPORTED; gồm PostgreSQL environmentFirst, Next/SPA, exact branch, observation concurrency và persistence/cleanup mapping. Kiểm source fixture, framework/contract và preflight policy, không nới guards để xanh |
| `src/main/db/productPostgresRepository.test.ts` | 1 | Cùng EPERM; runtime render ba files và credential isolation chưa được chứng minh |
| `src/main/domain/ingress/caddyInstallTransaction.test.ts` | 1 | WSL không chạy được `/bin/bash`; cần isolated POSIX parser hợp lệ rồi test lại remote scripts |
| `src/main/domain/ingress/caddyReconcile.linux.test.ts` | 1 | Linux/tmpfs harness exit 127, `bash: not found`; chuẩn bị đúng Linux harness rồi test reconcile/rollback |
| `src/main/domain/ingress/externalHttpsProbe.test.ts` | 0, suite setup lỗi | Lệnh `wsl openssl req` thất bại trước assertions; cần môi trường WSL/Linux + OpenSSL/fixture CA đúng, không bỏ cả suite |

Expected cho mỗi ca: assertions gốc đạt trên code đã tích hợp và môi trường hợp lệ. Những lỗi trên là observed failures, chưa đủ kết luận tất cả là bug source; các nhóm EPERM/WSL cần chẩn đoán môi trường trước. Không xóa cache chung, nới ACL hoặc sửa contract để tránh lỗi mà chưa xác định nguyên nhân.

## Lệnh chạy lại sau khi kéo và tích hợp

Trong checkout integration riêng do Sơn quản lý, ghi actual HEAD và diff/env; cài deps theo lock/toolchain của source tích hợp. Chạy từ repo root:

```powershell
. ./tools/enter-node22.ps1
$sonTests = @(
  'src/main/controlPlane/productEnvironmentOnboarding.test.ts'
  'src/main/controlPlane/productEnvironmentRuntime.test.ts'
  'src/main/controlPlane/productRuntimePipeline.test.ts'
  'src/main/controlPlane/projectSourceVerification.test.ts'
  'src/main/db/productPostgresRepository.test.ts'
  'src/main/domain/ingress/caddyInstallTransaction.test.ts'
  'src/main/domain/ingress/caddyReconcile.linux.test.ts'
  'src/main/domain/ingress/externalHttpsProbe.test.ts'
)
pnpm.cmd --prefix app exec vitest run @sonTests --reporter=default
# Sau focused fixes, chạy full runner trên chính integration HEAD:
node app/scripts/windows-delivery/source-check.mjs
```

Với Linux-only harness, chạy trong môi trường Linux/WSL có bash, OpenSSL và tmpfs theo test README hiện hành; không đổi expected assertions để chạy trên môi trường thiếu prerequisite. Lưu command/env/exit code/JSON và ghi kết quả từng nhóm. Source runner nonzero vẫn là nonzero, không đổi tên thành whole CI PASS.

Sau tích hợp, Sơn cần build/package lại từ code ghép và chạy affected full-app, native DB/migration, controller/ML verification, installer reinstall/upgrade/rollback và source tests trên **cùng integration HEAD**. Không dùng bundle Kim cũ để kết luận build ghép PASS. Nếu code Sơn thay resource catalog/pins/dependencies, cần approved resources tương ứng, không tự dùng bộ compiled baseline của Kim.

Luồng VPS/DB/controller live thuộc Sơn chạy trên đích được phép của Sơn; synthetic ML của installer không thay formal ML/live deploy evidence. Manual Windows/default identity/DPAPI/GUI và luồng VPS thật người dùng chọn ghi riêng theo checklist. Không tự coi các mục chưa chạy là PASS.

Điều kiện đóng packet: đủ 8 files chạy được, 21 historical failures và setup failure được giải quyết hoặc có kết quả mới chỉ rõ; full source/build và integration gates đạt, hoặc từng ca còn thiếu được báo OPEN đúng owner. Kim có thể chốt phạm vi độc lập khi tests Kim đạt thật; whole release/integration chỉ chốt theo kết quả của bản ghép.

## Tên chính xác 21 failed assertions trong JSON lịch sử


### `app/src/main/controlPlane/productEnvironmentOnboarding.test.ts`

1. `verifies selected source through the production preflight without a runtime capability, jobs or deployment`

### `app/src/main/controlPlane/productEnvironmentRuntime.test.ts`

2. `renders runtime only to a private file, public only to Dockerfile and hides the config manifest digest`

### `app/src/main/controlPlane/productRuntimePipeline.test.ts`

3. `Product Runtime Pipeline (H2-B) happy path V1 -> V2 succeeds and settles in single session`
4. `Product Runtime Pipeline (H2-B) definite build failure preserves previous deployment without activation barrier`
5. `Product Runtime Pipeline (H2-B) unhealthy candidate rolls back to previous and captures R0 boundary`
6. `Product Runtime Pipeline (H2-B) first deploy (no previous) health failure seals failed DEPLOY without rollback`
7. `Product Runtime Pipeline (H2-B) fails closed when target rejects runtime step`
8. `Product Runtime Pipeline (H2-B) fails closed when abort signal triggers during execution`

### `app/src/main/controlPlane/projectSourceVerification.test.ts`

9. `Managed PostgreSQL public source preflight authenticates combined env/database source with environmentFirst=false`
10. `Managed PostgreSQL public source preflight authenticates combined env/database source with environmentFirst=true`
11. `Managed PostgreSQL public source preflight verifies a database-backed source through metadata without creating runtime capability or deployment`
12. `Xác minh source Product trước deployment xác minh Next.js dùng NODE_ENV nội bộ, không deploy hoặc tự bật policy`
13. `Xác minh source Product trước deployment xác minh SPA khớp framework, giữ paused và không tạo deployment/job`
14. `Xác minh source Product trước deployment fetches the exact branch namespace and shares source/render preflight, keeping app paused without jobs`
15. `Xác minh source Product trước deployment re-verifies same SHA with one observation and exposes only safe metadata`
16. `Xác minh source Product trước deployment does not overwrite an observation committed by poller during fetch`
17. `Xác minh source Product trước deployment rolls back observation and desired state if audit persistence fails`
18. `Xác minh source Product trước deployment maps cleanup failures without exposing paths and retains a primary verification failure`

### `app/src/main/db/productPostgresRepository.test.ts`

19. `Product PostgreSQL claim runtime stages exactly three render files, keeps credential outside Dockerfile/source and omits secret manifest digest`

### `app/src/main/domain/ingress/caddyInstallTransaction.test.ts`

20. `P1e-3 first-run Caddy transaction passes both fixed remote scripts through the available isolated POSIX shell parser`

### `app/src/main/domain/ingress/caddyReconcile.linux.test.ts`

21. `Caddy reconcile Linux isolated filesystem runs first start, multi-route reload, idempotency, and rollback on tmpfs`

