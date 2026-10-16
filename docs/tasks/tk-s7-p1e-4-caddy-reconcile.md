# TK-S7 P1e-4 — atomic Caddy reconcile

> Trạng thái: CHỜ REVIEW. Backend only; no IPC/UI/pipeline and no VPS invocation.

## START 2026-10-16

- Yêu cầu: inventory từ DB hiện hành; giữ toàn bộ route OpsPilot; lock + pinned SSH; owner/service/config-generation/DNS/firewall recheck; atomic apply và state-aware rollback; không ghi HTTPS active.
- Kiểm thử: phase faults, first start/reload/multi-route/idempotency/stale/competition/DB failure/rollback conflict; file thật trên Linux cô lập; ghi riêng Caddy thật và systemd mock.
- Gates: focused ingress/SSH, tmpfs integration, typecheck, build, scoped lint, `git diff --check`; không gọi VPS thật, không đổi IPC/UI/pipeline.

## UPDATE 2026-10-16

- Thêm `DomainRepository.getSharedIngressInventory()` để chỉ lấy shared-ingress của VPS còn hoạt động; binding bật chỉ hợp lệ khi DNS, ownership key, app chưa import, host port và deployment OpsPilot hiện hành cùng khớp. Revision bao gồm identity VPS, toàn bộ binding và desired generation. Observation được ghi trong transaction, chỉ đặt `pending`/`disabled`, không nâng route, certificate hoặc HTTPS probe.
- Builder nhận route từ inventory, sắp thứ tự xác định và tách `production` khỏi `acme_staging`; staging chỉ được phép với hostname lab trong allowlist nội bộ.
- Reconcile dùng mutex VPS chung installer, pinned host identity trước preflight và `execWithHostIdentity` trước dispatch; remote script dùng chung `flock`, xác minh owner/unit/service, config hash/generation, DNS A/AAAA/CNAME bằng hai resolver và UFW trong khóa. Cloud firewall phải có evidence `verified_open` trước dispatch; thiếu evidence thì không ghi.
- Candidate, config/state snapshot và publish dùng file cùng filesystem cùng `mv` nguyên tử. Bắt đầu lần đầu hoặc reload, sau đó so sánh adapted config với `/config/` của Caddy admin loopback. Lỗi pha và lỗi DB cố gắng phục hồi config/state cùng trạng thái active/enabled nếu generation vẫn do transaction sở hữu; xung đột hoặc rollback không xác minh được trả trạng thái cần đối chiếu. Nếu remote đã-current và DB observation lỗi thì không chạy rollback giả vì không có thay đổi remote. File tạm `adapt`/`live` được tạo no-clobber và chỉ dọn khi identity còn khớp; test symlink xác nhận sentinel không đổi.
- Thành công chỉ ghi observation pending/disabled; không ghi `route_status=active`, certificate hợp lệ hay probe HTTPS. Container và URL HTTP không bị thay đổi. DB lỗi sau apply kích hoạt rollback có kiểm tra generation.
- Gates Node 22.23.3 trên trạng thái cuối: `vitest run src/main/domain/ingress src/main/ssh src/main/db/index.test.ts` — 13 files, 219 passed, 1 skipped; WSL Ubuntu tmpfs integration — 1 passed, gồm first start, nhiều route/reload, idempotency, lỗi validate/write/start/reload/verify/rollback và symlink temp. `typecheck` PASS; `build` PASS.
- Scoped ESLint chạy trên 7 file cuối: exit 0, 0 errors, 230 warnings (không gọi lint sạch). `git diff --check` PASS.
- Caddy binary thật và `systemd` thật: NOT_RUN; integration dùng Caddy/systemctl shim trên filesystem Linux `/dev/shm` trong WSL. VPS thật, IPC/UI/pipeline: NOT_RUN theo phạm vi.

## UPDATE 2026-10-16 — review 3a5d509

- Tách kết quả `service='verified'` (artifact được xác minh) khỏi `service_state='active'|'inactive'`. Service inactive chỉ được xác minh khi INSTALLATION, binary hash/version/architecture, symlink/path cha, unit hiệu lực không drop-in, marker/config, firewall và listener đều đạt kiểm tra hiện có. Reconcile dùng chung các kiểm tra ownership đó; inactive chỉ chấp nhận khi không có listener và service ownership độc lập trả `active=false`.
- Thêm kiểm tra prior generation + config SHA-256 lấy từ `ingress_reconcile_observation`. Giá trị được so khớp với config/state remote bên trong lock trước ghi. Nếu caller cũ gửi revision trước, remote không còn trạng thái ban đầu hoặc writer khác đã tiến generation, thao tác trả conflict và không ghi đè. Test Linux tmpfs bao gồm stale caller và writer mới trước rollback.
- Rollback sau lỗi DB khi service ban đầu active dùng `systemctl reload`, kiểm tra service còn active và so sánh cấu hình đã load qua admin API trước khi báo `rolled_back`. Shim giữ loaded config riêng với file trên đĩa; `start` khi service đã active không reload. Test xác nhận rollback cũ không ghi đè generation của writer mới hơn.
- Bổ sung integration test đi từ `collectCaddyAptEvidenceOverSsh` + planner + `installCaddyFirstRunOverSsh` trả `installed_not_running` tới reconcile đầu với artifact verified/service inactive. Không dùng fixture service vừa verified vừa mang trạng thái active mâu thuẫn.
- UFW parser đọc cấu trúc rule/cột, dùng fixture numbered đã căn cột cho IPv4/IPv6; rule DENY theo nguồn cụ thể, rule chồng lấn hoặc dòng không hiểu đều fail closed. Linux tmpfs chạy thực trên `/dev/shm` WSL.
- Gate cuối Node 22.23.3: `vitest run src/main/domain/ingress src/main/ssh src/main/db/index.test.ts` — 13 files, 223 passed, 1 skipped; Linux filesystem harness nằm trong focused suite và PASS. `typecheck` PASS; `build` PASS; ESLint phạm vi 11 file: 0 errors, 594 warnings (không gọi lint sạch); `git diff --check` PASS.
- Caddy binary không có trong WSL nên Caddy thật validate/load: NOT_RUN. Thao tác lifecycle/runtime systemd trong integration vẫn dùng shim; systemd service thật và VPS thật: NOT_RUN. IPC/UI/pipeline không nối theo phạm vi.
