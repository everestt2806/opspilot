# TK-S7 P1a — Shared ingress/HTTPS: hợp đồng và kế hoạch

> Trạng thái: thiết kế checkpoint, chưa triển khai runtime và chưa ghi lên VPS. Branch `feat/deploy-reachability`; nguồn trạng thái task là `docs/tasks/board.md`.

## Mục tiêu và quyết định

Chọn **Caddy 2 làm shared ingress do OpsPilot sở hữu trên mỗi VPS**, chạy như systemd service host-native. Caddy reverse-proxy theo hostname đến `127.0.0.1:<app.host_port>`; không đổi container/app image, không yêu cầu tham gia Docker network, và không mở public từng app port mới. Mỗi VPS có đúng một instance ingress được OpsPilot quản lý. Không tự tiếp quản Caddy/proxy đã tồn tại.

Chọn Caddy vì Automatic HTTPS và reverse proxy là khả năng tích hợp sẵn, phát hành/gia hạn certificate tự động, hỗ trợ validate/reload cấu hình; upstream loopback khớp host port hiện tại của OpsPilot. Nguồn chính thức được truy cập ngày 14/10/2026:

- [Caddy Automatic HTTPS](https://caddyserver.com/docs/automatic-https): hostname công khai và DNS đúng kích hoạt HTTPS; HTTP challenge cần cổng 80, TLS-ALPN challenge cần 443; DNS challenge chỉ dùng khi cấu hình provider/module tương ứng.
- [Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy): reverse proxy HTTP tới upstream, hỗ trợ health checks và header forwarding.
- [Caddy API](https://caddyserver.com/docs/api): API quản trị mặc định chỉ bind loopback; không public admin endpoint.
- [Caddy command line — reload](https://caddyserver.com/docs/command-line#caddy-reload): kiểm tra/áp dụng cấu hình bằng reload graceful.
- [Let's Encrypt challenge types](https://letsencrypt.org/docs/challenge-types/): HTTP-01 nhận challenge ở port 80; DNS-01 cần TXT và quyền DNS.

## Hợp đồng v1

### Sở hữu cổng và preflight

- OpsPilot chỉ bind wildcard TCP 80/443 sau khi preflight chứng minh hai cổng đang trống hoặc listener/service có identity marker và systemd unit của chính OpsPilot. Không chỉ dựa vào tên process `caddy`.
- Nếu bất kỳ cổng nào do nginx, Apache, Docker-published port, Caddy không thuộc OpsPilot, hoặc owner không xác định chiếm dụng: trả `INGRESS_PORT_CONFLICT`/`INGRESS_OWNER_UNKNOWN`; không stop/disable/ghi đè service, container hay firewall rule của bên khác.
- Nếu ingress của OpsPilot đã tồn tại: xác minh executable/version, unit, config path, admin bind và ownership marker trước reconcile. Sai lệch là conflict, yêu cầu người dùng xử lý thủ công.
- Chỉ expose 80/443; upstream vẫn là app host port hiện có trên loopback. Port allocation app `30000–30999` và URL hiện tại `http://<host>:<host_port>` được giữ nguyên. Không tự đóng port cũ trong checkpoint đầu.
- Preflight đọc trạng thái listener, systemd, UFW và cloud firewall capability. Không tự thay cloud firewall nếu chưa có provider adapter + credential scope được xác nhận; thiếu inbound 80/443 thì trả hướng dẫn cụ thể, không giả định rule đã mở.

### DNS, hostname và route

- Chỉ bind hostname đã normalize/validate, duy nhất toàn DB; `domain_binding` có ownership fingerprint. Không nhận wildcard ở v1.
- Trước cấu hình route, kiểm tra DNS công khai: tất cả A/AAAA phải trỏ đúng public IP của VPS; CNAME phải resolve tới đích đã xác nhận và kết quả cuối đúng VPS. NXDOMAIN, record lẫn target hoặc target khác là lỗi riêng, không cấp cert.
- Nếu VPS công bố IPv6/AAAA thì probe/firewall phải chứng minh IPv6 hoạt động; nếu không, người dùng phải sửa/xóa AAAA trước khi active để tránh client đi IPv6 lỗi.
- Chỉ route binding `mode='shared_ingress'` được bật, deployment thuộc đúng app/VPS và app `running`/local health pass. Route `hostname -> 127.0.0.1:host_port`; không đưa URL upstream hoặc header client-controlled vào cấu hình.
- DNS Cloudflare API hiện tại chỉ lo record; token scoped chỉ ở request/memory, không lưu DB. Nhà cung cấp khác cần cùng contract, không suy ra quyền DNS từ hostname.

### TLS, config apply và rollback

- v1 dùng Caddy Automatic HTTPS với ACME HTTP-01/TLS-ALPN; yêu cầu DNS đúng, outbound ACME khả dụng và inbound 80/443. DNS-01 là ngoài scope v1 vì cần adapter/module và secret DNS riêng.
- Caddy tự gia hạn; data/cert storage phải ở thư mục riêng của service với quyền tối thiểu, backup theo chính sách, không đưa private key/cert secret vào SQLite, log, IPC hay task evidence.
- Admin API chỉ loopback; mọi thao tác qua pinned SSH và command allowlist. Không shell-interpolate hostname/upstream; tạo config bằng serializer có escaping và validate hostname/port trước.
- Tạo candidate config trong cùng filesystem với mode hạn chế; `caddy validate` trước khi publish. Giữ bản config active; rename atomic candidate sang active rồi `caddy reload`. Reload graceful không được chấm dứt route cũ trước khi config mới được nhận.
- Nếu validate/reload thất bại: atomic restore config cũ, reload lại config cũ, verify service; trả lỗi gốc và trạng thái rollback. Nếu rollback cũng thất bại, báo `INGRESS_ROLLBACK_FAILED`, giữ app/container nguyên trạng, không xóa config backup để support phục hồi.
- Cấu hình có route app khác phải được giữ nguyên. Việc reconcile serialize theo VPS để tránh hai deploy cùng ghi config; idempotency theo binding/revision.

### Active, degraded và lỗi cho người dùng

- `domain_binding.route_status='active'` chỉ khi `dns_status='propagated'`, Caddy route đã reload thành công, cert hợp lệ cho cùng hostname và **probe HTTPS từ ngoài VPS cho cùng hostname** hoàn tất với TLS hostname validation + response theo policy. API DNS 200, Caddy reload 200, hoặc probe localhost không đủ. Cột `status` cũ được giữ làm DNS mirror tương thích.
- Sau loopback healthcheck, lỗi publish không rollback/stop app healthy. Giữ `app.url` hiện tại, deployment `running`; ghi exposure `degraded`/domain status lỗi và chỉ dẫn khắc phục. Không hiển thị URL HTTPS như đã dùng được trước external probe.
- Mã lỗi có cấu trúc, không parse log: `DNS_NOT_PROPAGATED`, `DNS_TARGET_MISMATCH`, `DNS_IPV6_UNREACHABLE`, `INGRESS_PORT_CONFLICT`, `INGRESS_OWNER_UNKNOWN`, `FIREWALL_80_BLOCKED`, `FIREWALL_443_BLOCKED`, `INGRESS_INSTALL_FAILED`, `INGRESS_CONFIG_INVALID`, `INGRESS_RELOAD_FAILED`, `INGRESS_ROLLBACK_FAILED`, `CERTIFICATE_PENDING`, `CERTIFICATE_ISSUE_FAILED`, `HTTPS_PROBE_FAILED`, `UPSTREAM_UNHEALTHY`, `DOMAIN_OWNERSHIP_CONFLICT`, `SSH_UNAVAILABLE`, `CANCELLED`.
- Trạng thái hiển thị ít nhất: preflight/pending, propagated, configuring, certificate pending, active, degraded/failed, conflict, disabled. UI nói rõ nguyên nhân quan sát được, bước tiếp theo và URL HTTP cũ còn phục vụ; không lộ stdout/stderr/credential.

## Chia checkpoint triển khai

| Checkpoint | Phạm vi file dự kiến | Definition of Done | Test / live gate |
|---|---|---|---|
| **P1b — Contract + persisted state** | `app/src/shared/ipc.ts`, `docs/contracts/ipc-contract.ts`, `docs/contracts/schema.sql`, migration kế tiếp sau 009, `app/src/main/db/*`, `app/src/main/domain/*` | Domain TLS/reconcile state và reason codes có kiểu; migration tương thích dữ liệu cũ; version/revision và ownership không nhập nhằng; docs contract khớp IPC | Migration upgrade fixture + FK check; IPC parity test; state transition/serialization tests. Chưa cần VPS. |
| **P1c — Ingress ownership/preflight** | module mới `app/src/main/domain/ingress/*`, `app/src/main/ssh/*`, `app/src/main/domain/*` | Probe listener/systemd/UFW/cloud capability read-only; chỉ nhận service có marker OpsPilot; builder route an toàn; conflict fail closed; lệnh qua pinned SSH | Unit fixtures cho mỗi owner/unknown/ports; command injection/property cases; mocked SSH. Live gate chỉ đọc trên VPS được phép, chưa bind cổng. |
| **P1d — DNS + certificate readiness** | `app/src/main/domain/dns.ts`, `app/src/main/domain/*`, `app/src/main/ipc.ts`, `app/src/shared/ipc.ts` | DNS records verify đầy đủ A/AAAA/CNAME; preflight inbound/firewall; ACME challenge prerequisites rõ; secrets chỉ memory, không persist | Resolver/provider contract tests, DNS mismatch/IPv6/firewall tests. Live gate trên hostname thử nghiệm có quyền, chỉ đọc đến khi người dùng duyệt thay đổi DNS/firewall riêng. |
| **P1e — Atomic reconcile + rollback** | `app/src/main/domain/ingress/*`, `app/src/main/domain/*`, `app/src/main/deploy/exposure.ts`, `app/src/main/deploy/pipeline.ts` | Serialize mỗi VPS; validate candidate; atomic replace/reload; rollback old config; preserve all existing routes; HTTPS active chỉ sau external probe; publish fail giữ app running + URL cũ | Fault injection tại write/validate/rename/reload/rollback/cert/probe; integration trên profile/container lab. Live gate riêng: VPS phát triển + hostname test + backup/rollback rehearsal + explicit operator window; chứng minh app URL cũ vẫn sống khi HTTPS fail. |
| **P1f — UI, diagnosis, operations** | Domain/VPS renderer components, strings 4 locales, IPC/renderer tests, task/runbook docs | Trạng thái và mã lỗi user-facing, retry/reconcile/disable rõ; không tuyên bố active sớm; hỗ trợ thao tác rollback và audit evidence đã khử nhạy cảm | Interaction tests cho transitions/stale result/retry; Electron layout check. Live gate chỉ sau P1e, xác nhận ngoài mạng cert, renew plan và rollback không gián đoạn app. |

Không chạy live gate bằng production domain/VPS; mỗi gate phải dùng hostname thử nghiệm có quyền và có thời gian rollback. P1a hiện tại là tài liệu/hợp đồng, không thay đổi source runtime.

## Trạng thái nền hiện tại

- `app/src/main/domain/assistant.ts` đã định nghĩa `direct_port`, `shared_ingress`, `named_tunnel`; shared-ingress plan hiện chỉ đưa hướng dẫn, không tạo route.
- `domain_binding` trong schema 004 lưu hostname/mode/provider/record/ownership/status/evidence; chưa lưu kết quả TLS/ingress reconcile riêng.
- IPC `domain:plan/check/upsert` và DNS Cloudflare adapter đã có; `domain:upsert` ghi desired-state, không chứng minh Caddy/HTTPS active.
- `app/src/main/deploy/exposure.ts` hiện mở UFW cho từng app port và probe URL hiện tại; chưa quản lý 80/443 hay HTTPS hostname.
- `DeployPipeline.publishExposure()` giữ deployment healthy khi publish lỗi. Đây là invariant cần bảo toàn.
- Git manual deploy/redeploy đã qua live gate, xem [G2](tk-s7-g2-live-git-vps-smoke.md), [G2b](tk-s7-g2b-local-template-vps-smoke.md) và [bằng chứng demo](../demo-14-10/evidence.md). Push-to-deploy và HTTPS vẫn chưa được chứng minh.

## Quyết định còn khóa trước P1b

P1a chọn Caddy và định nghĩa fail-closed ownership. Trước runtime, review phải duyệt: systemd host-native package/install path theo distro hỗ trợ; policy cập nhật Caddy binary; cách đưa firewall 80/443 vào cloud provider adapter; external probe vantage/timeout; retention/backup Caddy certificate storage; và semantics schema cho domain status/reason. Không có quyết định nào ở đây cho phép thao tác VPS trong P1a.
