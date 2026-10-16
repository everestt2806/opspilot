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
