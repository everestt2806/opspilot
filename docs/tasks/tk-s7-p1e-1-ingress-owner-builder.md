# TK-S7 P1e-1 — ingress owner preflight và Caddyfile builder

> Trạng thái: CHỜ REVIEW. Mở rộng preflight chỉ đọc và dựng Caddyfile OpsPilot; không áp dụng config, không cài/chạy Caddy, không ghi VPS.

## START 2026-10-15

Triển khai theo [thiết kế P1e](tk-s7-p1e-caddy-operations-design.md), P1a–P1d, `CLAUDE.md` và `DECISIONS.md`.

## Phạm vi

- Preflight dùng danh sách lệnh SSH cố định chỉ đọc metadata/file: distro/version/architecture, `/usr/bin/caddy`, chuỗi symlink/resolved target, package owner, SHA-256 file binary, manifest `INSTALLATION`, owner/mode của mọi path cha/file/unit cần thiết, hai unit distro Caddy kể cả inactive, unit/marker/config OpsPilot, listener 80/443 và UFW. Không thực thi `/usr/bin/caddy`.
- Chỉ Debian 12, Ubuntu 22.04/24.04 cùng amd64/arm64 là host được hỗ trợ. `INSTALLATION` là file `root:root 0644` dạng key-value `format=opspilot-caddy-installation-v1`, version, architecture, `repository_channel=stable`, `package_sha256` và `binary_sha256` (hex SHA-256). Binary hash được tính trên file thường giới hạn 100 MiB, không hardlink; version/path/architecture/hash phải khớp manifest và host. Thiếu hoặc lệch dữ kiện, output lạ, dangling/wrong symlink, symlink ở parent path, binary/package ngoài quyền sở hữu, mode/owner không đúng, unit distro hiện diện, marker/config symlink hoặc listener owner không rõ giữ service/install/local assessment unknown hoặc blocked.
- Cấu hình builder luôn có global options cố định `admin 127.0.0.1:2019`, `persist_config off`, production storage `/var/lib/opspilot/caddy/production`; route hostname được chuẩn hóa/sắp xếp, duplicate/hostname/port không hợp lệ bị từ chối.
- Không đổi IPC/UI: readiness tiếp tục nhận cùng các trường mà renderer hiện dùng; thêm bằng chứng chỉ nội bộ để đánh giá `safe/clear`.

## HANDOFF-LOCAL 2026-10-15

- Bản handoff ban đầu đã được sửa theo review ở UPDATE phía dưới; số liệu trên thuộc commit ban đầu `7334542`.

## UPDATE 2026-10-15 — review fail-closed

- Preflight không chạy executable Caddy; chỉ đọc system/package metadata, `stat`/`readlink`, đọc manifest và hash binary file thường tối đa 100 MiB. `service='verified'` và `install_assessment='safe'` đòi hỏi version/architecture/package hash/binary hash khớp manifest, package không sở hữu binary, symlink target chính xác, mọi parent không phải symlink, cùng owner/mode đúng cho binary, unit, marker, INSTALLATION, Caddyfile và production storage. Thiếu manifest/metadata giữ kết quả unknown.
- Node 22.23.3: focused preflight, Caddyfile builder, DNS readiness **80/80 PASS**; typecheck **PASS**; build **PASS** (3.113 modules); `git diff --check` **PASS**.
- ESLint trên hai file code đã sửa: **0 lỗi, 177 warnings**. Không format hàng loạt.
- Ba lỗi lint toàn repo đã được đối chiếu với `7334542`: current targeted ESLint xác nhận `dnsReadiness.test.ts:37` (`@typescript-eslint/explicit-function-return-type`), `dnsReadiness.ts:403` (cùng rule), `ssh/manager.ts:625` (`prefer-const`). Ba file nguồn và package lint không đổi từ commit nền (`git diff 7334542 HEAD` rỗng cho các path này), nên đây là lỗi có sẵn; không có lỗi lint mới trong file P1e-1. Full baseline lint không hoàn tất trong worktree tạm; lint toàn repo cho revision review này không chạy lại.
- VPS/Caddy install, service start/reload, config write, DNS/firewall và ACME: **NOT_RUN**. Test preflight xác nhận chỉ gọi lệnh đọc cố định, dùng hash metadata/file, không thực thi `/usr/bin/caddy`.
- Commit code gốc `7334542` được sửa bởi review này; SHA review sẽ được ghi sau commit.
