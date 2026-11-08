# Product controller runtime (Linux)

## Chuyển gói và bootstrap qua SSH (R3c-6h2b1)

Backend có `transferControllerRelease` và `callControllerBootstrap`, dùng đúng
SshManager/expected identity và callback kiểm authority hiện hành của Main.
Chưa có IPC/nút Install: phải nối Desktop durable installation journal và bridge
root admin → runtime UID trước wizard. Caller hiện giữ UUID/pins tường minh;
không tạo mã mới hoặc tự chạy lại install sau khi mất phản hồi.

Artifact catalog phải cung cấp **hai pin độc lập từ build tin cậy**: release
manifest và trusted installer CJS. Main kiểm local release/tool trước SSH, Python
kiểm lại trên máy đích trước khi chạy packaged Node. Không cần Node trong SSH
PATH, không npm/curl/apt hoặc download code qua URL tùy ý. Máy đích cần SSH đến
được, Python3 stdlib, root/systemd/util-linux/shadow và libc phù hợp release.

Protocol cố định: JSON frame uint32be tối đa4096bytes, raw manifest tối đa2MiB,
installer tối đa1MiB, release theo limits6h1, aggregate260MiB và overall20phút.
Server yêu cầu ACK1byte cho mỗi file, rồi nhận đúng size từ manifest bằng stream
với SSH backpressure. Không tar extraction và không ACK mỗi64KiB. Namespace
`/var/lib/opspilot-controller-transfer` root0700 giữ immutable UUID/pins/sizes;
khác key, file lạ, symlink/hardlink, hash/mode/ELF/catalog/lock sai đều bị từ chối.

`transfer` cần consent, chỉ staging; file đã commit được reuse khi hash đúng,
partial riêng của request được bỏ để nhận lại file đó. Không đụng service/DB/key.
`status` đọc progress/verified, không tạo namespace hoặc lock mới. `install` và
`recover` cần consent, chỉ gọi trusted installer với stdin do helper tự dựng;
`inspect` chỉ đọc installation. Gói verified chưa có nghĩa service đã cài.

Root flock kế thừa qua child giữ serialization khi SSH mất. Main không auto
reconnect/replay; lỗi sau dispatch có `remote_effects_possible`, timeout/lost
response được ghi nhận unknown. Chỉ explicit status/inspect hoặc same-key
transfer/recover. Receiver không chữa key/DB, không reset controller, không thay
source of truth SQLite. Error là code allowlist, không đưa raw stderr về caller.

CLI lab trước GUI (Linux Node22 root, có systemd):

```sh
export OPSPILOT_CONTROL_PLANE_MODULES=/absolute/approved/node_modules
export OPSPILOT_CONTROLLER_RELEASE_OUTPUT=/private/verified/release
export OPSPILOT_CONTROLLER_RELEASE_PIN='REPLACE_WITH_TRUSTED_RELEASE_MANIFEST_SHA256'
node app/scripts/controller-bootstrap-lab/run.mjs
```

Lab copy release vào private local fixture, build trusted fixture installer từ
source, dùng ephemeral SSH keys trong memory và Python-only SSH PATH. Có actual
stream145MB/systemd, interrupted transfer/resume, namespace crash, pin/hash/quota
checks và lost install reply→cold inspect; chỉ nonce fixture/account/group/unit
được tạo rồi dọn. Không dùng production VPS/DB hoặc reboot host dùng chung.

## Cài system service bằng CLI (R3c-6h2a)

Installer chạy trên Linux x64/glibc với **trusted host Node22**, quyền root và
systemd. Release directory phải đã có trên máy, root-owned và private, pin lấy
từ build tin cậy. Đây là CLI backend; Desktop chưa có transfer/bootstrap/wizard
và bridge root admin → service UID. Không nhập đường dẫn của service mới vào form
binding cũ rồi coi đó là luồng onboarding đã hoàn tất.

Các binary cần có: `systemctl`, `flock`, `setpriv`, `getent`, `useradd`. Build đã
kiểm trên Ubuntu/WSL/glibc2.39; chọn release có libc phù hợp host. Unit example
cũ giữ layout manual; installer render unit riêng từ `controllerInstallation.ts`.

Build trusted installer từ source trước (không chạy candidate để tự verify):

```sh
export OPSPILOT_CONTROL_PLANE_MODULES=/absolute/runtime/node_modules
export OPSPILOT_CONTROLLER_INSTALLER_OUTPUT=/private/trusted/controller-installer.cjs
node app/scripts/build-controller-installer.mjs
```

Receipt build trả hash của installer. Admin dùng bản từ build đã tin; không lấy
installer hoặc pin từ một candidate không rõ nguồn. Trên fresh VPS chưa có Node,
Python bootstrap kiểm bytes/pin trước packaged Node là phần tiếp theo; CLI này
chưa tự cài Node/npm/apt/Docker.

Chạy bằng Node22 tin cậy, quyền root:

```sh
node /private/trusted/controller-installer.cjs < installation.json
```

`installation.json` chỉ có metadata; thay UUID mới trước lần cài đầu, giữ nguyên
UUID/pin sau khi gửi hoặc mất phản hồi. Consent phải do admin chấp thuận:

```json
{
  "format": 1,
  "operation": "install",
  "request_key": "11111111-1111-4111-8111-111111111111",
  "consent": true,
  "release_directory": "/private/build/release",
  "release_sha256": "REPLACE_WITH_TRUSTED_RELEASE_MANIFEST_SHA256"
}
```

`inspect` chỉ nhận `{format:1,operation:"inspect",request_key:"<same UUID>"}`.
`recover` nhận `{format:1,operation:"recover",request_key:"<same UUID>",consent:true,
release_sha256:"<same pin>"}`. Gửi lại `install` đã có receipt chỉ inspect, không
tiếp tục mutation. `recover` là bước riêng cần xác nhận, không đổi pin/UUID hoặc
tạo DB/key khác. Service đã cài nhưng bị stop thì inspect/recover không tự bật lại.

Các vị trí mặc định:

| Nội dung | Vị trí / quyền |
|---|---|
| Journal + kernel lock | `/var/lib/opspilot-controller-install`, root0700 |
| Runtime | `/opt/opspilot-controller/runtime`, service UID0700/0600, Node0700 |
| DB/key | `/var/lib/opspilot-controller`, service UID0700/0600 |
| Unit | `/etc/systemd/system/opspilot-controller-product.service`, root0644 |
| Account | `opspilot-controller`, private group, nologin |

JSON không cho sửa output paths, account/UID, command hoặc unit. Bộ cài từ chối
installation/account/unit lạ, symlink/hardlink và gói sai pin. Root receipt/Unix
account xác định service UID; passive verifier chỉ nhận owner override nội bộ.
Default verifier vẫn từ chối foreign UID. File copy và journal fsync/rename;
kernel flock giữ qua initialization child, không có stale-PID bypass. Lock path
bị mất sau intent phải báo lỗi, không tạo inode mới để vượt khóa cũ.

Init/secrets-init dùng `setpriv --clear-groups` với runtime UID; trước đó cold
smoke kiểm Node/ABI/UID/groups/inherited descriptor. Không lấy Desktop DB hoặc
khóa/credential sang. Account không được login; systemd có NoNewPrivileges,
ProtectSystem=strict, ProtectHome và chỉ data directory được ghi. API vẫn chỉ
`127.0.0.1:8768`; không mở firewall hoặc public admin endpoint.

`service_state:running` cần đúng unit/UID/argv, socket loopback thuộc MainPID và
health ready. `service_enabled` là trạng thái autostart riêng. Receipt installed
là lịch sử cài, không có nghĩa service luôn đang chạy hoặc đã deploy dự án.
Key thiếu, owner/identity sai hoặc DB init chưa đủ marker đều báo recovery cần
thiết; không xóa/khởi tạo lại dữ liệu để che lỗi. Chưa có upgrade/uninstall UI.
Reboot/soak/live VPS còn là gate riêng; lab mới xác minh enable/start/restart/stop.

Lab disposable root/systemd: `app/scripts/controller-service-lab/run.mjs`, cùng
biến modules/release output/pin ở phần dưới, chạy Node22 root. Chỉ tạo account,
unit và `/opt/opspilot-controller-service-lab-<nonce>` của chính fixture; cleanup
kiểm nonce/owner, stop/disable unit rồi xóa account/private group/fixture. Không
đổi production paths hoặc reboot WSL/Docker host dùng chung.

## Gói runtime offline và kiểm tra máy cài (R3c-6h1)

Đã có builder Linux và passive verifier cho release directory gồm Node22,
production dependencies đúng lock, CLI và assets đã kiểm. Chưa có transport,
transaction cài service hoặc nút cài controller trong Desktop; form binding hiện
hành vẫn cần controller được admin thiết lập trước. Không xem build thành công
là service đang chạy hoặc app đã deploy.

Build trên **Linux x64/glibc, Node22**, bằng môi trường phát triển tin cậy.
`npm ci --prefix app/control-plane-runtime` dùng lock đã duyệt, gồm esbuild cho
builder. Chỉ production packages được đưa vào release. Không copy node_modules
từ Windows/Electron. Node đi kèm lấy từ chính `process.execPath` của builder;
không download hoặc tự chọn phiên bản Node từ VPS. Digest bảo vệ toàn vẹn với
pin độc lập, không thay xác thực nguồn phân phối.

```sh
export OPSPILOT_CONTROL_PLANE_MODULES=/absolute/runtime/node_modules
export OPSPILOT_CONTROL_PLANE_OUTPUT=/private/build/payload/control-plane.cjs
node app/scripts/build-control-plane.mjs
# Lấy manifest_sha256 từ receipt build tin cậy bên trên.
export OPSPILOT_CONTROLLER_RELEASE_ARTIFACT=/private/build/payload/control-plane.cjs
export OPSPILOT_CONTROLLER_RELEASE_PAYLOAD_PIN='REPLACE_WITH_64_LOWERCASE_HEX_PAYLOAD_PIN'
export OPSPILOT_CONTROLLER_RELEASE_OUTPUT=/private/build/release
node app/scripts/build-controller-release.mjs
```

Thư mục cha output phải tồn tại và thuộc builder/root, không group/world-write;
destination phải chưa tồn tại. Builder ghi staging riêng rồi rename sau verify.
Lỗi giữ staging có nonce để điều tra; không thay destination cũ. Node-gyp có thể
tạo hardlink trong trusted input; builder chép bytes sang inode mới, verifier
release vẫn từ chối mọi hardlink/symlink/special file. Runtime files600, Node700,
directories700. Build artifacts giữ ngoài Git, không commit Node/node_modules.

Receipt gồm `manifest_sha256`, file count và byte count. Admin/installer phải
nhận pin này từ nguồn tin cậy độc lập với candidate, rồi gọi
`verifyControllerRelease(absoluteDirectory, trustedPin)` từ code đã tin. Verifier
không chạy/import candidate: kiểm exact files/directories, SHA/size/limits,
approved lock/package versions, payload catalog và ELF64 x86_64 của Node/native
addons. `minimum_glibc` lấy từ builder, bảo thủ với host cũ; header ELF không
chứng minh ABI, nên activation tiếp theo vẫn phải cold-smoke trên máy đích.

`probeControllerHost` dùng fixed readonly Python qua SshManager với expected
identity/pin bắt buộc, response4096bytes, deadline15s/channel, không thu stderr
thô. Probe đọc OS/CPU/libc, RAM/disk còn trống, UID/systemd/bus/linger và default
installation conflicts. Root cần system systemd; user cần user bus + linger
đã có sẵn. RAM phải >512MiB, disk >2GiB. Không apt/npm/curl, tạo user, sửa
firewall, init DB/key, cài hoặc start service. Snapshot không reserve tài nguyên.

Lab độc lập trước UI:

```sh
export NODE_PATH="$OPSPILOT_CONTROL_PLANE_MODULES"
export OPSPILOT_CONTROLLER_RELEASE_PIN='REPLACE_WITH_64_LOWERCASE_HEX_RELEASE_PIN'
node app/scripts/controller-release-lab/run.mjs
```

Lab yêu cầu user Linux **không root**; chỉ private fixture DB và localhost SSH,
ephemeral keys trong memory. Chứng minh cold Node/native SQLite/CLI, pin/tamper,
source version drift, không overwrite, readonly SSH và pin sai không auth/exec.
Receipt dưới `app/.out-scripts/controller-release/<nonce>/result.json`. Không
phải test service start/reboot, production VPS hoặc PRODUCT_PASS.

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

## Chuẩn bị target từ Desktop (R3c-6g3c)

Dự án Product đã đăng ký có nút **Prepare target**. App đọc metadata hiện hành từ
controller và hiển thị SSH host/user/port, fingerprint, thư mục private và trạng thái.
Việc mở màn hình hoặc tải lại trạng thái không cài helper, tạo khóa hay tạo deployment.

Với target chưa chuẩn bị, nhập thư mục private (gợi ý `/var/lib/opspilot-product`),
chọn **Review**, xem lại đúng VPS/fingerprint/root rồi **Confirm preparation**. SSH user
phải có quyền tạo base; parent phải tồn tại, an toàn. Không sudo, chmod hay ghi đè
thư mục không an toàn. Root là cấu hình quản trị do người dùng xác nhận, không lấy từ repo.
Controller dùng installer và proof hiện hữu, ghi trạng thái trước SSH, không build/run app.

Nếu trạng thái **Outcome unknown**, thư mục cũ bị khóa và nút **Verify existing setup**
chỉ inspect proof đúng cấu hình; không cài lại hoặc tạo khóa thay thế. Sau khi tắt/mở
Desktop, **Load status** đọc lại record trên controller. Không đổi root để đoán kết quả.
Nếu proof/binding/release xung đột, dừng và xem lại với quản trị viên; không tự clear barrier.

**Target confirmation stored** chỉ xác nhận controller có stored HMAC proof hợp lệ.
Không phải VPS online, Docker sẵn sàng, app đã chạy hoặc URL đã public. Trước deploy
vẫn cần readiness tài nguyên/Docker/runtime và yêu cầu deploy có xác nhận (6g3d).
Đóng modal trong lúc chuẩn bị không tuyên bố hủy tác vụ controller; tải trạng thái
lại để kiểm chứng kết quả. Source verification là bước riêng và auto deploy vẫn paused.

CLI quản trị tương ứng: `project-target-state` dùng cùng JSON authority/artifact/pin
như `verify-project-source`; `enroll-project-target` thêm `target_root`. CLI wrapper
giữ current source/config/target fences trong prepare/begin/complete transaction và
ghim expected SSH identity trước auth. `enroll-target` cũ tiếp tục tương thích.

[Contract](../../docs/contracts/product-project-target.ts) và
[hồ sơ/gates](../../docs/tasks/tk-s7-release-r3c6g3c-target-ui.md).

## Xác minh source từ Desktop (R3c-6g3b)

Trong Settings → View Product apps → Product projects, dự án đã đăng ký có nút
**Check source**. Mở nút để xem lại repo/nhánh/thư mục và target, rồi chọn **Verify source**.
Controller tải source và trả full SHA, số file, dung lượng, cổng và thời điểm kiểm tra.
Chỉ kết nối active đã opt-in quyền deploy/policy mới có thể thực hiện. Không cần nhập
lại command, token, đường dẫn bundle hoặc SHA; main lấy metadata từ nhật ký đã đăng ký.

Kiểm tra có thể mất tối đa hai phút. Source không hỗ trợ, repo không tải được, cấu hình
đã đổi, app chưa paused hoặc quá hạn có thông báo riêng. Lỗi chưa rõ có thể kiểm tra lại
đúng dự án; thao tác này không đăng ký lại app hoặc tạo job/deployment. Đóng modal chỉ
đóng màn kết quả, không tuyên bố đã hủy tác vụ đọc trên controller. Refresh/đổi binding
bỏ kết quả cũ; kết quả không được lưu thành cờ ready. Target enrollment/runtime preflight
và deploy đầu tiên vẫn là bước tiếp, chưa được tự bật khi source kiểm tra thành công.

[Hồ sơ và bằng chứng Desktop](../../docs/tasks/tk-s7-release-r3c6g3b-source-ui.md).

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
