# TK-S7 P1e-2c — xác minh APT evidence và staging Caddy trong Linux cô lập

> Trạng thái: CHỜ REVIEW. Chỉ staging trong WSL cô lập; không ghi VPS và không nối installer vào IPC, pipeline hoặc UI.

## Kết quả

- Thêm `collectCaddyAptEvidence()` để đọc đúng một source Caddy stable, keyring regular file, `InRelease` và `Packages.gz`. Collector kiểm tra source URI/suite/component, xác minh chữ ký bằng `gpgv` với fingerprint signer ghim, kiểm SHA-256 và kích thước index theo `InRelease`, rồi chọn duy nhất stanza `caddy` stable đúng architecture với filename và SHA-256 hợp lệ.
- Planner chỉ chấp nhận object evidence do collector tạo trong tiến trình hiện tại (WeakSet private); các cờ `valid`/`authenticated` do caller tự truyền không đủ để tạo plan.
- Tách filename lưu trong APT index khỏi tên file APT thực sự in ra. Plan kiểm tra chính xác URI và output filename của `apt-get download --print-uris`, yêu cầu file tải tồn tại, so SHA-256 gói, giải nén bằng `dpkg-deb --extract`, rồi so hash binary đã giải nén với binary đọc trực tiếp từ data archive đã xác thực. Không chạy maintainer script hoặc lệnh service.
- Cho phép đường dẫn temp Windows 8.3 có ký tự `~`; collector vẫn yêu cầu source line khớp chính xác keyring path đã chuẩn hóa.

## Kiểm chứng thật trong WSL Ubuntu 24.04

- APT source cô lập trỏ tới Caddy stable thực tế; `apt-get update` dùng cache/state tạm và xác thực metadata repository.
- Collector xác minh `InRelease` thật bằng `/usr/bin/gpgv`, signer Caddy stable đã ghim; checksum/kích thước `Packages.gz` khớp metadata đã ký.
- Package được chọn: Caddy 2.11.7, amd64. `apt-get download --print-uris` khớp URI và tên đầu ra `caddy_2.11.7_amd64.deb`.
- Tải đúng một `.deb` (18,142,322 byte); SHA-256 package khớp chỉ mục xác thực: `a22b914ffd1958da42bc7ab13b7b62c6100634e0798ab594891d2d61d53ba749`.
- `sh -n` staging script PASS; `dpkg-deb --extract` PASS; SHA-256 binary archive và binary đã giải nén cùng là `678ade3bfc088749c81a681adc603333ee0bb023b6a6cfe3c0f58bef8ff854e9`.
- Chỉ tải, xác minh và giải nén vào thư mục tạm. Không cài gói, không chạy maintainer scripts/service, không sửa VPS.
- Debian 12 riêng, Ubuntu 22.04 riêng, Docker container và runtime/service Caddy: NOT_RUN.

## Test và gate

- Node 22.23.3 focused ingress Vitest: 5 file, 112/112 PASS. Bao gồm chữ ký sai/không ghim, checksum sai, nhiều APT source, stanza package trùng, filename/URI không khớp, output URI/tên file sai hoặc thiếu, download thiếu và hash binary không khớp bị staging script chặn.
- Typecheck Node + Web: PASS.
- Production build: PASS (3.113 renderer modules).
- ESLint trên bốn file checkpoint: PASS, 0 lỗi / 0 cảnh báo.
- ESLint toàn app: FAIL, 3 lỗi và 6.570 cảnh báo. Ba lỗi có sẵn ngoài scope: `dnsReadiness.test.ts:37` và `dnsReadiness.ts:403` (`@typescript-eslint/explicit-function-return-type`), `ssh/manager.ts:625` (`prefer-const`). Ruff không chạy vì ESLint dừng trước trong root lint script.
- `git diff --check`: PASS.

## Giới hạn

- Chưa có bước ghi/cài đặt nào; `writePlan.status` vẫn là `not-executed`. Không có IPC, pipeline, UI hoặc SSH installer caller.
- Staging thật chỉ chạy trên WSL Ubuntu 24.04 x86_64; không coi mock test là bằng chứng tải thật.
- Không push/PR/merge. Giữ nguyên file untracked đã có trước checkpoint.