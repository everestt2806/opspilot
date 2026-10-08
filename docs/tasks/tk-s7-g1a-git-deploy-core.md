# TK-S7 G1a — Nối snapshot Git vào deploy core

> Phụ thuộc: [G0](tk-s7-g0-two-source-git.md) đã qua review local; xem [audit Git](../30-audit-git-first-deploy.md) và [kế hoạch demo](../29-ke-hoach-demo-14-10.md). G1a là backend checkpoint; chưa được giới thiệu là người dùng đã deploy Git qua UI.

| Chủ | Hạn mục tiêu | Branch | Ưu tiên |
|---|---|---|---|
| Worker | 10/10/2026; không bỏ gate để kịp demo | `feat/deploy-reachability` | P0 |

## Mục tiêu

Chuẩn bị nguồn Git công khai một lần, trả full SHA và kết quả detector, rồi dùng **đúng snapshot đó** qua precheck/start/upload/build/record. Git là nguồn app; đường checkout tạm chỉ là payload, không được lưu vào `app.source_path`. Luồng deploy trực tiếp từ thư mục tiếp tục chạy như trước.

## Ranh giới

- Được sửa contract IPC/schema và DECISIONS theo quy trình contract-first, rồi main deploy/service/pipeline/repository/IPC/preload liên quan cùng test. Không thêm migration nếu schema 007 đủ; nếu cần thì dùng migration mới, không sửa 007.
- Không sửa UI trong G1a; UI, lịch sử hiển thị và migrate Git app thuộc G1b. Chưa dùng VPS thật, private Git, webhook, HTTPS hay control plane.
- Không push, PR, merge, reset, clean, stash hoặc ghi credential/stderr thô vào log/test/DB.

## Definition of Done

- [x] Contract nói rõ Git source (`repo/ref/root`) và một **opaque prepared-source handle**; renderer không được nhận đường temp. Pha sửa contract/DECISIONS commit riêng, compile/typecheck được trước runtime. Luồng local cũ tương thích; Git không cần `source_path` giả.
- [x] Prepare Git dùng module G0, pin full SHA rồi detect từ chính root đã checkout. Precheck/start dùng cùng handle/SHA, không fetch lại branch âm thầm. Nếu nguồn/target/env đổi làm precheck cũ vô hiệu; handle sai/hết hạn/đã dùng trả lỗi rõ. Có cleanup khi hủy, lỗi, đóng app và hết hạn; **không dọn khi pipeline còn dùng**.
- [ ] `deploy:start` vẫn trả `deployment_id` theo contract hiện có hoặc contract được sửa rõ ràng trước code; event đến sớm không bị mất. Git acquisition bất đồng bộ không tạo app/deployment mồ côi khi fail. Chặn hai deploy đồng thời trên cùng app và không cho redeploy Git vô tình chuyển thành local.
- [x] AppRepository lưu `source_type=git`, URL/ref/root và `source_path=NULL`; DeploymentRepository lưu URL/full SHA cho từng attempt **trong cùng transaction tạo deployment**. Các hàm đọc trả provenance thật. Local cũ vẫn là local với Git metadata NULL. Rollback lineage chỉ gắn SHA của image gốc nếu hiển thị provenance.
- [x] Test core cho branch đổi sau prepare, handle sai/hết hạn/replay, cancel/cleanup, fetch/detect thất bại, provenance ở DB, local regression, IPC early events. Không dùng working tree của OpsPilot để giả làm Git. CLI/backend integration test chứng minh prepare→precheck→start bằng snapshot fixture.
- [x] Node 22: focused tests, full Vitest, lint, Node/Web/Scripts typecheck, build và `git diff --check` pass. Ghi lệnh/kết quả thật, commit cục bộ và cập nhật task/board. Khi bàn giao chỉ trả lời “Worker đã xong”.

## Nhật ký

- PLAN 08/10 — Leader review G0 local pass; tách G1 thành core G1a và UI/migrate G1b để kiểm chứng vòng đời snapshot trước khi mở giao diện.
- START 08/10 — Đọc G0/audit/contracts; commit riêng contract IPC + DECISIONS, sau đó nối opaque snapshot handle xuyên detect/precheck/start, provenance DB, lifecycle cleanup và hồi quy local; chạy mọi gate trên Node 22.
- UPDATE 08/10 — Contract/DECISIONS đã commit riêng `494e1e2`. Runtime nối prepare/cancel IPC, lease snapshot với token precheck, start dùng cùng checkout và lưu URL/full SHA vào deployment; Git app lưu `source_path=NULL`; snapshot được dọn sau pipeline và khi shutdown. Test xác nhận prepare→precheck→start giữ nguyên root/SHA, target đổi làm token mất hiệu lực, lifecycle shutdown và provenance DB; G0 snapshot tests giữ bằng chứng branch move/cancel/cleanup. Node 22.23.3: focused 20 pass; full Vitest với `--maxWorkers=2` 71 file/648 pass. Lượt chạy mặc định trước đó có 1 test UI flaky (loading race), test riêng pass. `pnpm test` trước đó: Vitest 643 + ML 19 pass. Node/Web/Scripts typecheck, lint, build, CLI G0 snapshot, `git diff --check` pass.
- REVIEW 09/10 — Leader chạy lại focused 50/50 pass trên Node 22. Chưa duyệt G1a: test handoff mock `pipeline.run`, chưa chứng minh DB/cleanup của pipeline thật; `openLogStream()` có thể lỗi trước `try` của `executeLocked()` và bỏ qua release/cleanup; chưa có release cho prepared handle bị bỏ dở. Bổ sung test vòng đời thật và các nhánh lỗi trước khi sang G1b.
- CONTRACT UPDATE 09/10 — Thêm `deploy:release-git-prepare(handle)` để cleanup chủ động khi người dùng bỏ dở; snapshot đang được pipeline dùng vẫn do pipeline sở hữu tới khi hoàn tất. Contract + DECISIONS commit riêng `76dc5b2`, typecheck trước runtime pass.
- UPDATE 09/10 — Runtime sửa finalize idempotent cho lock/snapshot; mở log lỗi vẫn ghi deployment `failed`, dọn snapshot và nhả app lock; event renderer ném lỗi được cô lập, cleanup xong trước event `finished`. Thêm `deploy:release-git-prepare`; release bỏ dở/TTL không dọn lease đang chạy. Integration không mock `pipeline.run`: bare Git fixture đổi branch sau prepare; upload vẫn dùng marker/SHA cũ, SQLite lưu app/deployment provenance, snapshot được dọn trước `finished`. Test lỗi mở log, retry cùng app, event lỗi, expiry/replay và release khi lease đang chạy.
- GATES 09/10 — Node `v22.23.3`, pnpm `11.1.0`: focused deploy/lifecycle 55 pass; full Vitest mặc định lượt cuối 71 file/652 pass; `pnpm typecheck`; Scripts `tsc -p tsconfig.scripts.json --noEmit`; `pnpm lint`; `pnpm build`; `pnpm test:ml` (19 pass); contract strict `tsc`; CLI `pnpm --filter @opspilot/app try:git-snapshot -- https://github.com/everestt2806/opspilot.git main demo-apps/express-api`; `git diff --check` all pass. Full mặc định ở lượt trước từng fail 1 UI test `VpsDatabaseTab` vì bảng còn loading lúc assertion đọc `blog_admin`; test riêng pass, lần full cuối mặc định pass toàn bộ.
- REVIEW 09/10 — Leader chạy lại 54/54 test trọng tâm Node 22; tích hợp thật và cleanup đã có bằng chứng. Còn một nhánh vi phạm bất biến `finished` đúng một lần: nếu `resumeCollector()` ném lỗi trong `executeLocked()` catch, finally đã phát `finished`, rồi `run().catch → failUnexpected()` phát thêm lần nữa. Yêu cầu guard idempotent và test fault injection trước G1b.

## PR

Chưa được phép push, mở PR hoặc merge.
