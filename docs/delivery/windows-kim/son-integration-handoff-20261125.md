# Bàn giao Sơn — core tests và kiểm thử sau tích hợp

Cập nhật 26/11/2026. Theo yêu cầu user: Kim phải hoàn tất các tests thuộc Windows delivery; các ca core/tích hợp do Sơn xử lý và chạy lại sau khi kéo code. Packet này để user/Sơn nhận qua Git, chưa có việc gửi tin nhắn hoặc tự tích hợp nhánh.

**SON_INTEGRATION_PENDING.** Không coi các ca core dưới đây đã được miễn hoặc PASS. Phạm vi Kim theo [task chính thức, trạng thái a9b0ee0/R15](../../tasks/tk-s7-kim-windows-delivery.md): Kim đã hoàn tất R15 (`a9b0ee053251ef0ecb3a63bec0148a3334d93ed8`, bundle `handoff-bundle-20261125-r15`, `OpsPilot-0.2.0-setup.exe` 492,056,572 bytes SHA256 `a73aa8fd3395f4be06d81d2728fcff0fbebe3cd26e204823bd647e19bff12af8`), khắc phục xong P1 interrupted staging authority (dùng in-memory `$txCreatedStagingDir`, `--mode interrupted-fresh-install` PASS 3,801/3,801 files) và P3 ESLint (`eslint --max-warnings 0` trên delivery scripts đạt 0 errors, 0 warnings). Toàn bộ chuỗi kiểm thử thuộc Kim (5/5 upgrade lab, 7/7 installer lab, 8/8 locked probes, 5/5 legacy modes + 3/3 guards, 12/12 preflight, F2 runtime restore) đã PASS 100%. Các lỗi core dưới đây là phần của Sơn xử lý sau khi kéo nhánh tích hợp; core source ngoài Kim không đổi từ `c89d311` sang `a9b0ee0`. Phân công gốc: [tk-s7-parallel-2026-11-16.md](../../tasks/tk-s7-parallel-2026-11-16.md).

- **Thư mục bàn giao người dùng cuối tách riêng (chưa commit, phục vụ phân phối/nghiệm thu)**: `delivery-windows-r15/` gồm `OpsPilot-0.2.0-setup.exe` (492,056,572 bytes, SHA256 `a73aa8fd3395f4be06d81d2728fcff0fbebe3cd26e204823bd647e19bff12af8`) và `HUONG_DAN_CAI_DAT_VA_SU_DUNG.md` (hướng dẫn cài đặt, thiết lập và sử dụng step-by-step cho người dùng). Lưu ý bộ cài `.exe` nặng ~469 MB (>100 MB giới hạn GitHub) nếu đẩy remote cần GitHub Release hoặc Git LFS.

## Nguồn evidence và giới hạn

Evidence source mới nhất, leader chạy lại toàn bộ runner trên c89d311:

- `app/.out-scripts/windows-delivery/leader-final-c89d311-20261126T0600/source-current/source-check-report.json`
- SHA256: `a4e1aaee6492d7b4aaffe19155929161859da89e7146cc88792a03d47a6fa7f2`
- Hoàn tất: **26/11/2026 06:34:28 GMT+7**; runner 557.20s, **6/8 steps PASS**, overall FAIL. Scoped ESLint fail vì 7 formatting warnings trong `app/scripts/windows-delivery/test-restore-runtime.mjs` thuộc Kim; Vitest exit 1 với nhóm Sơn dưới đây. Standalone 12/12, types và build PASS.
- Provenance thực lúc chạy: **c89d31111639d6a283f8860f6d606edb32b5e998, clean working tree**, dirty diff null. Tài liệu bàn giao cập nhật sau runner không nằm trong snapshot đó. Không lấy report historical f8da4b2 trong bundle R14 để nhận là source run mới trên c89d311.

Số liệu xác nhận: **2,621 PASS / 21 failed assertions / 11 SKIP**, **8 failed files** (Vitest đếm 14 failed suites do nested suites). Toàn bộ 21 assertions fail nằm trong các files Sơn sở hữu; `delivery_failures_count: 0` chỉ là phân loại của Vitest, không chứng minh mọi tests NSIS/native thuộc Kim đạt hoặc không có regression. File `externalHttpsProbe.test.ts` fail lúc setup môi trường (WSL/Linux + OpenSSL), không có failed assertion riêng trong 21.

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

## Tên chính xác 21 failed assertions — đối chiếu JSON fresh c89d311


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

