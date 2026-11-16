# R7h-4a — Backend PostgreSQL và kiểm chứng pipeline riêng

START16/11/2026 — product-mode, task-discipline, base `ef21f97`. Tách checkpoint kỹ thuật để lưu/push phần đã kiểm chứng, rồi tiếp tục R7h-4b. Người dùng yêu cầu tiếp tục tự chủ, chỉ dừng khi cần can thiệp. Không đổi giao thức ML, không dùng VPS đang giữ sáu app để chạy fault.

Phạm vi: kho credential mã hoá, liên kết source/env/database, transfer theo claim, actor PostgreSQL trong guarded runtime, proof H2, CLI chuẩn bị và gate schema037 riêng. PostgreSQL chạy thật trong Docker Linux local. **Chưa bật chức năng database trên bản app đang phục vụ**: initializer vẫn035/controller và036/desktop; schema037 chưa đăng ký, chưa có lựa chọn DB qua Main/UI hay Root rollout35→37.

| Requirement | Change / current-session evidence | State |
|---|---|---|
| Resource ổn định, secret riêng tư | UUID/admin/app password riêng, AES-GCM purpose/owner/target/image binding, request idempotency, hai kết nối cạnh tranh, không tự tạo/đổi master key; PG33tests trong full suite | PASS |
| Source và authority | DB selection giữ env cũ; env selection kế tiếp giữ DB; immutable bindings không sao chép receipt UUID. Claim/lease/source/target kiểm tra trước và sau decrypt, scoped HMAC transfer, context/receipt không có password | PASS |
| Pipeline thật | Express, Express+env, Next+env, env-trước-DB: bốn suite, mỗi suite7 runtime attempts, có1000rows và collector DB_DSN. Update/build fail/health rollback giữ đúng PG CID/volume/system-ID/data và app/collector cũ | PASS |
| Lifecycle/backup | Actor34checks, private network, không host5432, app không superuser, cold reopen/restart, wrong key/owner/target, FIFO/hardlink, mất response/DDL dở không replay/adopt/reset. pg_dump custom + checksum; pg_restore clone khớp1000rows và nội dung | PASS |
| Legacy và helper pins | Ba suite Express/SPA/Next có env không DB,7attempts/suite; exact9f8 runtime. Native bootstrap/enrollment29tests, gồm7historical framework pairs và SIGKILL/recover/cancel. Chỉ thêm exact forward runtime/bootstrap pair; không học pin từ máy đích | PASS |
| Schema riêng, không mở tính năng sớm | CLI chỉ nhận exact037, existing key; initializer035 không tự migrate. Native CLI7checks + native schema10checks: WAL backup sealed/root, atomic abort, giữ key/inode/rows, replay apply/revert,035 startup từ chối private037. Node8schema tests thêm chặn downgrade khi có resource hoặc target pin đã đổi | PASS |
| Gates | Full Vitest2563PASS +2Linux-onlySKIP; Node/Web/scripts/lab types, build, Ruff, contract tsc, diff; ESLint theo script repo0errors,880warnings định dạng ở file không sửa. Tất cả source thay đổi lint/format0warnings. Không tự format các file ngoài phạm vi | PASS |
| Serving / public UI / official ML | Ngoài phạm vi checkpoint a; R7h-4 toàn phần tiếp tục OPEN. Không có VPS write, release mới được approve, Main/UI claim, hay thí nghiệm ML chính thức | N/A |

## Bằng chứng

- `app/.out-scripts/product-postgres-runtime/0ae8c03da5f1/proof.json`:34checks, runtime9f8e1fbb, cleanup6fixtures.
- `product-runtime-lab/0e4d2d1573ea`: Express PostgreSQL,11checks/7attempts.
- `product-runtime-lab/1eb99194668b`: Express PostgreSQL+env,15checks/7attempts, active exposure sau rollback.
- `product-runtime-lab/7470ba7261cf`: Next PostgreSQL+env,18checks/7attempts, SSR/assets và rollback thật.
- `product-runtime-lab/38406d3614f6`: chọn env trước DB,15checks/7attempts, inherited env binding thật.
- Legacy3reports và raw gates được chốt trong `docs/ui-redesign/r7h4a-verification.json`; file SQLite/key/env/raw archive của lab đều ngoài Git.
- Native CLI/schema cuối: `product-postgres-preparation/3ed88d586361`, `product-postgres-schema/e13b0a435578`. `r7h4-final-{full,quality,eslint-build,changed}.json` ghi command/exit code/log. Mỗi report native ghi hash source/artifact, quiescence và cleanup.

## Điều chỉnh đã có bằng chứng

1. Trial0348953bc97b FAIL do fixture tạo bảng bằng admin, app không có SELECT. Sửa fixture dùng đúng role app, không nới quyền.
2. Trial b3fb48ce6cd6 FAIL ở exposure sau rollback khi source có DB; sửa `controllerExposureSource` xác minh binding DB/env kế thừa, hai suite kết hợp sau đó pass.
3. SQL contract từng bị writer đổi CRLF; baseline checkoutef21f97 chạy39test pass. Đưa contract về LF, không sửa migration đã áp dụng,39test hiện hành pass.
4. Full suite đầu38fail:37chỗ kỳ vọng helper cũ và1SQL-line-ending. Thêm candidate transition exact9f8/e1a, cập nhật assertion cho phiên bản mới và giữ negative/tamper/reverse tests. Full cuối2563PASS.
5. Linter quét2.865JS/CJS trong controller bundles và vendor ML runtime; bỏ hai thư mục artifact khỏi ESLint, giữ source/scripts. Full lint0errors/880warnings cũ; changed-file lint0warnings. Không che lỗi source.

## Handoff sang R7h-4b

1. Root journal/backup riêng35→37, startup và cold recovery/rollback, chặn downgrade sau resource/target-helper changes; đăng ký037 chỉ khi có toàn bộ gate này. Nguồn29 phải qua release035 đã duyệt trước khi lên PG release, hoặc phải có thiết kế hai backup riêng được kiểm chứng.
2. Harden Docker stdout reader: lỗi đọc phải luôn trả unknown; thêm gate IO đóng pipe/timeout trước khi approve phục vụ. Đây là nhánh lỗi của runner cũ cần xử lý trong bước runtime tiếp theo; candidate9f8 chưa được đưa lên serving catalog.
3. CLI review/select/state có actual PG-capable helper probe, readiness rõ prepared/ready/unknown, không unpause hay deploy ngầm. Main/IPC/UI chọn instance rõ ràng; không dùng container đầu tiên khi một VPS có nhiều database.
4. Backup/restore và recovery vận hành có xác nhận/lease/fence, export riêng tư, checksum/row proof; production restore không được ghép vào rollback app. Hoàn thiện reconnect/migrate có DB.
5. Frozen candidate release + Root/systemd/Main + app mới trên VPS sau fresh pinned read-only attestation; giữ sáu app cũ. Catalog hiện8pins, cần bounded extension có test trước descriptor mới. GUI/packaging/soak và formal ML vẫn riêng.

HANDOFF-LOCAL16/11 — Local HEAD trước commit:ef21f97. SHA checkpoint lấy bằng `git log -1 -- docs/tasks/tk-s7-release-r7h4a-postgres-runtime.md`. Commit/push thường, Kim coauthor, không PR/merge/reset/clean/stash/rebase/force. Không kết luận toàn bộ R7h-4 hoặc release04/12 đã hoàn tất.
