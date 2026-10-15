# TK-S7 P1e-3 — transaction cài Caddy lần đầu

> Trạng thái: CHỜ REVIEW. Executor hiện chỉ ở main/domain; chưa nối IPC/UI/pipeline và chưa gọi trên VPS thật.

## Phạm vi triển khai

- `installCaddyFirstRunOverSsh()` chỉ nhận plan được planner cấp trong tiến trình, có pinned SSH target và APT evidence tối đa 5 phút. Plan mang download URI/SHA-256 đã xác thực; clone object tự tạo không qua được WeakSet brand.
- Chạy preflight read-only máy sạch và đối chiếu VPS identity trước dispatch. `SshManager.execWithHostIdentity()` nhận expected identity, xác minh đúng host/port/fingerprint trên connection đã pin trước khi mở command channel; lỗi trước dispatch phân biệt với lỗi sau dispatch.
- Một command cố định, không nhận path/lệnh/artifact tùy ý, dùng local mutex theo VPS và `flock` remote. Trong khóa kiểm tra listener, proxy/systemd units, binary/package, account/group, path vắng mặt và parent an toàn. Dữ liệu chỉ gồm version, architecture, URI và SHA-256 từ plan hợp lệ.
- Download `.deb` theo URI đã xác minh, đối chiếu package SHA-256, chỉ `dpkg-deb --extract`, so binary hash với binary trong tar xác thực; không chạy maintainer scripts. Tạo binary versioned, symlink `/usr/bin/caddy`, service account/group, directories, unit `EXPECTED_OPSPILOT_UNIT`, Caddyfile chỉ có global options, OWNER và INSTALLATION với owner/mode cố định.
- Remote transaction chưa enable/start/reload Caddy, không bind port, không lấy chứng chỉ và không đổi app URL. `systemctl daemon-reload` chỉ nạp unit; kết quả riêng `installed_not_running` chỉ trả sau xác minh artifact, unit inactive, route config rỗng và không listener.
- Rollback xóa file chỉ khi content hash, owner/mode và loại file còn khớp; chỉ rmdir các directory transaction tạo khi inode/owner/mode còn đúng và directory rỗng. Không xóa đệ quy path dùng chung. SSH đứt sau dispatch không tự retry và trả trạng thái cần đối chiếu. `verifyCaddyInstallationOwnershipOverSsh()` dùng chung ownership script cho checkpoint khởi chạy sau này.

## Kiểm thử và gate

- Kiểm thử có fixture SSH cho stale/forged plan, preflight bẩn, đổi identity trước dispatch tại SshManager, local mutex, remote lock bận, path/account conflict, các phase lỗi, lỗi verify, rollback thất bại, disconnect không retry và phân biệt installed inactive.
- Các kết quả cài/rollback do SSH fixture trả về; không thực thi transaction trên filesystem Linux. `bash -n` chạy thật qua WSL trên cả installer và ownership script, không chạy bất kỳ lệnh ghi nào.
- Node **v22.23.3**: SSH + ingress Vitest **10 files, 193/193 PASS**; typecheck Node + Web **PASS**; production build **PASS** (3.113 renderer modules); scoped ESLint trên 6 file sửa **PASS, 0 lỗi / 0 cảnh báo**; `git diff --check` **PASS**.
- `bash -n` WSL thật trên installer và ownership script: **PASS** (chỉ parse cú pháp, không chạy body).
- Các test transaction còn lại dùng SSH fixture: success/ownership verification, lock/path/account response, mọi phase lỗi, rollback/rollback-failed và disconnect đều là **mocked remote status**, không phải thực thi filesystem rollback trong Linux.
- Live VPS installer: **NOT_RUN**, theo yêu cầu. Docker chưa dùng để giả lập cài đặt.

## Giới hạn

- Chưa có IPC/UI caller và chưa có lần cài Caddy trên VPS thật. Không có bằng chứng về quyền sudo, repository/package hoặc firewall trên bất kỳ VPS nào trong checkpoint này.
- Full repo lint **NOT_RUN** trong checkpoint này; chỉ scoped lint đã chạy. GUI/Electron install flow **NOT_RUN** vì installer chưa nối UI/IPC.
