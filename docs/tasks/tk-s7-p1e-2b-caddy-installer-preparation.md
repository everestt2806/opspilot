# TK-S7 P1e-2b — chuẩn bị installer Caddy trong môi trường cô lập

> Trạng thái: CHỜ REVIEW. Không cài hoặc ghi lên VPS; không gọi installer từ IPC, pipeline hay UI.

## START 2026-10-15

### Phạm vi và kết quả

- Thêm planner thuần chỉ trả kế hoạch khi preflight báo `install_assessment='safe'`, host sạch, distro Debian 12 hoặc Ubuntu 22.04/24.04 và kiến trúc amd64/arm64.
- Ràng buộc source Caddy stable chính thức, suite/component/origin, release signature, authenticated package index, version stable cụ thể, architecture, filename và SHA-256. Metadata thiếu/sai hoặc không tin cậy trả mã lỗi cụ thể, fail closed.
- Kế hoạch chỉ tải package có version ghim, so hash và giải nén bằng `dpkg-deb --extract` vào staging. Không dùng `apt install`, `dpkg -i`, maintainer scripts hoặc lệnh khởi chạy/reload service. `EXPECTED_OPSPILOT_UNIT` là nguồn duy nhất cho unit. Unit, `INSTALLATION`, Caddyfile, storage path và mode được mô tả trong `writePlan` có trạng thái `not-executed`.
- Không có caller từ IPC/pipeline/UI. Không thực hiện thao tác ghi cài đặt trong checkpoint.

### Bằng chứng APT thật trong WSL Ubuntu 24.04

- Tải public key và `InRelease` từ Caddy stable repository chính thức; `gpgv` xác nhận chữ ký `Good signature`.
- SHA-256 của `main/binary-amd64/Packages.gz` khớp checksum trong `InRelease`; `sha256sum --check` PASS.
- Metadata đã xác thực chọn `caddy` **2.11.7 amd64**; filename là `pool/any-version/main/c/ca/caddy_2.11.7/caddy_2.11.7_linux_amd64.deb`; SHA-256 package `a22b914ffd1958da42bc7ab13b7b62c6100634e0798ab594891d2d61d53ba749`. Planner/fixture được sửa theo đúng layout filename đang phát hành.
- Không tải `.deb`, không giải nén binary, không cài/start service. Do đó hash binary và manifest cuối sau staging chưa được tạo.

### Kiểm tra

- Node 22.23.3 focused ingress tests: **114/114 PASS** (bao gồm 20 test mới cho planner).
- Typecheck: **PASS**.
- Build: **PASS**; 3.113 renderer modules.
- ESLint hai file trong checkpoint: **0 lỗi, 0 cảnh báo**.
- ESLint toàn repo: **FAIL** với **3 lỗi và 6.571 cảnh báo**. Ba lỗi ở `dnsReadiness.test.ts:37` (`@typescript-eslint/explicit-function-return-type`), `dnsReadiness.ts:403` (cùng rule), `ssh/manager.ts:625` (`prefer-const`); các file này không thuộc thay đổi checkpoint. Không gọi lint toàn repo là PASS.
- WSL Ubuntu 24.04: `sh -n` trên staging script sinh từ plan **PASS**; `systemd-analyze --root=<temporary-root> verify` **PASS** trên unit P1e. Unit verify dùng binary placeholder `/bin/true` chỉ để kiểm cú pháp systemd; không kiểm hành vi Caddy.
- Docker Linux gate: **NOT_RUN** (Docker engine không khả dụng). Debian 12/Ubuntu 22.04 gate riêng: **NOT_RUN**; unit cú pháp chỉ chạy trong WSL Ubuntu 24.04.
- Tải/giải nén package và kiểm binary thật: **NOT_RUN**. VPS, DNS, firewall, service và Caddy runtime: **NOT_RUN**.
- `git diff --cached --check`: **PASS** sau khi stage đúng bốn file checkpoint.

## HANDOFF-LOCAL

- Board giữ trạng thái **CHỜ REVIEW**.
- Không push, PR, merge hoặc thao tác VPS. Giữ nguyên các file untracked có sẵn ngoài file checkpoint.
- Mã commit cục bộ cho phần triển khai: `1a9e60d`.
