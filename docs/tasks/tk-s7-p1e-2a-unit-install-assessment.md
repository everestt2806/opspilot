# TK-S7 P1e-2a — xác minh unit và điều kiện cài mới

> Trạng thái: CHỜ REVIEW. Tiếp nối P1e-1; preflight chỉ đọc. Không cài hoặc ghi lên VPS.

## START 2026-10-15

### Phạm vi

- Chỉ xác minh `opspilot-caddy.service` là `verified` khi unit tại đường dẫn chuẩn khớp nguyên văn mẫu P1e, không có `DropInPaths`, và các thuộc tính systemd hiệu lực khớp user/group, ExecStartPre/ExecStart/ExecReload, capability bind 80/443, storage/write path và hardening.
- Đánh giá máy sạch độc lập với service đã cài. Máy sạch trả `service='absent'`; không yêu cầu manifest `INSTALLATION`. Chỉ cho `install_assessment='safe'` nếu distro/architecture hỗ trợ, path đích vắng, parent là directory root-owned với mode chuẩn, không có Caddy/package/unit hoặc proxy service đã biết, listener 80/443 vắng và UFW rõ.
- Partial path tree, drop-in, directive/unit khác mẫu, proxy/service hiện diện hoặc output thiếu/không parse được đều fail closed thành `unknown`/`blocked`.

### Kiểm tra

- Test preflight: clean host đủ điều kiện; path tồn tại một phần; service sai ExecStartPre, ExecReload, user/group/capability; directive bổ sung; drop-in; service OpsPilot hợp lệ.
- Node 22: ghi kết quả focused tests, typecheck, build, lint phạm vi file và `git diff --check` sau khi chạy.
- Không có khảo sát VPS hoặc thao tác ghi VPS trong checkpoint này.

## UPDATE 2026-10-15 — kết quả cục bộ

- Preflight hiện xác minh unit file khớp template cố định P1e, `DropInPaths` rỗng, và các thuộc tính systemd hiệu lực gồm user/group, ExecStartPre/ExecStart/ExecReload, capability, storage path và hardening. Unit/directive/drop-in sai không được `verified`.
- Nhánh máy sạch độc lập với xác minh service: cần distro/arch được hỗ trợ, binary/package và unit Caddy vắng, proxy units đã biết vắng, toàn bộ path đích vắng với parent chuẩn, listener trống và UFW rõ. Test máy sạch dùng `INSTALLATION` missing và vẫn đạt `safe`; service trả `absent`.
- Node 22.23.3: focused preflight/Caddyfile **58/58 PASS**; typecheck **PASS**; build **PASS** (3.113 renderer modules); `git diff --check` **PASS**.
- ESLint hai file trong scope: **0 lỗi, 246 warnings** (cảnh báo định dạng; không format hàng loạt). ESLint toàn repo **FAIL**: 3 lỗi, 6.570 warnings; ba lỗi nằm trong `dnsReadiness.test.ts:37`, `dnsReadiness.ts:403`, `ssh/manager.ts:625`, đều ngoài scope/không đổi trong task này. Ruff **NOT_RUN** vì chuỗi lint dừng ở ESLint.
- VPS/Caddy install, service/config/firewall/DNS writes: **NOT_RUN**.
