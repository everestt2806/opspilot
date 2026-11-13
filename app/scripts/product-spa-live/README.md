# R7c — Trusted SPA controller release và development VPS gate

Release này bổ sung capability SPA đã được kiểm ở R7a/R7b. Giữ nguyên hai
descriptor cũ; `app/control-plane-runtime/desktop-spa-retained-release.json` thêm bản mới.
Không sửa pin cũ hoặc dùng manifest do receiver tự báo làm nguồn tin cậy.

Approved Linux x64/glibc2.39, Node22.23.4; dùng modules từ approved controller
lock. Build dưới UID sở hữu modules; không đổi owner hoặc cài dependency bằng
root để né verifier. `OUTPUT` phải là thư mục private mới:

```sh
export OPSPILOT_CONTROL_PLANE_MODULES=/var/tmp/opspilot-p3e3a-runtime/node_modules
export OPSPILOT_CONTROL_PLANE_OUTPUT="$OUTPUT/payload/control-plane.cjs"
node app/scripts/build-control-plane.mjs
export OPSPILOT_CONTROLLER_RELEASE_ARTIFACT="$OPSPILOT_CONTROL_PLANE_OUTPUT"
export OPSPILOT_CONTROLLER_RELEASE_PAYLOAD_PIN=4fbe3321801fd084749df2892fbc2fa078ae6e64e6458a107b5940517f0ff957
export OPSPILOT_CONTROLLER_RELEASE_OUTPUT="$OUTPUT/release"
node app/scripts/build-controller-release.mjs
export OPSPILOT_CONTROLLER_INSTALLER_OUTPUT="$OUTPUT/installer.cjs"
node app/scripts/build-controller-installer.mjs
```

Frozen payload manifest4fbe332, releasea81ed72, installer8ac74cd; full pins nằm
trong descriptor. Copy generated release/installer vào ignored resource namespace
`app/resources/controller-releases/linux-x64-node22-20261113-spa-retained/`, giữ các bản cũ.
Production build bake cả bốn pins. Candidate6b5348b chỉ giữ historical để inspect/
rollback/adopt, không còn được chọn nâng cấp mới. Packaging gate đọc compiled pins, không tin JSON
catalog bị thay tại runtime. Source thay đổi cần release mới/pin mới, không gọi
artifact mới là bản dựng lại của pin này.

Native [upgrade lab](../controller-upgrade-desktop-lab/README.md) dùng original
release96a6a5b từ protected `linux-x64-node22-20261110/release`, không nhầm cache
builder9f387f4. Candidate dùng SPA releasea81ed72. Root/systemd/SSH/Main/SQLite
thật,19checks gồm lost reply/cold inspect/rollback, giữ UID/UUID/key/DB/client và
historical catalog vẫn inspect được khi đã rút khỏi lựa chọn mới.
Policy chỉ cho exact old→new pair của `static-spa.Dockerfile` và
`target_product_runtime.py`; Node/dependencies/asset khác giữ nguyên.

Native `controller-enrollment.mjs --retained-target-gate` dùng artifact mới cùng
`OPSPILOT_LEGACY_PAYLOAD` trỏ tới payload4e3a163 từ release cũ đã pin. Kiểm10cases
qua SSH/SQLite/CLI thật: legacy Express enrollment giữ nguyên helper và startup
ready; SPA legacy và helper bị tamper từ chối. Đây là gate bắt buộc khi nâng
controller có target cũ; empty-controller upgrade không thay thế gate này.

Development VPS gate dùng Windows Electron-as-Node để giữ SQLite ABI và DPAPI.
Sau `pnpm.cmd --prefix app build` và native gate PASS:

```text
Electron-as-Node app/scripts/product-spa-live/run.mjs --confirm-development-spa-rollout
Electron-as-Node app/scripts/product-spa-live/run.mjs --resume <12-hex-record>
```

Fresh input là bounded JSON qua redirected stdin: host/port/username/
host_fingerprint/password; secret chỉ lấy từ prompt bảo mật/RAM rồi đóng stdin,
không ghi secret vào file, shell command, argv hoặc env. Chỉ chấp nhận development
VPS167.71.202.116 và ED25519 pin đã lấy độc lập. Không dùng production Desktop
profile. Resume dùng exact `.owner`/private journal đã mã hóa, không nhập lại secret
hoặc phát lại upgrade sau unknown; inspect cùng UUID trước mọi quyết định.

Gate cold-adopt controller hiện hành, cấp client thử với consent, nâng qua Main
review/transfer/upgrade rồi xác nhận API binding riêng, giữ token/client. Sau đó
tạo public branch `demo/spa-r7c-<nonce>` trong repository hiện hành, chỉ source
Tiệm Đọc và lock đã duyệt; không merge vào nhánh sản phẩm. Bốn commits initial,
update, fault, final có Kim coauthor. Fault làm index không đọc được để kiểm
health403/auto rollback đúng app+collector CID. Final đưa branch/app về bản khỏe.
Đăng ký dự án, source verification, enroll target, preflight/first-deploy và các
lần redeploy đều qua production Main/controller API/pipeline; không SQL viết tay
hoặc Docker writer để dựng kết quả. Kiểm deep route/index, asset404 và release
marker từ ngoài VPS. Client thử revoke cuối gate; app giữ paused để không chạy
job ngoài kiểm soát. Giữ nguyên hai app cũ và collector của chúng.

Report và encrypted recovery journal riêng trong
`app/.out-scripts/product-spa-live/<nonce>/`. PASS mới xóa private DB/key; lỗi giữ
same-key journal để inspect/recover, không tự tạo installation/upgrade/app thay
thế. Gate không kiểm GUI, reboot, soak, domain/HTTPS, ML hoặc toàn R7.
