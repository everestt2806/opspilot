# Lab Main journal → SSH → controller upgrade

R3c-6h4c-2a/c-2b1/c-2b2: chạy root Linux systemd/Node22, loopback8768 đang trống. Không chạy đồng thời Windows ControllerService tests hoặc controller khác dùng8768.

Đầu vào trusted:

- `OPSPILOT_CONTROL_PLANE_MODULES`: Linux dependencies đã duyệt.
- `OPSPILOT_CONTROLLER_RELEASE_OUTPUT` và `OPSPILOT_CONTROLLER_RELEASE_PIN`: original release/pin độc lập, không đọc pin do receiver tự báo.
- `OPSPILOT_UPGRADE_RELEASE` và `OPSPILOT_UPGRADE_RELEASE_PIN`: candidate release/pin độc lập, cùng schema029/helper/dependency lock.

```sh
env OPSPILOT_CONTROL_PLANE_MODULES=/path/to/approved/node_modules \
  OPSPILOT_CONTROLLER_RELEASE_OUTPUT=/path/to/original/release \
  OPSPILOT_CONTROLLER_RELEASE_PIN=<original-pin> \
  OPSPILOT_UPGRADE_RELEASE=/path/to/new/release \
  OPSPILOT_UPGRADE_RELEASE_PIN=<new-pin> \
  /path/to/node22 app/scripts/controller-upgrade-desktop-lab/run.mjs
```

Fixture tạo root/account/unit riêng theo nonce, original transfer namespace và upgrade namespace độc lập. SSH2 server dùng host/client key sinh trong RAM; Python-only SSH PATH, receiver/Root installer/service UID/systemd/SQLite là thật. Main DB030 khác controller DB029. Không ghi key hoặc credential vào receipt; cold subprocess nhận key tạm qua stdin, chỉ trả metadata.

Phép thử: prepare idempotent/readonly absent status; verify transfer/tool pins; đóng SSH sau khi nhận command data nhưng trước khi chạy Python/root tool; journal remote chưa tồn tại và wrong-parent recover không tạo journal. Explicit same-key recover dùng verified staging, mất kết quả lần nữa; mở một tiến trình Main mới để inspect cùng UUID, PID không đổi; không cho upgrade lần hai hoặc tự sửa API binding. Revision admin xác minh current unit/runtime/UID/payload dưới original flock rồi chạy unchanged service-UID Python verifier; sai UID/payload hoặc controller dừng bị từ chối, không tự start. Explicit rollback giữ original receipt/identity/key/DB inode; current rolled-back operation admin dùng đúng parent payload; archive VPS chặn dispatch. Cleanup kiểm realpath/marker/unit bytes/account rồi chỉ dọn fixture nonce.

Từ c-2b2, original root admin cấp một client thử vào encrypted Main vault. Sau lost-reply/cold inspect, binding cũ bị chặn; actual DesktopControllerService review → explicit confirm cập nhật runtime intent/revision và giữ nguyên token/client/scopes. Token tiếp tục gọi authenticated loopback identity API200; current revision root admin đọc project targets. Rollback cần xác nhận binding lần nữa và cùng token vẫn gọi API200. Không enroll hoặc rotate để che binding cũ.

Giới hạn:0Productapps/targets, không Docker app deployment/OS reboot/production VPS. Native SSH/systemd/admin/enrollment/Main/vault/API là thật, private lab; không thay live rollout. Credential/VPS-ID rebind là checkpoint riêng, vẫn fail-closed. Raw result/progress trong `app/.out-scripts/controller-upgrade-desktop/<nonce>/`; sanitized proof trong hồ sơ task.

## Electron riêng cho c-2b2

```powershell
. ./tools/enter-node22.ps1
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
pnpm --prefix app exec electron scripts/controller-upgrade-desktop-lab/electron.mjs
```

Private profile/SQLite030/key, production preload và component thật, typed IPC gọi actual Main service. SSH/root responses là synthetic adapter, không dùng profile/VPS/DB sản phẩm. Kiểm consent/manual transfer/upgrade/lost-reply/inspect/refresh/rollback, token/client/scope preservation,4locale ×2theme ×2size;17PNG trong `docs/ui-redesign/screenshots/r3c6h4c2b2/`. Receipt ở `app/.out-scripts/controller-upgrade-electron/<nonce>/result.json`; private data dọn sau kiểm tra. Native lab ở trên chứng minh riêng actual SSH/root boundary, Electron không được ghi thành live SSH proof.

## Tái tạo protected upgrade resource

Descriptor đã duyệt nằm tại `app/control-plane-runtime/desktop-upgrade-release.json`; không thay pin của original release. Binary resources không commit. Để tái tạo đúng bytes của descriptor này, dùng source snapshot `60c14ed` trong checkout/export riêng cùng approved lock; không dùng source mới hơn rồi sửa pin cho khớp. Dùng Linux x64 glibc2.39, Node22.23.4 và approved production dependency lock như release lab. Cung cấp `NODE22`, `MODULES` và thư mục `OUTPUT` mới chưa tồn tại; không tải dependency bằng root:

```sh
env OPSPILOT_CONTROL_PLANE_MODULES="$MODULES" \
  OPSPILOT_CONTROL_PLANE_OUTPUT="$OUTPUT/payload/control-plane.cjs" \
  "$NODE22" app/scripts/build-control-plane.mjs
env OPSPILOT_CONTROL_PLANE_MODULES="$MODULES" \
  OPSPILOT_CONTROLLER_RELEASE_ARTIFACT="$OUTPUT/payload/control-plane.cjs" \
  OPSPILOT_CONTROLLER_RELEASE_PAYLOAD_PIN=4e3a163f077f69cd23b58ffcd26e40506489041804a9b01ea9ef006db3588510 \
  OPSPILOT_CONTROLLER_RELEASE_OUTPUT="$OUTPUT/release" \
  "$NODE22" app/scripts/build-controller-release.mjs
env OPSPILOT_CONTROL_PLANE_MODULES="$MODULES" \
  OPSPILOT_CONTROLLER_INSTALLER_OUTPUT="$OUTPUT/installer.cjs" \
  "$NODE22" app/scripts/build-controller-installer.mjs
```

Kiểm independent release pin `093a05957aa2d1f702a1f495346e338ac8e8ce3934556562f74882a7299962d7`, updater pin `7b19cefec8abce4d9dbba21ec234949fd4ae8783d9994cba817701e5f32a71d0`. Nếu không khớp, dừng; không sửa descriptor để hợp thức hóa artifact. Copy release directory và installer.cjs vào `app/resources/controller-releases/linux-x64-node22-20261112-upgrade/{release,installer.cjs}`; giữ nguyên original resources/catalog. `electron.vite.config.ts` ghép descriptor mới vào protected build catalog. Sau production build, chạy packaging hook để kiểm cả original và upgrade bytes:

```powershell
pnpm --prefix app build
pnpm --prefix app exec node -e "require('./scripts/controller-installer-before-pack.cjs')({packager:{projectDir:process.cwd()}}).then(function(){console.log('PACKAGING_GATE_PASS')})"
```

## c-2b3 — Nhận lại VPS sau đổi SSH

Source hiện tại thêm Desktop-only031; controller và protected upgrade resource vẫn029. Native lab mở lại local VPS bằng một ID mới/ciphertext mới trên cùng host/port/pin/username, chứng minh old authority bị chặn. Main review thực hiện actual pinned SSH Root inspect, confirm ghi append-only audit và đổi installation/upgrade authority nguyên tử, PID giữ nguyên. Token vẫn bị chặn ở khoảng giữa hai bước; separate runtime-binding review/confirm giữ client/token và gọi authenticated API200 + Root admin thành công, rồi rollback/archive guards tiếp tục chạy.

Electron lab thêm chọn candidate VPS, review hostname/user/fingerprint và consent SSH riêng; sau đó buộc xác nhận API binding riêng.19captures gồm2ảnh review SSH ở1280×800/1366×768 và17ảnh unknown/4locale/themes/layout, lưu `docs/ui-redesign/screenshots/r3c6h4c2b3/`. Main/private SQLite/encrypted vault/production preload/UI là thật; SSH responses là synthetic. Không dùng VPS/production DB, không cài lại/start/replay remote bằng chức năng rebind.

Chỉ nhận cùng host/port/fingerprint/username. Máy khác, fingerprint đổi, root operation thiếu/chưa settled/current/running hoặc candidate profile đổi giữa lúc review đều bị từ chối. Khi remote upgrade journal chưa tồn tại hoặc operation đang dở, cần khôi phục đúng authority trước; chức năng này không chuyển quyền sang máy khác hoặc học host key mới.0Productapps/targets trong native lab, không thay live exposure/onboarding/deployment/soak gate.

## c-3b1 — Hồ sơ Desktop mới nhận lại controller hiện hành

Native `run.mjs` thêm một Desktop DB031 hoàn toàn mới sau upgrade, cùng SSH fixture được mã hóa lại trong profile riêng. Fixed Python `discover-current` chỉ đọc original staging/receipt và current journal dưới original root flock. Main match cả original/current release và installer pins trong catalog, gọi pinned updater inspect rồi repeat discovery; review không tạo journal. Confirm trong60s xác minh lại và ghi original/current metadata nguyên tử, giữ UUID/controller ID/parent/pins. Original result được ghi là historical/stopped; trạng thái hiện hành lấy riêng từ current revision đã xác minh. Không cài lại hoặc replay upgrade.

Main chuẩn bị binding theo current runtime sau fresh inspect; separate explicit read-only enrollment gọi authenticated API200 rồi revoke client thử. Lab kiểm PID và bytes original receipt/current journal không đổi. Đây là private Linux SSH/systemd/SQLite thật; không dùng VPS production hoặc triển khai Product app. Bộ gate toàn bộ vẫn phải chạy riêng, không đồng thời test ControllerService trên Windows dùng8768.

```powershell
pnpm --prefix app exec electron scripts/controller-upgrade-desktop-lab/adoption-electron.mjs
```

Electron lab riêng dùng production preload, installer wizard, typed IPC, actual Main và private native SQLite/encrypted vault; discovery/SSH replies là synthetic, không được gọi là live VPS evidence. Kiểm xác nhận nhận lại riêng với API permission, current runtime khác historical result, IDs-only IPC,4locale×2theme×2size và horizontal overflow; ảnh lưu `docs/ui-redesign/screenshots/r3c6h4c3b1/`. Private DB bị xóa sau khi window đóng, profile sản phẩm không bị thay đổi. Lỗi harness lần đầu do dùng sai nhãn nút và stub status chưa đủ đã được sửa; chỉ final result PASS mới dùng làm bằng chứng.

Luồng này chỉ áp dụng khi profile chưa có installation cho cùng VPS identity. Không ghi đè journal đã biết, không chuyển token hoặc import app/history từ máy khác. Original/current protected staging phải còn đầy đủ và thuộc release được app tin cậy; thiếu hoặc sai thì từ chối. Controller gốc chưa nâng cấp tiếp tục dùng luồng cài đặt/inspect cũ. Chưa chứng minh live GUI onboarding/reconnect/firstdeploy: đó là c-3b2, không thay bằng native hoặc synthetic Electron gate.

Trên giao diện Settings → Tự động triển khai trên VPS: chọn VPS đã lưu fingerprint và kiểm tra VPS; nếu profile mới gặp controller đã nâng cấp, wizard chuyển sang review controller hiện hành. Có thể dùng nút “Tìm controller đã nâng cấp” trực tiếp. Kiểm tra máy chủ/tài khoản/fingerprint/controller/release rồi xác nhận “Nhận lại controller”. Bước này chưa cấp API token. Chọn quyền đọc hoặc quyền triển khai, xác nhận riêng rồi “Lưu kết nối”; Main kiểm tra current runtime lần nữa trước enrollment. Đóng wizard khi chờ sẽ bỏ phản hồi UI đến muộn, không tự tiếp tục enrollment.
