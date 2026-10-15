# TK-S7 P1e — Caddy operations design

> Trạng thái: CHỜ REVIEW. Đây là checkpoint thiết kế. Chưa cài Caddy, tạo service, sửa cấu hình, DNS, firewall hay VPS.

## START 2026-10-15

## Quyết định vận hành

1. **Distro và nguồn binary.** P1e chỉ hỗ trợ Debian 12 và Ubuntu 22.04/24.04 LTS chạy systemd, kiến trúc amd64/arm64 nếu Caddy stable repository có đúng package. Dùng repository stable chính thức Caddy đã được APT xác thực. Chọn phiên bản Caddy `2.x` stable cụ thể cho mỗi release; package version và SHA-256 từ metadata đã ký được ghi trong manifest cài đặt. Không dùng testing/beta, `latest`, `caddy upgrade` hay unattended upgrade.
2. **Không cài package service.** Tài liệu Caddy xác nhận package Debian/Ubuntu tự khởi chạy `caddy.service`. Vì vậy OpsPilot chỉ tải đúng `.deb` theo version/architecture (`apt-get download`), kiểm tra nguồn stable và hash theo metadata APT đã ký, rồi dùng `dpkg-deb --extract` trong thư mục staging để lấy riêng `usr/bin/caddy`. Không chạy `apt install`, `dpkg -i` hoặc maintainer scripts; không tạo/enable `caddy.service` hay `caddy-api.service`. Nếu official stable repository/keyring không hiện diện hoặc source/origin/hash không xác minh được, dừng và hướng dẫn cấu hình repository theo tài liệu chính thức; không tự thay key/source có sẵn.
3. **Binary không ghi đè file lạ.** Giữ từng bản bất biến tại `/usr/local/lib/opspilot-caddy/versions/<version>/caddy`, root:root, thư mục `0755`, file `0755`. `/usr/bin/caddy` là symlink do OpsPilot quản lý tới đúng binary versioned path để tương thích preflight P1c; chỉ tạo khi path vắng. Nếu path tồn tại, package manager sở hữu nó, link đích khác cây OpsPilot hoặc metadata không khớp, báo conflict và không thay thế. Ownership metadata tại `/etc/opspilot/caddy/INSTALLATION` ghi version, architecture, repository channel, package SHA-256 và SHA-256 của binary đã extract; file root:root `0644`. Update là thao tác riêng, có xác nhận, kiểm tra binary mới, atomic đổi symlink và rollback; không tự cập nhật.
4. **Preflight trước mọi cài/ghi.** P1e phải mở rộng P1c trước khi runtime: kiểm tra target/chain symlink của binary, owner/package metadata và `caddy.service`/`caddy-api.service`; unit Caddy distro có mặt (kể cả inactive), marker/config lạ, listener hoặc owner không chắc chắn đều fail closed. Đọc lại listener, service, marker, config, binary và firewall ngay trong khóa remote trước thao tác ghi. Không stop, disable, mask, sửa hoặc ghi đè proxy/service không thuộc OpsPilot.

## Service và quyền

Chỉ có một unit do OpsPilot sở hữu tại `/etc/systemd/system/opspilot-caddy.service`, root:root `0644`. Service chạy bằng system user/group `opspilot-caddy`, shell `nologin`, không có quyền ghi binary, unit hay Caddyfile. Cấp đúng `CAP_NET_BIND_SERVICE` để bind TCP 80/443; không chạy root và không cấp `CAP_NET_ADMIN`.

```ini
[Unit]
Description=OpsPilot shared ingress (Caddy)
Documentation=https://caddyserver.com/docs/
Wants=network-online.target
After=network-online.target

[Service]
Type=notify
User=opspilot-caddy
Group=opspilot-caddy
WorkingDirectory=/etc/opspilot/caddy
Environment=HOME=/var/lib/opspilot/caddy
UMask=0077
ExecStartPre=/usr/bin/caddy validate --config /etc/opspilot/caddy/Caddyfile --adapter caddyfile
ExecStart=/usr/bin/caddy run --config /etc/opspilot/caddy/Caddyfile --adapter caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/opspilot/caddy/Caddyfile --adapter caddyfile --force
Restart=on-failure
RestartSec=2s
TimeoutStopSec=5s
LimitNOFILE=1048576
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
LockPersonality=true
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
AmbientCapabilities=CAP_NET_BIND_SERVICE
ReadWritePaths=/var/lib/opspilot/caddy
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

- Caddyfile cố định ở `/etc/opspilot/caddy/Caddyfile`; parent `root:opspilot-caddy 0750`, file `root:opspilot-caddy 0640`. `OWNER` chứa đúng `opspilot-shared-ingress-v1`, root:root `0644`; unit, binary và marker không writable bởi service account.
- Caddyfile luôn có global options cố định:

  ```caddyfile
  {
      admin 127.0.0.1:2019
      persist_config off
      storage file_system /var/lib/opspilot/caddy/production
  }
  ```

  Admin API không bind public interface; không nhận địa chỉ admin qua IPC/env. Reload dùng CLI từ unit qua pinned SSH. Caddy storage là state bền vững, không phải cache.
- `/var/lib/opspilot/caddy` và `production/` do `opspilot-caddy:opspilot-caddy` sở hữu, mode `0700`; private key/certificate files do Caddy tạo trong đó và chỉ service user đọc được. Thư mục staging `staging/` cũng tách biệt `0700`; không copy staging certificate sang production. Cấu hình Caddy chỉ đọc data directory và chỉ ghi storage; không lưu certificate/private key vào SQLite, backup Caddyfile, IPC hoặc log.
- Route blocks được dựng từ toàn bộ tập binding OpsPilot hợp lệ, hostname tới `127.0.0.1:<host_port>`. Global options là template cố định do OpsPilot thêm trước blocks; không lấy directives tùy ý từ file/proxy ngoài OpsPilot. Không đổi container, app port hay URL HTTP hiện hành.

## Khóa và preflight

- Main process giữ mutex theo VPS/fingerprint. Mọi transaction ghi dùng thêm `flock` độc quyền tại `/run/lock/opspilot-caddy.lock` trên VPS; lock file phải regular, root-owned, không symlink. Kiểm tra `flock` có sẵn và thoát nếu lock bận. Khóa bao trọn recheck, staging file, validate, backup, rename, reload/start và verify local; script remote là hằng số, chỉ truyền payload Caddyfile đã serialize/base64, không shell-interpolate hostname, port hay path.
- Lệnh transaction có wall-clock timeout cố định (120 giây), không tự retry khi SSH ngắt giữa thao tác ghi; shell trap dọn candidate của generation đó, giữ backup và để `flock` tự nhả khi process kết thúc. Sau lỗi kết nối không gửi lại lệnh mù: reconnect chỉ đọc owner/generation/active hash trước rồi mới quyết định tiếp tục hay rollback.
- Ngay trong khóa, P1c phải xác minh fingerprint SSH, ownership marker, unit, binary version/path, Caddyfile, listener 80/443, UFW và config generation. DNS phải có `propagated` từ hai resolver P1d; yêu cầu fresh DNS check không dùng renderer hint. Nếu kết quả P1d là `proxy_hint_unverified`, resolver disagreement/timeout hoặc Anycast mismatch thì không đi tiếp. Cloud firewall phải được operator kiểm tra trực tiếp tại provider; task evidence chỉ ghi provider, rule ID và thời điểm đã khử nhạy cảm, không ghi credential. `unknown` chặn bắt đầu ACME. Cloudflare hint không phải bằng chứng và không được đọc làm điều kiện active. Nếu owner/cổng/firewall chưa rõ hoặc generation đổi, không viết và không yêu cầu certificate.

## Apply và rollback

1. Lấy snapshot DB cho toàn bộ route OpsPilot ở desired generation; xác nhận app/deployment running và health qua URL cũ. Không thêm hostname từ user input trực tiếp vào shell/config.
2. Mở khóa remote, chạy lại đầy đủ preflight. Kiểm tra `lstat` từng path component và canonical path. Chặn symlink, hard link, file/socket/device lạ ở config, unit, marker, binary alias, candidate, backup và lock; ngoại lệ duy nhất là symlink `/usr/bin/caddy` có target/version đúng `INSTALLATION` OpsPilot. Không đọc hoặc ghi config của proxy khác.
3. Dựng **toàn bộ** cấu hình OpsPilot từ DB, giữ mọi route OpsPilot hiện tại. Nếu config/service được đánh dấu OpsPilot nhưng có route/directive không khớp inventory DB, dừng conflict; không cố ghép/giữ directive không xác minh được. Tạo candidate cùng filesystem `/etc/opspilot/caddy/.Caddyfile.candidate.<generation>` bằng exclusive create, `root:opspilot-caddy 0640`; kiểm tra checksum, fsync nếu khả dụng và `caddy validate --config <candidate> --adapter caddyfile` trước khi chạm file active. `systemd-analyze verify` chạy trên unit candidate.
4. Tạo backup không ghi đè bằng tên generation/content hash và quyền `root:opspilot-caddy 0640`; backup Caddyfile, unit, binary alias và các marker mà transaction sắp đổi. Candidate và backup ở cùng filesystem. Thay active bằng atomic `rename` từ candidate. Với service lần đầu, nạp unit sau khi file đã validate; `daemon-reload` không đồng nghĩa start. Kiểm tra owner/cổng lần cuối rồi mới enable/start riêng `opspilot-caddy.service`. Với service đã xác minh, gọi `systemctl reload opspilot-caddy.service`; không restart để apply route.
5. Xác minh unit active, `ExecStart`/binary/config/marker đúng owner, reload thành công, và các route cũ vẫn giữ. Chỉ ghi `observed_generation`/certificate pending sau khi Caddy nhận đúng generation. Lỗi validate/rename/reload/start hoặc DB commit làm rollback: reacquire lock, chỉ phục hồi nếu observed generation vẫn là transaction này; atomic restore backup rồi reload config cũ. Nếu transaction sở hữu service mới thì stop/disable đúng unit OpsPilot vừa tạo và khôi phục trạng thái vắng ban đầu. Không bao giờ tác động `caddy.service`, nginx, Apache hay container khác.
6. Nếu rollback/reload cũ thất bại, không xóa backup; đánh dấu `INGRESS_ROLLBACK_FAILED`, giữ app/container và URL HTTP cũ, không ghi route active. Nếu generation mới hơn đã xuất hiện, không restore bản cũ đè lên người ghi mới; trả conflict/degraded để reconcile lại.
7. External probe chạy sau khi nhả lock remote. Trước khi ghi kết quả, so desired/observed generation, hostname, route ownership và Caddy config lại; kết quả cũ/stale bị bỏ. Nếu probe fail và cần rollback route, reacquire lock và chỉ rollback khi version đang chạy vẫn là generation đã probe. Giữ backup cho retention tối thiểu 3 generation/30 ngày, giới hạn tổng dung lượng; xóa chỉ backup có marker/path chính xác của OpsPilot.

## ACME staging, probe ngoài và active

- P1e live gate chỉ dùng hostname thử nghiệm được ủy quyền, DNS trực tiếp A/AAAA qua cả hai resolver, VPS dev và ACME staging directory `https://acme-staging-v02.api.letsencrypt.org/directory`. Staging Caddyfile dùng `acme_ca` staging và storage riêng `.../staging`; không dùng ACME production trong test. Caddy chọn HTTP-01/TLS-ALPN-01 theo khả năng mạng; ghi challenge đã quan sát được, không tuyên bố cả hai loại đã PASS nếu chỉ một loại chạy. DNS-01 nằm ngoài v1.
- Probe bắt buộc từ máy OpsPilot/điểm mạng độc lập **ngoài VPS**, không dùng `curl localhost`/hairpin từ VPS. Dùng hostname thật và SNI, không `--resolve` để bỏ qua DNS; xác minh peer IP thuộc public IP kỳ vọng, certificate SAN đúng hostname, thời hạn/chain và route response health theo policy. Probe staging tin cậy staging root qua trust bundle riêng của probe; không dùng `-k`, không cài staging CA vào trust store hệ thống. Let's Encrypt ghi rõ staging roots không có trong client trust stores và không được dùng cho hoạt động thường ngày.
- Staging certificate chỉ chứng minh quy trình test. Staging probe **không** ghi `certificate_status=valid`, `https_probe_status=passed` hay `route_status=active`; không giữ route staging sau kiểm thử. Khôi phục config production/previous snapshot dưới lock và xác minh URL HTTP cũ còn hoạt động. Staging certificate không được chuyển sang production store.
- `route_status='active'` chỉ khi cùng hostname/generation có `dns_status='propagated'`, Caddy route được reload và service/ownership verify, production certificate được hệ điều hành/client trust mặc định xác minh (không phải staging), SAN/chain/thời hạn hợp lệ, và external HTTPS probe thành công tới app health endpoint với TLS hostname validation, public peer IP đúng và response theo policy. Ghi `certificate_hostname`, `https_probe_hostname`, các checked-at và `observed_generation` trong cùng DB transaction. Mọi điều kiện chưa đủ giữ `pending`/`degraded`; Cloudflare hint không bao giờ làm bằng chứng hoặc trigger active.
- Probe đề xuất: connect timeout 5 giây, tổng timeout 20 giây, tối đa 3 lần trong 60 giây; yêu cầu 2xx từ health path (hoặc policy app đã cấu hình). Mọi lần probe phải cùng hostname/generation và không theo redirect sang hostname ngoài allowlist. Không lộ response body tùy ý, cert private data, credential hay raw SSH output.

## Gate P1e

- Unit: owner/Caddyfile conflict, unsupported distro/arch, missing/foreign package source, package hash/version mismatch, symlink/path traversal, no listener, another proxy/unit, insufficient capabilities, UFW/cloud-firewall unknown, concurrent lock, stale generation.
- Fault injection: candidate create/fsync, validate, backup, rename, daemon-reload, start/reload, local verify, ACME staging issue, external TLS/health probe, DB commit, rollback/rollback conflict. Chứng minh route cũ và HTTP URL còn sống, không sửa container.
- Caddyfile builder: global options, route preservation, deterministic output, injection rejection, staging/production storage isolation; service unit golden test + `systemd-analyze verify` trên supported distro images.
- Live gate staging: profile DB cô lập; hostname thử nghiệm có quyền; read-only recheck; ghi một lần trong operator window được duyệt riêng; Caddy staging certificate + external probe staging trust; rollback và kiểm tra direct HTTP URL. Không thử production ACME khi chưa có gate riêng.
- Không có hostname/live window trong checkpoint hiện tại: live ACME/HTTPS **NOT_RUN**.

## Đối chiếu nguồn chính thức (đọc 2026-10-15)

- [Caddy install](https://caddyserver.com/docs/install): official stable distro package có tiện ích quản lý service; Debian/Ubuntu package tự start `caddy.service`. P1e tránh package install scripts bằng chỉ tải và extract payload.
- [Caddy running as a service](https://caddyserver.com/docs/running): hướng dẫn static binary/manual systemd unit, service user và cách dùng reload; P1e tạo unit tách biệt do OpsPilot sở hữu.
- [Caddy signature verification](https://caddyserver.com/docs/signature-verification): release artifacts được ký bằng Sigstore; tham khảo khi nâng cấp nguồn binary khỏi APT artifact/package trust.
- [Caddy Caddyfile global options](https://caddyserver.com/docs/caddyfile/options): `admin` mặc định loopback và `storage` cấu hình được đường dẫn file system.
- [Caddy conventions](https://caddyserver.com/docs/conventions): data directory chứa certificate/private key và state, phải bền vững, không phải cache.
- [Caddy command line](https://caddyserver.com/docs/command-line) và [API](https://caddyserver.com/docs/api): `validate` kiểm tra cấu hình; reload/load graceful và cấu hình lỗi được giữ/rollback trong tiến trình Caddy.
- [Caddy Automatic HTTPS](https://caddyserver.com/docs/automatic-https), [Let's Encrypt challenge types](https://letsencrypt.org/docs/challenge-types/) và [staging environment](https://letsencrypt.org/docs/staging-environment/): HTTP-01/TLS-ALPN-01, staging ACME directory; staging roots không nằm trong trust store thông thường.

## UPDATE 2026-10-15

- Chốt install/extract không chạy service; chốt unit/account/capability/config/storage/admin endpoint, khóa per-VPS, recheck owner, transaction/rollback, staging/probe và active invariant.
- P1e hiện là docs-only. Không cài Caddy, không gọi VPS, không cấp certificate, không sửa DNS/firewall/config/service.

## HANDOFF-LOCAL 2026-10-15

- Đối chiếu P1a–P1d, `CLAUDE.md`, `DECISIONS.md` và tài liệu Caddy/Let's Encrypt được liệt kê ở trên; các invariant ownership fail-closed, hai-resolver DNS, external probe và `route_status='active'` chỉ sau bằng chứng production được giữ nhất quán.
- Gate tài liệu/diff: `git diff --check` PASS. Không chạy test/build vì checkpoint chỉ thay đổi tài liệu.
- Caddy install/service, ACME staging, external HTTPS probe và thao tác VPS: NOT_RUN theo phạm vi checkpoint; không có VPS nào được sửa.
- Commit local của thiết kế: `e1c0d437643eb3c1d82c9253887c053f3ed9d7bc`.
