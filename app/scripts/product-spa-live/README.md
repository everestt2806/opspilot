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

## R7d — SPA tự deploy khi Main ngắt SSH

Sau R7c, nghiệm thu đúng app3/port30002 và branch demo đã duyệt:

```text
Electron-as-Node app/scripts/product-spa-live/auto.mjs --confirm-development-auto 6ab247675f19
```

Input bounded stdin/DPAPI và SSH pin giống R7c. Đây là gate một lần từ exact
R7c final SHA1191914b; không reset branch về commit cũ để chạy lại. Report lưu
riêng tại `app/.out-scripts/product-spa-auto/<nonce>/result.json`, không sửa raw
R7c. Thiếu cờ/record duyệt bị từ chối exit2 trước tạo scratch hoặc kết nối.

Gate cold-adopt current controller, cấp client thử và resume policy app3 qua
Main. Sau `disconnectAll()` và xác nhận không còn verified connection, mới
commit/push thay `public/release.txt` trên demo branch. Không gửi redeploy hoặc
SSH trong thời gian đợi marker qua HTTP công khai. Khi marker mới xuất hiện,
mới reconnect để kiểm đúng1job `trigger=branch_poll`, đúng fullSHA/succeeded,
terminal settled và app/build leases released. Deep route/index, asset404 và
external exposure cũng phải đạt. Cuối gate pause policy, revoke client, kiểm
old4CID/controllerPID/key/DBinode/schema/Root receipts, xóa private scratch.

Nếu FAIL sau resume, giữ encrypted private journal và request UUID trong report.
Không chạy fresh gate hoặc phát lại command khi phản hồi chưa rõ; mở đúng
private Main profile, dùng `checkCommand(request_key)` để reconcile cùng UUID,
đọc current app status rồi explicit pause policy scoped app3/revoke client.
Không sửa SQL, journal, key hoặc source branch để tạo kết quả PASS. Chỉ xóa
đúng owned private profile sau khi reconcile và lưu bằng chứng; raw report giữ.

Live10be92694bb1 PASS3checks: commit2e4c991/deployment10,22HTTP polls, job
branch_poll thành công,0active jobs/clients/experiments cuối gate. Policy đã
paused; cần resume có chủ đích nếu dùng demo auto sau này. Main SSH thực sự
đã ngắt; process quan sát HTTP vẫn chạy. Không gọi gate này là bằng chứng OS
Desktop process đã thoát, GUI/reboot/soak hay toàn template matrix. R7c health403
rollback và R7d healthy auto commit là hai gate riêng.

## R7f — Trusted Next.js release và VPS

Additional descriptor `desktop-next-release.json` dùng release
`linux-x64-node22-20261113-next`, SHA
`b6803bc794cb39987936395d8d1f12cd06720a08f2e0ba2c3307ec619368ab45`;
payload manifest
`93abe6ea846f44ef914d0a9ee6e74aaa7e40d3c1ec3a353e537ca89b1ff0c777`;
control-plane.cjs
`2a444abc24115985f920d48bc7cf049bf376cc37ab386d1b7aa4e2d5b620ac95`.
Installer/upgrader8ac74cd, Node22.23.4/glibc2.39/modules/asset policy giữ nguyên.
Build theo recipe đầu file dưới UID sở hữu modules với OUTPUT private mới,
thay payload pin bằng93abe6e, copy release/installer vào ignored resource
namespace mới. Main bake5entries và giữ cả4pins lịch sử. Không ghi đè old release.

Chạy native upgrade với original96a/candidateb680 và retained enrollment với
current payload93ab/legacy4e3a trước VPS. Desktop source/R7e full2244+2existing
skip là baseline; descriptor/driver changes có scoped types/lint/build/catalog
regression và compiled-resource missing/tamper/refusal/restore gate riêng.

```text
Electron-as-Node app/scripts/product-spa-live/run.mjs --nextjs --confirm-development-next-rollout
Electron-as-Node app/scripts/product-spa-live/run.mjs --nextjs --resume <12-hex-record>
```

Explicit CLI guard/secret stdin/pin/DPAPI/same-key unknown handling như R7c.
Variant Next dùng private journal `product-next-live/<nonce>`, source Git
`product-next-git/<nonce>` và branch `demo/next-r7f-<nonce>` riêng. Không đưa
record Next vào namespace SPA hoặc sửa raw lịch sử. Ba app cũ gồm SPA6ab được
kiểm6CID trước/sau. Gói mới chỉ được nâng qua Main review/transfer/upgrade/
inspect và separate API-binding refresh giữ client/token. Không Root SQL writes.

Fixture Sổ Đọc dùng package/lock approved từ demo-next-blog, source Pages Router
SSR riêng không env/DB,1build CPU; không nhận Dockerfile/start command từ renderer.
Initial/update/fault/final là4public commits trên nhánh demo có Kim coauthor.
Fault SSR trả503 thật để kiểm health rollback exact app+collector CID; final
đưa branch/app về khỏe. HTTP ngoài VPS kiểm marker trong SSR index và deep
route, asset `/_next/`200, missingasset404 và release marker; exposure recorded
reachable qua Main/API. Đây là manual Git redeploy acceptance; auto Git Next
khi Main tắt/ngắt là gate riêng, không suy từ R7d SPA hoặc ca manual này.

PASS yêu cầu0active jobs/experiments, policypaused, client thử revoke và private
journal cleanup; giữ original receipt/key/DBinode/schema/target credentials và
3apps. FAIL giữ encrypted same-key journal để inspect/reconcile; không reset
DB/branch hoặc replay unknown. Không GUI/NSIS/new Windows/reboot/soak/ML hoặc
Next DB/env/customserver/customDockerfile claim.

## R7g — Next.js auto Git khi Main ngắt SSH

```text
Electron-as-Node app/scripts/product-spa-live/auto.mjs --nextjs --confirm-development-auto ba8a98aed302
```

Input secret bounded stdin/DPAPI và SSH pin như R7d/R7f. Variant Next chỉ nhận
exact R7f app4/port30003/framework/record đã PASS và private journal đã cleanup;
local/remote HEAD phải trùng R7f finalab115722. Không reset branch để chạy lại.
Report riêng `app/.out-scripts/product-next-auto/<nonce>/result.json`; raw R7f
không sửa. CLI thiếu consent hoặc recordSPA bị từ chối exit2 trước tạo scratch.

Sau cold adoption/scoped client/policy resume accepted, gate disconnectAll và
kiểm không còn verified connection trước Git commit/push. Commit chỉ đổi
`public/release.txt` và marker trong `pages/index.jsx` trên demo branch hiện có,
Kim coauthor. Chỉ HTTP observer chờ marker công khai; không manual redeploy,
appStatus/API hoặc SSH poll trước public success. Sau đó mới reconnect để kiểm
đúng1job triggerbranch_poll/target fullSHA/succeeded,1H2terminal settled và cả2
leases released. SSR index/deep phải chứa marker mới, Nextasset200 và asset
thiếu404, Main exposure recorded reachable. Giữ3oldapps/6CID/controllerPID/key/
DBinode/schema/Root receipts; pause lại, revoke client và xóa private journal
khi PASS. Controller release hiện tại giữb680/93ab, không nâng lại để chạy gate.

Nếu lỗi sau resume: giữ encrypted journal và request UUID. Mở đúng private Main
profile để `checkCommand(request_key)` cùng key, đọc current app status, explicit
pause scoped app4 và revoke client; không chạy lại fresh hoặc replay unknown.
Không Root SQL writes, reset source/history/key hoặc sửa raw report để làm PASS.
HTTP-only observer process vẫn sống; bằng chứng là Main SSH disconnected trong
khoảng Git→build→public success, không tuyên bố OS Desktop process đã thoát.
R7f manual health503 rollback là proof riêng, không tự gọi là Next auto rollback.
