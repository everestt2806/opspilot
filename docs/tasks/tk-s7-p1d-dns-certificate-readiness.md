# TK-S7 P1d — DNS and certificate readiness

> Trạng thái: CHỜ REVIEW. P1d chỉ đọc DNS, domain binding và preflight P1c. Không sửa DNS/firewall/Caddy/VPS, không cấp certificate, không ghi certificate/route state và không chạy external HTTPS probe.

## Phạm vi

- Thêm `checkSharedIngressReadiness()` và IPC `domain:ingress-readiness`. IPC chỉ nhận hostname đã bind ở mode `shared_ingress` và VPS ID tương ứng; lấy endpoint từ DB, chạy P1c qua `SshManager` rồi truy vấn DNS. Handler không gọi `domain:check` hoặc `domain:upsert` và không ghi DB.
- Dùng hai Node DNS resolver độc lập, lần lượt `1.1.1.1` và `8.8.8.8`; mỗi resolver có timeout 2.5 giây và bị hủy khi hết hạn. Truy vấn CNAME theo từng hop, giới hạn 8 hop, phát hiện vòng lặp; lấy cả A và AAAA cuối chuỗi. Chỉ xác nhận cùng kết quả khi cả hai resolver trả cùng chuỗi CNAME và cùng tập A/AAAA; lệch kết quả hoặc lỗi một resolver giữ trạng thái chưa xác minh.
- DNS chỉ `propagated` khi cả hai resolver thống nhất và mọi IP cuối cùng đều nằm trong tập public IP của endpoint VPS. Phân biệt `nxdomain`, `no_records`, `resolver_error`, `resolver_disagreement`, `resolver_timeout`, `target_mismatch`, `mixed_target`, `cname_loop`, `cname_depth_exceeded`, `ipv6_unreachable` và `expected_target_unresolved`. Chuẩn hóa IPv6 trước khi so sánh; loại chính xác các dải special-use, gồm IPv6 `2001:db8::/32` và ba dải IPv4 TEST-NET.
- `cloudflare_proxy_hint` là gợi ý do renderer/người dùng truyền, không phải trạng thái xác minh từ Cloudflare. Hint bật trả `proxy_hint_unverified`, không so IP Anycast với VPS; hướng dẫn yêu cầu xác minh origin tại DNS provider. Hint này không được dùng làm bằng chứng hay kích hoạt HTTPS trong P1e.
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
- Cloudflare Proxy chưa được tích hợp/xác minh từ provider. Hint của renderer không chứng minh cấu hình provider hoặc origin reachability.

## Update 15/10/2026

- Node 22.23.3 focused Vitest: 4 files, 61/61 tests PASS (DNS readiness, P1c preflight, route builder, IPC).
- Node 22.23.3 pnpm --dir app typecheck: PASS.
- Node 22.23.3 pnpm --dir app build: PASS.
- Node 22.23.3 git diff --check: PASS (Git only noted board.md line-ending normalization).
- No test hostname was specified. Live DNS and HTTPS: NOT_RUN; no DNS, firewall, Caddy, certificate, route, or VPS changes were made.

## Update — resolver consistency and hint semantics

- Node 22.23.3 focused Vitest: 4 files, 74/74 tests PASS, bao gồm resolver disagreement/timeout, hủy resolver, IPv6 dạng đầy đủ/rút gọn, `2001:db8::/32` và IP ở hai phía các dải IPv4 TEST-NET.
- Kết quả IPC liệt kê rõ hai resolver; timeout mỗi resolver là 2.5 giây. Mọi khác biệt hoặc lỗi resolver giữ DNS chưa xác minh.
- IPC đổi `cloudflare_proxy_status` thành `cloudflare_proxy_hint`; output và hướng dẫn nói rõ đây chỉ là gợi ý người dùng và P1e không được dùng để kích hoạt HTTPS.
- Node 22.23.3 `pnpm --dir app typecheck`: PASS; `pnpm --dir app build`: PASS; `git diff --check`: PASS.
- Live DNS/HTTPS tiếp tục NOT_RUN vì không có hostname thử nghiệm được chỉ định.
