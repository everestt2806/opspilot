# TK-S7 P1c — Ingress ownership and read-only preflight

> Trạng thái: CHỜ REVIEW. Theo hợp đồng P1a; không cài/chạy Caddy, sửa config, mở firewall, ghi VPS hoặc đánh dấu domain active.

## Phạm vi đã triển khai

- `preflightSharedIngress()` nhận `SshManager` và VPS ID, chỉ gọi sáu lệnh cố định qua SSH đã ghim fingerprint: đọc TCP listener 80/443, unit `opspilot-caddy.service`, marker, khả năng đọc config, phiên bản binary Caddy và trạng thái UFW. Không ghép dữ liệu người dùng vào lệnh; không trả stdout/stderr thô.
- Marker ownership được quy ước là `/etc/opspilot/caddy/OWNER` với nội dung `opspilot-shared-ingress-v1`; config phải đọc được tại `/etc/opspilot/caddy/Caddyfile`; unit phải active, có fragment `/etc/systemd/system/opspilot-caddy.service` và `ExecStart` trỏ `/usr/bin/caddy` cùng config path đó. Listener PID phải khớp `MainPID`. Tên process `caddy` riêng lẻ không đủ.
- Kết quả ownership phân biệt `ports_free`, `opspilot_owned`, `conflict`, `unknown`; `local_assessment` tổng hợp `clear`, `blocked`, `unknown` cho listener/UFW trên host. Thiếu quyền đọc/thiếu bằng chứng fail closed. Reason code dùng `INGRESS_PORT_CONFLICT`, `INGRESS_OWNER_UNKNOWN`, `FIREWALL_80_BLOCKED`, `FIREWALL_443_BLOCKED`, `SSH_UNAVAILABLE` theo bằng chứng; UFW không đọc được trả `unknown`. `route_activation` luôn `not_evaluated`; `clear` không xác nhận cloud firewall, DNS, route hay HTTPS.
- `buildSharedIngressConfig()` là builder thuần cho tập route OpsPilot được truyền vào; chuẩn hóa/validate hostname, validate port, từ chối hostname trùng hoặc dữ liệu chèn, sort ổn định và render upstream loopback. Caller phải cung cấp toàn bộ route OpsPilot muốn giữ; builder không đọc hay sửa config của proxy khác.

## Gate

- Node 22.23.3 focused Vitest `src/main/domain/ingress/preflight.test.ts` và `routeBuilder.test.ts`: 23/23 PASS.
- Node 22.23.3 `pnpm --dir app typecheck`: PASS.
- Node 22.23.3 `pnpm --dir app build`: PASS.
- `git diff --check`: PASS.
- VPS development survey: NOT_RUN. Checkpoint này không dùng profile/SSH live; không có bằng chứng runtime nào được suy ra từ unit test.

## Giới hạn còn lại

Preflight hiện chỉ là module main-process, chưa có IPC/UI. UFW là trạng thái firewall trên host; cloud firewall, DNS, route thực tế và external HTTPS probe chưa được kiểm tra. Chưa cài/reconcile Caddy và chưa có hostname route nào được áp dụng.
