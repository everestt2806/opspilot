# TK-S7 P1e-2d — xác minh Caddy APT evidence qua pinned SSH từ Windows

> Trạng thái: CHỜ REVIEW. Chỉ triển khai adapter chuẩn bị evidence; không kết nối adapter tới VPS thật, không cài Caddy, không ghi VPS, không nối IPC/pipeline/UI.

## Thay đổi

- Thêm `collectCaddyAptEvidenceOverSsh()` dùng `SshManager.execWithHostIdentity()` đã xác minh fingerprint. Remote command là script cố định, không nhận hostname/path từ IPC; chỉ request nonce ngẫu nhiên dạng hex được truyền làm tham số.
- Script đọc duy nhất source Caddy stable và keyring ở path cố định trên VPS, tải `InRelease`/`Packages.gz` qua HTTPS với max-filesize, xác minh signature bằng `gpgv` remote, và trả snapshot base64 giới hạn kích thước. Thiếu source/keyring/tool, lỗi resolver/repository/signature trả reason code kèm hướng dẫn.
- Adapter kiểm tra nonce, schema, encoding/canonical base64, giới hạn bytes, source/keyring identity, architecture, signer fingerprint đã ghim, `InRelease` identity và checksum/kích thước `Packages.gz`; chỉ sau đó tạo object evidence thuộc WeakSet nội bộ. JSON SSH đơn thuần không thể cấp evidence cho planner.
- Evidence gắn VPS ID, host, SSH port và fingerprint; ghi architecture, stable repository, signer, version, package URI, filename và SHA-256. Evidence local lab vẫn dùng cho staging thử nghiệm nhưng planner từ chối khi tạo VPS install plan.
- Planner từ chối evidence sai VPS/fingerprint, stale quá 5 phút hoặc không lấy qua pinned SSH. `prepareCaddyInstallPlanOverSsh()` đọc distro/version/architecture từ lệnh platform cố định, quét lại ingress ngay trước lúc tạo plan và xác nhận identity vẫn khớp. Module chưa được nối với caller cài đặt nào.
- SshManager bổ sung chạy lệnh kèm host identity, kiểm tra identity không đổi sau khi lệnh kết thúc, và giới hạn byte stdout/stderr; quá giới hạn sẽ destroy channel và fail bằng mã lỗi rõ.

## Giới hạn

- Không gọi adapter trên VPS thật theo yêu cầu. Xác thực thật của remote APT qua pinned SSH: **NOT_RUN**; test adapter dùng SSH fixture.
- Không cần WSL, `gpgv` hoặc file APT cục bộ trên Windows để dùng adapter. WSL collector local vẫn được giữ cho lab.
- Không cài package, chạy maintainer scripts/service, ghi VPS, hoặc tạo IPC/pipeline/UI.

## Gate Node 22

- Focused SSH + ingress Vitest: **7 files, 141/141 PASS**. Bao gồm output vượt giới hạn, metadata thiếu/quá lớn, chữ ký/signer sai, checksum sai, source/keyring thiếu, disconnect, host/fingerprint đổi, nonce cũ, architecture, planner binding/freshness và preflight lại trước plan.
- Typecheck Node + Web: **PASS**.
- Production build: **PASS**, 3.113 renderer modules.
- Scoped ESLint trên các file sửa: **PASS, 0 lỗi / 0 cảnh báo**.
- Full ESLint app: **FAIL, 2 lỗi / 6.547 cảnh báo**. Hai lỗi ngoài scope: `dnsReadiness.test.ts:37` và `dnsReadiness.ts:403`, cả hai `@typescript-eslint/explicit-function-return-type`. Ruff: NOT_RUN; root lint dừng ở ESLint.
- `git diff --check`: PASS.

## Handoff

- Board giữ trạng thái CHỜ REVIEW.
- Commit cục bộ; không push/PR/merge. Giữ nguyên các file untracked đã có trước checkpoint.