# TK-S7 P1e-1 — ingress owner preflight và Caddyfile builder

> Trạng thái: CHỜ REVIEW. Mở rộng preflight chỉ đọc và dựng Caddyfile OpsPilot; không áp dụng config, không cài/chạy Caddy, không ghi VPS.

## START 2026-10-15

Triển khai theo [thiết kế P1e](tk-s7-p1e-caddy-operations-design.md), P1a–P1d, `CLAUDE.md` và `DECISIONS.md`.

## Phạm vi

- Preflight dùng danh sách lệnh SSH cố định để đọc distro/version/architecture, `/usr/bin/caddy`, symlink và resolved target, package owner, hai unit distro Caddy kể cả inactive, unit/marker/config OpsPilot, listener 80/443 và UFW.
- Chỉ Debian 12, Ubuntu 22.04/24.04 cùng amd64/arm64 là host được hỗ trợ. Thiếu dữ kiện, output lạ, dangling/wrong symlink, binary/package ngoài quyền sở hữu, unit distro hiện diện, marker/config symlink hoặc listener owner không rõ giữ install/local assessment fail-closed.
- Cấu hình builder luôn có global options cố định `admin 127.0.0.1:2019`, `persist_config off`, production storage `/var/lib/opspilot/caddy/production`; route hostname được chuẩn hóa/sắp xếp, duplicate/hostname/port không hợp lệ bị từ chối.
- Không đổi IPC/UI: readiness tiếp tục nhận cùng các trường mà renderer hiện dùng; thêm bằng chứng chỉ nội bộ để đánh giá `safe/clear`.

## HANDOFF-LOCAL 2026-10-15

- Node 22.23.3: focused preflight, builder và DNS readiness **71/71 PASS**.
- `pnpm typecheck`: **PASS**. `pnpm build`: **PASS** (main, preload, renderer; 3.113 modules).
- `git diff --check`: **PASS**.
- `pnpm lint`: **FAIL** — 3 lỗi ngoài file checkpoint (`dnsReadiness.test.ts`, `dnsReadiness.ts`, `ssh/manager.ts`) và 6.470 warnings toàn repo. ESLint riêng bốn file checkpoint: 0 lỗi, 152 warnings. Không format file ngoài phạm vi.
- VPS/Caddy install, service start/reload, config write, DNS/firewall và ACME: **NOT_RUN**; preflight test xác nhận chỉ gọi các lệnh đọc cố định.
- Commit cục bộ của checkpoint: `73345426fd309897dc2dcf91ddd5e5ae69ea7e00`.
