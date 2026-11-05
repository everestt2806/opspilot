# Product controller runtime (Linux)

This runtime is a separate Node 22 artifact. It imports the Product SQLite repository and the existing migrations, but does not bootstrap Electron, the renderer, safeStorage, monitor, ML, or a deployment executor.

## Build and initialize

From `app/control-plane-runtime`, install the isolated dependencies and build the bundle:

```sh
npm ci
node ../scripts/build-control-plane.mjs
node dist/control-plane.cjs init --data-dir /var/lib/opspilot-controller
node dist/control-plane.cjs status --data-dir /var/lib/opspilot-controller
```

`init` is explicit and refuses to replace an existing database. It creates one controller identity only; it does not enroll applications, write Product ownership/source configuration, or infer Desktop-mode state. The data directory must be private to the service user (`0700`) and the database file is restricted to `0600`. `run`, `poll-once`, and `status` require that initialized identity and fail closed for missing, insecure, or invalid data.

`run --data-dir ...` serves only `GET /healthz` on `127.0.0.1:8768`, then polls configured Product-owned GitHub branches. It does not expose the `/v1` API. `poll-once` performs one poll without opening an HTTP listener. Both paths only observe Git and reconcile durable desired state/job records; neither claims nor executes a job.

The Linux runtime dependency set also includes the already approved `ssh2` and `tar` packages for the internal guarded-session seam. The packaged `target-helper/` files are not installed on a VPS by build and are not activated by the poll-only runtime. P3e-3a does not connect DeployPipeline or perform deployment phases.

The systemd example is `opspilot-controller.service.example`. It is a template only and is not installed by the build or CLI.

## Khởi tạo kho khóa và đăng ký VPS (R3b-4)

Hai lệnh quản trị **Linux-only**, chạy cục bộ bằng cùng user của controller:

```sh
node dist/control-plane.cjs secrets-init --data-dir /var/lib/opspilot-controller
node dist/control-plane.cjs enroll-vps --data-dir /var/lib/opspilot-controller
```

`secrets-init` tạo `.controller-runtime-key` (32 byte, `0600`) một lần trong data directory
private (`0700`). Không chạy lại khi đã có key hoặc khi còn VPS/app ownership/runtime key material;
thiếu key trong một controller đã có dữ liệu là trường hợp recovery, không tự tạo khóa thay thế.
`init`, `status`, `run` và `enroll-vps` không tự khởi tạo kho khóa.

`enroll-vps` chỉ nhận một JSON object qua **stdin pipe tới EOF**, không nhận secret qua argv/env
hoặc terminal có echo. Giới hạn 512 KiB cho input, 256 KiB UTF-8 cho secret, timeout input 30 giây.
Body theo [contract](../../docs/contracts/product-controller-bootstrap.ts):

```json
{
  "format": 1,
  "controller_id": "<controller_id từ init/status>",
  "profile": {
    "name": "VPS ứng dụng",
    "host": "<IP hoặc hostname>",
    "port": 22,
    "username": "<SSH user>",
    "auth_type": "key",
    "host_fingerprint": "<SHA256 lấy độc lập từ console provider>"
  },
  "secret": "<private key hoặc password chỉ truyền trong memory/stdin>"
}
```

Đây là mô tả format, **không tạo file chứa credential này hoặc commit/copy vào báo cáo**.
Admin dùng tiến trình cung cấp secret qua pipe (ví dụ Python đọc private key đã bảo vệ hoặc
`getpass` đọc password từ `/dev/tty` rồi serialize JSON). Không đưa credential vào command line,
environment hoặc shell history. `auth_type` chỉ nhận `key`/`password`; không tự dùng SSH agent.

Lệnh mở SSH session mới, xác minh pin và authentication, **không chạy remote command**, rồi lưu
credential AES-GCM đã bind controller/VPS/profile/revision trong một SQLite IMMEDIATE transaction.
Output chỉ có `state`, `controller_id`, `vps_id`, `host_fingerprint`. Nếu mất response sau commit,
gửi lại exact profile + secret: lệnh xác minh lại SSH và trả `already_enrolled` với cùng VPS ID,
không sửa metadata/ciphertext. Khác tên/endpoint/profile/credential hoặc hồ sơ đã archived thì
conflict, không tự update/restore/rotate. Hai tiến trình gửi cùng yêu cầu không tạo hai VPS.

Đăng ký credential này **chưa enroll target app/helpers/HMAC hoặc bật deployment executor**.
Không import Desktop SQLite/safeStorage, không tạo app/source/ownership/history, không mở thêm API.
Service mặc định vẫn polling-only; phần target enrollment/admission/cold startup/service opt-in
còn ở R3b/R3c. Kiểm chứng CLI/SSH thật và giới hạn hiện hành: [hồ sơ R3b-4](../../docs/tasks/tk-s7-release-r3b4-controller-enrollment.md).
