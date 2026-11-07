# Product controller runtime (Linux)

## Đăng ký dự án mới (R3c-6g1)

`register-project --data-dir <private initialized dir>` nhận metadata JSON qua stdin.
Chạy bằng CLI Linux đã kiểm bundle; không có HTTP endpoint đăng ký công khai.
Target VPS phải được `enroll-vps` trước bằng fingerprint đã xác minh và credential
controller mã hóa hợp lệ. ID VPS lấy từ controller, không dùng ID của Desktop.

`project-targets --data-dir ...` nhận `{controller_id,after_id:null,limit:20}` hoặc
`{controller_id,target_id:1}` qua stdin. Response chỉ gồm profile không archived,
có pin và controller credential giải mã hợp lệ; không trả secret/cipher. Duyệt
tiếp bằng `next_after_id` khi `has_more=true`, kể cả trang không có target đủ điều kiện.
Đọc `ssh_security_revision` của target để điền `expected_target_security_revision`
khi đăng ký; controller kiểm lại revision trong transaction trước khi tạo app.

Desktop hiện có form đăng ký trong Settings → View Product apps → Product projects.
Kết nối phải được đăng ký với quyền ghi opt-in. Hai bước cấu hình/xác nhận dùng
metadata target của controller, lưu mã yêu cầu trên Desktop trước khi tạo app qua
SSH đã kiểm pin/gói. Mất phản hồi thì thử lại đúng mã cũ, hủy chỉ khi chưa gửi.
Trạng thái registered chỉ xác nhận dự án ở chế độ paused; source verification,
target enrollment và first deployment vẫn là bước kế tiếp, không tự bật deploy.

Ví dụ nội dung `registration.json` (thay controller ID, VPS ID, repo và tạo UUID mới):

```json
{
  "format": 1,
  "controller_id": "replace-with-controller-id",
  "request_key": "11111111-1111-4111-8111-111111111111",
  "target_vps_id": 1,
  "expected_target_security_revision": 1,
  "app_name": "example-api",
  "framework": "express",
  "repository_url": "https://github.com/example/api",
  "production_ref": "main",
  "repository_root": ".",
  "host_port": null,
  "container_port": 3000,
  "healthcheck_path": "/health"
}
```

```sh
node dist/control-plane.cjs register-project --data-dir /var/lib/opspilot-controller < registration.json
```

App/source/paused ownership/history/request được commit cùng transaction. Gửi lại
cùng UUID và nội dung sau mất phản hồi trả cùng app; thay nội dung phải dùng yêu cầu
mới, còn trùng tên/port sẽ bị từ chối. Replay vẫn kiểm current controller/target và
app/source/ownership, không ghi đè cấu hình hoặc policy đã đổi. Không tái dùng UUID
mẫu cho nhiều dự án. Metadata file không chứa credential/env hoặc lệnh build tùy ý.

Chỉ Express không DB theo runtime hiện tại; source URL public GitHub chưa được fetch
hoặc detect ở thao tác đăng ký. `host_port:null` cấp port trống trong DB ở dải
30000–30999, chưa chứng minh listener trên target trống. Response `registered` kèm
`source_verification`, `target_enrollment`, `runtime_preflight` đều `required`;
đây là trạng thái lúc đăng ký, không phải readiness hiện hành sau replay. Cần source
verification và `enroll-target` đúng gói/ownership, rồi kiểm readiness trước khi bật
auto-deploy có chủ đích. Không tạo observation/job/deployment hoặc chạy remote
command trong `register-project`. Wizard Desktop cho luồng mới là checkpoint kế tiếp.

This runtime is a separate Node 22 artifact. It imports the Product SQLite repository and migrations without Electron, the renderer or safeStorage. Default `run` only polls Git; explicit Linux `run-product` composes the guarded deployment executor after startup recovery and resource admission. Monitor/ML are not started by either command.

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

## Cấp và thu hồi quyền cho Desktop (R3c-3)

Trusted Linux admin có thể gọi `enroll-desktop-client --data-dir ...` bằng CLI đã kiểm gói.
Exact metadata JSON qua stdin, không secret trong argv:

```json
{
  "request_key": "<new UUID for this admin operation>",
  "display_name": "Son desktop",
  "requested_scopes": ["read", "deploy:manual", "policy:write"]
}
```

Kết quả `issued_once` chứa bearer ngẫu nhiên32bytes, hạn30ngày; bên nhận phải cất trong protected
main-process credential store, không renderer/log/report. SQLite chỉ giữ SHA256, client identity và scopes.
Gửi lại cùng UUID/body trả `credential_delivery_unknown` và client ID, không cấp/lộ token lần nữa.
Đổi nội dung hoặc operation cùng UUID bị `IDEMPOTENCY_CONFLICT`; muốn bỏ credential mất response thì
thu hồi client, tạo yêu cầu enroll mới. Quyền admin lấy từ OS uid hiện hành của process, không body/env actor.

`revoke-desktop-client --data-dir ...` nhận `{request_key:<new UUID>,client_id:<issued ID>}` qua stdin.
Thu hồi ngay client và các credential, replay trả lại timestamp cũ; không tự kích hoạt lại khi enroll replay.
Metadata identity có thể lưu/audit; credential chỉ có trong response cấp lần đầu. Network caller sau này
phải dùng strict pinned SSH administration. Hai CLI này chưa là HTTP endpoint hoặc Desktop connection flow;
chưa rotation/tunnel/API management, không tự bật Product policy hoặc ghi VPS.

## API đọc trên controller (R3c-4)

### Nền lệnh thủ công (R3c-5a, chưa bật HTTP writes)

Migration023 và command repository đã có request tombstone theo controller/client/UUID,
auth/generation check, atomic manual enqueue + pause auto, explicit pause/resume và lookup.
Gửi lại cùng UUID/nội dung trả kết quả gốc; đổi app/action/nội dung bị conflict. Lookup chỉ
client tạo yêu cầu đọc được và vẫn kiểm tra owner hiện hành. Source generation đã thay đổi
không làm mất outcome cũ; retry mutation với generation cũ vẫn bị từ chối.

Manual redeploy chỉ nhận desired SHA do server biết hoặc SHA đã có provenance cùng repo/root.
Pause không đòi service ready, resume không clear unknown/lease hoặc vượt manual job đang chờ.
Không lưu note/bearer/body thô vào request/audit. Đây là persistence gate; HTTP body limits/drain,
runtime manual acceptance và Desktop flow còn checkpoint5b, write capabilities vẫn unsupported.

### Các route đọc

Chỉ explicit `run-product` mở các route `/v1/controllers/{controller_id}/...` trên
`127.0.0.1:8768`. Mỗi request cần header `Authorization: Bearer <issued credential>`;
không nhận token trong URL hoặc origin từ browser. Default `run` vẫn health-only.

Các route GET đã có: `identity`, `status`, `capabilities`, `apps`, `apps/{id}`,
`apps/{id}/jobs`, `apps/{id}/deployments`, `apps/{id}/history`. DTO chỉ lấy current
controller/Product ownership và trường được cho phép; không trả env/credential,
stdout/stderr hay raw safe-summary JSON. Quyền bị thu hồi có hiệu lực ngay với
process đang chạy. App đã đổi controller/archived không đọc được bằng cursor cũ.

Collection nhận `limit`1–100 (mặc định50) và `cursor` opaque. App list đi theo
app_id tăng dần, giữ upper bound của page đầu; các collection của app giữ ceiling
và offset. Cursor AES-GCM bind purpose/controller/app/collection, không cấp quyền;
mỗi page vẫn xác thực lại. Header/request time, URL, response≤1MiB và rate120request/phút
được giới hạn; response `no-store`/connection close. Trang rỗng khác lỗi tải.

Manual redeploy/policy writes, request lookup và logs còn `UNSUPPORTED`501;
capabilities của các thao tác ghi là unsupported. Desktop tunnel/credential store/UI
chưa nối ở checkpoint này, không tự fallback sang DB hoặc pipeline Desktop.

Các lab systemd/native dùng cổng contract8768. Không chạy đồng thời với Windows
`ControllerService.test.ts` trên máy có WSL localhost forwarding; chạy nối tiếp để
không biến tranh cổng của fixture thành lỗi service.

## Bật execution có chủ đích (R3c-1)

Chỉ dùng bundle đã kiểm bằng CLI tin cậy và independent manifest pin. Controller phải có protected
master key/VPS credential, Product ownership/source config và enrolled target app/generation từ trước.
Không copy Desktop DB, tự học host key, tạo lại key hoặc tự bỏ pause để vượt prerequisite.

Input JSON không chứa secret, cùng format với `recover-runtime`:

```json
{
  "format": 1,
  "artifact": "/opt/opspilot-controller/payload/control-plane.cjs",
  "manifest_sha256": "<64 lowercase hex from trusted build>"
}
```

```sh
node /opt/opspilot-controller/payload/control-plane.cjs recover-runtime --data-dir /var/lib/opspilot-controller < /etc/opspilot-controller/execution.json
node /opt/opspilot-controller/payload/control-plane.cjs run-product --data-dir /var/lib/opspilot-controller < /etc/opspilot-controller/execution.json
```

`recover-runtime` trả report, không bật worker; phải đọc `state`, không suy từ exit0. `run-product`
phục hồi enrollment/T1 bằng historical manifest/key trước claim, rồi mới chạy poller/worker. Unknown
không tự reinstall/replay. Management RAM/disk phải đo được và đủ ngưỡng; trước dispatch còn kiểm
target qua pinned SSH, Docker và port. Packaged template/collector path lấy từ verified bundle,
không phụ thuộc cwd hay `OPSPILOT_TEMPLATES_DIR`. Product hiện chỉ hỗ trợ Express không DB/required-env;
framework parity và Desktop/API integration chưa được nhận hoàn tất.

Health chỉ có `GET /healthz` loopback: `maintenance` khi polling-only/đang khởi động hoặc dừng,
`degraded` khi recovery/admission/poller/worker blocked, `ready` khi execution sẵn sàng nhận việc.
Đây không phải chứng nhận mọi app/domain khỏe. SIGTERM/SIGINT hủy và chờ task dừng trước khi đóng
SSH/SQLite; unconfirmed task không được clear lease hoặc đóng DB giả như đã hoàn tất.

`opspilot-controller-product.service.example` là unit opt-in riêng, nhận metadata bằng systemd
`StandardInput=file:`; admin cung cấp Node22/runtime dependencies/approved bundle, private data directory
và file metadata chỉ admin sửa. Chưa tự install unit, mở `/v1`, hay chạy live VPS trong checkpoint này.
[Gate và giới hạn R3c-1](../../docs/tasks/tk-s7-release-r3c1-execution-service.md).

## Gói phát hành và kiểm checksum trước kích hoạt (R3b-5a)

Build offline hiện tạo entrypoint cùng `target-helper/` (3 runtime files + 1 enrollment bootstrap), `templates/` (4 files), `collector/`
(3 files) và `bundle-manifest.json`. Catalog approved ở `bundle-files.json`, không glob repo hoặc
copy tests/cache/venv/node_modules/.env. Build in digest SHA256 của manifest ra stdout. Native
dependencies vẫn cài từ package-lock tại runtime directory **ngoài payload directory**.

Admin lấy digest qua kênh build tin cậy và dùng **CLI đang tin cậy** để kiểm gói ứng viên trước khi
chạy nó; không khởi động binary chưa xác minh chỉ để nó tự xác minh:

```sh
node /trusted/control-plane.cjs verify-bundle \
  --artifact /releases/candidate/control-plane.cjs \
  --manifest-sha256 <64-lowercase-hex-from-trusted-build>
```

Lệnh chỉ đọc file, không cần `--data-dir`, không tạo/migrate DB hoặc mở SSH/HTTP. Kiểm exact file
set, size/hash, digest manifest tường minh, từ chối symlink/hardlink/traversal/duplicate/extra file.
Linux còn kiểm owner (root hoặc user hiện hành) và từ chối group/world-writable files/directories.
Windows diagnostic không chứng minh ACL Linux. Output có verified paths cho templates/collector/
helper; không tự đặt global env hoặc bật deployment executor.

Payload directory hiện chứa 12 files và manifest; không đặt data/key/log/node_modules vào đó.
Build/rebuild chỉ trong directory offline, **không đè release đang chạy**. Khi deploy dùng release
directory mới, verify rồi mới activate trong checkpoint service. Hash xác nhận byte theo digest đã
pin, không thay chữ ký hoặc xác thực kênh phân phối. [Hồ sơ/gate R3b-5a](../../docs/tasks/tk-s7-release-r3b5a-controller-bundle.md).

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

## Xác minh source trước lần deploy đầu tiên (R3c-6g3a)

Sau `register-project`, kiểm tra source bằng CLI trên controller:

```sh
node /releases/verified/control-plane.cjs verify-project-source --data-dir /var/lib/opspilot-controller < source-check.json
```

Ví dụ `source-check.json` chỉ chứa metadata. Lấy các generation/hash từ kết quả đăng ký
hoặc trạng thái hiện hành, revision từ `project-targets`, và manifest pin từ bản build tin cậy:

```json
{
  "format": 1,
  "controller_id": "replace-with-controller-id",
  "app_id": 1,
  "expected_ownership_generation": 1,
  "expected_source_generation": 1,
  "expected_source_config_sha256": "replace-with-current-64-hex-source-config-hash",
  "expected_target_security_revision": 1,
  "artifact": "/releases/verified/control-plane.cjs",
  "manifest_sha256": "replace-with-independently-verified-64-hex-bundle-hash"
}
```

Repo/ref/root lấy từ SQLite hiện hành, không nhập lại URL hoặc SHA ở lệnh này.
Controller tải snapshot public GitHub của `refs/heads/<production_ref>` trong thư mục
tạm, dùng chung detector/render/quota với pipeline. Giới hạn toàn thao tác Git90giây,
snapshot512MiB; giới hạn transfer hiện hành vẫn áp dụng lên source/collector/render.
Không cài dependency, chạy code trong repo, build Docker hoặc mở SSH tới target.

App phải Product-owned đúng controller/generation/config, target chưa archive và có pin,
auto-deploy paused, không queued/active/uncertain work/lease/terminal chưa settle.
Sau tải, controller kiểm lại authority/profile/config và observation sequence trước khi
ghi observation + history cùng transaction. Thay đổi giữa chừng bị từ chối; không tự
retry hoặc bật auto-deploy. Rerun cùng SHA giữ nguyên observation sequence.

`state:source_verified` trả full SHA và metadata/counts, không file content hoặc
build/start command. Đây là snapshot source tại thời điểm kiểm tra, **chưa deploy**,
chưa chứng minh Docker, tài nguyên, listener/health hoặc public URL trên target.
Runtime luôn tải đúng SHA và kiểm lại điều kiện trước thực thi. Bước tiếp theo vẫn là
`enroll-target`, readiness và yêu cầu deploy có xác nhận. Chưa có nút source verification
trên Desktop ở6g3a; không coi CLI gate là luồng GUI hoàn tất.

[Contract](../../docs/contracts/product-project-source-verification.ts) và
[hồ sơ/gates](../../docs/tasks/tk-s7-release-r3c6g3a-source-verification.md).

## Cài helper và đăng ký target app (R3b-5b)

```sh
node /trusted/control-plane.cjs enroll-target --data-dir /var/lib/opspilot-controller
```

Chỉ nhận JSON qua stdin pipe/EOF (không gõ secret vào argv/env/terminal); input không chứa key hoặc
script. App/source phải được cấu hình **Product-owned đúng controller/generation, auto-deploy paused**,
không queued/active/uncertain job, unreleased app lease hoặc pending terminal settlement. Lệnh không
tạo source, chuyển Desktop ownership hoặc tự bật auto-deploy. Setup source/ownership/UI vẫn là bước riêng.

```json
{
  "format": 1,
  "controller_id": "<controller_id từ init/status>",
  "app_id": 1,
  "ownership_generation": 1,
  "artifact": "/releases/verified/control-plane.cjs",
  "manifest_sha256": "<64 hex từ build tin cậy>",
  "target_root": "/var/lib/opspilot-product"
}
```

`target_root` là trusted admin config, không lấy từ app/repo: absolute Linux path, không symlink,
control character, `..` hoặc segment quá255bytes; helper path sau khi suy ra phải trong512characters.
SSH user phải sở hữu private base (`0700`) hoặc có quyền tạo base trong parent an toàn. Không chạy sudo,
không chmod/adopt path hiện hữu không an toàn. VPS SSH profile/credential đã enroll trước bằng R3b-4.

Controller kiểm bundle pin, tạo/reuse encrypted HMAC material đúng app/generation một lần, lưu SQLite
`prepared` rồi commit `unknown` **trước** mở bootstrap exec. Source bootstrap đã kiểm SHA256 đi trong
argv; HMAC key chỉ qua bounded SSH stdin (không SSH credential trong payload). Target publish nguyên
tử directory theo controller hash/app ID, gồm helpers/marker/key/manifest/receipt; rename-noreplace
không thay cả directory rỗng đã tồn tại. Không gọi fixture initializer, không Docker/deploy/firewall.

Receipt có HMAC domain riêng, bind exact controller/app/generation/target/release/paths. Controller
đối chiếu current SQLite authority rồi mới lưu `enrolled`. Output chỉ nhận `state:'enrolled'` là ready;
`state:'unknown'` không phải thành công dù CLI đã trả JSON. Sau mất response/process chết, chạy lại
chỉ `inspect`, không cài lại, rotate hoặc ghi đè. Remote absent/partial/tamper vẫn giữ unknown để
operator reconcile; không tự clear barrier. Release/generation/target khác conflict, chưa auto-upgrade.

Helper/state paths trả về lúc này là **installed target paths**, khác local bundle source paths của
`verify-bundle`. Admission/cold startup/service composition phải dùng persisted proof + exact key;
chưa bật service hoặc nối Desktop API/UI từ CLI này. [Hồ sơ và giới hạn gate](../../docs/tasks/tk-s7-release-r3b5b-target-enrollment.md).
