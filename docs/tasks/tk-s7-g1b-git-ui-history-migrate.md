# TK-S7 G1b — Hai nguồn deploy trong UI, lịch sử Git và migrate

> Phụ thuộc: [G1a](tk-s7-g1a-git-deploy-core.md) qua review local tại `234cb57`. Đọc [audit Git](../30-audit-git-first-deploy.md), [kế hoạch demo](../29-ke-hoach-demo-14-10.md), contract IPC và `DECISIONS.md` trước khi sửa code. G1b hoàn tất trải nghiệm thủ công; webhook và private Git thuộc mốc khác.

| Chủ | Hạn mục tiêu | Branch | Ưu tiên |
|---|---|---|---|
| Worker | 10/10/2026; không cắt gate để kịp demo | `feat/deploy-reachability` | P0 |

## Hiện trạng đã xác minh

- `DeployPage.tsx` chỉ tạo `DeployInput.source_path` và gọi detect local; backend G1a đã có `deploy:prepare-git`, `deploy:cancel-git-prepare`, `deploy:release-git-prepare`, Git precheck/start và trả full SHA.
- `App`/`Deployment` đã có source type, repo/ref/root và deployment SHA; `AppsPage` chưa trình bày provenance Git.
- `MigrateService.sourcePath()` còn yêu cầu `app.source_path`; với Git, cột này là `NULL`. `createTargetApp()` và `startRestoreDeployment()` còn dựa vào local source path. Không được gọi migrate Git là hỗ trợ cho đến khi đường restore này được kiểm chứng.

## Definition of Done

- [x] Wizard cho chọn **Thư mục trên máy** hoặc **Git repository** ngang hàng. Local cũ và preselect local vẫn dùng được. Git nhập URL HTTPS công khai, ref/branch, root directory; chuẩn bị nguồn qua IPC, hiển thị trạng thái tiến trình, detector và full/short SHA trước precheck/start. Không cho chạy với detection không khớp.
- [x] Chỉ dùng `prepared_source_handle` từ main; không truyền đường temp sang renderer, không nhét repo URL vào `source_path`. Precheck/start Git dùng cùng handle và `precheck_token`; khi đổi URL/ref/root, VPS, app, port, env hoặc source mode thì vô hiệu precheck cũ. Kết quả prepare/precheck đến muộn không được ghi đè lựa chọn mới. Release handle đã bỏ dở khi đổi nguồn, reset, rời wizard; cancel prepare đang chạy khi phù hợp. Sau lỗi/hết hạn, hướng dẫn chuẩn bị lại. Double click chỉ start một lần và event đến trước ID vẫn được giữ đúng deployment.
- [x] Redeploy app Git điền đúng repo/ref/root đã liên kết, chuẩn bị snapshot mới để lấy SHA mới và chặn đổi nhầm sang local. App local tiếp tục redeploy từ thư mục. Danh sách/chi tiết/lịch sử ghi rõ source type, repo/ref/root, **SHA của từng deployment** và URL đã redacted; bản local không hiện SHA giả. Rollback dùng image gốc và hiển thị provenance của image gốc qua `is_rollback_of`/lineage, không gán SHA của bản Git mới nhất cho rollback cũ.
- [x] Migrate app Git chạy được sau khi snapshot tạm của G1a đã dọn: nguồn là payload đã relay trên VPS đích và build plan hợp lệ của deployment nguồn, hoặc một snapshot **pin đúng SHA** được quản lý vòng đời rõ ràng. Không phụ thuộc `app.source_path` hay fetch branch mới để khôi phục bản cũ. Target app giữ `source_type=git`, repo/ref/root; target deployment ghi SHA tương ứng với payload chạy thật. Local migrate không hồi quy. Nếu cần contract/schema, cập nhật contract và DECISIONS trước runtime, migration mới nếu đổi DB, không sửa migration cũ.
- [x] Test UI cho hai mode, prepare thành công/lỗi/hủy, race đổi nguồn, token stale, retry, preselect/redeploy, early events và cleanup handle. Test backend migrate Git bằng fixture chứng minh restore sau khi xóa snapshot temp, không đọc local path, không đổi SHA khi branch di chuyển; test local migrate và rollback provenance. Ảnh Electron thật dark/light ở 1280×800 hoặc 1366×768 cho wizard Git và lịch sử app; không có cuộn ngang/cắt nút chính.
- [x] Node 22: focused + full Vitest, lint, Node/Web/Scripts typecheck, build, `git diff --check` pass. Ghi lệnh/số test thật, cập nhật hồ sơ/board, commit cục bộ. Không push, PR, merge; chưa tuyên bố live VPS hay push-to-deploy. Khi xong chỉ trả lời “Worker đã xong”.

## Ghi chú triển khai

- Giữ một pipeline build/health/record cho cả hai nguồn; xử lý source type ở biên. Migrate có thể cần đường restore tin cậy dùng saved plan để tránh detect từ path desktop. Chọn cách đơn giản nhất có test chứng minh; không dùng path giả chỉ để vượt validation.
- UI không hiển thị credential, token precheck, prepared handle, temp checkout path, env secret hoặc raw stderr. Metadata repo có thể hiển thị sau khi loại userinfo; main đã chặn URL chứa userinfo.
- Nếu gặp blocker kiến trúc khi migrate, ghi bằng chứng trong task và dừng ở ranh giới đó để Leader quyết định; UI phải nói rõ tính năng chưa hỗ trợ cho Git, không cho bắt đầu một lượt migrate chắc chắn thất bại.

## Nhật ký

- START 09/10/2026 — bắt đầu triển khai G1b trên `feat/deploy-reachability`; giữ nhánh local, không dùng VPS thật.
- PLAN 09/10 — Leader review G1a local pass; kiểm kê UI hiện chỉ local và migrate còn phụ thuộc `source_path`. Giao một checkpoint bao trùm wizard Git, provenance/redeploy và migrate để G1 có thể qua gate trước live VPS G2.

## PR

Chưa được phép push, mở PR hoặc merge.

- UPDATE 09/10 — Hoàn tất wizard hai nguồn, handle/token lifecycle, Git redeploy/provenance/rollback lineage và restore migrate Git bằng payload relay + saved plan; local path vẫn giữ nguyên. 3 focused files: 100/100; full Vitest: 71 files, 657/657; lint; Node/Web/Scripts typecheck; build; `git diff --check` đều pass trên Node 22.23.3. Electron thật dark/light đã lưu tại `docs/evidence/tk-s7-g1b/` (CSS 1280×800, physical 1920×1200, scale 1.5); chỉ dùng fixture, không kết nối VPS. Xem README evidence để biết trạng thái từng ảnh.
- HANDOFF-LOCAL 09/10 — local commit sẽ được ghi sau khi chốt SHA; chưa push, chưa PR/merge.
