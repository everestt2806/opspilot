# TK-S7 P1f-1 — shared-ingress service coordinator

> Trạng thái: CHỜ REVIEW. Backend coordinator only; không nối IPC/UI/pipeline, không tự chạy khi khởi động và không gọi VPS thật.

## START 2026-10-19

- Đọc `CLAUDE.md`, `DECISIONS.md`, task-discipline, P1e design và các task P1e-1..5. P1e-5 được Leader duyệt trong phạm vi backend/local lab.
- Ghép service quanh planner/installer/reconcile/HTTPS activation hiện có; không viết lại transaction, probe hoặc mutex. Service chỉ nhận VPS/binding ID và lấy dữ liệu/healthcheck từ DB.
- DoD: read-only status không tạo network; các operation ghi xác minh VPS/fingerprint/inventory/deployment; policy production/staging nội bộ; typed result đã khử dữ liệu nhạy cảm; uncertain result không bị phát lại mù; app và URL HTTP không đổi khi HTTPS lỗi.
- Gate: focused service + ingress/repository tests, Node 22 typecheck, build, scoped lint, `git diff --check`; không có tác động VPS.

## UPDATE 2026-10-19

- Thêm `SharedIngressService` với bốn thao tác (`readStatus`, `prepareOrInstall`, `reconcile`, `checkHttps`). Các thao tác chỉ nhận ID; hostname, pinned SSH identity, deployment, upstream port và healthcheck lấy từ `VpsRepository`, `DomainRepository`, `AppRepository`, `DeploymentRepository`.
- VPS archived/missing, binding không thuộc VPS, app/deployment không hiện hành, deployment import, fingerprint thiếu/thay đổi, staging ngoài allowlist và inventory đổi đều bị từ chối. `readStatus` chỉ đọc DB kể cả khi thiếu fingerprint. Policy nội bộ được copy/freeze khi tạo service.
- Facade không giữ mutex; installer, reconcile và activation tiếp tục sở hữu mutex VPS chung cùng remote lock đã có. Trước/preflight/prepare/write và sau mỗi transaction, facade đối chiếu lại identity/inventory. Install chỉ chạy với host sạch; host OpsPilot đã cài chỉ được nhận khi ownership, marker, config và service evidence đều verified. Reconcile gọi transaction P1e trên toàn bộ inventory VPS, bảo toàn các route khác.
- Kết quả chỉ trả operation/status/failure step/reason/retryability, URL HTTP DB và ingress state; không trả plan, stdout/stderr hay credential. Kết quả install/reconcile không xác định được trả `uncertain`/không tự replay trong lần gọi đó; lần thử sau phải bắt đầu bằng preflight/reconcile hiện trạng. HTTPS lỗi/pending không thay đổi app, deployment hoặc URL HTTP; activation chỉ qua coordinator/CAS P1e-5.
- Tests: clean install, managed host, conflict, planner/install/reconcile failure, uncertain install rồi retry fail-closed, HTTPS pending rồi thành công khi retry, invalid VPS/binding/app/deployment, thiếu/đổi identity, inventory change, hai app trên một VPS, concurrent calls qua mutex thật, read no-network và bảo toàn URL HTTP.
- Gates (Node 22): ghi kết quả cuối tại HANDOFF-LOCAL bên dưới. Không có live VPS; IPC/UI/pipeline NOT_RUN theo scope.

## HANDOFF-LOCAL 2026-10-19

- Focused command: `pnpm --filter @opspilot/app exec vitest run` trên 14 file service/ingress/repository/migration — **207 passed, 1 skipped**.
- Node `v22.23.3`: `pnpm --filter @opspilot/app typecheck` PASS (Node + Web); `pnpm --filter @opspilot/app build` PASS (main/preload/renderer).
- Scoped ESLint trên bốn file đã sửa: exit 0, **0 errors / 121 warnings**. Tất cả là `prettier/prettier` trong các phần có sẵn trước đó của `repository.ts` và `repository.test.ts`; service source/test và các dòng thêm trong repository không có warning. Không format hàng loạt code cũ. Full-repo lint: NOT_RUN.
- `git diff --cached --check`: PASS. Caddy Linux real-process gate: N/A (P1e đã có local-lab evidence; P1f chỉ ghép module).
- Code commit SHA: `92b03d3b0b43f482eb0d9c1880969c61fae8b591`.
- Review-fix code commit SHA: `264571ca4f8b5d0b025535e13a630f149f698f5a`.
- Review correction: phân biệt managed active (`opspilot_owned` + listener/port occupied) với managed inactive (`ports_free`, port 80/443 trống, không listener). Cả hai cần ownership verified và trạng thái active khớp; preflight phải safe/clear, marker valid và config tồn tại/đọc được. Inactive trả `installed` mà không prepare, download, cài lại hoặc start; reconcile tiếp tục sở hữu việc start.
- Sau `verifyOwnership`, reload binding/VPS/inventory, xác minh lại SSH identity đã pin, rồi reload inventory lần nữa trước khi trả kết quả. Regression tests bao phủ active/inactive, xung đột port/ownership, identity/inventory/archive đổi trong lúc verify, clean install → installed_not_running → retry không cài lần hai → reconcile.
- Gates trên Node `v22.23.3`: focused service + preflight/install/reconcile/repository: **9 files, 176 passed, 1 skipped**; typecheck PASS; build PASS; scoped ESLint hai file sửa PASS (0 warning); `git diff --check` PASS. VPS, IPC/UI/pipeline NOT_RUN.
- VPS thật, IPC/UI/pipeline: NOT_RUN theo yêu cầu checkpoint.
