# TK-S7 P1d — DNS and certificate readiness

> Trạng thái: CHỜ REVIEW. P1d chỉ đọc DNS, domain binding và preflight P1c. Không sửa DNS/firewall/Caddy/VPS, không cấp certificate, không ghi certificate/route state và không chạy external HTTPS probe.

## Phạm vi

- Thêm `checkSharedIngressReadiness()` và IPC `domain:ingress-readiness`. IPC chỉ nhận hostname đã bind ở mode `shared_ingress` và VPS ID tương ứng; lấy endpoint từ DB, chạy P1c qua `SshManager` rồi truy vấn DNS. Handler không gọi `domain:check` hoặc `domain:upsert` và không ghi DB.
- Dùng Node DNS resolver cấu hình public resolvers `1.1.1.1` và `8.8.8.8`. Truy vấn CNAME theo từng hop, giới hạn 8 hop, phát hiện vòng lặp; lấy cả A và AAAA cuối chuỗi. Host VPS dạng IP phải là public; dạng hostname được phân giải qua cùng resolver và cũng chỉ nhận địa chỉ public.
- DNS chỉ `propagated` khi mọi IP cuối cùng đều nằm trong tập public IP của endpoint VPS. Phân biệt `nxdomain`, `no_records`, `resolver_error`, `target_mismatch`, `mixed_target`, `cname_loop`, `cname_depth_exceeded`, `ipv6_unreachable` và `expected_target_unresolved`.
- Nếu IPC nhận bằng chứng `cloudflare_proxy_status=enabled`, không so A/AAAA Anycast với IP VPS; trả `cloudflare_proxied` cùng hướng dẫn xác minh origin/DNS only. Proxy evidence không làm readiness thành active.
- Kết hợp từng port/UFW, ownership và install assessment từ P1c để báo `acme_http_01`/`acme_tls_alpn`. Cloud firewall chưa có adapter nên luôn `unknown`; IPv6 quảng bá nhưng thiếu target hoặc bị UFW chặn là `ipv6_unreachable`. DNS đúng không tự chứng minh thử ACME thành công.
- Kết quả luôn giữ `certificate_status=not_requested`, `route_status=not_configured`, `https_probe_status=not_run`, `overall_status=unknown`. Không ghi secret hay kết quả preflight vào SQLite.
- Shared IPC và `docs/contracts/ipc-contract.ts` cùng khai báo channel/result/reason codes. Không thêm reason code vào persisted `DomainReasonCode`/migration. Hành vi `domain:check` và `domain:upsert` giữ nguyên.

## Gate

- Node 22 focused Vitest: `domain/ingress/dnsReadiness.test.ts`, `preflight.test.ts`, `routeBuilder.test.ts` và `ipc.test.ts`.
- Node 22 `pnpm --dir app typecheck`.
- Node 22 `pnpm --dir app build`.
- `git diff --check`.
- Live DNS/HTTPS: **NOT_RUN** — chưa có hostname thử nghiệm được chỉ định. Không truy vấn hostname/VPS thật.

## Giới hạn

- Cloud firewall chưa được kiểm chứng; do đó readiness ACME không được báo ready-to-try trong lần triển khai này. `overall_status` luôn unknown cho tới khi có certificate, route và external HTTPS probe từ checkpoint triển khai tương ứng.
- Trạng thái Cloudflare Proxy là evidence do caller truyền vào cho mục đích hướng dẫn. Khi `enabled`, kết quả luôn thận trọng và không khẳng định origin reachability.

## Update 15/10/2026

- Node 22.23.3 focused Vitest: 4 files, 61/61 tests PASS (DNS readiness, P1c preflight, route builder, IPC).
- Node 22.23.3 pnpm --dir app typecheck: PASS.
- Node 22.23.3 pnpm --dir app build: PASS.
- Node 22.23.3 git diff --check: PASS (Git only noted board.md line-ending normalization).
- No test hostname was specified. Live DNS and HTTPS: NOT_RUN; no DNS, firewall, Caddy, certificate, route, or VPS changes were made.
